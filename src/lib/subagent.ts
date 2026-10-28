// Sub-agents: a private reply hands a self-contained piece of work to a fresh context and gets back only the result.
import { jsonSchema, tool, type ToolSet } from "ai";
import { resolveModel, useData, usePrefs } from "../store";
import type { Agent } from "../types";
import { guard, readOnly } from "./agentTools";
import { systemPrompt } from "./chat";
import { libraryRules, libraryTools } from "./library";
import { completeText, describeError } from "./llm";
import { skillRules, skillTools } from "./skills";
import { webAccess, type Report } from "./tools";
import { workTools } from "./workmode";

export const DELEGATE_RULES =
  "子任务能独立完成、又会产生大量中间内容时（比如分别调研几个方向、各读一篇长文献、各查一组数据），用 delegate 交给子智能体：它在独立的上下文里做完，只把结果交回来，你的上下文不会被中间过程占满。互不依赖的子任务可以在同一步里同时派出几个。简单的事自己做。";

const SUB_RULES = [
  "你是被派来完成一个子任务的子智能体。只做下面这个任务，不要扩展。",
  "可以搜索、检索资料库、读文件，但不能修改文件，也不能问用户问题。",
  "最后给出完整、可以直接使用的结果：要点、关键数据和出处。不寒暄，不写过程。",
].join("\n");

const MAX_OUTPUT_SHOWN = 6000;

export function delegateTool(parent: Agent, report: Report): ToolSet {
  const others = useData.getState().agents.filter((a) => a.id !== parent.id);
  return {
    delegate: tool({
      description: "把一个能独立完成的子任务交给子智能体，在独立的上下文里做完后返回结果。可以指定某个智能体来做（用它的角色和模型），不指定就用和你一样的设置。",
      inputSchema: jsonSchema<{ task: string; agent?: string }>({
        type: "object",
        properties: {
          task: { type: "string", description: "子任务：要做什么、交回什么，写清楚，子智能体看不到你们之前的对话" },
          ...(others.length ? { agent: { type: "string", enum: others.map((a) => a.name), description: "可选：交给哪个智能体" } } : {}),
        },
        required: ["task"],
      }),
      execute: async ({ task, agent: name }, { toolCallId, abortSignal }) => {
        const sub = others.find((a) => a.name === name) ?? parent;
        const step = { id: toolCallId, name: "delegate" as const, label: `${sub.id === parent.id ? "子智能体" : sub.name}：${task}` };
        const { providers, defaultModel } = useData.getState();
        const target = resolveModel(sub, providers, defaultModel);
        if (!target) {
          report({ ...step, status: "error", detail: "没有可用的模型" });
          return "子任务没有执行：没有可用的模型。";
        }
        // The sub-agent's own tool calls are counted on this step instead of being listed one by one.
        const seen = new Set<string>();
        const track: Report = (t) => {
          if (seen.has(t.id)) return;
          seen.add(t.id);
          report({ ...step, status: "running", detail: `已用 ${seen.size} 次工具` });
        };
        report({ ...step, status: "running" });
        const web = webAccess(sub, track);
        // Reading files asks for approval in the strictest mode; nobody would see that card here, so leave them out.
        const files = usePrefs.getState().approval === "ask" ? {} : workTools(sub, track);
        const tools = guard(readOnly({ ...web.tools, ...libraryTools(track), ...skillTools(track, sub), ...files }), {
          agent: sub,
          settle: () => {},
        });
        try {
          const r = await completeText({
            provider: target.provider,
            modelId: target.modelId,
            system: [systemPrompt(sub), skillRules(), libraryRules(), SUB_RULES].filter(Boolean).join("\n\n"),
            messages: [{ role: "user", content: task }],
            params: sub.params,
            signal: abortSignal ?? new AbortController().signal,
            tools,
            search: web.search,
          });
          const out = r.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim() || "（子智能体没有给出结果）";
          report({
            ...step,
            status: "done",
            detail: `${seen.size ? `用了 ${seen.size} 次工具 · ` : ""}${r.seconds} 秒`,
            output: out.length > MAX_OUTPUT_SHOWN ? `${out.slice(0, MAX_OUTPUT_SHOWN)}…` : out,
          });
          return out;
        } catch (e) {
          const message = abortSignal?.aborted ? "已停止" : describeError(e).message;
          report({ ...step, status: "error", detail: message });
          return `子任务失败：${message}`;
        }
      },
    }),
  };
}
