import clsx from "clsx";
import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  Download,
  FilePen,
  FilePlus2,
  FileSearch,
  FileText,
  FolderOpen,
  Globe,
  Hand,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  Plug,
  Search,
  ShieldAlert,
  SquareTerminal,
  Undo2,
  Users,
} from "lucide-react";
import { useState } from "react";
import { answerQuestion, useQuestions } from "../lib/agentTools";
import { answer, undo, usePending } from "../lib/workmode";
import { usePrefs, useUi } from "../store";
import type { DiffLine, ToolTrace } from "../types";

const icons = {
  web_search: Search,
  read_page: FileText,
  dispatch_to_group: Users,
  make_file: FilePlus2,
  use_skill: BookOpen,
  install_skill: Download,
  mcp: Plug,
  list_dir: FolderOpen,
  read_file: FileText,
  search_files: FileSearch,
  write_file: FilePen,
  edit_file: FilePen,
  run_command: SquareTerminal,
  ask_user: MessageCircleQuestion,
};

const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);

function verb(t: ToolTrace) {
  switch (t.name) {
    case "list_dir":
      return `查看 ${t.label}`;
    case "read_file":
      return `读取 ${t.label}`;
    case "search_files":
      return `搜索文件「${short(t.label, 40)}」`;
    case "write_file":
    case "edit_file":
      return `修改 ${t.label}`;
    case "run_command":
      return `运行 ${short(t.label)}`;
    case "web_search":
      return `搜索「${t.label}」`;
    case "read_page":
      return `阅读 ${shortUrl(t.label)}`;
    case "make_file":
      return `生成 ${t.label}`;
    case "use_skill":
      return `使用技能「${t.label}」`;
    case "install_skill":
      return `安装技能「${t.label}」`;
    case "mcp":
      return `调用 ${t.label}`;
    case "dispatch_to_group":
      return t.status === "running" ? `已派到「${t.label}」` : `「${t.label}」`;
    case "ask_user":
      return t.answer ? `问你：${short(t.label, 40)} → ${short(t.answer, 40)}` : `问你：${short(t.label, 60)}`;
  }
}

/** A question from the agent: click a suggested answer or write one. The reply continues with it. */
function Question({ step: t }: { step: ToolTrace }) {
  const live = useQuestions((s) => !!s[t.id]);
  const [text, setText] = useState("");
  const send = (a: string) => a.trim() && answerQuestion(t.id, a.trim());
  return (
    <div className="w-[min(520px,70vw)] max-w-full space-y-2 rounded-xl border border-accent/40 bg-accent-soft p-3">
      <div className="flex items-start gap-2 text-[13.5px]">
        <MessageCircleQuestion size={16} className="mt-px shrink-0 text-accent-text" />
        <div className="min-w-0 font-medium">{t.question?.text ?? t.label}</div>
      </div>
      {live ? (
        <>
          {!!t.question?.options.length && (
            <div className="flex flex-wrap gap-1.5">
              {t.question.options.map((o) => (
                <button key={o} type="button" onClick={() => send(o)} className="rounded-full border border-line-2 bg-raise px-3 py-1 text-[13px] hover:bg-hover">
                  {o}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t.question?.options.length ? "或者自己写" : "写下你的回答"}
              className="h-8 min-w-0 flex-1 rounded-full border border-line bg-raise px-3 text-[13px] outline-none focus:border-line-2"
            />
            <button type="submit" disabled={!text.trim()} className="h-8 shrink-0 rounded-full bg-fg px-4 text-[13px] font-semibold text-bg disabled:opacity-40">
              回答
            </button>
          </form>
        </>
      ) : (
        <div className="text-right text-[12.5px] text-fg-3">已停止</div>
      )}
    </div>
  );
}

function shortUrl(url: string) {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    const s = u.hostname.replace(/^www\./, "") + path;
    return s.length > 48 ? `${s.slice(0, 48)}…` : s;
  } catch {
    return url;
  }
}

/** Citation number → URL, from every search in the message. */
export function citations(steps?: ToolTrace[]) {
  const map = new Map<number, string>();
  for (const s of steps ?? []) s.sources?.forEach((src, i) => map.set((s.first ?? 1) + i, src.url));
  return map;
}

/** What an agent did with its tools before (or while) answering. */
export function ToolSteps({ steps, messageId }: { steps: ToolTrace[]; messageId: string }) {
  const brief = usePrefs((s) => s.steps === "brief");
  // Brief: one line until clicked. Steps that wait for the user always show.
  if (brief && steps.length > 1 && !steps.some((t) => t.status === "waiting")) {
    const running = steps.findLast((t) => t.status === "running");
    const failed = steps.filter((t) => t.status === "error").length;
    return (
      <details className="group/b mb-2">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] text-fg-2 select-none">
          {running ? <Loader2 size={14} className="shrink-0 animate-spin" /> : <ListChecks size={14} className="shrink-0" />}
          <span className="min-w-0 truncate">{running ? verb(running) : `执行了 ${steps.length} 步${failed ? `，${failed} 步出错` : ""}`}</span>
          <ChevronDown size={14} className="shrink-0 transition-transform group-open/b:rotate-180" />
        </summary>
        <div className="mt-1.5 space-y-1.5 border-l border-line pl-2.5">
          {steps.map((t) => (
            <Step key={t.id} step={t} messageId={messageId} />
          ))}
        </div>
      </details>
    );
  }
  return (
    <div className="mb-2 space-y-1.5">
      {steps.map((t) => (
        <Step key={t.id} step={t} messageId={messageId} />
      ))}
    </div>
  );
}

function Diff({ lines }: { lines: DiffLine[] }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-lg bg-bg py-1.5 font-mono text-[12px] leading-[1.55]">
      {lines.map((l, i) => (
        <div
          key={i}
          className={clsx(
            "whitespace-pre-wrap break-all px-2.5",
            l.type === "add" && "bg-ok-soft text-ok",
            l.type === "del" && "bg-bad-soft text-bad",
            l.type === "gap" && "py-0.5 text-center text-fg-3",
            l.type === "same" && "text-fg-2",
          )}
        >
          {l.type === "gap" ? `⋯ ${l.text} ⋯` : `${l.type === "add" ? "+" : l.type === "del" ? "-" : " "} ${l.text}`}
        </div>
      ))}
    </pre>
  );
}

/** A local action waiting for the user. Dangerous commands need a second click. */
function Approval({ step: t }: { step: ToolTrace }) {
  const live = usePending((s) => !!s[t.id]);
  const [sure, setSure] = useState(false);
  const danger = t.ask?.danger;
  return (
    <div className={clsx("w-[min(520px,70vw)] max-w-full space-y-2 rounded-xl border p-3", danger ? "border-bad/40 bg-bad-soft" : "border-line bg-active")}>
      <div className="flex items-start gap-2 text-[13.5px]">
        {danger ? <ShieldAlert size={16} className="mt-px shrink-0 text-bad" /> : <Hand size={16} className="mt-px shrink-0 text-warn" />}
        <div className="min-w-0">
          <div className="break-all font-medium">{t.ask?.what}</div>
          {danger && <div className="mt-0.5 text-bad">危险操作：{danger}</div>}
        </div>
      </div>
      {t.ask?.diff && <Diff lines={t.ask.diff} />}
      {live ? (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => answer(t.id, false)} className="h-8 rounded-full border border-line-2 px-4 text-[13px] font-medium hover:bg-hover">
            拒绝
          </button>
          <button
            type="button"
            onClick={() => (danger && !sure ? setSure(true) : answer(t.id, true))}
            className={clsx("h-8 rounded-full px-4 text-[13px] font-semibold", danger ? "bg-bad text-white" : "bg-fg text-bg", "hover:opacity-90")}
          >
            {danger ? (sure ? "确认执行" : "执行") : "允许"}
          </button>
        </div>
      ) : (
        <div className="text-right text-[12.5px] text-fg-3">已停止</div>
      )}
    </div>
  );
}

