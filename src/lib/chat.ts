import type { ImagePart, ModelMessage, ToolSet, UserContent } from "ai";
import { create } from "zustand";
import { resolveModel, useData, usePrefs } from "../store";
import type { Agent, Attachment, Group, Issue, Message, ModelRef, TextMessage } from "../types";
import { AUTO_COMPACT, contextWindow, estimateTokens, sinceSummary, SUMMARY_PROMPT, TOOL_OVERHEAD } from "./context";
import { attachmentText, hasImages } from "./files";
import { dispatchRules, dispatchTools } from "./collab";
import { call, isDesktop } from "./desktop";
import { describeError, showWait, streamReply } from "./llm";
import { mcpTools } from "./mcp";
import { FILE_RULES, fileTools, filesText } from "./outputs";
import { factsLine, HONEST_RULES, verifyReply } from "./verify";
import { skillRules, skillTools } from "./skills";
import { workRules, workTools } from "./workmode";
import { agentRules, askTool, guard, PLAN_RULES, readOnly, todoTool, usePlanMode } from "./agentTools";
import { requeueSteers, takeSteers } from "./inbox";
import { NEXT_RULES, splitNext, useCompare, withoutAlternatives } from "./compare";
import { MEMORY_RULES, memoryLines, memoryTools } from "./memory";
import { libraryRules, libraryTools } from "./library";
import { DELEGATE_RULES, delegateTool } from "./subagent";
import { afterReply, goalRules } from "./goal";
import { docRules, docTools } from "./docs";
import { jobRules, jobTools } from "./jobs";
import { scheduleRules, scheduleTool } from "./schedule";
import { NATIVE_WEB_RULES, NO_WEB_RULES, tracer, WEB_RULES, webAccess, webPlan, type Report } from "./tools";

/** Chats with work in flight. One run per chat; stopping a chat aborts all of its replies. */
export const useBusy = create<Record<string, boolean>>(() => ({}));
const controllers = new Map<string, AbortController>();

export function begin(chat: string) {
  if (controllers.has(chat)) return null;
  const c = new AbortController();
  controllers.set(chat, c);
  useBusy.setState({ [chat]: true });
  return c;
}

export function end(chat: string) {
  controllers.delete(chat);
  useBusy.setState({ [chat]: false });
}

export const stop = (chat: string) => controllers.get(chat)?.abort();

export const uid = () => crypto.randomUUID();
export const agentById = (id: string) => useData.getState().agents.find((a) => a.id === id);
export const stripThink = (t: string) => t.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

// ---------- prompts ----------

export function systemPrompt(agent: Agent) {
  const lines = [
    `你是「${agent.name}」，${agent.tagline}。`,
    `职责：${agent.role.duty}`,
    agent.role.scope && `能力边界：${agent.role.scope}`,
    agent.role.io && `输入输出：${agent.role.io}`,
  ].filter(Boolean) as string[];
  const me = usePrefs.getState().name.trim();
  if (me) lines.push(`用户的称呼：${me}`);
  const memory = memoryLines(agent);
  if (memory.length) lines.push("", "关于用户你已经知道：", ...memory.map((m) => `- ${m}`));
  const web = webPlan(agent);
  if (web) lines.push("", web === "tools" ? WEB_RULES : NATIVE_WEB_RULES);
  else if (agent.web) lines.push("", NO_WEB_RULES);
  lines.push("", `现在是${now()}。`, "用用户的语言回答，回答直接、具体。");
  return lines.join("\n");
}

/** Models don't know today's date; without this they guess from their training data. */
const now = () =>
  new Date().toLocaleString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false });

export function groupSystem(agent: Agent, group: Group) {
  const others = group.memberIds.map(agentById).filter((a): a is Agent => !!a && a.id !== agent.id);
  return [
    systemPrompt(agent),
    ...(agent.role.protocol ? [`协作方式：${agent.role.protocol}`] : []),
    "",
    `你在群聊「${group.name}」中。其他成员：${others.map((a) => `${a.name}（${a.tagline}）`).join("、") || "无"}。`,
    "聊天记录里【名字】表示发言人，【用户】是向大家提需求的人。",
    `只以「${agent.name}」的身份发言，不替别人发言，开头不要写自己的名字。`,
    "成员发言后面的（系统记录：…）是程序记下的真实情况：调用了哪些工具、结果如何、工作区里实际多了哪些文件。转述或核对别人做的事以它为准；发言里说做了、记录里没有的，就是没做。",
    ...(group.workspace && isDesktop ? [`本群开启了工作模式，工作区是 ${group.workspace}：成员能读写其中的文件、运行命令，生成的文件会存进去。`] : []),
  ].join("\n");
}

