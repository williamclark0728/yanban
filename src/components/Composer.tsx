import clsx from "clsx";
import { AlertCircle, ArrowUp, Loader2, Plus, Square, Users, X } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { ALL } from "../lib/collab";
import { ACCEPT, formatSize, readAttachment } from "../lib/files";
import type { Agent, Attachment } from "../types";
import { BotAvatar } from "./Avatar";
import { FileIcon } from "./FileCard";

export interface ComposerHandle {
  addFiles: (files: Iterable<File>) => void;
}

interface Pending {
  key: string;
  name: string;
  size: number;
  status: "reading" | "ready" | "error";
  file?: Attachment;
  error?: string;
}

export function Composer({
  placeholder,
  members,
  busy = false,
  tools,
  onSend,
  onStop,
  ref: handle,
}: {
  placeholder: string;
  members: Agent[];
  busy?: boolean;
  tools?: ReactNode;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop?: () => void;
  ref?: Ref<ComposerHandle>;
}) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const addFiles = (files: Iterable<File>) => {
    for (const f of files) {
      const key = crypto.randomUUID();
      setPending((p) => [...p, { key, name: f.name || "粘贴的图片", size: f.size, status: "reading" }]);
      readAttachment(f).then(
        (file) => setPending((p) => p.map((x) => (x.key === key ? { ...x, status: "ready", file } : x))),
        (e: Error) => setPending((p) => p.map((x) => (x.key === key ? { ...x, status: "error", error: e.message || "读取失败" } : x))),
      );
    }
    ref.current?.focus();
  };
  useImperativeHandle(handle, () => ({ addFiles }));

  const mention = members.length > 0 ? /@([^\s@]*)$/.exec(text) : null;
  const matches = mention ? members.filter((m) => m.name.includes(mention[1])) : [];
  const everyone = !!mention && members.length > 1 && ALL.startsWith(mention[1]);
  const ready = pending.filter((p) => p.status === "ready").map((p) => p.file!);
  const reading = pending.some((p) => p.status === "reading");
  const canSend = !busy && !reading && (!!text.trim() || ready.length > 0);

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim(), ready);
    setText("");
    setPending([]);
  };

  const pick = (name: string) => {
    setText((t) => t.replace(/@([^\s@]*)$/, `@${name} `));
    ref.current?.focus();
  };

  return (
    <div className="relative">
      {(matches.length > 0 || everyone) && (
        <div className="rise absolute bottom-full left-2 mb-2 w-56 rounded-2xl border border-line bg-raise p-1.5 shadow-[var(--shadow)]">
          {everyone && (
            <button type="button" onClick={() => pick(ALL)} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left hover:bg-hover">
              <span className="grid size-6 place-items-center rounded-full bg-hover">
                <Users size={14} />
              </span>
              <span className="text-sm font-medium">{ALL}</span>
              <span className="ml-auto truncate text-xs text-fg-3">每人直接回复</span>
            </button>
          )}
          {matches.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => pick(m.name)}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left hover:bg-hover"
            >
              <BotAvatar agent={m} size={24} />
              <span className="text-sm font-medium">{m.name}</span>
              <span className="ml-auto truncate text-xs text-fg-3">{m.tagline}</span>
            </button>
          ))}
        </div>
      )}
      <div className="rounded-[26px] border border-line bg-raise px-2 py-2 shadow-[var(--shadow)] focus-within:border-line-2">
        {pending.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1 pb-2 pt-0.5">
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
            title="添加文件：文本、PDF、Word 或图片"
            onClick={() => picker.current?.click()}
            className="grid size-9 shrink-0 place-items-center rounded-full text-fg-2 hover:bg-active hover:text-fg"
          >
            <Plus size={20} />
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            accept={ACCEPT}
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
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (matches.length > 0) pick(matches[0].name);
                else if (everyone) pick(ALL);
                else submit();
              }
            }}
            className="max-h-[200px] min-h-9 flex-1 resize-none bg-transparent py-[7px] leading-[22px] outline-none placeholder:text-fg-3"
          />
          {busy ? (
            <button
              type="button"
              aria-label="停止"
              onClick={onStop}
              className="grid size-9 shrink-0 place-items-center rounded-full bg-fg text-bg transition-opacity hover:opacity-85"
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="发送"
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
