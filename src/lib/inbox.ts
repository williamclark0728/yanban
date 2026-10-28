// Messages the user sent while a reply was running. Two kinds:
// - queued (Ctrl+Enter): wait and go out, in order, once the chat is free; they can be edited, removed and reordered;
// - inserted (Enter, private chats): handed to the running reply before its next step. If the reply ends
//   without another step, they go out right after it, ahead of the queue.
// Sending lives in queue.ts; this module has no dependency on the chat code, so chat.ts can use it.
import { create } from "zustand";
import type { Attachment } from "../types";
import { attachmentText } from "./files";

export interface Queued {
  id: string;
  text: string;
  attachments?: Attachment[];
}

export const useQueue = create<Record<string, Queued[]>>(() => ({}));
export const useSteer = create<Record<string, Queued[]>>(() => ({}));

export const item = (text: string, attachments?: Attachment[]): Queued => ({ id: crypto.randomUUID(), text, attachments });

export function queue(chat: string, text: string, attachments?: Attachment[]) {
  useQueue.setState((q) => ({ [chat]: [...(q[chat] ?? []), item(text, attachments)] }));
}

export const unqueue = (chat: string, id: string) => useQueue.setState((q) => ({ [chat]: (q[chat] ?? []).filter((m) => m.id !== id) }));
export const unsteer = (chat: string, id: string) => useSteer.setState((s) => ({ [chat]: (s[chat] ?? []).filter((m) => m.id !== id) }));

/** Moves a queued message up (-1) or down (+1). */
export function moveQueued(chat: string, id: string, delta: number) {
  useQueue.setState((q) => {
    const list = [...(q[chat] ?? [])];
    const i = list.findIndex((m) => m.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return {};
    [list[i], list[j]] = [list[j], list[i]];
    return { [chat]: list };
  });
}

/** Takes the messages inserted into a running reply: what the user sees, and what the model reads. */
export function takeSteers(chat: string) {
  const items = useSteer.getState()[chat] ?? [];
  if (items.length) useSteer.setState({ [chat]: [] });
  return items.map((m) => ({ shown: m.text, prompt: [m.text, attachmentText(m.attachments)].filter(Boolean).join("\n\n") }));
}

/** Inserted messages the reply never got to (it ended without another step) go first in the queue. */
export function requeueSteers(chat: string) {
  const left = useSteer.getState()[chat] ?? [];
  if (!left.length) return;
  useSteer.setState({ [chat]: [] });
  useQueue.setState((q) => ({ [chat]: [...left, ...(q[chat] ?? [])] }));
}
