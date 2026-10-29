import { jsonSchema, tool, type ModelMessage, type ToolSet } from "ai";
import { resolveModel, useData, usePrefs } from "../store";
import type { Agent, AskItem, Attachment, Baseline, BoardItem, Group, Issue, IssueStatus, Message, Run, RunRound, RunStep, TextMessage } from "../types";
import {
  agentById,
  autoCompact,
  begin,
  end,
  formatIssue,
  groupPrompt,
  groupSystem,
  latestImages,
  planSystem,
  sendsImages,
  speak,
  stop,
  stripThink,
  systemPrompt,
  uid,
  useBusy,
  userContent,
  withFiles,
} from "./chat";
import { cleanQuestions, waitAnswer } from "./agentTools";
import { completeText, describeError, repairJson, showWait } from "./llm";
import { tracer, webAccess, type Report } from "./tools";
import { verifyReply } from "./verify";

type Kind = "produce" | "review";

interface Assignment {
  agent: Agent;
  task: string;
  type: Kind;
  /** Producers listed earlier whose output this one waits for and builds on. */
  after?: Agent[];
}

/** Mentioning this makes every member answer directly. */
export const ALL = "所有人";

/** Requests where members just speak in turn, used when the lead's plan doesn't say. */
const TAKE_TURNS = /自我介绍|介绍(一下)?(你们|自己)|各自|每个人|每人|轮流|大家(都)?(说|谈|聊)/;

const REVIEW_RULES = [
  "你负责审查。对照用户的需求和提供的材料，检查最新一版稿件。按顺序做三件事：",
  "1. 逐项核对用户需求里的每一个要求（字数、格式、必须包含或单独列出的内容）是否做到，没做到的记为 holds。",
  "2. 核对稿件与材料是否一致（数字、名称、结论）。",
  "3. 判断材料本身的说法是否站得住：同一指标前后不一、名称与描述自相矛盾、复杂度或单位错误等；稿件照搬了这类问题也记为 holds。",
  "逐条列出你检查的要点，每条给出判定：",
  "- holds（成立）：确实有问题，必须修改",
  "- unsure（存疑）：找不到依据确认，需要作者补充依据或说明",
  "- rejected（不成立）：核对过，没有问题",
  "重点写 holds 和 unsure；关键数字和结论即使没问题，也列为 rejected，表明你核对过。",
  "只有影响事实、数字、结论、原意或用户明确要求的问题才判 holds。换个同义词、调整语序这类措辞偏好不算问题，不要列；确实影响理解的措辞最多记 unsure。",
  "上一轮已经按意见改好的地方不要再提，更不要要求改回去。改写类任务要检查有没有改变原意、有没有加入原文没有的判断或程度词。",
  "每条写清原文怎么写、问题是什么、建议怎么改；evidence 写依据位置（文件名和行号或页码），没有就留空。",
  "只输出一个 JSON 对象，不要输出其他内容：",
  '{"summary": "一句话结论", "issues": [{"text": "……", "status": "holds 或 unsure 或 rejected", "evidence": "……"}]}',
].join("\n");

// ---------- parsing ----------

