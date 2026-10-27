// Token usage by day and model, kept apart from the messages so clearing a chat doesn't erase it.
import { create } from "zustand";
import type { Message } from "../types";
import { getKv, setKv } from "./db";

export interface Tally {
  input: number;
  output: number;
  calls: number;
}

/** "2026-10-27" → model id → tally. */
export type UsageLog = Record<string, Record<string, Tally>>;

export const useUsage = create<{ log: UsageLog; loaded: boolean }>(() => ({ log: {}, loaded: false }));

/** Local calendar date, so "today" matches the user's clock. */
export const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

let saving: ReturnType<typeof setTimeout> | undefined;
const save = () => {
  clearTimeout(saving);
  saving = setTimeout(() => void setKv("usageLog", useUsage.getState().log), 500);
};

function add(log: UsageLog, day: string, model: string, input: number, output: number) {
  const t = (log[day] ??= {})[model] ?? { input: 0, output: 0, calls: 0 };
  log[day][model] = { input: t.input + input, output: t.output + output, calls: t.calls + 1 };
}

/** Called after every model call. */
export function recordUsage(model: string, input: number, output: number) {
  if (!input && !output) return;
  const log = structuredClone(useUsage.getState().log);
  add(log, dayKey(Date.now()), model, input, output);
  useUsage.setState({ log });
  save();
}

/** Loads the log; the first time, it is rebuilt from the replies already in the chats. */
export async function loadUsage(messages: Message[]) {
  let log = await getKv<UsageLog | null>("usageLog", null);
  if (!log) {
    log = {};
    for (const m of messages) if (m.kind !== "round" && m.usage) add(log, dayKey(m.at), m.usage.model, m.usage.input, m.usage.output);
    void setKv("usageLog", log);
  }
  useUsage.setState({ log, loaded: true });
}