/** The lead's plan prompt. `ask`: it may ask the user first when key details are missing. */
export function planSystem(lead: Agent, group: Group, members: Agent[], ask = false) {
  return [
    groupSystem(lead, group),
    "",
    "你是这个群的主持人。用户的需求交给你处理，可分派的成员：",
    ...members.map((m) => `- ${m.name}：${m.role.duty}`),
    "",
    `判断怎么处理用户的最新消息，${ask ? "四选一" : "三选一"}：`,
    ...(ask
      ? [
          "0. 要花工夫的新任务（写报告、调研、做 PPT 或表格、写代码），但关键细节用户没说（范围、篇幅、格式、用途和读者、时间范围、语言风格等），猜错就得返工：先不分工，mode 写 ask，在 questions 里一次问完（最多 4 个，每个给 2–4 个选项，用户也能自己写；可以多选的加 \"multi\": true），reply 用一句话说明先问清再开工。要求已经清楚、或用户说了“直接做”时不要问。",
        ]
      : []),
    "1. 需要实际工作（写作、调研、分析、核查等）：拆成具体任务派给合适的成员，可以只派给部分成员，每人一条。",
    "   每条任务标明类型：produce 表示产出（写稿、调研、分析、写代码），review 表示审查别人的产出（核对事实和数字、检查逻辑措辞）。",
    "   需要准确性的成果，至少安排一名 produce 和一名 review；审查成员不产出，会在产出完成后检查并提出疑点，作者据此修订。",
    "   produce 默认同时开始。如果某人要用到别人的产出（比如先搜集资料、再据此写稿），把前者排在前面，在后者的任务里写 after: 前者的名字（要等几个人就写几个名字，用顿号隔开），后者会等他们都完成再开始。没有先后关系的不写 after。要读取、核对或修改别人产出的文件，就必须写 after，否则会在文件还没生成时就开始。",
    "   mode 写 work。",
    "2. 要成员各自发言（自我介绍、各自说看法、轮流回答同一个问题）：给每位被点到的成员（说“大家”“每个人”就是全部成员）各派一条 produce 任务，task 写清要说什么、说多长；不安排 review。mode 写 speak。",
    "3. 打招呼、简单问答、问你自己的事：不分工，自己在 reply 里完整回答。mode 写 answer。",
    "你在这一步不能调用任何工具。凡是要生成或发文件、运行命令、查看或核对工作区里的文件、联网查证的，都按第 1 种派给成员（产出类），不要自己说已经做了或马上去做。",
    "成员可以用 make_file 把 Word、Excel、PPT 文件直接附在群聊消息里给用户下载，不要说群聊发不了文件。",
    "",
    "只输出一个 JSON 对象，不要输出其他内容。格式：",
    ask
      ? '{"reply": "你作为主持人自己说的话", "mode": "ask 或 work 或 speak 或 answer", "questions": [{"question": "问题", "options": ["选项一", "选项二"]}], "assignments": [{"member": "成员名", "type": "produce 或 review", "task": "具体任务", "after": "要等的成员名，没有就省略"}]}'
      : '{"reply": "你作为主持人自己说的话", "mode": "work 或 speak 或 answer", "assignments": [{"member": "成员名", "type": "produce 或 review", "task": "具体任务", "after": "要等的成员名，没有就省略"}]}',
    "- reply 是你自己的发言，不要照抄或复述用户的消息。分工时是一两句回应（比如说明怎么安排）；不分工时是给用户的完整回答。",
    "- 不分工时 assignments 为空数组。",
    ...(ask ? ["- 不提问时省略 questions；提问时 assignments 为空数组。"] : []),
    ...(group.guide ? ["", `本群的工作流程（需要实际工作时照这个分工）：\n${group.guide}`] : []),
    "",
    `示例（用户：大家好，自我介绍一下）：`,
    JSON.stringify({
      reply: `大家好，我是${lead.name}，负责拆任务、派活和最后汇总。下面请各位成员介绍自己。`,
      mode: "speak",
      assignments: members.slice(0, 1).map((m) => ({ member: m.name, type: "produce", task: "用两三句话介绍你自己：你是谁、擅长什么、怎么配合大家" })),
    }),
    "（示例只列了一位，实际要列出所有被点到的成员。）",
  ].join("\n");
}

