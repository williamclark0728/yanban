// Tools and safeguards every reply gets: a step list, asking the user, plan mode, and a guard
// against repeated calls, hung tools and huge outputs.
import { jsonSchema, tool, type ToolSet } from "ai";
import { create } from "zustand";
import { useData } from "../store";
import type { Agent, Todo, ToolTrace } from "../types";
import { call, isDesktop } from "./desktop";
import type { Report } from "./tools";

export const AGENT_RULES = [
  "多步骤的任务（三步以上）先用 update_todos 列出步骤，开始做哪一步就把它标成 in_progress，做完标成 done；简单问答不用列。",
  "拿不准用户要什么、而且猜错代价大时，用 ask_user 问用户，给出 2–4 个选项；能自己判断的不要问，一次只问一个问题。",
  "做完一个多步骤、以后可能还会重复做的任务（比如按固定格式整理材料、写某类报告），结尾用一句话提议把这次的做法存成技能，用户点回复下方的「存成技能」就能保存。",
].join("\n");

// ---------- step list ----------

export function todoTool(messageId: string): ToolSet {
  return {
    update_todos: tool({
      description: "写下或更新这次任务的步骤清单，每次传完整的清单。用户会在回复里看到进度。",
      inputSchema: jsonSchema<{ todos: Todo[] }>({
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string", description: "这一步做什么，一句话" },
                status: { type: "string", enum: ["pending", "in_progress", "done"] },
              },
              required: ["text", "status"],
            },
          },
        },
        required: ["todos"],
      }),
      execute: async ({ todos }) => {
        const list = (todos ?? []).filter((t) => t?.text).slice(0, 30);
        useData.getState().patchMessage(messageId, { todos: list }, true);
        const done = list.filter((t) => t.status === "done").length;
        return `已更新清单（${done}/${list.length} 完成）。`;
      },
    }),
  };
}

// ---------- asking the user ----------

/** Questions waiting for the user, by trace id. `null` means the reply was stopped. */
export const useQuestions = create<Record<string, (answer: string | null) => void>>(() => ({}));

export function answerQuestion(id: string, answer: string | null) {
  const resolve = useQuestions.getState()[id];
  if (!resolve) return;
  useQuestions.setState((s) => {
    const { [id]: _, ...rest } = s;
    return rest;
  }, true);
  resolve(answer);
}

export function askTool(report: Report): ToolSet {
  return {
    ask_user: tool({
      description: "向用户提一个问题并等待回答。用于需求不明确、有几种做法要用户选的时候。",
      inputSchema: jsonSchema<{ question: string; options?: string[] }>({
        type: "object",
        properties: {
          question: { type: "string", description: "要问的问题，一句话说清楚" },
          options: { type: "array", items: { type: "string" }, description: "2–4 个可选答案；用户也可以自己写" },
        },
        required: ["question"],
      }),
      execute: async ({ question, options }, { toolCallId, abortSignal }) => {
        const step: ToolTrace = {
          id: toolCallId,
          name: "ask_user",
          label: question,
          status: "waiting",
          question: { text: question, options: (options ?? []).filter(Boolean).slice(0, 6) },
        };
        report(step);
        const answer = await new Promise<string | null>((resolve) => {
          useQuestions.setState({ [toolCallId]: resolve });
          abortSignal?.addEventListener("abort", () => answerQuestion(toolCallId, null), { once: true });
        });
        if (answer === null) {
          report({ ...step, status: "error", detail: "已停止" });
          return "用户没有回答。";
        }
        report({ ...step, status: "done", answer });
        return `用户的回答：${answer}`;
      },
    }),
  };
}

// ---------- plan mode ----------

/** Private chats in plan mode: the agent investigates and proposes a plan, but changes nothing. */
export const usePlanMode = create<Record<string, boolean>>(() => ({}));
export const setPlanMode = (chat: string, on: boolean) => usePlanMode.setState({ [chat]: on });

/** Tools that only look; plan mode keeps these and drops everything that changes files, sends or installs. */
const READ_ONLY = new Set(["web_search", "read_page", "list_dir", "read_file", "search_files", "use_skill", "read_skill_file", "ask_user", "update_todos", "remember", "search_chats", "search_library", "delegate"]);