function extractJson(raw: string): Record<string, unknown> | null {
  const text = stripThink(raw).replace(/```(?:json)?/gi, "");
  const start = text.indexOf("{");
  const stop = text.lastIndexOf("}");
  if (start < 0 || stop <= start) return null;
  const body = text.slice(start, stop + 1);
  try {
    return JSON.parse(body);
  } catch {
    // Windows paths with single backslashes (D:\研伴测试\), trailing commas…
    const fixed = repairJson(body);
    return fixed ? JSON.parse(fixed) : null;
  }
}

/** A task that checks someone else's work, whatever type the lead gave it. */
const CHECKS = /审查|审核|审阅|审稿|核查|核对|核实|校对|校验|复核|验算|把关|挑错|找错|纠错|检查/;
const OF_WORK = /稿|产出|答案|解答|结果|报告|文章|内容|步骤|推导|计算/;

/**
 * Reads the lead's JSON plan; tolerant of code fences, extra prose and Chinese labels.
 * `after` names one or more producers ("甲、乙" or a list). Models often get the order wrong, so outside "speak" mode:
 * a "produce" task that checks someone's work becomes a review (reviews start after every producer is done),
 * and a producer whose task names another producer ("根据检索员甲的资料写稿") waits for them.
 * Producers are put in an order where everyone comes after those they wait for; a wait that would close a loop is dropped.
 */
export function parsePlan(raw: string, members: Agent[]): { reply: string; speak: boolean; assignments: Assignment[]; questions: AskItem[] } | null {
  const data = extractJson(raw);
  if (!data) return null;
  const byName = (name: string) =>
    members.find((m) => m.name === name) ?? members.find((m) => name.includes(m.name) || m.name.includes(name));
  const clean = (v: unknown) => (Array.isArray(v) ? v.join("、") : String(v ?? "")).replace(/@/g, "").trim();
  // Every member named in an `after`, longest names first so "检索员甲" isn't read as some shorter name.
  const named = (wait: string) => {
    const found: Agent[] = [];
    let rest = wait;
    for (const m of [...members].sort((a, b) => b.name.length - a.name.length)) {
      if (!rest.includes(m.name)) continue;
      found.push(m);
      rest = rest.split(m.name).join(" ");
    }
    const one = !found.length && wait ? byName(wait) : undefined;
    return one ? [one] : found;
  };
  const merged = new Map<string, Assignment & { wait: string }>();
  for (const a of Array.isArray(data.assignments) ? data.assignments : []) {
    const name = clean(a?.member);
    const task = String(a?.task ?? "").trim();
    const agent = name && byName(name);
    if (!agent || !task) continue;
    const type: Kind = /review|审|核/i.test(String(a?.type ?? "")) ? "review" : "produce";
    const prev = merged.get(agent.id);
    merged.set(agent.id, { agent, type: prev?.type ?? type, task: prev ? `${prev.task}；${task}` : task, wait: prev?.wait || clean(a?.after) });
  }
  const speak = /speak|发言/i.test(String(data.mode ?? ""));
  const list = [...merged.values()];
  if (!speak) {
    const mentionsOther = (a: (typeof list)[number]) => list.some((x) => x !== a && a.task.includes(x.agent.name));
    const checking = list.filter((a) => a.type === "produce" && CHECKS.test(a.task) && (OF_WORK.test(a.task) || mentionsOther(a)));
    // Something must still be produced for the reviews to check.
    if (list.some((a) => a.type === "produce" && !checking.includes(a))) for (const a of checking) a.type = "review";
  }
  const producers = list.filter((a) => a.type === "produce");
  const waitsFor = new Map(
    producers.map((a) => {
      const others = producers.filter((x) => x !== a).map((x) => x.agent);
      const wanted = a.wait ? named(a.wait) : speak ? [] : others.filter((m) => a.task.includes(m.name));
      return [a.agent.id, wanted.filter((m) => others.includes(m))];
    }),
  );
  const ordered: typeof producers = [];
  for (let rest = producers; rest.length; ) {
    const ready = rest.find((a) => waitsFor.get(a.agent.id)!.every((m) => ordered.some((x) => x.agent === m))) ?? rest[0];
    ordered.push(ready);
    rest = rest.filter((a) => a !== ready);
  }
  const assignments = [...ordered, ...list.filter((a) => a.type !== "produce")].map(({ wait: _, ...a }, i) => {
    const after = a.type === "produce" ? waitsFor.get(a.agent.id)!.filter((m) => ordered.slice(0, i).some((x) => x.agent === m)) : [];
    return after.length ? { ...a, after } : a;
  });
  return { reply: typeof data.reply === "string" ? data.reply.trim() : "", speak, assignments, questions: assignments.length ? [] : cleanQuestions(data.questions) };
}

export function issueStatus(value: unknown): IssueStatus {
  const v = String(value ?? "").toLowerCase();
  if (/不成立|没问题|无问题|rejected|no issue|pass|通过|正确/.test(v)) return "rejected";
  if (/成立|需修改|holds|confirmed|error|错误/.test(v)) return "holds";
  return "unsure";
}

/** Reviewer JSON → summary and issues. Unreadable output counts as one open question, never as a pass. */
export function parseReview(raw: string): { summary: string; issues: Issue[] } {
  const data = extractJson(raw);
  if (!data || !Array.isArray(data.issues)) {
    const plain = stripThink(raw).slice(0, 120);
    return { summary: "审查结果没有按格式给出", issues: [{ text: `没能读出明确的判定：${plain}`, status: "unsure" }] };
  }
  const issues = data.issues
    .map((i: Record<string, unknown>) => ({
      text: String(i?.text ?? "").trim(),
      status: issueStatus(i?.status),
      evidence: String(i?.evidence ?? "").trim() || undefined,
    }))
    .filter((i: Issue) => i.text);
  return { summary: typeof data.summary === "string" ? data.summary.trim() : "", issues };
}

// ---------- consensus ----------

/**
 * Strict: every point must be cleared, so open questions block too.
 * Relaxed: only confirmed problems block; open questions are carried along.
 */
export function judge(issues: Issue[], rule: Group["consensus"]) {
  const holds = issues.filter((i) => i.status === "holds").length;
  const unsure = issues.filter((i) => i.status === "unsure").length;
  return { pass: holds === 0 && (rule === "relaxed" || unsure === 0), holds, unsure };
}

const reviewIssues = (round: RunRound) => round.steps.filter((s) => s.type === "review").flatMap((s) => s.issues ?? []);

/** First-round and per-round acceptance under both rules, computed from the recorded reviews. */
export function acceptance(runs: Run[]) {
  const reviewed = runs.filter((r) => r.rounds.some((rd) => rd.steps.some((s) => s.type === "review")));
  const rounds = reviewed.flatMap((r) => r.rounds.filter((rd) => rd.steps.some((s) => s.type === "review")));
  const rate = (n: number, of: number) => (of ? n / of : 0);
  return {
    runs: reviewed.length,
    rounds: rounds.length,
    firstStrict: rate(reviewed.filter((r) => judge(reviewIssues(r.rounds[0]), "strict").pass).length, reviewed.length),
    firstRelaxed: rate(reviewed.filter((r) => judge(reviewIssues(r.rounds[0]), "relaxed").pass).length, reviewed.length),
    roundStrict: rate(rounds.filter((rd) => judge(reviewIssues(rd), "strict").pass).length, rounds.length),
    roundRelaxed: rate(rounds.filter((rd) => judge(reviewIssues(rd), "relaxed").pass).length, rounds.length),
    finalPass: rate(reviewed.filter((r) => r.rounds.at(-1)?.verdict === "pass").length, reviewed.length),
    avgRounds: reviewed.length ? reviewed.reduce((n, r) => n + r.rounds.length, 0) / reviewed.length : 0,
  };
}

// ---------- non-streamed JSON step ----------

interface Thought {
  ok: boolean;
  text: string;
  reasoning: string;
  tokens: number;
  messageId: string;
  usage?: { model: string; input: number; output: number; seconds: number };
}

/** Shows a typing bubble, gets one complete answer, and leaves the bubble for the caller to fill in. */
async function think(opts: { chat: string; agent: Agent; system: string; messages: ModelMessage[]; signal: AbortSignal; temperature?: number }): Promise<Thought> {
  const { providers, defaultModel, addMessage, patchMessage } = useData.getState();
  const id = uid();
  addMessage({ id, chat: opts.chat, kind: "text", sender: opts.agent.id, text: "", status: "streaming", at: Date.now() });
  const target = resolveModel(opts.agent, providers, defaultModel);
  if (!target) {
    patchMessage(id, { status: "error", error: { message: "还没有连接模型服务" } }, true);
    return { ok: false, text: "", reasoning: "", tokens: 0, messageId: id };
  }
  const { report, halt } = tracer(id);
  const web = webAccess(opts.agent, report);
  try {
    const params = { ...opts.agent.params, temperature: opts.temperature ?? opts.agent.params.temperature };
    const r = await completeText({
      provider: target.provider,
      modelId: target.modelId,
      system: opts.system,
      messages: opts.messages,
      params,
      signal: opts.signal,
      tools: Object.keys(web.tools).length ? web.tools : undefined,
      search: web.search,
      onSources: web.onSources,
      onWait: showWait(id),
    });
    return {
      ok: true,
      text: r.text,
      reasoning: r.reasoning,
      tokens: r.input + r.output,
      messageId: id,
      usage: { model: target.modelId, input: r.input, output: r.output, seconds: r.seconds },
    };
  } catch (e) {
    halt();
    if (opts.signal.aborted) patchMessage(id, { status: "stopped" }, true);
    else {
      const error = describeError(e);
      if (sendsImages(opts.messages) && /请求被拒绝|找不到/.test(error.message)) error.message = "这个模型可能不支持图片，换一个能识图的模型试试";
      patchMessage(id, { status: "error", error }, true);
    }
    return { ok: false, text: "", reasoning: "", tokens: 0, messageId: id };
  }
}

const plain = (s: string) => stripThink(s).replace(/[\s\p{P}\p{S}]/gu, "");

/** The lead's reply is empty, or just the user's own words again. */
function echoes(reply: string, said: string) {
  const r = plain(reply);
  const u = plain(said);
  return !r || r === u || (u.length >= 4 && r.includes(u) && r.length <= u.length + 6);
}

const summarize = (text: string) => {
  const plain = stripThink(text).replace(/[*#>`_]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > 60 ? `${plain.slice(0, 60)}…` : plain;
};

