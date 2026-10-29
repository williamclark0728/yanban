import clsx from "clsx";
import { AlertCircle, AlertTriangle, Archive, BookPlus, Brain, Hourglass, Check, CheckCircle2, ChevronDown, Circle, CircleDot, Copy, CornerDownRight, ExternalLink, FileDown, FilePen, FolderOpen, Languages, ListTodo, NotebookPen, Loader2, MessageSquarePlus, Play, RotateCcw, RotateCw, Sparkles, Square, Undo2 } from "lucide-react";
import { memo, useRef, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { RUN_PLAN, setPlanMode } from "../lib/agentTools";
import { retry, useBusy } from "../lib/chat";
import { useWaits } from "../lib/llm";
import { call } from "../lib/desktop";
import { openDoc } from "../lib/docs";
import { formatSize } from "../lib/files";
import { linkClick, URL_RE } from "../lib/links";
import { looksEnglish, translateReasoning } from "../lib/translate";
import { send } from "../lib/queue";
import { undoAll } from "../lib/workmode";
import { download, replyAsDocx } from "../lib/outputs";
import { clock } from "../lib/time";
import { useData, usePrefs, useUi } from "../store";
import type { Agent, Issue, Message, Todo, ToolTrace, Unverified, Usage, Verdict } from "../types";
import { BotAvatar, palette } from "./Avatar";
import { FileCard, FileIcon, kindOf } from "./FileCard";
import { MadeFiles } from "./MadeFiles";
import { SaveSkill } from "./SaveSkill";
import { CitedSources, citations, ToolSteps } from "./ToolSteps";
import { IconButton } from "./ui";

function withMentions(text: string, agents: Agent[]) {
  const me = usePrefs.getState().name.trim();
  const names = [...agents.map((a) => a.name), ...(me ? [me] : [])].sort((a, b) => b.length - a.length);
  const re = new RegExp(`@(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return text.replace(re, (_, name: string) => {
    const id = agents.find((a) => a.name === name)?.id ?? "me";
    return `[@${name}](mention:${id})`;
  });
}

/**
 * Models write formulas as `\( … \)` and `\[ … \]` as often as `$ … $`; turn the first two into dollar signs
 * so they render too. Code blocks and inline code are left alone.
 */
function withMath(text: string) {
  return text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(/\\\[([\s\S]+?)\\\]/g, (_, m: string) => `\n$$\n${m.trim()}\n$$\n`).replace(/\\\(([\s\S]+?)\\\)/g, (_, m: string) => `$${m.trim()}$`),
    )
    .join("");
}

/** `[3]` after a web search becomes a link to that source. */
function withCitations(text: string, cites?: Map<number, string>) {
  if (!cites?.size) return text;
  return text.replace(/\[(\d{1,3})\](?![(:])/g, (whole, n: string) => {
    const url = cites.get(Number(n));
    return url ? `[${n}](cite:${url})` : whole;
  });
}

export function RichText({ text, agents, cites }: { text: string; agents: Agent[]; cites?: Map<number, string> }) {
  return (
    <div className="prose-chat">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        urlTransform={(url) => url}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("cite:")) {
              return (
                <a
                  href={href.slice(5)}
                  onClick={linkClick(href.slice(5))}
                  title={href.slice(5)}
                  className="mx-px inline-grid h-[18px] min-w-[18px] place-items-center rounded-md bg-accent-soft px-1 align-[2px] text-[11px] font-semibold text-accent-text no-underline"
                >
                  {children}
                </a>
              );
            }
            if (href?.startsWith("mention:")) {
              const agent = agents.find((a) => a.id === href.slice(8));
              return (
                <span
                  className="inline-flex items-baseline gap-1 font-medium"
                  style={{ color: agent ? palette[agent.color].text : "var(--accent-text)" }}
                >
                  {agent && <BotAvatar agent={agent} size={15} className="relative top-[2px]" />}
                  {children}
                </span>
              );
            }
            return (
              <a href={href} onClick={href ? linkClick(href) : undefined} title={href}>
                {children}
              </a>
            );
          },
        }}
      >
        {withCitations(withMentions(withMath(text), agents), cites)}
      </Markdown>
    </div>
  );
}

export const verdictLabel: Record<Verdict, string> = { pass: "通过", done: "完成", stop: "结束", revise: "退回修订" };

const issueStyle: Record<Issue["status"], { label: string; cls: string }> = {
  holds: { label: "需修改", cls: "bg-bad-soft text-bad" },
  rejected: { label: "没问题", cls: "bg-ok-soft text-ok" },
  unsure: { label: "存疑", cls: "bg-warn-soft text-warn" },
};

export function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-sm font-medium text-ok">
        <CheckCircle2 size={16} /> 通过
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {issues.map((it, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span className={clsx("mt-[3px] shrink-0 rounded-md px-1.5 py-px text-[11.5px] font-semibold", issueStyle[it.status].cls)}>
            {issueStyle[it.status].label}
          </span>
          <span className="leading-relaxed">
            {it.text}
            {it.evidence && <span className="mt-0.5 block text-[12.5px] text-fg-3">依据：{it.evidence}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Copies the reply as written (Markdown), so it can be pasted into a document or an experiment record. */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title="复制"
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
      className="flex items-center gap-1 hover:text-fg"
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
      {done ? "已复制" : "复制"}
    </button>
  );
}

/** Saves the reply as a Word document. */
function WordButton({ text, name }: { text: string; name: string }) {
  return (
    <button type="button" title="下载为 Word" onClick={() => void download(replyAsDocx(text, name))} className="flex items-center gap-1 hover:text-fg">
      <FileDown size={12} /> Word
    </button>
  );
}

function Meta({
  time,
  usage,
  note,
  copy,
  name,
  align,
  extra,
}: {
  time: string;
  usage?: Usage;
  note?: string;
  copy?: string;
  name?: string;
  align: "left" | "right";
  extra?: ReactNode;
}) {
  const dev = usePrefs((s) => s.mode === "dev");
  return (
    <div
      className={clsx(
        "mt-1 flex gap-2 px-3 text-[11.5px] text-fg-3 transition-opacity",
        align === "right" && "justify-end",
        dev || note ? "opacity-100" : "opacity-0 group-hover:opacity-100",
      )}
    >
      <span>{time}</span>
      {note && <span>{note}</span>}
      {dev && usage && (
        <span className="font-mono">
          {usage.model} · {usage.input.toLocaleString()}→{usage.output.toLocaleString()} tok · {usage.seconds}s
        </span>
      )}
      {copy && <CopyButton text={copy} />}
      {copy && name && <WordButton text={copy} name={name} />}
      {extra}
    </div>
  );
}

/** While a reply runs: why it's waiting (the service's queue, a rate limit), else the typing dots when nothing has arrived yet. */
function Waiting({ id, typing }: { id: string; typing: boolean }) {
  const note = useWaits((s) => s[id]);
  if (note) {
    return (
      <span className="mt-1 flex items-center gap-1.5 text-[13px] text-fg-3" role="status">
        <Hourglass size={13} className="shrink-0" />
        {note}
      </span>
    );
  }
  return typing ? <Typing /> : null;
}

function Typing() {
  return (
    <span className="flex h-[26px] items-center gap-1 text-[13px] text-fg-3" aria-label="正在思考">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 animate-pulse rounded-full bg-fg-3" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
      <span className="ml-1">正在思考…</span>
    </span>
  );
}

/** The model's thinking, folded; English thinking can be shown in Chinese. */
function Reasoning({ text, live, messageId, zh }: { text: string; live: boolean; messageId: string; zh?: string }) {
  const [showZh, setShowZh] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const box = useRef<HTMLDetailsElement>(null);
  const canTranslate = !live && looksEnglish(text);
  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    setError("");
    // Show the text being switched to, even when the box was folded.
    if (box.current) box.current.open = true;
    if (zh) return setShowZh((v) => !v);
    setWorking(true);
    try {
      await translateReasoning(messageId);
      setShowZh(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWorking(false);
    }
  };
  return (
    <details ref={box} open={live} className="group/r mb-2 rounded-xl bg-active px-3 py-2 text-[13.5px] text-fg-2">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium select-none">
        <Brain size={14} />
        {live ? "思考中…" : "思考过程"}
        <ChevronDown size={14} className="transition-transform group-open/r:rotate-180" />
        {canTranslate && (
          <button type="button" onClick={toggle} disabled={working} className="ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium text-accent-text hover:bg-hover disabled:opacity-60">
            {working ? <Loader2 size={12} className="animate-spin" /> : <Languages size={12} />}
            {working ? "翻译中" : zh && showZh ? "看原文" : "译成中文"}
          </button>
        )}
      </summary>
      {error && <div className="mt-1 text-[12.5px] text-bad">{error}</div>}
      <div className="mt-1.5 whitespace-pre-wrap leading-relaxed">
        <Linked text={zh && showZh ? zh : text} />
      </div>
    </details>
  );
}

/** Plain text with its web addresses clickable, such as the pages a model mentions while thinking. */
function Linked({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(URL_RE)) {
    parts.push(text.slice(at, m.index));
    parts.push(
      <a key={m.index} href={m[0]} onClick={linkClick(m[0])} title={m[0]} className="break-all text-accent-text underline underline-offset-2">
        {m[0]}
      </a>,
    );
    at = m.index + m[0].length;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

function Failure({ msg }: { msg: Extract<Message, { kind: "text" }> }) {
  const dev = usePrefs((s) => s.mode === "dev");
  const openSettings = useUi((s) => s.openSettings);
  const keyProblem = /API Key|没有连接/.test(msg.error?.message ?? "");
  return (
    <div className="mt-1 rounded-2xl border border-bad/30 bg-bad-soft px-4 py-2.5">
      <div className="flex items-center gap-2 text-sm font-medium text-bad">
        <AlertCircle size={16} />
        {msg.error?.message}
      </div>
      {dev && msg.error?.detail && <div className="mt-1 break-all font-mono text-xs text-fg-2">{msg.error.detail}</div>}
      <div className="mt-2 flex gap-2 empty:hidden">
        {msg.chat === msg.sender && !msg.summary && !msg.compare && (
          <button
            type="button"
            onClick={() => retry(msg.id)}
            className="flex h-8 items-center gap-1.5 rounded-full bg-raise px-3 text-[13px] font-medium hover:bg-raise-2"
          >
            <RotateCcw size={14} /> 重试
          </button>
        )}
        {keyProblem && (
          <button
            type="button"
            onClick={() => openSettings("providers")}
            className="flex h-8 items-center rounded-full bg-raise px-3 text-[13px] font-medium hover:bg-raise-2"
          >
            模型设置
          </button>
        )}
      </div>
    </div>
  );
}

/** The agent's step list for this reply, ticked off as it works. */
function Todos({ todos, ended }: { todos: Todo[]; ended: boolean }) {
  const done = todos.filter((t) => t.status === "done").length;
  return (
    <div className="mb-2 rounded-xl bg-active px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-[12.5px] font-medium text-fg-2">
        <ListTodo size={14} /> 步骤 {done}/{todos.length}
        {ended && done < todos.length && <span className="font-normal text-fg-3">· 回复已结束，清单没有勾完</span>}
      </div>
      <ul className="space-y-0.5 text-[13.5px]">
        {todos.map((t, i) => (
          <li key={i} className={clsx("flex items-start gap-2", t.status === "done" && "text-fg-3 line-through")}>
            {t.status === "done" ? (
              <CheckCircle2 size={14} className="mt-[3px] shrink-0 text-ok" />
            ) : t.status === "in_progress" ? (
              <CircleDot size={14} className="mt-[3px] shrink-0 text-accent-text" />
            ) : (
              <Circle size={14} className="mt-[3px] shrink-0 text-fg-3" />
            )}
            <span className={clsx(t.status === "in_progress" && "font-medium")}>{t.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What the reply claims that the app checked and could not confirm. */
function Unconfirmed({ u }: { u: Unverified }) {
  const lines = [
    u.missing?.length && `回复里说的 ${u.missing.join("、")} 在工作区里找不到，文件并不存在。`,
    u.fakeFile && "回复里手写了一段「生成的文件」，但没有调用 make_file，并没有生成文件。",
    u.unsourced && "这次回复没有联网搜索，却列了参考资料或链接，可能是模型凭记忆写的，引用前请自己核实。",
    u.noTools && "回复说已经执行、生成或打开了什么，但这一步没有调用任何工具。说的是它自己做的，那就没有发生；说的是别人做的，以那条消息的工具步骤为准。",
  ].filter(Boolean);
  return (
    <div className="mt-2 flex items-start gap-2 rounded-xl border border-warn/40 bg-warn-soft px-3 py-2 text-[13px] text-fg">
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
      <div className="min-w-0 space-y-0.5">
        <div className="font-medium text-warn">研伴核对：这条回复有说法没有得到证实</div>
        {lines.map((l) => (
          <div key={l as string}>{l}</div>
        ))}
      </div>
    </div>
  );
}

const absPath = (root: string, path: string) => `${root.replace(/[\\/]+$/, "")}\\${path.replace(/\//g, "\\")}`;

/** Files the reply left in the workspace, its scripts' outputs included: preview, open, or show in the folder. */
function OutputFiles({ outputs }: { outputs: NonNullable<Extract<Message, { kind: "text" }>["outputs"]> }) {
  const openPane = useUi((s) => s.openPane);
  const [error, setError] = useState("");
  const { root, files } = outputs;
  return (
    <div className="mt-1.5 rounded-2xl border border-line bg-raise px-2 py-2 text-[13px]">
      <div className="flex items-center gap-2 px-1.5 pb-1 font-medium">
        <FolderOpen size={14} className="shrink-0 text-fg-2" />
        这次生成或改动的文件（{files.length}）
      </div>
      <ul>
        {files.map((f) => (
          <li key={f.path} className="group/f flex items-center gap-2 rounded-xl px-1.5 py-1 hover:bg-hover">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text">
              <FileIcon kind={kindOf(f.path)} />
            </span>
            <button type="button" onClick={() => openPane({ kind: "file", root, path: f.path })} title="在侧栏查看" className="min-w-0 flex-1 text-left">
              <span className="block truncate font-medium">{f.path.split("/").pop()}</span>
              <span className="block truncate text-[12px] text-fg-3">
                {f.path.includes("/") ? `${f.path.slice(0, f.path.lastIndexOf("/"))} · ` : ""}
                {formatSize(f.size)}
              </span>
            </button>
            <button
              type="button"
              title="用默认程序打开"
              onClick={() => void call("open_file", { path: absPath(root, f.path) }).catch((e: Error) => setError(e.message))}
              className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[12.5px] font-medium text-accent-text hover:bg-active"
            >
              <ExternalLink size={13} /> 打开
            </button>
            <IconButton aria-label="在文件夹中显示" title="在文件夹中显示" className="size-7" onClick={() => void call("reveal", { path: absPath(root, f.path) })}>
              <FolderOpen size={14} />
            </IconButton>
          </li>
        ))}
      </ul>
      {error && <div className="px-1.5 text-bad">{error}</div>}
    </div>
  );
}

/** Every file this reply changed, with one button to put them all back. */
function Changes({ messageId, tools }: { messageId: string; tools: ToolTrace[] }) {
  const changed = tools.filter((t) => t.undo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!changed.length) return null;
  const files = [...new Set(changed.map((t) => t.undo!.path))];
  const open = changed.filter((t) => !t.undo!.undone);
  return (
    <div className="mt-1.5 rounded-2xl border border-line bg-raise px-3.5 py-2.5 text-[13px]">
      <div className="flex items-center gap-2">
        <FilePen size={14} className="shrink-0 text-fg-2" />
        <span className="flex-1 font-medium">
          这次改动了 {files.length} 个文件{open.length ? "" : "，已全部撤销"}
        </span>
        {open.length > 0 && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              await undoAll(messageId).catch((e: Error) => setError(e.message));
              setBusy(false);
            }}
            className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-medium text-accent-text hover:bg-hover disabled:opacity-50"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />} 全部撤销
          </button>
        )}
      </div>
      <ul className="mt-1 space-y-0.5 pl-6 text-fg-2">
        {files.map((f) => {
          const last = changed.findLast((t) => t.undo!.path === f)!;
          return (
            <li key={f} className={clsx("truncate font-mono text-[12.5px]", last.undo!.undone && "text-fg-3 line-through")}>
              <button
                type="button"
                title="在侧栏查看"
                onClick={() => useUi.getState().openPane({ kind: "file", root: last.undo!.root, path: f })}
                className="underline decoration-line-2 underline-offset-2 hover:text-fg"
              >
                {f}
              </button>{" "}
              <span className="font-sans text-fg-3">{last.detail}</span>
            </li>
          );
        })}
      </ul>
      {error && <div className="mt-1 text-bad">{error}</div>}
    </div>
  );
}

/** Under a plan written in plan mode: leave plan mode and carry it out. */
function RunPlan({ chat }: { chat: string }) {
  const busy = useBusy((s) => !!s[chat]);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setPlanMode(chat, false);
        send(chat, RUN_PLAN);
      }}
      className="mt-1.5 flex h-9 w-fit items-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
    >
      <Play size={14} /> 按计划执行
    </button>
  );
}