// ---------- context ----------

/** A message's own text plus its text attachments; images are named here and sent separately. */
export function withFiles(m: TextMessage) {
  const files = m.attachments ?? [];
  const images = files.filter((f) => f.kind === "image").map((f) => `[图片：${f.name}]`);
  return [m.text, attachmentText(files), images.join(" ")].filter(Boolean).join("\n\n");
}

/** Image parts from the newest user message that has any; older images stay as placeholders to save tokens. */
export function latestImages(messages: Message[]): ImagePart[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.kind === "text" && m.sender === "me" && hasImages(m.attachments)) {
      return m.attachments!.filter((f) => f.kind === "image" && f.image).map((f) => ({ type: "image", image: f.image!, mediaType: f.mime }));
    }
  }
  return [];
}

export const userContent = (text: string, images: ImagePart[]): ModelMessage["content"] & UserContent =>
  images.length ? [{ type: "text", text }, ...images] : text;

/** The last `limit` finished turns of a private chat since its latest summary, oldest first. */
export function privateHistory(messages: Message[], chat: string, limit: number): ModelMessage[] {
  const recent = sinceSummary(withoutAlternatives(messages.filter((m) => m.chat === chat)))
    .rest.filter((m): m is TextMessage => m.kind === "text" && !m.summary && m.status !== "error" && m.status !== "streaming" && (!!m.text || !!m.attachments?.length))
    .slice(-limit);
  const lastUser = recent.findLastIndex((m) => m.sender === "me");
  // What the user added while a reply was running belongs with the request it answered.
  const added = (m?: TextMessage) => (m?.steers?.length ? `\n\n（回复过程中用户又补充：${m.steers.join("；")}）` : "");
  const turns = recent.map<ModelMessage>((m, i) =>
    m.sender === "me"
      ? { role: "user", content: userContent(withFiles(m) + added(recent.slice(i + 1).find((x) => x.sender !== "me")), i === lastUser ? latestImages([m]) : []) }
      : { role: "assistant", content: [m.text, filesText(m.files), factsLine(m)].filter(Boolean).join("\n\n") },
  );
  while (turns[0]?.role === "assistant") turns.shift();
  return turns;
}

const issueTag: Record<Issue["status"], string> = { holds: "需修改", unsure: "存疑", rejected: "没问题" };

export const formatIssue = (i: Issue) => `[${issueTag[i.status]}] ${i.text}${i.evidence ? `（依据：${i.evidence}）` : ""}`;

/**
 * Group chat as plain text with speaker tags, so any model sees who said what.
 * Everything from `sinceId` on is kept (the current run, including the task and its files);
 * before it only the last `limit` messages.
 */
export function transcript(chat: string, limit: number, sinceId?: string) {
  const { summary, rest: all } = sinceSummary(useData.getState().messages.filter((m) => m.chat === chat));
  const found = sinceId ? all.findIndex((m) => m.id === sinceId) : -1;
  const start = found >= 0 ? found : all.length;
  const line = (m: Message) => {
    if (m.kind === "round") return `【系统】第 ${m.round} 轮：${m.note}`;
    if (m.kind === "text" && (m.status === "streaming" || m.status === "error" || m.summary)) return null;
    if (!m.text && !(m.kind === "text" && (m.attachments?.length || m.files?.length))) return null;
    const who = m.sender === "me" ? "用户" : (agentById(m.sender)?.name ?? m.sender);
    const body = m.kind === "text" ? [withFiles(m), filesText(m.files), m.sender !== "me" && factsLine(m)].filter(Boolean).join("\n\n") : [m.text, ...m.issues.map((i) => `- ${formatIssue(i)}`)].join("\n");
    return `【${who}】${body}`;
  };
  const lines = [...all.slice(0, start).map(line).filter(Boolean).slice(-limit), ...all.slice(start).map(line).filter(Boolean)];
  if (summary?.text) lines.unshift(`【系统】更早的对话已压缩，摘要：\n${summary.text}`);
  return `群聊记录（${lines.length} 条）：\n\n${lines.join("\n\n")}`;
}