const names = (agents: Agent[]) => agents.map((a) => a.name).join("、");

// ---------- entry ----------

/** How a collaboration ended, for whoever started it. */
export interface CollabResult {
  status: Run["status"] | "busy";
  /** The lead's delivery, or its direct answer when nobody was assigned. */
  text: string;
  /** The last round's verdict line, e.g. "核查员、审稿人审查通过". */
  note?: string;
}

/**
 * Members named with @ answer directly; otherwise (or when the lead is named) the lead runs a collaboration.
 * `via` marks a task a lead brought over from a private chat; it always goes to the lead.
 */
/** The task each group is working on, for an interjection to carry over. */
const tasks = new Map<string, string>();
export const runningTask = (groupId: string) => tasks.get(groupId);

/**
 * `before`: the user interjected while this task ran; the lead re-plans from it instead of starting over.
 */
export async function sendToGroup(groupId: string, text: string, attachments?: Attachment[], via?: string, before?: string): Promise<CollabResult | null> {
  const { groups, addMessage } = useData.getState();
  const group = groups.find((g) => g.id === groupId);
  if (!group) return null;
  if (!useBusy.getState()[groupId]) await autoCompact(groupId);
  const messageId = uid();
  addMessage({ id: messageId, chat: groupId, kind: "text", sender: "me", text, attachments, via, at: Date.now() });

  // A group in work mode lends its folder to every member for this conversation.
  const members = group.memberIds
    .map(agentById)
    .filter((a): a is Agent => !!a)
    .map((a) => (group.workspace ? { ...a, workspace: group.workspace } : a));
  const lead = members.find((m) => m.id === group.leadId) ?? members[0];
  if (!lead) return null;
  if (!via && text.includes(`@${ALL}`)) {
    await answerMentions(group, [lead, ...members.filter((m) => m.id !== lead.id)]);
    return null;
  }
  const named = members.filter((m) => text.includes(`@${m.name}`));
  if (!via && named.length > 0 && !named.some((m) => m.id === lead.id)) {
    await answerMentions(group, named);
    return null;
  }
  const task = text || `处理附件：${attachments?.map((f) => f.name).join("、") ?? ""}`;
  // A task brought over from a private chat was already clarified there; the user is watching that chat, not this one.
  return collaborate(group, lead, members.filter((m) => m.id !== lead.id), task, messageId, !via && !before, before);
}

