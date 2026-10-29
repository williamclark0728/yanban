// Sending while a reply runs: Enter interjects (changes the reply's course now), Ctrl+Enter queues
// (stores in inbox.ts).
import type { Attachment } from "../types";
import { sendToAgent, stop, useBusy } from "./chat";
import { runningTask, sendToGroup } from "./collab";
import { item, useQueue, useSteer } from "./inbox";
import { useData } from "../store";

export { moveQueued, queue, unqueue, unsteer, useQueue, useSteer } from "./inbox";

const isGroup = (chat: string) => useData.getState().groups.some((g) => g.id === chat);

function sendNow(chat: string, text: string, attachments?: Attachment[], before?: string) {
  void (isGroup(chat) ? sendToGroup(chat, text, attachments, undefined, before) : sendToAgent(chat, text, attachments));
}

/** The chat's replies still being written. */
const streaming = (chat: string) => useData.getState().messages.filter((m) => m.chat === chat && m.kind === "text" && m.status === "streaming");

/** Stops the chat's running replies, marked as interrupted so the stop reads as the user's correction. */
function interrupt(chat: string) {
  const { patchMessage } = useData.getState();
  for (const m of streaming(chat)) patchMessage(m.id, { interrupted: true });
  stop(chat);
}

/**
 * Enter: sends now when the chat is free. While something runs, it interjects:
 * - private chat: the message reaches the reply before its next step. A reply in the middle of a tool step
 *   (a search, a command, a question to the user) finishes that step first; one that is only writing stops
 *   now, and the message goes out at once with the partial reply above it.
 * - group: the run stops, and the message goes out first, carrying the task it interrupted, so the lead
 *   re-plans from there instead of starting over.
 */
export function send(chat: string, text: string, attachments?: Attachment[]) {
  if (!useBusy.getState()[chat]) return sendNow(chat, text, attachments);
  if (isGroup(chat)) {
    useQueue.setState((q) => ({ [chat]: [{ ...item(text, attachments), before: runningTask(chat) }, ...(q[chat] ?? [])] }));
    return interrupt(chat);
  }
  useSteer.setState((s) => ({ [chat]: [...(s[chat] ?? []), item(text, attachments)] }));
  const inStep = streaming(chat).some((m) => m.kind === "text" && m.tools?.some((t) => t.status === "running" || t.status === "waiting"));
  if (!inStep) interrupt(chat);
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
      else sendNow(chat, next.text, next.attachments, next.before);
    }, 0);
  }
});
