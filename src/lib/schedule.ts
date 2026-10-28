// Scheduled tasks: at set times a message goes to an agent's private chat, as if the user had sent it.
// They run while the app (or the website tab) is open; a run missed in the last 12 hours happens on next open.
import { jsonSchema, tool, type ToolSet } from "ai";
import { useData } from "../store";
import type { Schedule } from "../types";
import { sendToAgent, useBusy } from "./chat";
import { queue } from "./inbox";
import type { Report } from "./tools";

const CATCH_UP_MS = 12 * 60 * 60 * 1000;
const TICK_MS = 20_000;

const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const at = (day: Date, time: string) => {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(day);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
};

const onDay = (s: Schedule, d: Date) => (s.repeat === "weekdays" ? d.getDay() >= 1 && d.getDay() <= 5 : s.repeat === "once" ? dayKey(d) === s.date : true);

/** The latest moment at or before `now` the task was due, or null. */
export function lastDue(s: Schedule, now = new Date()): Date | null {
  for (let back = 0; back < 8; back++) {
    const day = new Date(now);
    day.setDate(now.getDate() - back);
    const t = at(day, s.time);
    if (t <= now && onDay(s, day)) return t;
  }
  return null;
}

/** The next moment after `now` the task is due, for the settings list. */
export function nextDue(s: Schedule, now = new Date()): Date | null {
  if (!s.enabled) return null;
  for (let ahead = 0; ahead < 8; ahead++) {
    const day = new Date(now);
    day.setDate(now.getDate() + ahead);
    const t = at(day, s.time);
    if (t > now && onDay(s, day)) return t;
  }
  return null;
}

export const repeatLabel = (s: Pick<Schedule, "repeat" | "date">) => (s.repeat === "daily" ? "每天" : s.repeat === "weekdays" ? "工作日" : `${s.date ?? ""} 一次`);

/** Sends the task's message now: straight away when the chat is free, otherwise after the running reply. */
export function runSchedule(id: string) {
  const { schedules, setSchedules, agents } = useData.getState();
  const s = schedules.find((x) => x.id === id);
  if (!s || !agents.some((a) => a.id === s.agentId)) return;
  setSchedules(schedules.map((x) => (x.id === id ? { ...x, lastRun: Date.now(), enabled: x.repeat === "once" ? false : x.enabled } : x)));
  const text = `【定时任务】${s.prompt}`;
  if (useBusy.getState()[s.agentId]) queue(s.agentId, text);
  else void sendToAgent(s.agentId, text);
}

function tick() {
  const now = new Date();
  for (const s of useData.getState().schedules) {
    if (!s.enabled) continue;
    const due = lastDue(s, now);
    if (!due || now.getTime() - due.getTime() > CATCH_UP_MS) continue;
    if (Math.max(s.lastRun ?? 0, s.createdAt) >= due.getTime()) continue;
    runSchedule(s.id);
  }
}

let started = false;
/** Starts checking for due tasks; called once the data is loaded. */
export function startScheduler() {
  if (started) return;
  started = true;
  tick();
  window.setInterval(tick, TICK_MS);
}

export function addSchedule(s: Omit<Schedule, "id" | "createdAt" | "enabled">) {
  const { schedules, setSchedules } = useData.getState();
  const made: Schedule = { ...s, id: crypto.randomUUID().slice(0, 8), enabled: true, createdAt: Date.now() };
  setSchedules([...schedules, made]);
  return made;
}

// ---------- the agent's side ----------

const isPrivate = (chat: string) => useData.getState().agents.some((a) => a.id === chat);

export function scheduleRules(chat: string) {
  if (!isPrivate(chat)) return "";
  return "用户要你定时做某件事（比如每天早上搜新论文、每周五整理进展）时，用 schedule_task 建一个定时任务：到点时研伴会把 prompt 作为一条消息发给你。研伴要开着才会运行，告诉用户这一点。";
}

export function scheduleTool(chat: string, report: Report): ToolSet {
  if (!isPrivate(chat)) return {};
  return {
    schedule_task: tool({
      description: "建一个定时任务：在指定时间把 prompt 作为一条消息发给你自己（这个私聊）。用户可以在 设置 → 定时任务 里查看、修改、关掉。",
      inputSchema: jsonSchema<{ prompt: string; time: string; repeat: Schedule["repeat"]; date?: string }>({
        type: "object",
        properties: {
          prompt: { type: "string", description: "到点时要做的事，写成给你自己的完整指令" },
          time: { type: "string", description: "时间，24 小时制 HH:MM，比如 08:30" },
          repeat: { type: "string", enum: ["daily", "weekdays", "once"], description: "每天 / 工作日 / 只一次" },
          date: { type: "string", description: "只一次时的日期 YYYY-MM-DD" },
        },
        required: ["prompt", "time", "repeat"],
      }),
      execute: async ({ prompt, time, repeat, date }, { toolCallId }) => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
        if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return "time 要写成 HH:MM，比如 08:30。";
        if (repeat === "once" && !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return "只一次的任务要写 date，格式 YYYY-MM-DD。";
        const s = addSchedule({ agentId: chat, prompt: prompt.trim(), time: `${pad(Number(m[1]))}:${m[2]}`, repeat, date: repeat === "once" ? date : undefined });
        report({ id: toolCallId, name: "schedule_task", label: `${repeatLabel(s)} ${s.time} · ${s.prompt}`, status: "done" });
        return `已建好定时任务：${repeatLabel(s)} ${s.time}。研伴开着时到点自动运行。`;
      },
    }),
  };
}