// ---------- a private-chat lead handing work to its group ----------

export function dispatchRules(led: Group[]) {
  const list = led.map((g) => {
    const members = g.memberIds.filter((id) => id !== g.leadId).map(agentById).filter((a): a is Agent => !!a);
    return `- 「${g.name}」：${members.map((m) => `${m.name}（${m.tagline}）`).join("、") || "暂无成员"}`;
  });
  return [
    "你是以下群的主持人，可以用 dispatch_to_group 把任务交给群里协作（成员分工产出、审查、修订后由你交付）：",
    ...list,
    "用户要你安排团队完成、或者明显需要写作加核查的任务，就派到群里；简单问题自己回答。",
    "只有调用 dispatch_to_group 才算真的派出去了，不要在没调用时说已经安排好。",
    "task 要写完整：用户的原始要求、所有约束（字数、格式、语气）、用户给的材料要点，群成员看不到这段私聊。",
    "工具返回群里的交付结果后，向用户汇报：结论或成品要点、审查情况，并告诉用户完整过程在群里。",
  ].join("\n");
}

export function dispatchTools(lead: Agent, led: Group[], report: Report, attachments?: Attachment[]): ToolSet {
  return {
    dispatch_to_group: tool({
      description: "把任务交给你主持的群协作完成。会一直等到群里交付，返回交付内容。",
      inputSchema: jsonSchema<{ group: string; task: string }>({
        type: "object",
        properties: {
          group: { type: "string", enum: led.map((g) => g.name), description: "群名" },
          task: { type: "string", description: "交给群的完整任务说明" },
        },
        required: ["group", "task"],
      }),
      execute: async ({ group, task }, { toolCallId, abortSignal }) => {
        const g = led.find((x) => x.name === group) ?? (led.length === 1 ? led[0] : undefined);
        if (!g) return `没有叫「${group}」的群，可用的群：${led.map((x) => x.name).join("、")}`;
        const base = { id: toolCallId, name: "dispatch_to_group" as const, label: g.name, groupId: g.id };
        if (useBusy.getState()[g.id]) {
          report({ ...base, status: "error", detail: "群里正在进行别的任务" });
          return `「${g.name}」正在进行别的任务，这次没有派出。请告诉用户稍后再试。`;
        }
        report({ ...base, status: "running", detail: "群里正在协作" });
        // Stopping the private reply stops the group's run too.
        const onAbort = () => stop(g.id);
        abortSignal?.addEventListener("abort", onAbort);
        try {
          const r = await sendToGroup(g.id, task, attachments, lead.id);
          if (!r || r.status === "busy") {
            report({ ...base, status: "error", detail: "群里正在进行别的任务" });
            return `「${g.name}」正在进行别的任务，这次没有派出。`;
          }
          const label = { done: "已交付", stopped: "已停止", failed: "没有完成", running: "进行中" }[r.status];
          report({ ...base, status: r.status === "done" ? "done" : "error", detail: [label, r.note].filter(Boolean).join(" · ") });
          if (r.status !== "done") return `群里的任务${label}。${r.note ?? ""}${r.text ? `\n目前的结果：\n${r.text}` : ""}`;
          return `「${g.name}」已交付。${r.note ? `审查情况：${r.note}。` : ""}\n交付内容：\n${stripThink(r.text)}`;
        } finally {
          abortSignal?.removeEventListener("abort", onAbort);
        }
      },
    }),
  };
}

async function answerMentions(group: Group, named: Agent[]) {
  const c = begin(group.id);
  if (!c) return;
  try {
    await Promise.all(
      named.map((agent) =>
        speak({
          chat: group.id,
          agent,
          system: groupSystem(agent, group),
          messages: groupPrompt(group.id, agent.params.history, "用户在群里 @ 了你，请回复。"),
          signal: c.signal,
        }),
      ),
    );
  } finally {
    end(group.id);
  }
}