/** One user turn for a group member: the transcript, an instruction, and the latest images. */
export function groupPrompt(chat: string, limit: number, instruction: string, sinceId?: string): ModelMessage[] {
  const images = latestImages(useData.getState().messages.filter((m) => m.chat === chat).slice(-limit));
  return [{ role: "user", content: userContent(`${transcript(chat, limit, sinceId)}\n\n${instruction}`, images) }];
}

export const sendsImages = (messages: ModelMessage[]) =>
  messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image"));

// ---------- one agent speaking ----------

/** Tools that can leave files in the workspace (commands and scripts included). */
const WRITES = new Set(["write_file", "edit_file", "run_command", "make_file", "start_job", "mcp"]);

interface Spoken {
  ok: boolean;
  text: string;
  tokens: number;
  messageId: string;
}

/**
 * Streams one agent's reply into a chat as a new message.
 * Every reply can make files; agents with web access get the search tools; `extraTools` adds more (the lead's dispatch tool).
 */
export async function speak(opts: {
  chat: string;
  agent: Agent;
  system: string;
  messages: ModelMessage[];
  signal: AbortSignal;
  extraTools?: (report: Report) => ToolSet;
  /** Plan mode: only tools that look, and a plan at the end instead of changes. */
  plan?: boolean;
  /** Private chats: messages the user inserts while this reply runs reach the model before its next step. */
  steer?: boolean;
  /** Private chats: the reply may end with suggested next steps. */
  suggest?: boolean;
  /** One of several models answering the same question side by side: the set's id and this model. */
  compare?: { id: string; model: ModelRef };
  /** A member working inside a group run: the lead already asked the user, so no ask_user. */
  noAsk?: boolean;
}): Promise<Spoken> {
  const { providers, defaultModel, addMessage, patchMessage } = useData.getState();
  const id = uid();
  const agent = opts.compare ? { ...opts.agent, model: opts.compare.model } : opts.agent;
  addMessage({
    id,
    chat: opts.chat,
    kind: "text",
    sender: opts.agent.id,
    text: "",
    status: "streaming",
    at: Date.now(),
    plan: opts.plan || undefined,
    compare: opts.compare?.id,
    model: opts.compare?.model.id,
  });

  const target = resolveModel(agent, providers, defaultModel);
  if (!target) {
    patchMessage(id, { status: "error", error: { message: "还没有连接模型服务" } }, true);
    return { ok: false, text: "", tokens: 0, messageId: id };
  }

  const { report, halt, settle, missed } = tracer(id);
  const web = webAccess(agent, report);
  // Desktop: agents with web access can also read pages in the built-in browser (loaded only there).
  const browser = isDesktop && agent.web ? await import("./browserTools") : null;
  const all: ToolSet = {
    ...web.tools,
    ...browser?.browserTools(agent, report),
    ...todoTool(id),
    ...(opts.noAsk ? {} : askTool(report)),
    ...memoryTools(report, agent, id),
    ...libraryTools(report),
    ...docTools(opts.chat, report),
    ...jobTools(agent, report),
    ...scheduleTool(opts.chat, report),
    ...fileTools(id, report, agent),
    ...skillTools(report, agent),
    ...workTools(agent, report),
    ...(await mcpTools(report)),
    ...opts.extraTools?.(report),
  };
  const tools = guard(opts.plan ? readOnly(all) : all, { agent: agent, settle });
  const work = await workRules(agent);

  // Work mode: after the reply, list what it left in the workspace, so the files are a click away.
  const started = Date.now();
  const collect = async () => {
    if (!isDesktop || !agent.workspace) return;
    // Group members work at the same time: a reply that wrote nothing must not claim a teammate's files.
    const msg = useData.getState().messages.find((m) => m.id === id);
    const wrote = msg?.kind === "text" && msg.tools?.some((t) => t.status === "done" && WRITES.has(t.name));
    if (!wrote) return;
    try {
      const found = await call<{ path: string; size: number }[]>("ws_recent", { root: agent.workspace, sinceMs: started - 1000 });
      const files = found.filter((f) => !f.path.startsWith(".yanban/")).map(({ path, size }) => ({ path, size }));
      if (files.length) patchMessage(id, { outputs: { root: agent.workspace, files } }, true);
    } catch {
      /* the folder may be gone; the reply stands without the list */
    }
  };

  let text = "";
  let reasoning = "";
  let queued = false;
  let done = false;
  const flush = () => {
    queued = false;
    if (!done) patchMessage(id, { text: splitNext(text).text, reasoning: reasoning.trim() ? reasoning : undefined });
  };
  // Batch deltas; a timer keeps working when the window is in the background, unlike requestAnimationFrame.
  const schedule = () => {
    if (!queued) {
      queued = true;
      setTimeout(flush, 40);
    }
  };

  try {
    const r = await streamReply({
      provider: target.provider,
      modelId: target.modelId,
      system: [opts.system, FILE_RULES, skillRules(), work, jobRules(agent), browser?.BROWSER_RULES, agentRules(!opts.noAsk), HONEST_RULES, MEMORY_RULES, libraryRules(), scheduleRules(opts.chat), docRules(opts.chat), opts.plan && PLAN_RULES, opts.suggest && usePrefs.getState().suggest && NEXT_RULES]
        .filter(Boolean)
        .join("\n\n"),
      messages: opts.messages,
      params: agent.params,
      signal: opts.signal,
      tools,
      search: web.search,
      onSources: web.onSources,
      onToolError: missed,
      onWait: showWait(id),
      steer: opts.steer
        ? () => {
            const taken = takeSteers(opts.chat);
            if (!taken.length) return [];
            const msg = useData.getState().messages.find((m) => m.id === id);
            const before = msg?.kind === "text" ? (msg.steers ?? []) : [];
            patchMessage(id, { steers: [...before, ...taken.map((t) => t.shown)] }, true);
            return taken.map((t) => `（用户在你回复过程中补充，接下来照这个调整）：${t.prompt}`);
          }
        : undefined,
      onText: (d) => {
        text += d;
        schedule();
      },
      onReasoning: (d) => {
        reasoning += d;
        schedule();
      },
    });
    done = true;
    const final = splitNext(text);
    patchMessage(
      id,
      {
        text: final.text,
        next: opts.suggest ? final.next : undefined,
        reasoning: reasoning.trim() ? reasoning : undefined,
        status: undefined,
        usage: { model: target.modelId, input: r.input, output: r.output, seconds: r.seconds },
      },
      true,
    );
    await collect();
    await verifyReply(id, agent);
    return { ok: true, text: final.text, tokens: r.input + r.output, messageId: id };
  } catch (e) {
    done = true;
    halt();
    text = splitNext(text).text;
    if (opts.signal.aborted) patchMessage(id, { text, reasoning: reasoning.trim() ? reasoning : undefined, status: "stopped" }, true);
    else {
      const error = describeError(e);
      // Text-only models usually reject image parts with a 400; say so plainly.
      if (sendsImages(opts.messages) && /请求被拒绝|找不到/.test(error.message)) error.message = "这个模型可能不支持图片，换一个能识图的模型试试";
      patchMessage(id, { text, reasoning: reasoning.trim() ? reasoning : undefined, status: "error", error }, true);
    }
    await collect();
    return { ok: false, text, tokens: 0, messageId: id };
  }
}

