// Messages sent while a reply is running wait here and go out, in order, once the chat is free.
import { create } from "zustand";
import type { Attachment } from "../types";
import { sendToAgent, useBusy } from "./chat";
import { sendToGroup } from "./collab";
import { useData } from "../store";

export interface Queued {
  id: string;
  text: string;
  attachments?: Attachment[];
}

export const useQueue = create<Record<string, Queued[]>>(() => ({}));

/** Sends now, or queues when the chat is busy. */
export function send(chat: string, text: string, attachments?: Attachment[]) {
  if (useBusy.getState()[chat]) {
    useQueue.setState((q) => ({ [chat]: [...(q[chat] ?? []), { id: crypto.randomUUID(), text, attachments }] }));
    return;
  }
  const isGroup = useData.getState().groups.some((g) => g.id === chat);
  void (isGroup ? sendToGroup(chat, text, attachments) : sendToAgent(chat, text, attachments));
}

export const unqueue = (chat: string, id: string) => useQueue.setState((q) => ({ [chat]: (q[chat] ?? []).filter((m) => m.id !== id) }));

// When a chat goes idle, its next queued message goes out.
useBusy.subscribe((now, before) => {
  for (const chat of Object.keys(before)) {
    if (!before[chat] || now[chat]) continue;
    const [next, ...rest] = useQueue.getState()[chat] ?? [];
    if (!next) continue;
    useQueue.setState({ [chat]: rest });
    // Let the run that just ended finish its own state updates first. A compaction ends right before
    // its reply starts, so if the chat is busy again the message goes back to the front of the line.
    setTimeout(() => {
      if (useBusy.getState()[chat]) useQueue.setState((q) => ({ [chat]: [next, ...(q[chat] ?? [])] }));
      else send(chat, next.text, next.attachments);
    }, 0);
  }
});