// ---------- the collaboration loop ----------

/**
 * 1. The lead plans: answer directly, or assign produce / review tasks.
 * 2. Producers write (round 1) or revise (later rounds) in parallel.
 * 3. Reviewers return structured points; the group's consensus rule decides pass or revise.
 * 4. Repeat until pass or the round limit, then the lead delivers.
 */
async function collaborate(group: Group, lead: Agent, members: Agent[], task: string, sinceId: string, canAsk: boolean, before?: string): Promise<CollabResult> {
  const c = begin(group.id);
  if (!c) return { status: "busy", text: "" };
  const said = task;
  // An interjection: members work from the old task with the user's change on top.
  if (before) task = `${before}\n\n用户中途插话修改：${said}`;
  tasks.set(group.id, task);
  let delivered = "";
  const { saveRun, addMessage, patchMessage } = useData.getState();
  const signal = c.signal;
  const run: Run = {
    id: uid(),
    groupId: group.id,
    task,
    status: "running",
    startedAt: Date.now(),
    tokens: 0,
    rounds: [],
    messageId: sinceId,
    consensus: group.consensus,
    maxRounds: group.maxRounds,
  };
  // Only real collaborations are recorded; a direct answer from the lead is just a chat message.
  let recorded = false;
  const save = () => {
    if (!recorded) return;
    const steps = run.rounds.flatMap((r) => r.steps);
    saveRun({
      ...run,
      tokens: steps.reduce((n, s) => n + s.tokens, 0),
      rounds: run.rounds.map((r) => ({ ...r, steps: [...r.steps] })),
      board: run.board?.map((b) => ({ ...b })),
    });
  };
  /** Moves one member's card on the task board. */
  const mark = (agentId: string, type: BoardItem["type"], status: BoardItem["status"], note?: string) => {
    const item = run.board?.find((b) => b.agentId === agentId && b.type === type);
    if (!item) return;
    item.status = status;
    if (note !== undefined) item.note = note || undefined;
    save();
  };
  const prompt = (instruction: string, limit = lead.params.history) => groupPrompt(group.id, limit, instruction, sinceId);

  const body = async () => {
    // 1. Plan. With "ask first" on, the lead may ask the user once before assigning anything.
    const temperature = Math.min(lead.params.temperature, 0.5);
    const first = before
      ? `用户在上一个任务进行中插话，改了方向；上一个任务已经停下，完成的部分在群聊记录里（标着“被你插话打断”的是没做完的）。\n上一个任务：「${before}」\n用户的插话：「${said}」\n按插话后的要求重新安排：插话是补充或修改细节时，沿着原任务继续，已有的产出能用就接着用，不要从头重做；插话换了一件事时，按新要求处理。`
      : "请处理用户的最新消息。";
    let plan = await think({ chat: group.id, agent: lead, system: planSystem(lead, group, members, canAsk && usePrefs.getState().clarify), messages: prompt(first), signal, temperature });
    if (!plan.ok) {
      run.status = signal.aborted ? "stopped" : "failed";
      return;
    }
    let parsed = parsePlan(plan.text, members);
    if (parsed?.questions.length) {
      const qs = parsed.questions;
      const step = { id: uid(), name: "ask_user" as const, label: qs.length > 1 ? `${qs.length} 个问题` : qs[0].text, questions: qs };
      patchMessage(plan.messageId, { text: parsed.reply || "开工前先问你几个问题：", status: undefined, usage: plan.usage, tools: [{ ...step, status: "waiting" }] }, true);
      const answer = await waitAnswer(step.id, signal);
      patchMessage(plan.messageId, { tools: [answer === null ? { ...step, status: "error", detail: "已停止" } : { ...step, status: "done", answer }] }, true);
      if (answer === null) {
        run.status = "stopped";
        return;
      }
      // Everyone works from the request with the answers added.
      task = `${task}\n\n${lead.name}问过的补充信息：\n${answer}`;
      run.task = task;
      tasks.set(group.id, task);
      plan = await think({ chat: group.id, agent: lead, system: planSystem(lead, group, members), messages: prompt(`请处理用户的最新消息。你已经问过用户，回答如下，不要再提问，直接安排：\n${answer}`), signal, temperature });
      if (!plan.ok) {
        run.status = signal.aborted ? "stopped" : "failed";
        return;
      }
      parsed = parsePlan(plan.text, members);
    }
    let assignments = parsed?.assignments ?? [];
    const intro = parsed ? parsed.reply : stripThink(plan.text);
    if (assignments.length === 0 && echoes(intro, task)) {
      // Small models sometimes copy the user's message into "reply"; ask once more for a plain answer.
      useData.getState().removeMessage(plan.messageId);
      const answer = await speak({
        chat: group.id,
        agent: lead,
        system: groupSystem(lead, group),
        messages: prompt("这条消息不需要分工。请以主持人的身份直接回复用户，不要复述用户的话。"),
        signal,
      });
      run.status = answer.ok ? "done" : signal.aborted ? "stopped" : "failed";
      delivered = answer.text;
      return;
    }
    // Work someone writes gets checked: when the lead assigns no reviewer, the group's checkers review it.
    if (assignments.length && !parsed?.speak && !TAKE_TURNS.test(task) && !assignments.some((a) => a.type === "review")) {
      const checkers = members.filter((m) => !assignments.some((a) => a.agent.id === m.id) && /审|核|查/.test(`${m.name}${m.role.duty}`));
      assignments = [...assignments, ...checkers.map((agent) => ({ agent, type: "review" as const, task: "核对事实和数字，检查是否满足用户的要求、有没有改变原意" }))];
    }
    const list = assignments
      .map((a, i) => `${i + 1}. @${a.agent.name}${a.type === "review" ? "（审查）" : a.after ? `（等${names(a.after)}完成后）` : ""} ${a.task}`)
      .join("\n");
    patchMessage(
      plan.messageId,
      { text: [intro || (assignments.length ? "收到，分工如下：" : ""), list].filter(Boolean).join("\n\n"), reasoning: plan.reasoning?.trim() ? plan.reasoning : undefined, status: undefined, usage: plan.usage },
      true,
    );
    // The lead plans without tools, so anything it says it did here is checked like any reply.
    if (assignments.length === 0) await verifyReply(plan.messageId, lead);
    if (assignments.length === 0) {
      run.status = "done";
      delivered = intro;
      return;
    }
    // Reviewers need something to review.
    if (!assignments.some((a) => a.type === "produce")) assignments = assignments.map((a) => ({ ...a, type: "produce" }));
    const producers = assignments.filter((a) => a.type === "produce");
    const reviewers = assignments.filter((a) => a.type === "review");
    // Producers someone else builds on only work in round 1; the ones at the end of a chain revise.
    const finals = producers.filter((p) => !producers.some((q) => q.after?.some((x) => x.id === p.agent.id)));
    const takingTurns = !reviewers.length && (!!parsed?.speak || TAKE_TURNS.test(task));

    recorded = true;
    run.board = [
      ...assignments.map((a) => ({ agentId: a.agent.id, task: a.task, type: a.type, status: "waiting" as const })),
      { agentId: lead.id, task: "汇总交付", type: "summary" as const, status: "waiting" as const },
    ];
    const planStep: RunStep = {
      agentId: lead.id,
      type: "plan",
      summary: reviewers.length ? `${names(producers.map((a) => a.agent))}产出，${names(reviewers.map((a) => a.agent))}审查` : `分派给 ${names(producers.map((a) => a.agent))}`,
      tokens: plan.tokens,
      messageId: plan.messageId,
    };
    run.rounds.push({ index: 1, steps: [planStep] });
    save();

    const maxRounds = reviewers.length ? Math.max(1, group.maxRounds) : 1;
    let open: { reviewer: Agent; issue: Issue }[] = [];
    let passed = false;

    for (let r = 1; r <= maxRounds; r++) {
      const round = r === 1 ? run.rounds[0] : (run.rounds[run.rounds.push({ index: r, steps: [] }) - 1]);

      // 2. Produce or revise
      const feedback = open.map((o) => `- ${o.reviewer.name}：${formatIssue(o.issue)}`).join("\n");
      const writers = r === 1 ? producers : finals;
      // Each producer starts once the one it waits for has finished, so it sees that output in the transcript.
      const finished = new Map<string, Promise<unknown>>();
      const outputs = await Promise.all(
        writers.map((a) => {
          const work = (async () => {
            if (r === 1 && a.after) await Promise.all(a.after.map((x) => finished.get(x.id)));
            if (signal.aborted) return null;
            mark(a.agent.id, "produce", "working", r === 1 ? "" : `第 ${r} 轮修订`);
            const instruction =
              r === 1
                ? `${lead.name}分配给你的任务：${a.task}\n用户的原始需求：「${task}」\n${a.after ? `${names(a.after)}的产出已在群聊记录里，在它的基础上完成你的任务。\n` : ""}产出要逐项满足原始需求里的每个要求，直接给出完整产出。不要加入材料和原文里没有的事实、结论或程度词。`
                : `第 ${r - 1} 轮审查意见（[需修改] 必须修改，[存疑] 请补充依据或说明）：\n${feedback}\n\n请在你上一版的基础上修订，输出完整的新版本；最后加一段「修订说明」，逐条说明每个疑点改了什么或为什么不改。`;
            const out = await speak({ chat: group.id, agent: a.agent, system: groupSystem(a.agent, group), messages: prompt(instruction), signal, noAsk: true });
            round.steps.push({ agentId: a.agent.id, type: r === 1 ? "draft" : "revise", summary: summarize(out.text) || "未完成", tokens: out.tokens, failed: !out.ok, messageId: out.messageId });
            mark(a.agent.id, "produce", out.ok ? "done" : "failed");
            return out;
          })();
          finished.set(a.agent.id, work);
          return work;
        }),
      );
      if (signal.aborted) return void (run.status = "stopped");
      if (outputs.every((o) => !o?.ok)) return void (run.status = "failed");
      if (!reviewers.length) break;

      // 3. Review
      const authors = writers.map((a) => a.agent);
      const reviews = await Promise.all(
        reviewers.map(async (a) => {
          mark(a.agent.id, "review", "working", r === 1 ? "" : `第 ${r} 轮审查`);
          const t = await think({
            chat: group.id,
            agent: a.agent,
            system: `${groupSystem(a.agent, group)}\n\n${REVIEW_RULES}`,
            messages: prompt(`请审查${names(authors)}第 ${r} 轮的产出（群聊记录中最新的版本）。\n用户的原始需求：「${task}」\n你的关注点：${a.task}`),
            signal,
            temperature: Math.min(a.agent.params.temperature, 0.3),
          });
          if (!t.ok) {
            round.steps.push({ agentId: a.agent.id, type: "review", summary: "未完成", tokens: 0, failed: true, messageId: t.messageId });
            mark(a.agent.id, "review", "failed");
            return null;
          }
          const review = parseReview(t.text);
          patchMessage(
            t.messageId,
            // The typing bubble becomes a review message; `status` is cleared so it stops showing as in progress.
            { kind: "review", text: review.summary || "审查完成", issues: review.issues, reasoning: t.reasoning?.trim() ? t.reasoning : undefined, status: undefined, usage: t.usage } as unknown as Partial<Message>,
            true,
          );
          round.steps.push({ agentId: a.agent.id, type: "review", summary: review.summary || "审查完成", issues: review.issues, tokens: t.tokens, messageId: t.messageId });
          mark(a.agent.id, "review", "done");
          return { reviewer: a.agent, issues: review.issues };
        }),
      );
      if (signal.aborted) return void (run.status = "stopped");
      const done = reviews.filter((x): x is { reviewer: Agent; issues: Issue[] } => !!x);
      if (done.length === 0) return void (run.status = "failed");

      // 4. Consensus
      const all = done.flatMap((d) => d.issues);
      const verdict = judge(all, group.consensus);
      open = done.flatMap((d) => d.issues.filter((i) => i.status !== "rejected" && (i.status === "holds" || group.consensus === "strict")).map((issue) => ({ reviewer: d.reviewer, issue })));
      passed = verdict.pass;
      const last = r === maxRounds;
      round.verdict = passed ? "pass" : last ? "stop" : "revise";
      round.note = passed
        ? verdict.unsure
          ? `没有需修改的问题，按宽松规则通过，保留 ${verdict.unsure} 条存疑`
          : `${names(done.map((d) => d.reviewer))}审查通过`
        : last
          ? `已到最多 ${maxRounds} 轮，仍有 ${verdict.holds} 条需修改、${verdict.unsure} 条存疑`
          : `${verdict.holds} 条需修改、${verdict.unsure} 条存疑，退回修订`;
      addMessage({ id: uid(), chat: group.id, kind: "round", runId: run.id, round: r, verdict: round.verdict, note: round.note, at: Date.now() });
      save();
      if (passed) break;
    }

    // 5. Deliver
    const unresolved = open.map((o) => `- ${formatIssue(o.issue)}`).join("\n");
    const instruction = takingTurns
      ? "成员们已经各自发言。请用一两句话自然地收尾，比如回应一下大家、说说接下来可以怎么用这个群。不要复述或总结成员说过的话，不要写“结论”“各成员贡献”“未完成部分”这类小标题或列表。"
      : !reviewers.length
        ? `请汇总以上成员的产出，完成用户的需求：${task}\n先给结论或成品，再简要列出各成员的贡献。没完成的部分如实说明。\n${FACTS_FIRST}`
        : passed
        ? `审查已通过。请把最终成果交付给用户：先给出完整成品（以作者最新一版为准，不要改动已核实的内容，保留其中按用户要求列出的内容），再用几句话说明各成员的结论和修订经过。\n用户的原始需求：「${task}」\n${FACTS_FIRST}`
        : `已到最多轮数，审查仍未全部通过。请交付作者最新一版的完整成品，并如实列出仍未解决的疑点：\n${unresolved}\n用户的原始需求：「${task}」\n${FACTS_FIRST}`;
    mark(lead.id, "summary", "working");
    const final = await speak({ chat: group.id, agent: lead, system: groupSystem(lead, group), messages: prompt(instruction, lead.params.history), signal, noAsk: true });
    mark(lead.id, "summary", final.ok ? "done" : "failed");
    run.rounds[run.rounds.length - 1].steps.push({ agentId: lead.id, type: "summary", summary: summarize(final.text) || "未完成", tokens: final.tokens, failed: !final.ok, messageId: final.messageId });
    delivered = final.text;
    run.status = final.ok ? "done" : signal.aborted ? "stopped" : "failed";
    if (final.ok && !reviewers.length) {
      const round = run.rounds[0];
      round.verdict = "done";
      round.note = takingTurns ? `${outputsDone(round)} 位成员已发言` : `${outputsDone(round)} 位成员完成，${lead.name}已汇总`;
      addMessage({ id: uid(), chat: group.id, kind: "round", runId: run.id, round: 1, verdict: "done", note: round.note, at: Date.now() });
    }
  };

  try {
    await body();
  } finally {
    const lastRound = run.rounds.at(-1);
    if (lastRound && !lastRound.verdict && run.status !== "done") lastRound.verdict = "stop";
    run.endedAt = Date.now();
    save();
    tasks.delete(group.id);
    end(group.id);
  }
  return { status: run.status, text: delivered, note: run.rounds.at(-1)?.note };
}

