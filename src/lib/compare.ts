// Asking several models the same question in a private chat, and the suggested next steps under a reply.
import { create } from "zustand";
import { useData } from "../store";
import type { Message, ModelRef } from "../types";

export const MAX_COMPARE = 3;

/** Private chats in compare mode: the models that each answer the next messages. Two or more turn it on. */
export const useCompare = create<Record<string, ModelRef[]>>(() => ({}));

export const setCompare = (chat: string, models: ModelRef[]) => useCompare.setState({ [chat]: models.slice(0, MAX_COMPARE) });

export const sameModel = (a: ModelRef, b: ModelRef) => a.provider === b.provider && a.id === b.id;

/**
 * Of each set of side-by-side replies only one carries on into the context: the one the user picked,
 * otherwise the first that finished.
 */
export function withoutAlternatives(messages: Message[]) {
  const keep = new Map<string, string>();
  for (const m of messages) {
    if (m.kind !== "text" || !m.compare) continue;
    if (m.chosen) keep.set(m.compare, m.id);
    else if (!keep.has(m.compare) && m.status !== "error" && m.status !== "streaming") keep.set(m.compare, m.id);
  }
  return messages.filter((m) => m.kind !== "text" || !m.compare || keep.get(m.compare) === m.id);
}

/** Picks one reply of a comparison to carry on with. */
export function choose(id: string) {
  const { messages, patchMessage } = useData.getState();
  const m = messages.find((x) => x.id === id);
  if (m?.kind !== "text" || !m.compare) return;
  for (const x of messages) if (x.kind === "text" && x.compare === m.compare) patchMessage(x.id, { chosen: x.id === id || undefined }, true);
}

// ---------- suggested next steps ----------

export const NEXT_RULES =
  "回答完后，如果用户接下来很可能要做某几件事，在回复最末尾另起一行写 <next>建议一|建议二</next>：每条是用户会直接发给你的一句话（15 字以内，比如“生成 PPT”“整理成对比表”“派到群里写正式稿”），最多 3 条，用 | 隔开。寒暄、简单问答不写。";

/** Splits `<next>…</next>` off the end of a reply; an unfinished tag while streaming is hidden too. */
export function splitNext(text: string): { text: string; next?: string[] } {
  const m = /\s*<next>([\s\S]*?)(?:<\/next>\s*$|$)/.exec(text);
  if (!m) return { text: text.replace(/\s*<(?:n(?:e(?:xt?)?)?)?$/, "") };
  const next = m[1]
    .split(/[|｜\n]/)
    .map((s) => s.replace(/^[\s\-*\d.、]+/, "").trim())
    .filter((s) => s && s.length <= 40)
    .slice(0, 3);
  return { text: text.slice(0, m.index).trimEnd(), next: next.length ? next : undefined };
}