// ---------- private chat ----------

export async function sendToAgent(agentId: string, text: string, attachments?: Attachment[]) {
  await autoCompact(agentId);
  useData.getState().addMessage({ id: uid(), chat: agentId, kind: "text", sender: "me", text, attachments, at: Date.now() });
  await reply(agentId);
  // A session goal carries on by itself; a message the user queued meanwhile goes first.
  void afterReply(agentId, (next) => {
    if (!useBusy.getState()[agentId]) void sendToAgent(agentId, next);
  });
}

export async function reply(agentId: string) {
  const agent = agentById(agentId);
  const c = agent && begin(agentId);
  if (!agent || !c) return;
  try {
    const { messages, groups } = useData.getState();
    const context = privateHistory(messages, agentId, agent.params.history);
    const { summary } = sinceSummary(messages.filter((m) => m.chat === agentId));
    const base = summary?.text ? `${systemPrompt(agent)}\n\n更早的对话已压缩，摘要如下（原文已不在上下文里）：\n${summary.text}` : systemPrompt(agent);
    // A lead can hand work to the groups it runs, taking along the files from the user's latest message.
    const led = groups.filter((g) => g.leadId === agent.id);
    const asked = messages.findLast((m): m is TextMessage => m.chat === agentId && m.kind === "text" && m.sender === "me");
    const turn = {
      chat: agentId,
      agent,
      system: [base, led.length && dispatchRules(led), DELEGATE_RULES, goalRules(agentId)].filter(Boolean).join("\n\n"),
      messages: context,
      signal: c.signal,
      // Sub-agents only start from private chats, so they never hand work on again.
      extraTools: (report: Report) => ({ ...delegateTool(agent, report), ...(led.length ? dispatchTools(agent, led, report, asked?.attachments) : {}) }),
      plan: !!usePlanMode.getState()[agentId],
      suggest: true,
    };
    // Compare mode: every picked model answers the same context at once; the user picks one to carry on.
    const models = useCompare.getState()[agentId] ?? [];
    if (models.length >= 2) {
      const set = uid();
      await Promise.all(models.map((model) => speak({ ...turn, suggest: false, compare: { id: set, model } })));
    } else await speak({ ...turn, steer: true });
  } finally {
    requeueSteers(agentId);
    end(agentId);
  }
}

