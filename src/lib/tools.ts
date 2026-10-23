import { jsonSchema, tool, type ToolSet } from "ai";
import { useData } from "../store";
import type { Agent, ToolTrace } from "../types";
import { describeError } from "./llm";
import { readPage, searchReady, webSearch } from "./search";

/** Adds or updates one tool step on the message being written. */
export type Report = (t: ToolTrace) => void;

/** Tracks a message's tool steps and writes each change into it. */
export function tracer(messageId: string) {
  const traces: ToolTrace[] = [];
  const report: Report = (t) => {
    const i = traces.findIndex((x) => x.id === t.id);
    if (i >= 0) traces[i] = t;
    else traces.push(t);
    useData.getState().patchMessage(messageId, { tools: [...traces] }, t.status !== "running");
  };
  /** Steps still running when the reply stops are marked as stopped. */
  const halt = () => traces.filter((t) => t.status === "running").forEach((t) => report({ ...t, status: "error", detail: "已停止" }));
  return { report, halt };
}

export const webEnabled = (agent: Agent) => !!agent.web && searchReady(useData.getState().search);

export const WEB_RULES = [
  "你可以联网：web_search 搜索网页，read_page 阅读某个网页的全文。",
  "需要最新信息、具体数据、新闻或你不确定的事实时，先搜索再回答；常识问题不用搜。",
  "引用搜索结果时，在句末用 [编号] 标注来源，编号沿用搜索结果里的编号。",
].join("\n");

const fail = (e: unknown) => describeError(e).message;

/** web_search and read_page. Result numbers keep counting across searches within one reply. */
export function webTools(report: Report): ToolSet {
  let next = 1;
  return {
    web_search: tool({
      description: "搜索网页，返回带编号的结果（标题、网站、日期、链接、摘要）。",
      inputSchema: jsonSchema<{ query: string }>({
        type: "object",
        properties: { query: { type: "string", description: "搜索词，简短具体，可以用中文或英文" } },
        required: ["query"],
      }),
      execute: async ({ query }, { toolCallId, abortSignal }) => {
        const base = { id: toolCallId, name: "web_search" as const, label: query };
        report({ ...base, status: "running" });
        try {
          const hits = await webSearch(useData.getState().search, query, abortSignal);
          const first = next;
          next += hits.length;
          report({ ...base, status: "done", detail: `${hits.length} 条结果`, sources: hits.map(({ title, url, site, date }) => ({ title, url, site, date })), first });
          if (!hits.length) return "没有搜到结果，换个说法再试。";
          return hits
            .map((h, i) => `[${first + i}] ${h.title}（${[h.site, h.date].filter(Boolean).join("，")}）\n${h.url}\n${h.snippet}`)
            .join("\n\n");
        } catch (e) {
          report({ ...base, status: "error", detail: fail(e) });
          return `搜索失败：${fail(e)}`;
        }
      },
    }),
    read_page: tool({
      description: "读取一个网页的正文（转成纯文本），用于搜索摘要不够时查看原文。",
      inputSchema: jsonSchema<{ url: string }>({
        type: "object",
        properties: { url: { type: "string", description: "完整网址，以 http 或 https 开头" } },
        required: ["url"],
      }),
      execute: async ({ url }, { toolCallId, abortSignal }) => {
        const base = { id: toolCallId, name: "read_page" as const, label: url };
        report({ ...base, status: "running" });
        try {
          const text = await readPage(useData.getState().search, url, abortSignal);
          report({ ...base, status: "done", detail: `${text.length} 字` });
          return text;
        } catch (e) {
          report({ ...base, status: "error", detail: fail(e) });
          return `读取失败：${fail(e)}`;
        }
      },
    }),
  };
}
