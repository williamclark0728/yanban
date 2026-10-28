// Sending while a reply runs: Enter inserts into a private reply, Ctrl+Enter queues (stores in inbox.ts).
import type { Attachment } from "../types";
import { sendToAgent, useBusy } from "./chat";
import { sendToGroup } from "./collab";
import { item, queue, useQueue, useSteer } from "./inbox";
import { useData } from "../store";

export { moveQueued, queue, unqueue, unsteer, useQueue, useSteer } from "./inbox";

const isGroup = (chat: string) => useData.getState().groups.some((g) => g.id === chat);

function sendNow(chat: string, text: string, attachments?: Attachment[]) {
  void (isGroup(chat) ? sendToGroup(chat, text, attachments) : sendToAgent(chat, text, attachments));
}

/**
 * Enter: sends now when the chat is free; while a private reply runs, inserts into it;
 * a running group task can't take new input, so the message waits in the queue.
 */
export function send(chat: string, text: string, attachments?: Attachment[]) {
  if (!useBusy.getState()[chat]) return sendNow(chat, text, attachments);
  if (isGroup(chat)) return queue(chat, text, attachments);
  useSteer.setState((s) => ({ [chat]: [...(s[chat] ?? []), item(text, attachments)] }));
}

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
      else sendNow(chat, next.text, next.attachments);
    }, 0);
  }
});
