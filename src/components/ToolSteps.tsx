import clsx from "clsx";
import {
  AlertCircle,
  BookOpen,
  Bookmark,
  Bot,
  CalendarClock,
  CircleStop,
  ChevronDown,
  Download,
  FilePen,
  FilePlus2,
  FileSearch,
  FileText,
  FolderOpen,
  Globe,
  History,
  LibraryBig,
  NotebookPen,
  Play,
  ScrollText,
  Hand,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  Plug,
  Search,
  ShieldAlert,
  ShieldCheck,
  SquareTerminal,
  Undo2,
  Users,
} from "lucide-react";
import { useState } from "react";
import { answerQuestion, useQuestions } from "../lib/agentTools";
import { linkClick } from "../lib/links";
import { forget, remembered } from "../lib/memory";
import { answer, undo, usePending } from "../lib/workmode";
import { useData, usePrefs, useUi } from "../store";
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
  remember: Bookmark,
  search_chats: History,
  search_library: LibraryBig,
  delegate: Bot,
  schedule_task: CalendarClock,
  edit_doc: NotebookPen,
  start_job: Play,
  job_output: ScrollText,
  stop_job: CircleStop,
};

/** Steps about one file in the workspace; its name opens the file in the side panel. */
const FILE_STEPS = new Set(["read_file", "write_file", "edit_file"]);

/** Steps that fold open to the full command and what it printed. */
const COMMAND_STEPS = new Set(["run_command", "start_job"]);
/** Steps that fold open to what they returned (a folder listing, search hits, a job's output). */
const OUTPUT_STEPS = new Set(["list_dir", "search_files", "job_output"]);

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
    case "remember":
      return `记住：${short(t.label, 60)}`;
    case "search_chats":
      return `搜索旧对话「${short(t.label, 40)}」`;
    case "search_library":
      return `检索资料库「${short(t.label, 40)}」`;
    case "delegate":
      return t.status === "running" ? `子任务进行中 · ${short(t.label, 50)}` : `子任务 · ${short(t.label, 50)}`;
    case "schedule_task":
      return `建定时任务：${short(t.label, 60)}`;
    case "edit_doc":
      return `改共写文档：${t.label}`;
    case "start_job":
      return `后台运行 ${short(t.label)}`;
    case "job_output":
      return `查看后台任务 ${t.label}`;
    case "stop_job":
      return `结束后台任务 ${t.label}`;
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

