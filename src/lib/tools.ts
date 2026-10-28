import { google } from "@ai-sdk/google";
import { jsonSchema, tool, type ToolSet } from "ai";
import { resolveModel, useData } from "../store";
import type { Agent, Source, ToolTrace } from "../types";
import { describeError, KIMI_SEARCH, nativeSearch, type NativeSearch } from "./llm";
import { canSearch, readPage, searchWeb } from "./search";

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
  const halt = () => traces.filter((t) => t.status === "running" || t.status === "waiting").forEach((t) => report({ ...t, status: "error", detail: "已停止" }));
  /** Ends a step that is still running, e.g. when it timed out. */
  const settle = (id: string, detail: string) => {
    const t = traces.find((x) => x.id === id);
    if (t?.status === "running") report({ ...t, status: "error", detail });
  };
  /** A call that failed before its tool ran, so the tool never reported it: shown as a failed step. */
  const missed = (call: { id: string; name: string; message: string }) => {
    if (traces.some((x) => x.id === call.id)) return;
    const reason = /JSON|parse|Unexpected|Expected/i.test(call.message) ? "参数不是合法的 JSON，没有执行" : call.message.slice(0, 120);
    report({ id: call.id, name: call.name as ToolTrace["name"], label: "调用失败", status: "error", detail: reason });
  };
  return { report, halt, settle, missed };
}

/**
 * How an agent with web access searches: the model's own search when its service has one,
 * otherwise the web_search / read_page tools when a search service is available.
 */
export function webPlan(agent: Agent): NativeSearch | "tools" | null {
  if (!agent.web) return null;
  const { providers, defaultModel } = useData.getState();
  const target = resolveModel(agent, providers, defaultModel);
  const native = target && nativeSearch(target.provider, target.modelId);
  return native || (canSearch() ? "tools" : null);
}

export const webEnabled = (agent: Agent) => webPlan(agent) !== null;

export const WEB_RULES = [
  "你可以联网：web_search 搜索网页，read_page 阅读某个网页的全文。",
  "需要最新信息、具体数据、新闻或你不确定的事实时，先搜索再回答；常识问题不用搜。",
  "引用搜索结果时，在句末用 [编号] 标注来源，编号沿用搜索结果里的编号。",
].join("\n");

export const NATIVE_WEB_RULES = [
  "你可以联网搜索：搜索由模型服务自动完成，搜到的资料会直接提供给你，所以你没有单独的搜索工具，但确实能联网。不要说自己不能联网。",
  "需要最新信息、具体数据、新闻或你不确定的事实时，先搜索再回答；常识问题不用搜。回答里注明信息来源。",
].join("\n");

/** The user turned web search on, but neither the model nor a search service can do it. */
export const NO_WEB_RULES =
  "用户为你打开了联网搜索，但当前模型不自带搜索，也还没连接搜索服务，所以这次不能联网。需要最新信息时如实说明，并告诉用户：在 设置 → 联网搜索 里连接一个搜索服务（博查、Tavily 等），或换一个自带搜索的模型（通义千问、智谱、Kimi、Gemini 3）。";

const NATIVE_LABEL: Record<NativeSearch, string> = { qwen: "通义千问", zhipu: "智谱", kimi: "Kimi", gemini: "Google" };

/** The web part of a model call: tools to pass, whether to turn on the service's own search, and where cited pages go. */
export function webAccess(agent: Agent, report: Report): { tools: ToolSet; search: boolean; onSources?: (s: Source[]) => void } {
  const plan = webPlan(agent);
  if (!plan) return { tools: {}, search: false };
  if (plan === "tools") return { tools: webTools(report), search: false };
  const label = `${NATIVE_LABEL[plan]}自带搜索`;
  const onSources = (sources: Source[]) =>
    report({ id: "native-search", name: "web_search", label, status: "done", detail: `${sources.length} 个来源`, sources, first: 1 });
  if (plan === "gemini") return { tools: { google_search: google.tools.googleSearch({}) }, search: true, onSources };
  if (plan === "kimi") {
    // Kimi runs the search itself; the client only returns the call's arguments unchanged.
    const echo = tool({
      description: "联网搜索",
      inputSchema: jsonSchema<Record<string, unknown>>({ type: "object", properties: {} }),
      execute: async (args, { toolCallId }) => {
        report({ id: toolCallId, name: "web_search", label, status: "done" });
        return args;
      },
    });
    return { tools: { [KIMI_SEARCH]: echo }, search: true };
  }
  return { tools: {}, search: true };
}

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
          const hits = await searchWeb(query, abortSignal);
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