/** The lead's delivery reports what happened by the app's records, not by what members said. */
const FACTS_FIRST =
  "这是最后一条交付消息：直接给出完整的最终成品或结论，不要说“正在处理”“稍后给出”。" +
  "说到文件、命令和操作时，以成员发言后的（系统记录）为准：记录里没有 make_file 成功或工作区新增的文件，就不要说文件已生成或已保存，而是如实告诉用户没生成，并说明可以让哪位成员用 make_file 生成；没有成功的命令就不要说已执行。不要编造路径、大小、修改时间和命令输出。";

const outputsDone = (round: RunRound) => round.steps.filter((s) => s.type === "draft" && !s.failed).length;

// ---------- single-agent baseline ----------

const BASELINE_SYSTEM = "你是一名能力全面的助手。独立完成用户的任务，直接交付完整的最终成品。用用户的语言回答。";

/**
 * Runs the same task with one agent (the first producer's model, no role, no review loop),
 * then has the run's reviewers check that answer once with the same rules.
 */
export async function runBaseline(runId: string) {
  const key = `baseline:${runId}`;
  const c = begin(key);
  if (!c) return;
  const get = () => useData.getState().runs.find((r) => r.id === runId);
  const update = (patch: Partial<Baseline>) => {
    const run = get();
    if (run) useData.getState().saveRun({ ...run, baseline: { ...(run.baseline as Baseline), ...patch } });
  };

  try {
    const run = get();
    const taskMsg = useData.getState().messages.find((m): m is TextMessage => m.id === run?.messageId && m.kind === "text");
    if (!run || !taskMsg) return;
    const steps = run.rounds.flatMap((r) => r.steps);
    const authorId = steps.find((s) => s.type === "draft")?.agentId ?? steps[0]?.agentId;
    const author = authorId ? agentById(authorId) : undefined;
    const reviewerIds = [...new Set(steps.filter((s) => s.type === "review").map((s) => s.agentId))];
    if (!author) return;

    const { providers, defaultModel } = useData.getState();
    const target = resolveModel(author, providers, defaultModel);
    useData.getState().saveRun({ ...run, baseline: { status: "running", agentId: author.id, model: target?.modelId, tokens: 0, seconds: 0, reviews: [] } });
    if (!target) return update({ status: "failed", error: "还没有连接模型服务" });

    const request = userContent(withFiles(taskMsg) || run.task, latestImages([taskMsg]));
    let answer: string;
    try {
      const r = await completeText({ provider: target.provider, modelId: target.modelId, system: BASELINE_SYSTEM, messages: [{ role: "user", content: request }], params: author.params, signal: c.signal });
      answer = stripThink(r.text);
      update({ text: answer, tokens: r.input + r.output, seconds: r.seconds });
    } catch (e) {
      return update({ status: "failed", error: describeError(e).message });
    }

    const reviews = await Promise.all(
      reviewerIds.map(async (id) => {
        const reviewer = agentById(id);
        const rt = reviewer && resolveModel(reviewer, providers, defaultModel);
        if (!reviewer || !rt) return { agentId: id, summary: "未完成", issues: [], tokens: 0, failed: true };
        try {
          const r = await completeText({
            provider: rt.provider,
            modelId: rt.modelId,
            system: `${systemPrompt(reviewer)}\n\n${REVIEW_RULES}`,
            messages: [{ role: "user", content: userContent(`用户的需求：\n${withFiles(taskMsg) || run.task}\n\n待审查稿件：\n${answer}`, latestImages([taskMsg])) }],
            params: { ...reviewer.params, temperature: Math.min(reviewer.params.temperature, 0.3) },
            signal: c.signal,
          });
          const review = parseReview(r.text);
          return { agentId: id, summary: review.summary, issues: review.issues, tokens: r.input + r.output };
        } catch {
          return { agentId: id, summary: "未完成", issues: [], tokens: 0, failed: true };
        }
      }),
    );
    // `tokens` stays the single agent's own cost; review tokens are kept per review.
    update({ status: "done", reviews });
  } finally {
    const base = get()?.baseline;
    if (base?.status === "running") update({ status: "failed", error: c.signal.aborted ? "已停止" : "未完成" });
    end(key);
  }
}

export const stopBaseline = (runId: string) => stop(`baseline:${runId}`);
