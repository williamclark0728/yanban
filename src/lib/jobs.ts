// Desktop work mode: long commands (training, builds, local servers) run in the background. The agent starts
// one, checks its output later, and can stop it; the user sees the running jobs above the composer.
import { jsonSchema, tool, type ToolSet } from "ai";
import { create } from "zustand";
import type { Agent, ToolTrace } from "../types";
import { call, isDesktop } from "./desktop";
import type { Report } from "./tools";
import { approve, danger, shown } from "./workmode";

export interface JobInfo {
  id: string;
  command: string;
  root: string;
  started: number;
  done: boolean;
  code: number | null;
  size: number;
}

interface Output {
  text: string;
  next: number;
  done: boolean;
  code: number | null;
  cut: boolean;
}

/** Every background job of this run of the app, refreshed while any is running. */
export const useJobs = create<JobInfo[]>(() => []);

let timer = 0;
export async function refreshJobs() {
  if (!isDesktop) return;
  try {
    const list = await call<JobInfo[]>("job_list");
    useJobs.setState(list, true);
    clearTimeout(timer);
    if (list.some((j) => !j.done)) timer = window.setTimeout(refreshJobs, 2000);
  } catch {
    /* not available */
  }
}

export const readJob = (id: string, since?: number, tail?: number) => call<Output>("job_output", { id, since, tail });
export const stopJob = async (id: string) => {
  await call("job_stop", { id });
  setTimeout(refreshJobs, 300);
};

/** Where the agent last read each job's output, so job_output returns only what is new. */
const readTo = new Map<string, number>();

const MAX_SHOWN = 8_000;
const status = (o: Output) => (o.done ? `已结束，退出码 ${o.code ?? "未知（被停止）"}` : "还在运行");

export function jobRules(agent: Agent) {
  if (!isDesktop || !agent.workspace) return "";
  const running = useJobs.getState().filter((j) => !j.done && j.root === agent.workspace);
  return [
    "要跑几分钟以上的命令（训练模型、编译、起本地服务）用 start_job 放到后台，接着用 job_output 看进度（可以等一会儿再看），不需要了用 stop_job 结束；几秒钟能跑完的命令照常用 run_command。",
    running.length ? `现在后台在跑：${running.map((j) => `${j.id}（${j.command.slice(0, 60)}）`).join("；")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function jobTools(agent: Agent, report: Report): ToolSet {
  if (!isDesktop || !agent.workspace) return {};
  const root = agent.workspace;
  return {
    start_job: tool({
      description: "在工作区里后台运行一条 PowerShell 命令（训练、编译、起服务等长任务），立刻返回任务编号，不等它结束。",
      inputSchema: jsonSchema<{ command: string }>({ type: "object", properties: { command: { type: "string" } }, required: ["command"] }),
      execute: async ({ command }, { toolCallId, abortSignal }) => {
        const s: ToolTrace = { id: toolCallId, name: "start_job", label: command, status: "running", root };
        if (!(await approve(report, s, "change", { what: `后台运行：${command}`, danger: danger(command) }, abortSignal))) return "用户没有同意运行这条命令。";
        try {
          const id = await call<string>("job_start", { root, command });
          readTo.set(id, 0);
          report({ ...s, status: "done", detail: id });
          void refreshJobs();
          return `已在后台开始，任务编号 ${id}。用 job_output 查看输出，stop_job 结束。`;
        } catch (e) {
          report({ ...s, status: "error", detail: (e as Error).message });
          return `启动失败：${(e as Error).message}`;
        }
      },
    }),
    job_output: tool({
      description: "查看后台任务的新输出和是否结束。wait 秒内会等到有新输出或任务结束再返回（最多 60）。",
      inputSchema: jsonSchema<{ id: string; wait?: number }>({
        type: "object",
        properties: { id: { type: "string", description: "任务编号，比如 job-1" }, wait: { type: "number", description: "最多等几秒，默认 0" } },
        required: ["id"],
      }),
      execute: async ({ id, wait }, { toolCallId, abortSignal }) => {
        const s: ToolTrace = { id: toolCallId, name: "job_output", label: id, status: "running" };
        report(s);
        try {
          const deadline = Date.now() + Math.min(Math.max(wait ?? 0, 0), 60) * 1000;
          let out = await readJob(id, readTo.get(id) ?? 0);
          while (!out.text && !out.done && Date.now() < deadline && !abortSignal?.aborted) {
            await new Promise((r) => setTimeout(r, 1000));
            out = await readJob(id, readTo.get(id) ?? 0);
          }
          readTo.set(id, out.next);
          const text = out.text.length > MAX_SHOWN ? `…（前面省略 ${out.text.length - MAX_SHOWN} 字）\n${out.text.slice(-MAX_SHOWN)}` : out.text;
          report({ ...s, status: "done", detail: out.done ? `已结束 · 退出码 ${out.code ?? "—"}` : "运行中", output: shown(out.text, "tail") });
          return [`${id}：${status(out)}`, out.cut && "（更早的输出已经丢弃）", text ? `新输出：\n${text}` : "没有新输出。"].filter(Boolean).join("\n");
        } catch (e) {
          report({ ...s, status: "error", detail: (e as Error).message });
          return `读取失败：${(e as Error).message}`;
        }
      },
    }),
    stop_job: tool({
      description: "结束一个后台任务。",
      inputSchema: jsonSchema<{ id: string }>({ type: "object", properties: { id: { type: "string" } }, required: ["id"] }),
      execute: async ({ id }, { toolCallId }) => {
        try {
          await stopJob(id);
          report({ id: toolCallId, name: "stop_job", label: id, status: "done" });
          return `已结束 ${id}。`;
        } catch (e) {
          report({ id: toolCallId, name: "stop_job", label: id, status: "error", detail: (e as Error).message });
          return `结束失败：${(e as Error).message}`;
        }
      },
    }),
  };
}