/** A reply worth repeating: several tool steps or a step list. */
const complex = (msg: Extract<Message, { kind: "text" }>) => (msg.tools?.length ?? 0) >= 3 || (msg.todos?.length ?? 0) >= 3;

function SkillButton({ messageId, children, className }: { messageId: string; children: ReactNode; className: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" title="把这次的做法存成技能，以后同类任务照着做" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      {open && <SaveSkill messageId={messageId} onClose={() => setOpen(false)} />}
    </>
  );
}

const chip = "flex h-8 items-center gap-1.5 rounded-full border border-line bg-raise px-3 text-[13px] hover:bg-hover";

/** Under the latest private reply: what the user will likely want next, and saving the method as a skill. */
function NextSteps({ msg }: { msg: Extract<Message, { kind: "text" }> }) {
  const busy = useBusy((s) => !!s[msg.chat]);
  const next = msg.next ?? [];
  if (busy || (!next.length && !complex(msg))) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {next.map((n) => (
        <button key={n} type="button" onClick={() => send(msg.chat, n)} className={chip}>
          <Sparkles size={13} className="shrink-0 text-accent-text" />
          {n}
        </button>
      ))}
      {complex(msg) && (
        <SkillButton messageId={msg.id} className={chip}>
          <BookPlus size={13} className="shrink-0 text-fg-2" />
          存成技能
        </SkillButton>
      )}
    </div>
  );
}

