// Long-term memory about the user, shared by every agent and every chat, and searching old chats.
import { jsonSchema, tool, type ToolSet } from "ai";
import { useData, usePrefs } from "../store";
import type { Agent, Memory, Message } from "../types";
import type { Report } from "./tools";

export const MEMORY_RULES = [
  "用户说出关于自己的长期信息（年级、专业、研究方向、课题、常用工具、写作习惯和偏好）时，用 remember 记成一句话，以后所有对话都能看到。一次性的事、已经记过的不要记；证件号、密码、Key 这类隐私不要记。",
  "用户提到以前聊过的内容（“上次说的”“之前那篇”），而上下文里没有时，用 search_chats 搜旧对话再回答。",
].join("\n");

const MAX = 200;

/** What every agent is told about the user: the shared memory first, then the agent's own notes. */
export function memoryLines(agent: Agent) {
  const shared = useData.getState().memories.map((m) => m.text);
  return [...new Set([...shared, ...agent.memory])];
}

/** Adds a memory unless the same text is already there. Returns false for a duplicate. */
export function addMemory(text: string, by?: string) {
  const { memories, setMemories } = useData.getState();
  const clean = text.trim().slice(0, 300);
  if (!clean || memories.some((m) => m.text === clean)) return false;
  setMemories([...memories, { id: crypto.randomUUID(), text: clean, at: Date.now(), by }].slice(-MAX));
  return true;
}

export const forget = (text: string) => {
  const { memories, setMemories } = useData.getState();
  setMemories(memories.filter((m) => m.text !== text));
};

export const remembered = (memories: Memory[], text: string) => memories.some((m) => m.text === text);

// ---------- searching old chats ----------

export interface Hit {
  id: string;
  chat: string;
  /** The chat's name: the agent or the group. */
  where: string;
  who: string;
  at: number;
  snippet: string;
}

const plain = (s: string) => s.replace(/[*_>#`]/g, "").replace(/\s+/g, " ").trim();

function bodyOf(m: Message) {
  if (m.kind === "round") return "";
  if (m.kind === "text" && (m.summary || m.status === "streaming")) return "";
  return plain(m.text);
}

/** Messages containing every word of the query, newest first, with a short excerpt around the first match. */
export function searchMessages(query: string, limit = 20, skip?: (m: Message) => boolean): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const { messages, agents, groups } = useData.getState();
  const nameOf = (chat: string) => groups.find((g) => g.id === chat)?.name ?? agents.find((a) => a.id === chat)?.name;
  const hits: Hit[] = [];
  for (let i = messages.length - 1; i >= 0 && hits.length < limit; i--) {
    const m = messages[i];
    if (skip?.(m)) continue;
    const text = bodyOf(m);
    const low = text.toLowerCase();
    if (!text || !words.every((w) => low.includes(w))) continue;
    const where = nameOf(m.chat);
    if (!where) continue;
    const at = low.indexOf(words[0]);
    const start = Math.max(0, at - 40);
    const snippet = `${start > 0 ? "…" : ""}${text.slice(start, at + 80)}${at + 80 < text.length ? "…" : ""}`;
    const sender = m.kind === "text" || m.kind === "review" ? m.sender : "";
    hits.push({ id: m.id, chat: m.chat, where, who: sender === "me" ? "我" : (agents.find((a) => a.id === sender)?.name ?? ""), at: m.at, snippet });
  }
  return hits;
}

/** The whole message a hit points to, cut to a length a model can take. */
function fullText(id: string) {
  const m = useData.getState().messages.find((x) => x.id === id);
  const text = m ? bodyOf(m) : "";
  return text.length > 1500 ? `${text.slice(0, 1500)}…` : text;
}

const day = (at: number) => new Date(at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });

// ---------- tools ----------

export function memoryTools(report: Report, agent: Agent, replyId: string): ToolSet {
  const tools: ToolSet = {
    search_chats: tool({
      description: "按关键词搜索以前的对话（所有私聊和群聊），返回匹配的消息和日期。关键词用空格隔开，都要出现。",
      inputSchema: jsonSchema<{ query: string }>({
        type: "object",
        properties: { query: { type: "string", description: "关键词，比如 “稀疏 显存”" } },
        required: ["query"],
      }),
      execute: async ({ query }, { toolCallId }) => {
        // The question being answered right now (and this reply) would match first; leave the current turn out.
        const { messages } = useData.getState();
        const chat = messages.find((m) => m.id === replyId)?.chat;
        const asked = messages.findLast((m) => m.chat === chat && m.kind === "text" && m.sender === "me")?.at ?? Infinity;
        const hits = searchMessages(query, 8, (m) => m.id === replyId || (m.chat === chat && m.at >= asked));
        report({ id: toolCallId, name: "search_chats", label: query, status: "done", detail: `${hits.length} 条` });
        if (!hits.length) return `没有找到包含「${query}」的旧消息。换个关键词，或者如实告诉用户没找到。`;
        return hits.map((h) => `[${day(h.at)} · ${h.where} · ${h.who}] ${fullText(h.id)}`).join("\n\n");
      },
    }),
  };
  if (!usePrefs.getState().autoMemory) return tools;
  tools.remember = tool({
    description: "把关于用户的一条长期信息记下来，以后所有对话、所有智能体都会知道。用户可以在 设置 → 记忆 里查看和删除。",
    inputSchema: jsonSchema<{ text: string }>({
      type: "object",
      properties: { text: { type: "string", description: "一句话，比如 “武汉大学大三，研究方向是模型压缩”" } },
      required: ["text"],
    }),
    execute: async ({ text }, { toolCallId }) => {
      const added = addMemory(text, agent.name);
      report({ id: toolCallId, name: "remember", label: text.trim(), status: "done", detail: added ? undefined : "已经记过" });
      return added ? "已记住。" : "这条已经记过了。";
    },
  });
  return tools;
}
