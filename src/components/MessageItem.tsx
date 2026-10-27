import clsx from "clsx";
import { AlertCircle, Archive, Brain, Check, CheckCircle2, ChevronDown, Copy, FileDown, Loader2, RotateCcw, RotateCw, Square } from "lucide-react";
import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { retry } from "../lib/chat";
import { download, replyAsDocx } from "../lib/outputs";
import { clock } from "../lib/time";
import { usePrefs, useUi } from "../store";
import type { Agent, Issue, Message, Usage, Verdict } from "../types";
import { BotAvatar, palette } from "./Avatar";
import { FileCard } from "./FileCard";
import { MadeFiles } from "./MadeFiles";
import { citations, ToolSteps } from "./ToolSteps";

function withMentions(text: string, agents: Agent[]) {
  const me = usePrefs.getState().name.trim();
  const names = [...agents.map((a) => a.name), ...(me ? [me] : [])].sort((a, b) => b.length - a.length);
  const re = new RegExp(`@(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return text.replace(re, (_, name: string) => {
    const id = agents.find((a) => a.name === name)?.id ?? "me";
    return `[@${name}](mention:${id})`;
  });
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
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => url}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("cite:")) {
              return (
                <a
                  href={href.slice(5)}
                  target="_blank"
                  rel="noreferrer"
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
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {withCitations(withMentions(text, agents), cites)}
      </Markdown>
    </div>
  );
}

export const verdictLabel: Record<Verdict, string> = { pass: "通过", done: "完成", stop: "结束", revise: "退回修订" };

const issueStyle: Record<Issue["status"], { label: string; cls: string }> = {
  holds: { label: "成立", cls: "bg-bad-soft text-bad" },
  rejected: { label: "不成立", cls: "bg-raise-2 text-fg-2" },
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

function Meta({ time, usage, note, copy, name, align }: { time: string; usage?: Usage; note?: string; copy?: string; name?: string; align: "left" | "right" }) {
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
    </div>
  );
}

function Typing() {
  return (
    <span className="flex h-[26px] items-center gap-1" aria-label="正在输入">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 animate-pulse rounded-full bg-fg-3" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </span>
  );
}

function Reasoning({ text, live }: { text: string; live: boolean }) {
  return (
    <details open={live} className="group/r mb-2 rounded-xl bg-active px-3 py-2 text-[13.5px] text-fg-2">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium select-none">
        <Brain size={14} />
        {live ? "思考中…" : "思考过程"}
        <ChevronDown size={14} className="transition-transform group-open/r:rotate-180" />
      </summary>
      <div className="mt-1.5 whitespace-pre-wrap leading-relaxed">{text}</div>
    </details>
  );
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
        {msg.chat === msg.sender && !msg.summary && (
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

/** Where the chat was compressed: later replies see this summary instead of the messages above it. */
function Summary({ msg, agents }: { msg: Extract<Message, { kind: "text" }>; agents: Agent[] }) {
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

export function MessageItem({
  msg,
  agents,
  inGroup,
  first,
  last,
}: {
  msg: Message;
  agents: Agent[];
  inGroup: boolean;
  first: boolean;
  last: boolean;
}) {
  const showPanel = useUi((s) => s.showPanel);

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
        <div className="flex max-w-[min(620px,85%)] flex-col items-end">
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
    <div className={clsx("group flex items-end gap-2.5", first ? "mt-4" : "mt-1")}>
      {inGroup && (
        <div className="w-8 shrink-0 self-end pb-6">{last && agent && <BotAvatar agent={agent} size={32} />}</div>
      )}
      <div className="flex min-w-0 max-w-[min(680px,85%)] flex-col">
        {inGroup && first && (
          <span className="mb-1 ml-3 text-[13px] font-medium" style={{ color: agent ? palette[agent.color].text : "var(--text-3)" }}>
            {agent?.name ?? "已删除的成员"}
          </span>
        )}
        {hasBody && (
          <div className="rounded-[20px] bg-bubble px-4 py-2.5">
            {reasoning && <Reasoning text={reasoning} live={streaming && !msg.text} />}
            {tools && <ToolSteps steps={tools} messageId={msg.id} />}
            {msg.text ? <RichText text={msg.text} agents={agents} cites={citations(tools)} /> : streaming && !reasoning && <Typing />}
            {msg.kind === "review" && (
              <div className="mt-2.5 border-t border-line pt-2.5">
                <IssueList issues={msg.issues} />
              </div>
            )}
          </div>
        )}
        {msg.kind === "text" && msg.files?.length ? <MadeFiles files={msg.files} /> : null}
        {failed && <Failure msg={msg} />}
        {!streaming && (
          <Meta
            time={time}
            usage={msg.usage}
            note={stopped ? "已停止" : undefined}
            copy={msg.text || undefined}
            name={msg.kind === "text" ? (agent?.name ?? "回复") : undefined}
            align="left"
          />
        )}
      </div>
    </div>
  );
}