/** Where the chat was compressed: later replies see this summary instead of the messages above it. */
function Summary({ msg, agents }: { msg: Extract<Message, { kind: "text" }>; agents: Agent[] }) {
  if (msg.reset) {
    return (
      <div className="my-5 flex items-center gap-3 px-2 text-xs text-fg-3">
        <span className="h-px flex-1 bg-line" />
        <MessageSquarePlus size={13} />
        新话题：之后的回复不带上面的对话
        <span className="h-px flex-1 bg-line" />
      </div>
    );
  }
  const working = msg.status === "streaming";
  const failed = msg.status === "error" || msg.status === "stopped";
  return (
    <div className="my-5 px-2">
      <div className="flex items-center gap-3 text-xs text-fg-3">
        <span className="h-px flex-1 bg-line" />
        {working ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
        {working ? "正在压缩之前的对话…" : failed ? "压缩没有完成，之前的对话照常保留" : "之前的对话已压缩，之后的回复只带这份摘要"}
        <span className="h-px flex-1 bg-line" />
      </div>
      {working && (
        <div className="mt-1 flex justify-center">
          <Waiting id={msg.id} typing={false} />
        </div>
      )}
      {msg.text && !failed && (
        <details className="group/s mx-auto mt-2 max-w-[680px] rounded-2xl border border-line bg-raise px-4 py-2.5 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium select-none">
            查看摘要
            <ChevronDown size={14} className="transition-transform group-open/s:rotate-180" />
          </summary>
          <div className="mt-2">
            <RichText text={msg.text} agents={agents} />
          </div>
        </details>
      )}
      {msg.status === "error" && <Failure msg={msg} />}
    </div>
  );
}

// The last message of each chat, worked out once per change of the message list instead of once per bubble.
const lastIds = new WeakMap<Message[], Map<string, string>>();
function lastIdOf(messages: Message[], chat: string) {
  let map = lastIds.get(messages);
  if (!map) {
    map = new Map();
    for (const m of messages) map.set(m.chat, m.id);
    lastIds.set(messages, map);
  }
  return map.get(chat);
}

/** Redrawn only when its own message or position changes, so a streaming reply doesn't redraw the whole chat. */
export const MessageItem = memo(MessageBubble);

function MessageBubble({
  msg,
  agents,
  inGroup,
  first,
  last,
  column,
}: {
  msg: Message;
  agents: Agent[];
  inGroup: boolean;
  first: boolean;
  last: boolean;
  /** One answer of a side-by-side comparison: full width, no follow-up buttons. */
  column?: boolean;
}) {
  const showPanel = useUi((s) => s.showPanel);
  const isLatest = useData((s) => lastIdOf(s.messages, msg.chat) === msg.id);

  if (msg.kind === "round") {
    const pass = msg.verdict === "pass" || msg.verdict === "done";
    const Icon = pass ? CheckCircle2 : msg.verdict === "stop" ? Square : RotateCw;
    return (
      <div className="my-4 flex justify-center px-2">
        <button
          type="button"
          onClick={() => showPanel("runs")}
          className="flex w-full max-w-md items-center gap-3 rounded-2xl border border-line bg-raise px-4 py-3 text-left transition-colors hover:bg-raise-2"
        >
          <span className={clsx("grid size-8 shrink-0 place-items-center rounded-full", pass ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn")}>
            <Icon size={16} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              第 {msg.round} 轮 · {verdictLabel[msg.verdict]}
            </span>
            <span className="block truncate text-[13px] text-fg-2">{msg.note}</span>
          </span>
          <span className="shrink-0 text-[13px] text-accent-text">查看记录</span>
        </button>
      </div>
    );
  }

  const time = clock(msg.at);
  const mine = msg.sender === "me";
  const agent = agents.find((a) => a.id === msg.sender);

  if (mine) {
    return (
      <div className={clsx("group flex justify-end", first ? "mt-4" : "mt-1")}>
        <div className="flex max-w-[min(calc(var(--chat-w)*0.76),85%)] flex-col items-end">
          {msg.kind === "text" && msg.via && (
            <span className="mb-1 mr-3 text-[12px] text-fg-3">{agents.find((a) => a.id === msg.via)?.name ?? "主持人"}从私聊转来</span>
          )}
          {msg.kind === "text" &&
            msg.attachments?.map((f, i) => <FileCard key={f.id ?? i} file={f} />)}
          {msg.text && (
            <div className="rounded-[20px] bg-bubble-me px-4 py-2.5">
              <RichText text={msg.text} agents={agents} />
            </div>
          )}
          <Meta time={time} align="right" copy={msg.text || undefined} />
        </div>
      </div>
    );
  }

  if (msg.kind === "text" && msg.summary) return <Summary msg={msg} agents={agents} />;

  const streaming = msg.kind === "text" && msg.status === "streaming";
  const failed = msg.kind === "text" && msg.status === "error";
  const stopped = msg.kind === "text" && msg.status === "stopped";
  const reasoning = msg.kind === "text" ? msg.reasoning : undefined;
  const tools = msg.tools?.length ? msg.tools : undefined;
  const hasBody = !!msg.text || !!reasoning || !!tools || streaming;

  return (
    <div className={clsx("group flex items-end gap-2.5", !column && (first ? "mt-4" : "mt-1"))}>
      {inGroup && (
        <div className="w-8 shrink-0 self-end pb-6">{last && agent && <BotAvatar agent={agent} size={32} />}</div>
      )}
      <div className={clsx("flex min-w-0 flex-col", column ? "w-full" : "max-w-[min(calc(var(--chat-w)*0.83),85%)]")}>
        {inGroup && first && (
          <span className="mb-1 ml-3 text-[13px] font-medium" style={{ color: agent ? palette[agent.color].text : "var(--text-3)" }}>
            {agent?.name ?? "已删除的成员"}
          </span>
        )}
        {hasBody && (
          <div className="rounded-[20px] bg-bubble px-4 py-2.5" data-reply={msg.text && !streaming ? msg.id : undefined}>
            {reasoning && <Reasoning text={reasoning} live={streaming && !msg.text} messageId={msg.id} zh={msg.kind === "text" ? msg.reasoningZh : undefined} />}
            {msg.kind === "text" && msg.todos?.length ? <Todos todos={msg.todos} ended={!streaming} /> : null}
            {msg.kind === "text" &&
              msg.steers?.map((s, i) => (
                <div key={i} className="mb-2 flex items-start gap-1.5 rounded-xl bg-accent-soft px-3 py-1.5 text-[13px] text-accent-text">
                  <CornerDownRight size={13} className="mt-[3px] shrink-0" />
                  <span className="min-w-0 whitespace-pre-wrap">你在回复中插入：{s}</span>
                </div>
              ))}
            {tools && <ToolSteps steps={tools} messageId={msg.id} />}
            {msg.text && <RichText text={msg.text} agents={agents} cites={citations(tools)} />}
            {streaming && <Waiting id={msg.id} typing={!msg.text && !reasoning} />}
            {msg.text && !streaming && <CitedSources text={msg.text} steps={tools} />}
            {msg.kind === "review" && (
              <div className="mt-2.5 border-t border-line pt-2.5">
                <IssueList issues={msg.issues} />
              </div>
            )}
          </div>
        )}
        {msg.kind === "text" && msg.files?.length ? <MadeFiles files={msg.files} /> : null}
        {msg.kind === "text" && msg.outputs?.files.length && !streaming ? <OutputFiles outputs={msg.outputs} /> : null}
        {msg.kind === "text" && msg.unverified && !streaming ? <Unconfirmed u={msg.unverified} /> : null}
        {tools && !streaming && <Changes messageId={msg.id} tools={tools} />}
        {msg.kind === "text" && msg.plan && !streaming && !failed && isLatest && <RunPlan chat={msg.chat} />}
        {msg.kind === "text" && !inGroup && !column && !streaming && !failed && isLatest && <NextSteps msg={msg} />}
        {failed && <Failure msg={msg} />}
        {!streaming && (
          <Meta
            time={time}
            usage={msg.usage}
            note={stopped ? "已停止" : undefined}
            copy={msg.text || undefined}
            name={msg.kind === "text" ? (agent?.name ?? "回复") : undefined}
            align="left"
            extra={
              <>
                {msg.kind === "text" && msg.text && !failed && (
                  <button type="button" title="把这条回复放进共写文档，在侧栏接着改" onClick={() => openDoc(msg.chat, msg.text)} className="flex items-center gap-1 hover:text-fg">
                    <NotebookPen size={12} /> 放进文档
                  </button>
                )}
                {msg.kind === "text" && !inGroup && !isLatest && !failed && complex(msg) && (
                  <SkillButton messageId={msg.id} className="flex items-center gap-1 hover:text-fg">
                    <BookPlus size={12} /> 存成技能
                  </SkillButton>
                )}
              </>
            }
          />
        )}
      </div>
    </div>
  );
}
