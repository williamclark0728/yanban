import { useData } from "../store";
import type { Agent, Issue, Message, Run, StepType } from "../types";
import { judge } from "./collab";
import { isDesktop, saveAs } from "./desktop";

const stepName: Record<StepType, string> = { plan: "分工", draft: "产出", check: "核查", review: "审查", revise: "修订", summary: "最终交付" };
const issueName: Record<Issue["status"], string> = { holds: "成立", unsure: "存疑", rejected: "不成立" };
const verdictName = { pass: "通过", revise: "退回修订", stop: "结束", done: "完成" } as const;

const stamp = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const cell = (s = "") => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function context(run: Run) {
  const { agents, groups, messages } = useData.getState();
  const byId = new Map(messages.map((m) => [m.id, m]));
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? "已删除的成员";
  return { group: groups.find((g) => g.id === run.groupId), agents, byId, name };
}

function issueTable(issues: Issue[]) {
  if (!issues.length) return "未发现问题。\n";
  return ["| 判定 | 内容 | 依据 |", "| --- | --- | --- |", ...issues.map((i) => `| ${issueName[i.status]} | ${cell(i.text)} | ${cell(i.evidence)} |`)].join("\n") + "\n";
}

/** Message text with its own headings pushed below the report's ### level. */
const textOf = (m?: Message) => (m && m.kind !== "round" ? m.text.replace(/^(#{1,3})(?=\s)/gm, "####") : "");

export function runToMarkdown(run: Run) {
  const { group, byId, name } = context(run);
  const ask = byId.get(run.messageId ?? "");
  const files = ask?.kind === "text" ? (ask.attachments ?? []).map((f) => f.name) : [];
  const seconds = run.endedAt ? Math.round((run.endedAt - run.startedAt) / 1000) : undefined;
  const out: string[] = [
    `# 协作记录：${run.task.slice(0, 40)}`,
    "",
    `- 群聊：${group?.name ?? "已解散"}；主持：${group ? name(group.leadId) : "-"}`,
    `- 开始：${stamp(run.startedAt)}${seconds !== undefined ? `；用时 ${seconds} 秒` : ""}；共 ${run.rounds.length} 轮；Token ${run.tokens.toLocaleString()}`,
    `- 共识规则：${(run.consensus ?? group?.consensus) === "relaxed" ? "宽松（没有成立的疑点即通过）" : "严格（成立和存疑都要解决）"}；最多 ${run.maxRounds ?? group?.maxRounds ?? "-"} 轮`,
    `- 结果：${{ done: "已完成", running: "进行中", stopped: "已停止", failed: "未完成" }[run.status]}`,
    "",
    "## 用户需求",
    "",
    textOf(ask) || run.task,
    ...(files.length ? ["", `附件：${files.join("、")}`] : []),
  ];

  for (const round of run.rounds) {
    out.push("", `## 第 ${round.index} 轮`);
    for (const s of round.steps) {
      if (s.type === "summary") continue;
      const m = byId.get(s.messageId ?? "");
      out.push("", `### ${name(s.agentId)} · ${stepName[s.type]}${s.failed ? "（未完成）" : ""}`, "");
      if (s.type === "review") out.push(s.summary, "", issueTable(s.issues ?? []));
      else out.push(textOf(m) || s.summary);
    }
    if (round.verdict) {
      const issues = round.steps.filter((s) => s.type === "review").flatMap((s) => s.issues ?? []);
      const count = (s: Issue["status"]) => issues.filter((i) => i.status === s).length;
      const detail = issues.length ? `成立 ${count("holds")}、存疑 ${count("unsure")}、不成立 ${count("rejected")}` : round.note;
      out.push("", `**本轮判定：${verdictName[round.verdict]}**${detail ? ` · ${detail}` : ""}`);
    }
  }

  const summary = run.rounds.flatMap((r) => r.steps).find((s) => s.type === "summary");
  if (summary) out.push("", "## 最终交付", "", `由${name(summary.agentId)}汇总：`, "", textOf(byId.get(summary.messageId ?? "")) || summary.summary);

  const b = run.baseline;
  if (b?.status === "done") {
    const issues = b.reviews.flatMap((r) => r.issues);
    const v = judge(issues, run.consensus ?? "strict");
    out.push(
      "",
      "## 单 Agent 对照",
      "",
      `同一需求和附件交给 ${name(b.agentId)} 使用的模型（${b.model ?? "-"}）单独完成，不分工、不审查；再由同一批审查成员按同样规则审查一次。`,
      "",
      "| 指标 | 多 Agent 协作 | 单 Agent |",
      "| --- | --- | --- |",
      `| 轮数 | ${run.rounds.length} | 1 |`,
      `| Token | ${run.tokens.toLocaleString()} | ${b.tokens.toLocaleString()} |`,
      `| 用时（秒） | ${seconds ?? "-"} | ${b.seconds} |`,
      `| 最后一次审查：成立 / 存疑 | ${finalCounts(run)} | ${v.holds} / ${v.unsure} |`,
      "",
      "### 单 Agent 产出",
      "",
      b.text ?? "",
      "",
      "### 对单 Agent 产出的审查",
    );
    for (const r of b.reviews) out.push("", `**${name(r.agentId)}**：${r.summary}`, "", issueTable(r.issues));
  }
  return out.join("\n") + "\n";
}

function finalCounts(run: Run) {
  const last = [...run.rounds].reverse().find((r) => r.steps.some((s) => s.type === "review"));
  if (!last) return "未审查";
  const issues = last.steps.filter((s) => s.type === "review").flatMap((s) => s.issues ?? []);
  const v = judge(issues, "strict");
  return `${v.holds} / ${v.unsure}`;
}

export function runToJson(run: Run) {
  const { group, agents, byId } = context(run);
  const ids = new Set([run.messageId, ...run.rounds.flatMap((r) => r.steps.map((s) => s.messageId))]);
  const member = (a: Agent) => ({ id: a.id, name: a.name, role: a.role, model: a.model, params: a.params });
  const messages = [...ids]
    .map((id) => byId.get(id ?? ""))
    .filter((m): m is Message => !!m)
    .map((m) =>
      m.kind === "text"
        ? { ...m, attachments: m.attachments?.map(({ image: _image, text: _text, ...meta }) => meta) }
        : m,
    );
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      group: group && { id: group.id, name: group.name, leadId: group.leadId, consensus: group.consensus, maxRounds: group.maxRounds },
      members: (group?.memberIds ?? []).map((id) => agents.find((a) => a.id === id)).filter((a): a is Agent => !!a).map(member),
      run,
      messages,
    },
    null,
    2,
  );
}

export function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  if (isDesktop) return void saveAs(filename, blob);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A whole chat as Markdown (/export): who said what, with summaries and new-topic marks. */
export function chatToMarkdown(chat: string) {
  const { agents, groups, messages } = useData.getState();
  const title = groups.find((g) => g.id === chat)?.name ?? agents.find((a) => a.id === chat)?.name ?? "对话";
  const name = (id: string) => (id === "me" ? "我" : (agents.find((a) => a.id === id)?.name ?? "已删除的成员"));
  const parts = messages
    .filter((m) => m.chat === chat)
    .map((m) => {
      if (m.kind === "round") return `> 第 ${m.round} 轮 · ${verdictName[m.verdict]}：${m.note}`;
      if (m.kind === "text" && m.reset) return "---\n\n*新话题*";
      if (m.kind === "text" && m.summary) return m.text ? `---\n\n*之前的对话已压缩，摘要：*\n\n${m.text}` : null;
      if (!m.text && !(m.kind === "text" && m.attachments?.length)) return null;
      const files = m.kind === "text" && m.attachments?.length ? `\n\n附件：${m.attachments.map((f) => f.name).join("、")}` : "";
      const issues = m.kind === "review" ? `\n\n${issueTable(m.issues)}` : "";
      return `### ${name(m.sender)} · ${stamp(m.at)}\n\n${textOf(m)}${files}${issues}`;
    })
    .filter(Boolean);
  return { title, text: [`# ${title}`, `导出时间：${stamp(Date.now())}`, ...parts].join("\n\n") + "\n" };
}

export function exportChat(chat: string) {
  const { title, text } = chatToMarkdown(chat);
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  download(`研伴对话_${title.replace(/[\\/:*?"<>|\s]+/g, "")}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.md`, text, "text/markdown");
}

export const exportName = (run: Run, ext: string) => {
  const d = new Date(run.startedAt);
  const p = (n: number) => String(n).padStart(2, "0");
  const title = run.task.replace(/[\\/:*?"<>|\s]+/g, "").slice(0, 16) || "协作";
  return `研伴协作记录_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}_${title}.${ext}`;
};