/** The sources a reply cites with [n], listed under it so each can be opened and checked. */
export function CitedSources({ text, steps }: { text: string; steps?: ToolTrace[] }) {
  const all = new Map<number, NonNullable<ToolTrace["sources"]>[number]>();
  for (const s of steps ?? []) s.sources?.forEach((src, i) => all.set((s.first ?? 1) + i, src));
  const cited = [...new Set([...text.matchAll(/\[(\d{1,3})\](?![(:])/g)].map((m) => Number(m[1])))].filter((n) => all.has(n)).sort((a, b) => a - b);
  if (!cited.length) return null;
  return (
    <div className="mt-3 border-t border-line pt-2">
      <div className="mb-1 text-[12px] font-medium text-fg-3">
        来源（点开核实）{all.size > cited.length && ` · 回答引用了搜到的 ${all.size} 条中的 ${cited.length} 条，编号沿用搜索结果`}
      </div>
      <ol className="space-y-0.5">
        {cited.map((n) => {
          const s = all.get(n)!;
          return (
            <li key={n}>
              <a href={s.url} onClick={linkClick(s.url)} title={s.url} className="flex items-baseline gap-2 rounded-lg px-1 py-0.5 text-[13px] hover:bg-hover">
                <span className="shrink-0 font-mono text-[11.5px] font-semibold text-accent-text">[{n}]</span>
                <span className="min-w-0 truncate text-fg">{s.title || s.url}</span>
                <span className="shrink-0 text-[12px] text-fg-3">{[s.site ?? shortUrl(s.url), s.date].filter(Boolean).join(" · ")}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </div>
  );
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
          {t.ask?.review && <div className="mt-0.5 text-warn">智能审批：{t.ask.review}</div>}
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
  const openPane = useUi((s) => s.openPane);
  const kept = useData((s) => t.name === "remember" && remembered(s.memories, t.label));
  const [undoError, setUndoError] = useState("");
  if (t.status === "waiting") return t.name === "ask_user" ? <Question step={t} /> : <Approval step={t} />;
  const Icon = t.status === "running" ? Loader2 : t.status === "error" ? AlertCircle : icons[t.name];
  const head = (
    <>
      <Icon size={14} className={clsx("shrink-0", t.status === "running" && "animate-spin", t.status === "error" && "text-bad")} />
      {FILE_STEPS.has(t.name) && t.root && t.status !== "error" ? (
        <button
          type="button"
          title="在侧栏查看这个文件"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openPane({ kind: "file", root: t.root!, path: t.label });
          }}
          className="min-w-0 truncate text-left underline decoration-line-2 underline-offset-2 hover:text-fg"
        >
          {verb(t)}
        </button>
      ) : t.name === "read_page" ? (
        <a href={t.label} onClick={linkClick(t.label)} title={t.label} className="min-w-0 truncate underline decoration-line-2 underline-offset-2 hover:text-fg">
          {verb(t)}
        </a>
      ) : (
        <span className="min-w-0 truncate">{verb(t)}</span>
      )}
      {t.auto && (
        <span title={`智能审批放行：${t.auto}`} className="flex shrink-0 items-center gap-0.5 text-ok">
          <ShieldCheck size={13} /> 已审查
        </span>
      )}
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

  // A memory the agent saved: it can be dropped right here, or later in Settings → Memory.
  if (t.name === "remember" && t.status === "done") {
    return (
      <div className={row}>
        {head}
        {kept ? (
          <button
            type="button"
            onClick={() => forget(t.label)}
            className="ml-auto flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12.5px] font-medium text-accent-text hover:bg-hover"
          >
            <Undo2 size={13} /> 忘掉
          </button>
        ) : (
          !t.detail && <span className="shrink-0 text-fg-3">· 已删除</span>
        )}
      </div>
    );
  }

  // A command: folded until clicked, then the whole command and what it printed.
  if ((COMMAND_STEPS.has(t.name) || (OUTPUT_STEPS.has(t.name) && t.output)) && t.status !== "running") {
    return (
      <details className="group/s">
        <summary className={clsx(row, "cursor-pointer list-none select-none")}>
          {head}
          <ChevronDown size={14} className="shrink-0 transition-transform group-open/s:rotate-180" />
        </summary>
        <div className="mt-1.5 space-y-1.5 rounded-xl bg-active p-2.5">
          {COMMAND_STEPS.has(t.name) && (
            <div>
              <div className="mb-1 text-[12px] text-fg-3">命令</div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-bg px-2.5 py-1.5 font-mono text-[12px] leading-[1.55]">{t.label}</pre>
            </div>
          )}
          {t.output !== undefined ? (
            <div>
              {COMMAND_STEPS.has(t.name) && <div className="mb-1 text-[12px] text-fg-3">输出</div>}
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-bg px-2.5 py-1.5 font-mono text-[12px] leading-[1.55] text-fg-2">
                {t.output || "（没有输出）"}
              </pre>
            </div>
          ) : (
            t.name === "run_command" && <div className="text-[12px] text-fg-3">这一步没有保存输出（旧版本的记录）</div>
          )}
        </div>
      </details>
    );
  }

  // Passages found in the library, or what a sub-agent handed back: folded until clicked.
  if (t.passages?.length || t.output) {
    return (
      <details className="group/s">
        <summary className={clsx(row, "cursor-pointer list-none select-none")}>
          {head}
          <ChevronDown size={14} className="shrink-0 transition-transform group-open/s:rotate-180" />
        </summary>
        {t.output ? (
          <div className="mt-1.5 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-active p-2.5 text-[13px] leading-relaxed text-fg-2">{t.output}</div>
        ) : (
          <ol className="mt-1.5 space-y-1.5 rounded-xl bg-active p-2">
            {t.passages!.map((p, i) => (
              <li key={i} className="px-1.5 py-0.5 text-[13px]">
                <div className="flex items-center gap-1.5 font-medium text-fg">
                  <span className="font-mono text-[11.5px] text-fg-3">{i + 1}</span>
                  <span className="truncate">{p.title}</span>
                </div>
                <div className="line-clamp-3 text-[12.5px] text-fg-3">{p.text}</div>
              </li>
            ))}
          </ol>
        )}
      </details>
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
            <a href={s.url} onClick={linkClick(s.url)} title={s.url} className="flex items-start gap-2 rounded-lg px-1.5 py-1 text-[13px] hover:bg-hover">
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