// ---------- context size and compression ----------

/** Who answers in a chat: the agent, or the group's lead. */
function speaker(chat: string) {
  const group = useData.getState().groups.find((g) => g.id === chat);
  const agent = agentById(group ? group.leadId : chat);
  return agent ? { agent, group } : null;
}

const plainText = (m: ModelMessage) =>
  typeof m.content === "string" ? m.content : m.content.map((p) => (p.type === "text" ? p.text : p.type === "image" ? "x".repeat(3000) : "")).join("");

/** Roughly how full the next request would be: system prompt, recent messages, tool definitions. */
/** One line of the context panel: a part of every request and its rough size. */
export interface ContextPart {
  key: "history" | "summary" | "role" | "rules" | "tools" | "skills" | "memory";
  label: string;
  tokens: number;
}

export function contextUse(chat: string) {
  const who = speaker(chat);
  const { messages, providers, defaultModel } = useData.getState();
  const target = who && resolveModel(who.agent, providers, defaultModel);
  if (!who || !target) return null;
  const { agent, group } = who;
  const { summary, rest } = sinceSummary(messages.filter((m) => m.chat === chat));
  const history = group ? transcript(chat, agent.params.history) : privateHistory(messages, chat, agent.params.history).map(plainText).join("\n");
  const system = group ? groupSystem(agent, group) : systemPrompt(agent);
  // What each part of a request adds, the way the context panel lists it.
  const memory = estimateTokens(memoryLines(agent).join("\n"));
  const plan = webPlan(agent);
  const web = estimateTokens(plan ? (plan === "tools" ? WEB_RULES : NATIVE_WEB_RULES) : agent.web ? NO_WEB_RULES : "");
  const rules = [FILE_RULES, jobRules(agent), agentRules(), HONEST_RULES, MEMORY_RULES, libraryRules(), scheduleRules(chat), docRules(chat)].filter(Boolean).join("\n");
  const parts: ContextPart[] = [
    { key: "history", label: group ? "群聊记录" : "对话记录", tokens: estimateTokens(history) },
    { key: "summary", label: "之前的摘要", tokens: !group && summary?.text ? estimateTokens(summary.text) : 0 },
    { key: "role", label: "角色设定", tokens: Math.max(0, estimateTokens(system) - memory - web) },
    { key: "rules", label: "使用规则", tokens: estimateTokens(rules) + web },
    { key: "tools", label: "工具说明（估算）", tokens: TOOL_OVERHEAD },
    { key: "skills", label: "技能", tokens: estimateTokens(skillRules()) },
    { key: "memory", label: "记忆", tokens: memory },
  ];
  // Every member of a group reads the same transcript, so the member whose model reads the least sets the limit.
  let tightest = { name: agent.name, modelId: target.modelId, window: contextWindow(target.modelId) };
  for (const id of group?.memberIds ?? []) {
    const member = agentById(id);
    const t = member && resolveModel(member, providers, defaultModel);
    if (t && contextWindow(t.modelId) < tightest.window) tightest = { name: member.name, modelId: t.modelId, window: contextWindow(t.modelId) };
  }
  return {
    used: parts.reduce((n, p) => n + p.tokens, 0),
    parts,
    window: tightest.window,
    model: tightest.modelId,
    /** In a group: the member whose model has the smallest window. */
    member: group ? tightest.name : undefined,
    /** Messages since the last summary; compressing fewer than a few is pointless. */
    pending: rest.filter((m) => m.kind !== "round").length,
  };
}

