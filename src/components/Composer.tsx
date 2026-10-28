import clsx from "clsx";
import { AlertCircle, ArrowUp, BookOpen, FileText, Loader2, Plus, Quote, Slash, Square, Users, X } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { ALL } from "../lib/collab";
import { call, isDesktop } from "../lib/desktop";
import { formatSize, readAttachment } from "../lib/files";
import type { Agent, Attachment, Skill } from "../types";
import { BotAvatar } from "./Avatar";
import { FileIcon } from "./FileCard";

export interface ComposerHandle {
  addFiles: (files: Iterable<File>) => void;
  /** Puts a passage above the box; it is sent as a quote before the message. */
  quote: (text: string) => void;
  /** Focuses the box, optionally typing `insert` into an empty one. */
  focus: (insert?: string) => void;
}

/** A slash command: runs right away instead of being sent to the model. */
export interface Command {
  name: string;
  label: string;
  hint?: string;
  run: () => void;
}

interface Pending {
  key: string;
  name: string;
  size: number;
  status: "reading" | "ready" | "error";
  file?: Attachment;
  error?: string;
}

interface Option {
  key: string;
  icon: ReactNode;
  title: string;
  hint?: string;
  pick: () => void;
}

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

/** The skill's instructions as an attachment, read by the model as "use this skill now". */
function skillAttachment(s: Skill): Attachment {
  const text = s.dir && isDesktop ? `${s.body}\n\n技能文件夹：${s.dir}（其中的参考文件用 read_skill_file 读取）` : s.body;
  return { id: crypto.randomUUID(), name: s.name, size: text.length, kind: "text", text, skill: true };
}

