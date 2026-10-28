// Session goals: the user sets a goal in a private chat; after each reply the model checks whether it is met,
// and if not the chat carries on by itself, up to a few rounds.
import { create } from "zustand";
import { resolveModel, useData } from "../store";
import type { TextMessage } from "../types";
import { completeText } from "./llm";

export interface Goal {
  text: string;
  /** Replies so far while working on it. */
  round: number;
  max: number;
  status: "running" | "done" | "paused";
  /** Why it paused. */
  note?: string;
  /** What the last check said is still missing. */
  left?: string;
}

export const useGoal = create<Record<string, Goal | undefined>>(() => ({}));

export const GOAL_ROUNDS = [3, 5, 8];

export function goalRules(chat: string) {
  const g = useGoal.getState()[chat];
  if (!g || g.status !== "running") return "";
  return `当前会话目标：${g.text}\n每一轮都朝这个目标推进，已经做完的部分不要重复；这一轮做不完就先完成能完成的部分，说明下一步做什么。`;
}

export const clearGoal = (chat: string) => useGoal.setState({ [chat]: undefined });

const patch = (chat: string, p: Partial<Goal>) => {
  const g = useGoal.getState()[chat];
  if (g) useGoal.setState({ [chat]: { ...g, ...p } });
};

/** Sets a goal and starts on it. */
export function startGoal(chat: string, text: string, max: number, send: (text: string) => void) {
  useGoal.setState({ [chat]: { text: text.trim(), round: 0, max, status: "running" } });
  send(`目标：${text.trim()}`);
}

export function resumeGoal(chat: string, send: (text: string) => void) {
  const g = useGoal.getState()[chat];
  if (!g) return;
  patch(chat, { status: "running", note: undefined, max: Math.max(g.max, g.round + 2) });
  send(g.left ? `继续推进目标。还差：${g.left}` : "继续推进目标。");
}

const JUDGE = [
  "你判断一个会话目标是否已经完成。只看最新这条回复和之前的进展，不要替用户降低要求。",
  '只输出一个 JSON 对象：{"done": true 或 false, "left": "还差什么，一句话；完成了就写空字符串"}',
].join("\n");

/** Reads the judge's answer; anything unreadable counts as not done, so the user can still stop it. */
export function parseVerdict(raw: string): { done: boolean; left: string } {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/gi, "");
  try {
    const data = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    // "还差" is added when shown; models often start with it themselves.
    return { done: data.done === true || data.done === "true", left: String(data.left ?? "").trim().replace(/^还差[：:\s]*/, "") };
  } catch {
    return { done: /"done"\s*:\s*true/.test(text), left: "" };
  }
}

/** After a reply: checks the goal and, if it isn't met, sends the next round. */
export async function afterReply(chat: string, send: (text: string) => void) {
  const g = useGoal.getState()[chat];
  if (!g || g.status !== "running") return;
  const { messages, agents, providers, defaultModel } = useData.getState();
  const reply = messages.findLast((m): m is TextMessage => m.chat === chat && m.kind === "text" && m.sender !== "me" && !m.summary);
  if (!reply || reply.status === "stopped" || reply.status === "error") {
    return patch(chat, { status: "paused", note: reply?.status === "error" ? "回复出错" : "回复被停止" });
  }
  const round = g.round + 1;
  const agent = agents.find((a) => a.id === reply.sender);
  const target = resolveModel(agent, providers, defaultModel);
  if (!agent || !target) return patch(chat, { round, status: "paused", note: "没有可用的模型" });
  let verdict = { done: false, left: "" };
  try {
    const r = await completeText({
      provider: target.provider,
      modelId: target.modelId,
      system: JUDGE,
      messages: [{ role: "user", content: `目标：${g.text}\n\n已经进行了 ${round} 轮。最新的回复：\n${reply.text.slice(-6000)}` }],
      params: { ...agent.params, temperature: 0 },
      signal: new AbortController().signal,
    });
    verdict = parseVerdict(r.text);
  } catch {
    return patch(chat, { round, status: "paused", note: "检查目标时出错" });
  }
  // The user may have ended the goal while it was being checked.
  if (useGoal.getState()[chat]?.status !== "running") return;
  if (verdict.done) return patch(chat, { round, status: "done", note: undefined, left: undefined });
  if (round >= g.max) return patch(chat, { round, status: "paused", note: `到了 ${g.max} 轮上限`, left: verdict.left || undefined });
  patch(chat, { round, left: verdict.left || undefined });
  send(verdict.left ? `继续推进目标。还差：${verdict.left}` : "继续推进目标。");
}