/** Writes a summary of the chat so far; later replies see the summary instead of the messages before it. */
export async function compact(chat: string) {
  const who = speaker(chat);
  const { messages, providers, defaultModel, addMessage, patchMessage } = useData.getState();
  const target = who && resolveModel(who.agent, providers, defaultModel);
  if (!who || !target) return false;
  const c = begin(chat);
  if (!c) return false;
  const { agent, group } = who;
  const own = messages.filter((m) => m.chat === chat);
  const { summary, rest } = sinceSummary(withoutAlternatives(own));
  let text = group
    ? transcript(chat, 100_000)
    : [
        summary?.text && `【之前的摘要】${summary.text}`,
        ...rest
          .filter((m): m is TextMessage => m.kind === "text" && !m.summary && m.status !== "streaming" && m.status !== "error")
          .map((m) => `【${m.sender === "me" ? "用户" : agent.name}】${[withFiles(m), filesText(m.files)].filter(Boolean).join("\n\n")}`),
      ]
        .filter(Boolean)
        .join("\n\n");
  // Keep the newest part if the conversation is larger than the model can read at once.
  const room = contextWindow(target.modelId) * 0.7;
  while (estimateTokens(text) > room) text = text.slice(Math.floor(text.length * 0.2));

  const id = uid();
  addMessage({ id, chat, kind: "text", sender: agent.id, text: "", summary: true, status: "streaming", at: Date.now() });
  let out = "";
  try {
    const r = await streamReply({
      provider: target.provider,
      modelId: target.modelId,
      system: "你负责把一段对话压缩成摘要，供之后的对话接着用。",
      onWait: showWait(id),
      messages: [{ role: "user", content: `${text}\n\n${SUMMARY_PROMPT}` }],
      params: { ...agent.params, temperature: 0.2 },
      signal: c.signal,
      onText: (d) => {
        out += d;
        patchMessage(id, { text: out });
      },
      onReasoning: () => {},
    });
    patchMessage(id, { text: stripThink(out), status: undefined, usage: { model: target.modelId, input: r.input, output: r.output, seconds: r.seconds } }, true);
    return true;
  } catch (e) {
    patchMessage(id, { text: out, status: c.signal.aborted ? "stopped" : "error", error: describeError(e) }, true);
    return false;
  } finally {
    end(chat);
  }
}

/** Starts a new topic: later replies see nothing above this point. Nothing is deleted. */
export function newTopic(chat: string) {
  const who = speaker(chat);
  if (!who || useBusy.getState()[chat]) return;
  useData.getState().addMessage({ id: uid(), chat, kind: "text", sender: who.agent.id, text: "", summary: true, reset: true, at: Date.now() });
}

/** Compresses before the next message when the context is nearly full, like the CLI agents do. */
export async function autoCompact(chat: string) {
  const use = contextUse(chat);
  if (use && use.pending >= 4 && use.used > use.window * AUTO_COMPACT) await compact(chat);
}

/** Drops a failed private reply and asks again with the same context. */
export function retry(messageId: string) {
  const { messages, removeMessage } = useData.getState();
  const m = messages.find((x) => x.id === messageId);
  if (!m || m.kind !== "text" || m.chat !== m.sender) return;
  removeMessage(messageId);
  void reply(m.sender);
}