export function Composer({
  placeholder,
  members,
  busy = false,
  canQueue = false,
  tools,
  trailing,
  commands,
  skills,
  workspace,
  onSend,
  onStop,
  ref: handle,
}: {
  placeholder: string;
  members: Agent[];
  busy?: boolean;
  /** While busy, sending is still allowed: the message waits for the running reply. */
  canQueue?: boolean;
  tools?: ReactNode;
  /** Shown just before the send button. */
  trailing?: ReactNode;
  /** Offered when the box starts with `/`. */
  commands?: Command[];
  /** Offered after `$`. */
  skills?: Skill[];
  /** Desktop work mode: `@` also finds files in this folder. */
  workspace?: string;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop?: () => void;
  ref?: Ref<ComposerHandle>;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [quoted, setQuoted] = useState<string | null>(null);
  const [picked, setPicked] = useState<Skill[]>([]);
  const [hits, setHits] = useState<string[]>([]);
  const [sel, setSel] = useState(0);
  // Esc hides the list until the text changes.
  const [dismissed, setDismissed] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // An empty box is one line; measuring it while the window is hidden can give a stale height.
    if (!text) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const load = (name: string, size: number, read: Promise<Attachment>) => {
    const key = crypto.randomUUID();
    setPending((p) => [...p, { key, name, size, status: "reading" }]);
    read.then(
      (file) => setPending((p) => p.map((x) => (x.key === key ? { ...x, status: "ready", file, size: file.size as number } : x))),
      (e: Error) => setPending((p) => p.map((x) => (x.key === key ? { ...x, status: "error", error: e.message || "读取失败" } : x))),
    );
  };

  const addFiles = (files: Iterable<File>) => {
    for (const f of files) load(f.name || "粘贴的图片", f.size, readAttachment(f));
    ref.current?.focus();
  };

  /** A workspace file, read the same way as an upload so PDFs, Word and images work too. */
  const addWorkspaceFile = (root: string, path: string) =>
    load(
      path,
      0,
      call<ArrayBuffer>("ws_read_bytes", { root, path }).then((buf) => {
        const ext = path.split(".").pop()?.toLowerCase() ?? "";
        return readAttachment(new File([buf], path, { type: IMAGE_TYPES[ext] ?? "" }));
      }),
    );

  useImperativeHandle(handle, () => ({
    addFiles,
    quote: (passage) => {
      setQuoted(passage);
      ref.current?.focus();
    },
    focus: (insert) => {
      if (insert) setText((t) => t || insert);
      ref.current?.focus();
    },
  }));

  const slash = commands?.length ? /^\/(\S*)$/.exec(text) : null;
  const dollar = skills?.length ? /(?:^|\s)\$([^\s$]*)$/.exec(text) : null;
  const mention = members.length > 0 || workspace ? /@([^\s@]*)$/.exec(text) : null;
  const fileQuery = workspace && mention ? mention[1] : null;

  useEffect(() => {
    if (fileQuery === null || !workspace) return setHits([]);
    const t = setTimeout(() => {
      call<string[]>("ws_files", { root: workspace, query: fileQuery }).then(setHits, () => setHits([]));
    }, 120);
    return () => clearTimeout(t);
  }, [workspace, fileQuery]);

  const strip = (re: RegExp) => setText((t) => t.replace(re, (whole) => (whole.startsWith(" ") ? " " : "")));

  const pickMember = (name: string) => {
    setText((t) => t.replace(/@([^\s@]*)$/, `@${name} `));
    ref.current?.focus();
  };

  const options: Option[] = [];
  if (slash) {
    const q = slash[1].toLowerCase();
    for (const c of commands!.filter((c) => c.name.startsWith(q) || c.label.includes(q))) {
      options.push({
        key: `/${c.name}`,
        icon: <Slash size={14} />,
        title: `/${c.name}`,
        hint: c.hint ? `${c.label} · ${c.hint}` : c.label,
        pick: () => {
          setText("");
          c.run();
        },
      });
    }
  } else if (dollar) {
    const q = dollar[1].toLowerCase();
    for (const s of skills!.filter((s) => s.name.toLowerCase().includes(q) || s.description.includes(q)).slice(0, 12)) {
      options.push({
        key: `$${s.id}`,
        icon: <BookOpen size={14} />,
        title: s.name,
        hint: s.description,
        pick: () => {
          strip(/(?:^|\s)\$([^\s$]*)$/);
          setPicked((p) => (p.some((x) => x.id === s.id) ? p : [...p, s]));
          ref.current?.focus();
        },
      });
    }
  } else if (mention) {
    const q = mention[1];
    if (members.length > 1 && ALL.startsWith(q)) {
      options.push({ key: "@all", icon: <Users size={14} />, title: ALL, hint: "每人直接回复", pick: () => pickMember(ALL) });
    }
    for (const m of members.filter((m) => m.name.includes(q))) {
      options.push({ key: `@${m.id}`, icon: <BotAvatar agent={m} size={22} />, title: m.name, hint: m.tagline, pick: () => pickMember(m.name) });
    }
    for (const path of hits.slice(0, 8)) {
      options.push({
        key: `@file:${path}`,
        icon: <FileText size={14} />,
        title: path.split("/").pop()!,
        hint: path,
        pick: () => {
          strip(/(?:^|\s)@([^\s@]*)$/);
          addWorkspaceFile(workspace!, path);
          ref.current?.focus();
        },
      });
    }
  }
  const shown = dismissed === text ? [] : options;
  const optionKeys = shown.map((o) => o.key).join("|");
  useEffect(() => setSel(0), [optionKeys]);

  const ready = pending.filter((p) => p.status === "ready").map((p) => p.file!);
  const reading = pending.some((p) => p.status === "reading");
  const hasContent = !!text.trim() || ready.length > 0;
  const canSend = (!busy || canQueue) && !reading && hasContent;

  const submit = () => {
    if (!canSend) return;
    const quote = quoted ? `${quoted.split("\n").map((l) => `> ${l}`).join("\n")}\n\n` : "";
    onSend(`${quote}${text.trim()}`, [...picked.map(skillAttachment), ...ready]);
    setText("");
    setPending([]);
    setPicked([]);
    setQuoted(null);
  };

  return (
    <div className="relative">
      {shown.length > 0 && (
        <div className="rise absolute bottom-full left-2 z-20 mb-2 max-h-80 w-[min(380px,calc(100%-16px))] overflow-y-auto rounded-2xl border border-line bg-raise p-1.5 shadow-[var(--shadow)]">
          {shown.map((o, i) => (
            <button
              key={o.key}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setSel(i)}
              onClick={o.pick}
              className={clsx("flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left", i === sel && "bg-hover")}
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-hover text-fg-2">{o.icon}</span>
              <span className="shrink-0 text-sm font-medium">{o.title}</span>
              {o.hint && <span className="ml-auto min-w-0 truncate text-xs text-fg-3">{o.hint}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="rounded-[26px] border border-line bg-raise px-2 py-2 shadow-[var(--shadow)] focus-within:border-line-2">
        {quoted && (
          <div className="mx-1 mb-2 flex items-start gap-2 rounded-xl bg-bg px-3 py-2 text-[13px] text-fg-2">
            <Quote size={14} className="mt-0.5 shrink-0 text-fg-3" />
            <span className="line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap">{quoted}</span>
            <button type="button" aria-label="取消引用" onClick={() => setQuoted(null)} className="shrink-0 text-fg-3 hover:text-fg">
              <X size={14} />
            </button>
          </div>
        )}
        {(pending.length > 0 || picked.length > 0) && (
          <div className="flex flex-wrap gap-2 px-1 pb-2 pt-0.5">
            {picked.map((s) => (
              <div key={s.id} title={s.description} className="flex max-w-[240px] items-center gap-2 rounded-xl border border-line bg-bg py-1.5 pl-1.5 pr-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text">
                  <BookOpen size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{s.name}</span>
                  <span className="block truncate text-[11.5px] text-fg-3">技能 · 这次按它的说明做</span>
                </span>
                <button type="button" aria-label={`移除 ${s.name}`} onClick={() => setPicked((p) => p.filter((x) => x.id !== s.id))} className="text-fg-3 hover:text-fg">
                  <X size={14} />
                </button>
              </div>
            ))}
            {pending.map((p) => (
              <div
                key={p.key}
                title={p.error}
                className={clsx(
                  "flex max-w-[240px] items-center gap-2 rounded-xl border py-1.5 pl-1.5 pr-2",
                  p.status === "error" ? "border-bad/40 bg-bad-soft" : "border-line bg-bg",
                )}
              >
                {p.file?.kind === "image" && p.file.image ? (
                  <img src={`data:${p.file.mime};base64,${p.file.image}`} alt="" className="size-8 rounded-lg object-cover" />
                ) : (
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text">
                    {p.status === "reading" ? <Loader2 size={15} className="animate-spin" /> : p.status === "error" ? <AlertCircle size={15} className="text-bad" /> : <FileIcon kind={p.file?.kind} />}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{p.name}</span>
                  <span className={clsx("block truncate text-[11.5px]", p.status === "error" ? "text-bad" : "text-fg-3")}>
                    {p.status === "reading" ? "读取中…" : p.status === "error" ? p.error : `${formatSize(p.size)}${p.file?.pages ? ` · ${p.file.pages} 页` : ""}${p.file?.truncated ? " · 只读取前一部分" : ""}`}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`移除 ${p.name}`}
                  onClick={() => setPending((list) => list.filter((x) => x.key !== p.key))}
                  className="text-fg-3 hover:text-fg"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <button
            type="button"
            aria-label="添加附件"
            title="添加文件：文本、代码、PDF、Word、Excel、PPT、zip 压缩包或图片"
            onClick={() => picker.current?.click()}
            className="grid size-9 shrink-0 place-items-center rounded-full text-fg-2 hover:bg-active hover:text-fg"
          >
            <Plus size={20} />
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles([...e.target.files]);
              e.target.value = "";
            }}
          />
          {tools}
          <textarea
            ref={ref}
            rows={1}
            value={text}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.length) {
                e.preventDefault();
                addFiles(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (shown.length > 0) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setSel((i) => (i + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length);
                  return;
                }
                if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                  e.preventDefault();
                  shown[Math.min(sel, shown.length - 1)].pick();
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setDismissed(text);
                  return;
                }
              }
              if (e.key === "Escape" && busy) {
                e.preventDefault();
                onStop?.();
              } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            className="max-h-[200px] min-h-9 flex-1 resize-none bg-transparent py-[7px] leading-[22px] outline-none placeholder:text-fg-3"
          />
          {trailing}
          {busy && (
            <button
              type="button"
              aria-label="停止"
              title="停止（Esc）"
              onClick={onStop}
              className="grid size-9 shrink-0 place-items-center rounded-full bg-fg text-bg transition-opacity hover:opacity-85"
            >
              <Square size={13} fill="currentColor" />
            </button>
          )}
          {(!busy || (canQueue && hasContent)) && (
            <button
              type="button"
              aria-label={busy ? "排队发送" : "发送"}
              title={busy ? "排队：这条回复完成后再发" : undefined}
              onClick={submit}
              disabled={!canSend}
              className={clsx(
                "grid size-9 shrink-0 place-items-center rounded-full transition-colors",
                canSend ? "bg-accent text-white hover:brightness-110" : "bg-raise-2 text-fg-3",
              )}
            >
              <ArrowUp size={19} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
