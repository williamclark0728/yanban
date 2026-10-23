import type { ImagePart, ModelMessage, UserContent } from "ai";
import { create } from "zustand";
import { resolveModel, useData } from "../store";
import type { Agent, Attachment, Group, Issue, Message, TextMessage } from "../types";
import { attachmentText, hasImages } from "./files";
import { describeError, streamReply } from "./llm";

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
  if (agent.memory.length) lines.push("", "关于用户你已经知道：", ...agent.memory.map((m) => `- ${m}`));
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
  ].join("\n");
}

export function planSystem(lead: Agent, group: Group, members: Agent[]) {
  return [
    groupSystem(lead, group),
    "",
    "你是这个群的主持人。用户的需求交给你处理，可分派的成员：",
    ...members.map((m) => `- ${m.name}：${m.role.duty}`),
    "",
    "判断是否需要分工：",
    "- 需要（写作、分析、核查等实际工作）：拆成具体任务派给合适的成员，可以只派给部分成员，每人一条。",
    "  每条任务标明类型：produce 表示产出（写稿、分析、写代码），review 表示审查别人的产出（核对事实和数字、检查逻辑措辞）。",
    "  需要准确性的成果，至少安排一名 produce 和一名 review；审查成员不产出，会在产出完成后检查并提出疑点，作者据此修订。",
    "- 不需要（打招呼、简单问答）：自己直接回答。",
    "",
    "只输出一个 JSON 对象，不要输出其他内容：",
    '{"reply": "对用户说的话：分工时是一句简短回应，不分工时是完整回答", "assignments": [{"member": "成员名", "type": "produce 或 review", "task": "具体任务，写清要交付什么或审查什么"}]}',
    "不分工时 assignments 为空数组。",
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

/** The last `limit` finished turns of a private chat, oldest first. */
export function privateHistory(messages: Message[], chat: string, limit: number): ModelMessage[] {
  const recent = messages
    .filter((m): m is TextMessage => m.chat === chat && m.kind === "text" && m.status !== "error" && m.status !== "streaming" && (!!m.text || !!m.attachments?.length))
    .slice(-limit);
  const lastUser = recent.findLastIndex((m) => m.sender === "me");
  const turns = recent.map<ModelMessage>((m, i) =>
    m.sender === "me"
      ? { role: "user", content: userContent(withFiles(m), i === lastUser ? latestImages([m]) : []) }
      : { role: "assistant", content: m.text },
  );
  while (turns[0]?.role === "assistant") turns.shift();
  return turns;
}

const issueTag: Record<Issue["status"], string> = { holds: "成立", unsure: "存疑", rejected: "不成立" };

export const formatIssue = (i: Issue) => `[${issueTag[i.status]}] ${i.text}${i.evidence ? `（依据：${i.evidence}）` : ""}`;

/**
 * Group chat as plain text with speaker tags, so any model sees who said what.
 * Everything from `sinceId` on is kept (the current run, including the task and its files);
 * before it only the last `limit` messages.
 */
export function transcript(chat: string, limit: number, sinceId?: string) {
  const all = useData.getState().messages.filter((m) => m.chat === chat);
  const found = sinceId ? all.findIndex((m) => m.id === sinceId) : -1;
  const start = found >= 0 ? found : all.length;
  const line = (m: Message) => {
    if (m.kind === "round") return `【系统】第 ${m.round} 轮：${m.note}`;
    if (m.kind === "text" && (m.status === "streaming" || m.status === "error")) return null;
    if (!m.text && !(m.kind === "text" && m.attachments?.length)) return null;
    const who = m.sender === "me" ? "用户" : (agentById(m.sender)?.name ?? m.sender);
    const body = m.kind === "text" ? withFiles(m) : [m.text, ...m.issues.map((i) => `- ${formatIssue(i)}`)].join("\n");
    return `【${who}】${body}`;
  };
  const lines = [...all.slice(0, start).map(line).filter(Boolean).slice(-limit), ...all.slice(start).map(line).filter(Boolean)];
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

interface Spoken {
  ok: boolean;
  text: string;
  tokens: number;
  messageId: string;
}

/** Streams one agent's reply into a chat as a new message. */
export async function speak(opts: { chat: string; agent: Agent; system: string; messages: ModelMessage[]; signal: AbortSignal }): Promise<Spoken> {
  const { providers, defaultModel, addMessage, patchMessage } = useData.getState();
  const id = uid();
  addMessage({ id, chat: opts.chat, kind: "text", sender: opts.agent.id, text: "", status: "streaming", at: Date.now() });

  const target = resolveModel(opts.agent, providers, defaultModel);
  if (!target) {
    patchMessage(id, { status: "error", error: { message: "还没有连接模型服务" } }, true);
    return { ok: false, text: "", tokens: 0, messageId: id };
  }

  let text = "";
  let reasoning = "";
  let queued = false;
  let done = false;
  const flush = () => {
    queued = false;
    if (!done) patchMessage(id, { text, reasoning: reasoning || undefined });
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
      system: opts.system,
      messages: opts.messages,
      params: opts.agent.params,
      signal: opts.signal,
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
    patchMessage(
      id,
      { text, reasoning: reasoning || undefined, status: undefined, usage: { model: target.modelId, input: r.input, output: r.output, seconds: r.seconds } },
      true,
    );
    return { ok: true, text, tokens: r.input + r.output, messageId: id };
  } catch (e) {
    done = true;
    if (opts.signal.aborted) patchMessage(id, { text, reasoning: reasoning || undefined, status: "stopped" }, true);
    else {
      const error = describeError(e);
      // Text-only models usually reject image parts with a 400; say so plainly.
      if (sendsImages(opts.messages) && /请求被拒绝|找不到/.test(error.message)) error.message = "这个模型可能不支持图片，换一个能识图的模型试试";
      patchMessage(id, { text, reasoning: reasoning || undefined, status: "error", error }, true);
    }
    return { ok: false, text, tokens: 0, messageId: id };
  }
}

// ---------- private chat ----------

export async function sendToAgent(agentId: string, text: string, attachments?: Attachment[]) {
  useData.getState().addMessage({ id: uid(), chat: agentId, kind: "text", sender: "me", text, attachments, at: Date.now() });
  await reply(agentId);
}

export async function reply(agentId: string) {
  const agent = agentById(agentId);
  const c = agent && begin(agentId);
  if (!agent || !c) return;
  try {
    const context = privateHistory(useData.getState().messages, agentId, agent.params.history);
    await speak({ chat: agentId, agent, system: systemPrompt(agent), messages: context, signal: c.signal });
  } finally {
    end(agentId);
  }
}

/** Drops a failed private reply and asks again with the same context. */
export function retry(messageId: string) {
  const { messages, removeMessage } = useData.getState();
  const m = messages.find((x) => x.id === messageId);
  if (!m || m.kind !== "text" || m.chat !== m.sender) return;
  removeMessage(messageId);
  void reply(m.sender);
}