export const readOnly = (tools: ToolSet): ToolSet => Object.fromEntries(Object.entries(tools).filter(([name]) => READ_ONLY.has(name)));

export const PLAN_RULES = [
  "现在是计划模式：先调查清楚（可以读文件、搜索、提问），但不要修改文件、运行命令或生成文件，这些工具这次也不可用。",
  "最后给出一份执行计划：目标、编号的步骤（每步写清改哪个文件或做什么）、风险和需要用户决定的地方。用户点「按计划执行」后你再动手。",
].join("\n");

export const RUN_PLAN = "按上面的计划执行。";

// ---------- guard ----------

/** Tools that may wait for the user (approvals, questions, a group's whole run) never time out. */
const MAY_WAIT = new Set([
  "list_dir",
  "read_file",
  "search_files",
  "write_file",
  "edit_file",
  "run_command",
  "install_skill",
  "ask_user",
  "dispatch_to_group",
  "make_file",
  "use_skill",
  "read_skill_file",
  "update_todos",
  "remember",
  "search_chats",
  "search_library",
  "delegate",
]);
const TIMEOUT_MS = 90_000;
const REPEAT_LIMIT = 3;
const MAX_RESULT = 20_000;

type Execute = (input: unknown, options: { toolCallId: string; abortSignal?: AbortSignal }) => Promise<unknown>;

/**
 * Wraps every tool of one reply:
 * - the same call with the same input a third time is refused, so the model stops looping;
 * - network tools (search, pages, MCP) give up after 90 seconds;
 * - very long results are cut to their start and end; on the desktop with a workspace the full text is saved there.
 */
export function guard(tools: ToolSet, opts: { agent: Agent; settle: (id: string, detail: string) => void }): ToolSet {
  const seen = new Map<string, number>();
  const wrapped: ToolSet = {};
  for (const [name, t] of Object.entries(tools)) {
    const run = t.execute as Execute | undefined;
    if (!run) {
      wrapped[name] = t;
      continue;
    }
    const execute: Execute = async (input, options) => {
      const key = `${name}:${JSON.stringify(input)}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n >= REPEAT_LIMIT) {
        return `你已经第 ${n} 次用同样的参数调用 ${name}，结果不会变。换个做法（换参数、换工具），或者根据已有信息直接回答。`;
      }
      let result: unknown;
      if (MAY_WAIT.has(name)) result = await run(input, options);
      else {
        let timer = 0;
        const late = new Promise<string>((resolve) => {
          timer = window.setTimeout(() => {
            opts.settle(options.toolCallId, "超时");
            resolve(`${name} 超过 ${TIMEOUT_MS / 1000} 秒没有结果，已放弃。换个做法，或者根据已有信息回答。`);
          }, TIMEOUT_MS);
        });
        result = await Promise.race([run(input, options), late]);
        clearTimeout(timer);
      }
      return typeof result === "string" && result.length > MAX_RESULT ? shorten(name, result, opts.agent) : result;
    };
    wrapped[name] = { ...t, execute } as ToolSet[string];
  }
  return wrapped;
}

/** Keeps the start and the end of a long result. */
async function shorten(name: string, text: string, agent: Agent) {
  const head = text.slice(0, 8_000);
  const tail = text.slice(-3_000);
  const cut = text.length - head.length - tail.length;
  if (name === "read_file") return `${head}\n…（中间省略 ${cut} 字，用 read_file 的 start / end 分段读）…\n${tail}`;
  if (isDesktop && agent.workspace) {
    const path = `.yanban/outputs/${name}-${Date.now()}.txt`;
    try {
      await call("ws_write", { root: agent.workspace, path, content: text });
      return `${head}\n…（结果太长，中间省略 ${cut} 字；完整内容已存到工作区 ${path}，需要时用 read_file 分段读）…\n${tail}`;
    } catch {
      /* fall through to plain cutting */
    }
  }
  return `${head}\n…（结果太长，中间省略 ${cut} 字）…\n${tail}`;
}
