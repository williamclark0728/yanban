import clsx from "clsx";
import { ChevronDown, Download, Loader2, Scale, Square } from "lucide-react";
import { useState } from "react";
import { useBusy } from "../lib/chat";
import { acceptance, judge, runBaseline, stopBaseline } from "../lib/collab";
import { download, exportName, runToJson, runToMarkdown } from "../lib/export";
import { clock } from "../lib/time";
import { useData, usePrefs } from "../store";
import type { Agent, Run, StepType } from "../types";
import { BotAvatar, palette } from "./Avatar";
import { IssueList, RichText, verdictLabel } from "./MessageItem";
import { Card } from "./ui";

const stepLabel: Record<StepType, string> = {
  plan: "分工",
  draft: "产出",
  check: "核查",
  review: "审查",
  revise: "修订",
  summary: "汇总",
};

const runStatus: Record<Run["status"], { label: string; cls: string }> = {
  done: { label: "已完成", cls: "bg-ok-soft text-ok" },
  running: { label: "进行中", cls: "bg-accent-soft text-accent-text" },
  stopped: { label: "已停止", cls: "bg-raise-2 text-fg-2" },
  failed: { label: "未完成", cls: "bg-bad-soft text-bad" },
};

const unknownAgent: Agent = {
  id: "",
  name: "已删除",
  color: "snow",
  look: 0,
  tagline: "",
  model: null,
  memory: [],
  role: { duty: "", scope: "", io: "", protocol: "" },
  params: { temperature: 0.7, topP: 1, maxTokens: 0, history: 20 },
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Scrolls the chat to a step's message and flashes it. */
function reveal(messageId?: string) {
  const el = messageId && document.getElementById(`msg-${messageId}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.animate([{ backgroundColor: "var(--accent-soft)" }, { backgroundColor: "transparent" }], { duration: 1600 });
}

export function RunList({ groupId, agents }: { groupId: string; agents: Agent[] }) {
  const dev = usePrefs((s) => s.mode === "dev");
  const runs = useData((s) => s.runs)
    .filter((r) => r.groupId === groupId)
    .sort((a, b) => b.startedAt - a.startedAt);
  if (runs.length === 0) return <p className="py-10 text-center text-sm text-fg-3">还没有协作记录</p>;
  const stats = acceptance(runs);
  return (
    <div className="space-y-4">
      {dev && stats.runs > 0 && (
        <Card className="p-4">
          <div className="mb-3 text-[13px] font-semibold">接受率（{stats.runs} 次协作，{stats.rounds} 次审查）</div>
          <table className="w-full text-[13px]">
            <thead className="text-fg-3">
              <tr>
                <th className="pb-1.5 text-left font-normal" />
                <th className="pb-1.5 text-right font-normal">严格</th>
                <th className="pb-1.5 text-right font-normal">宽松</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              <tr>
                <td className="py-1 text-fg-2">首轮通过</td>
                <td className="text-right">{pct(stats.firstStrict)}</td>
                <td className="text-right">{pct(stats.firstRelaxed)}</td>
              </tr>
              <tr>
                <td className="py-1 text-fg-2">每次审查通过</td>
                <td className="text-right">{pct(stats.roundStrict)}</td>
                <td className="text-right">{pct(stats.roundRelaxed)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-fg-3">
            按记录里的审查结果分别套用两种规则计算。实际最终通过 {pct(stats.finalPass)}，平均 {stats.avgRounds.toFixed(1)} 轮。
          </p>
        </Card>
      )}
      {runs.map((r) => (
        <RunCard key={r.id} run={r} agents={agents} />
      ))}
    </div>
  );
}

function RunCard({ run, agents }: { run: Run; agents: Agent[] }) {
  const dev = usePrefs((s) => s.mode === "dev");
  const [menu, setMenu] = useState(false);
  const status = runStatus[run.status];
  const seconds = run.endedAt ? Math.round((run.endedAt - run.startedAt) / 1000) : undefined;
  const find = (id: string) => agents.find((x) => x.id === id) ?? unknownAgent;
  const finished = run.status !== "running";

  return (
    <Card className="p-4">
      <div className="flex items-start gap-2">
        <p className="line-clamp-3 flex-1 font-medium leading-snug">{run.task}</p>
        <span className={clsx("shrink-0 rounded-md px-1.5 py-px text-xs font-medium", status.cls)}>{status.label}</span>
      </div>
      <p className="mt-1 text-xs text-fg-3">
        {clock(run.startedAt)} · {run.rounds.length} 轮{run.consensus && ` · ${run.consensus === "strict" ? "严格" : "宽松"}规则`}
        {seconds !== undefined && ` · ${seconds} 秒`}
        {dev && ` · ${run.tokens.toLocaleString()} tokens`}
      </p>

      <ol className="mt-4 space-y-4">
        {run.rounds.map((round) => (
          <li key={round.index}>
            <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
              <span>第 {round.index} 轮</span>
              {round.verdict && (
                <span
                  className={clsx(
                    "rounded-md px-1.5 py-px text-[11px]",
                    round.verdict === "pass" || round.verdict === "done" ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn",
                  )}
                >
                  {verdictLabel[round.verdict]}
                </span>
              )}
            </div>
            <ol className="relative space-y-3 border-l border-line-2 pl-4">
              {round.steps.map((s, i) => {
                const a = find(s.agentId);
                return (
                  <li key={i} className="relative">
                    <span className="absolute -left-[25px] top-0.5 rounded-full bg-raise ring-2 ring-raise">
                      <BotAvatar agent={a} size={17} />
                    </span>
                    <button type="button" onClick={() => reveal(s.messageId)} className="block w-full text-left">
                      <span className="flex items-baseline gap-2 text-[13px]">
                        <span className="font-medium" style={{ color: palette[a.color].text }}>{a.name}</span>
                        <span className="text-fg-3">{stepLabel[s.type]}</span>
                        {s.failed && <span className="text-bad">未完成</span>}
                        {dev && <span className="ml-auto font-mono text-[11px] text-fg-3">{s.tokens.toLocaleString()}</span>}
                      </span>
                      <span className="mt-0.5 block text-[13px] text-fg-2">{s.summary}</span>
                    </button>
                    {s.issues && s.issues.length > 0 && (
                      <div className="mt-1.5 text-[13px]">
                        <IssueList issues={s.issues} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            {round.note && <p className="mt-2 pl-4 text-xs text-fg-3">{round.note}</p>}
          </li>
        ))}
      </ol>

      <BaselinePanel run={run} agents={agents} seconds={seconds} />

      {finished && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
          {!run.baseline && <BaselineButton run={run} />}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu((v) => !v)}
              className="flex h-8 items-center gap-1.5 rounded-full bg-raise-2 px-3 text-[13px] font-medium hover:bg-active"
            >
              <Download size={14} /> 导出 <ChevronDown size={13} />
            </button>
            {menu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                <div className="rise absolute bottom-full left-0 z-20 mb-2 w-44 rounded-2xl border border-line bg-raise p-1.5 shadow-[var(--shadow)]">
                  <button
                    type="button"
                    onClick={() => {
                      download(exportName(run, "md"), runToMarkdown(run), "text/markdown");
                      setMenu(false);
                    }}
                    className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-hover"
                  >
                    Markdown 报告
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      download(exportName(run, "json"), runToJson(run), "application/json");
                      setMenu(false);
                    }}
                    className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-hover"
                  >
                    JSON 原始数据
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function BaselineButton({ run }: { run: Run }) {
  const hasDraft = run.rounds.some((r) => r.steps.some((s) => s.type === "draft"));
  if (!hasDraft) return null;
  return (
    <button
      type="button"
      onClick={() => void runBaseline(run.id)}
      title="把同一需求交给一个智能体单独完成，再用同样的审查规则检查"
      className="flex h-8 items-center gap-1.5 rounded-full bg-raise-2 px-3 text-[13px] font-medium hover:bg-active"
    >
      <Scale size={14} /> 单 Agent 对照
    </button>
  );
}

function BaselinePanel({ run, agents, seconds }: { run: Run; agents: Agent[]; seconds?: number }) {
  const busy = useBusy((s) => !!s[`baseline:${run.id}`]);
  const [open, setOpen] = useState(false);
  const b = run.baseline;
  if (!b) return null;
  const agent = agents.find((a) => a.id === b.agentId) ?? unknownAgent;

  if (b.status === "running" || busy) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-xl bg-active px-3 py-2.5 text-[13px] text-fg-2">
        <Loader2 size={15} className="animate-spin" />
        <span className="flex-1">{b.text ? "正在用同样的标准审查单 Agent 产出…" : `${agent.name}的模型正在单独完成…`}</span>
        <button type="button" onClick={() => stopBaseline(run.id)} className="flex items-center gap-1 text-fg-3 hover:text-fg">
          <Square size={12} fill="currentColor" /> 停止
        </button>
      </div>
    );
  }
  if (b.status === "failed") {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-xl bg-bad-soft px-3 py-2.5 text-[13px] text-bad">
        <span className="flex-1">单 Agent 对照没有完成：{b.error}</span>
        <button type="button" onClick={() => void runBaseline(run.id)} className="font-medium hover:underline">
          重试
        </button>
      </div>
    );
  }

  const issues = b.reviews.flatMap((r) => r.issues);
  const single = judge(issues, "strict");
  const last = [...run.rounds].reverse().find((r) => r.steps.some((s) => s.type === "review"));
  const multi = last ? judge(last.steps.filter((s) => s.type === "review").flatMap((s) => s.issues ?? []), "strict") : null;
  const rows: [string, string, string][] = [
    ["轮数", String(run.rounds.length), "1"],
    ["Token", run.tokens.toLocaleString(), b.tokens.toLocaleString()],
    ["用时", seconds !== undefined ? `${seconds} 秒` : "-", `${b.seconds} 秒`],
  ];
  if (b.reviews.length) rows.push(["审查：成立 / 存疑", multi ? `${multi.holds} / ${multi.unsure}` : "-", `${single.holds} / ${single.unsure}`]);

  return (
    <div className="mt-4 rounded-xl border border-line p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
        <Scale size={14} /> 单 Agent 对照
        <span className="font-normal text-fg-3">· {b.model}</span>
      </div>
      <table className="w-full text-[13px] tabular-nums">
        <thead className="text-fg-3">
          <tr>
            <th className="pb-1 text-left font-normal" />
            <th className="pb-1 text-right font-normal">多 Agent</th>
            <th className="pb-1 text-right font-normal">单 Agent</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, m, s]) => (
            <tr key={k}>
              <td className="py-0.5 text-fg-2">{k}</td>
              <td className="text-right">{m}</td>
              <td className="text-right">{s}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 flex items-center gap-1 text-[13px] text-accent-text">
        {open ? "收起" : "查看单 Agent 产出与审查"} <ChevronDown size={13} className={clsx("transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          <div className="max-h-72 overflow-y-auto rounded-xl bg-bg px-3 py-2 text-[13.5px]">
            <RichText text={b.text ?? ""} agents={agents} />
          </div>
          {b.reviews.map((r) => (
            <div key={r.agentId} className="text-[13px]">
              <div className="mb-1 font-medium">
                {(agents.find((a) => a.id === r.agentId) ?? unknownAgent).name}：<span className="font-normal text-fg-2">{r.summary}</span>
              </div>
              <IssueList issues={r.issues} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