function Step({ step: t, messageId }: { step: ToolTrace; messageId: string }) {
  const open = useUi((s) => s.open);
  const [undoError, setUndoError] = useState("");
  if (t.status === "waiting") return t.name === "ask_user" ? <Question step={t} /> : <Approval step={t} />;
  const Icon = t.status === "running" ? Loader2 : t.status === "error" ? AlertCircle : icons[t.name];
  const head = (
    <>
      <Icon size={14} className={clsx("shrink-0", t.status === "running" && "animate-spin", t.status === "error" && "text-bad")} />
      <span className="min-w-0 truncate">{verb(t)}</span>
      {t.detail && <span className={clsx("shrink-0", t.status === "error" ? "text-bad" : "text-fg-3")}>· {t.detail}</span>}
    </>
  );
  const row = "flex min-w-0 items-center gap-1.5 text-[13px] text-fg-2";

  if (t.name === "dispatch_to_group") {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-active px-3 py-2">
        <div className={clsx(row, "flex-1")}>{head}</div>
        {t.groupId && (
          <button type="button" onClick={() => open({ kind: "group", id: t.groupId! })} className="shrink-0 text-[13px] font-medium text-accent-text hover:underline">
            去群里看
          </button>
        )}
      </div>
    );
  }

  // A file change: the diff folds open, and the change can be undone.
  if (t.ask?.diff && t.status !== "error") {
    const canUndo = t.undo && !t.undo.undone;
    return (
      <details className="group/s">
        <summary className={clsx(row, "cursor-pointer list-none select-none")}>
          {head}
          <ChevronDown size={14} className="shrink-0 transition-transform group-open/s:rotate-180" />
          {canUndo && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setUndoError("");
                undo(messageId, t.id).catch((err: Error) => setUndoError(err.message));
              }}
              className="ml-auto flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12.5px] font-medium text-accent-text hover:bg-hover"
            >
              <Undo2 size={13} /> 撤销
            </button>
          )}
        </summary>
        {undoError && <div className="mt-1 text-[12.5px] text-bad">{undoError}</div>}
        <div className="mt-1.5">
          <Diff lines={t.ask.diff} />
        </div>
      </details>
    );
  }

  if (!t.sources?.length) return <div className={row}>{head}</div>;

  return (
    <details className="group/s">
      <summary className={clsx(row, "cursor-pointer list-none select-none")}>
        {head}
        <ChevronDown size={14} className="shrink-0 transition-transform group-open/s:rotate-180" />
      </summary>
      <ol className="mt-1.5 space-y-1 rounded-xl bg-active p-2">
        {t.sources.map((s, i) => (
          <li key={s.url + i}>
            <a href={s.url} target="_blank" rel="noreferrer" className="flex items-start gap-2 rounded-lg px-1.5 py-1 text-[13px] hover:bg-hover">
              <span className="mt-px shrink-0 font-mono text-[11.5px] text-fg-3">{(t.first ?? 1) + i}</span>
              <span className="min-w-0">
                <span className="line-clamp-1 text-fg">{s.title}</span>
                <span className="flex items-center gap-1 text-[12px] text-fg-3">
                  <Globe size={11} />
                  {[s.site, s.date].filter(Boolean).join(" · ")}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </details>
  );
}
