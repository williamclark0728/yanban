import { google } from "@ai-sdk/google";
import { jsonSchema, tool, type ToolSet } from "ai";
import { resolveModel, useData } from "../store";
import type { Agent, Source, ToolTrace } from "../types";
import { describeError, KIMI_SEARCH, nativeSearch, type NativeSearch } from "./llm";
import { isDesktop } from "./desktop";
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
  "用户要最近、最新的信息时，优先用发布日期近的结果，并写出日期；结果没有日期或已经比较旧时要说明。",
  "X（推特）、小红书、Instagram、Facebook、Threads 要登录才能看，read_page 读不到；Reddit 常拦截自动访问。这些平台只能用搜索结果里出现的标题、链接和摘要，并注明“只看到搜索摘要，没打开原文”；搜索结果里没有的帖子就说没找到，请用户自己登录查看。",
  "只列搜索结果或读过的页面里真实出现过的网址；不要按格式拼出帖子编号、视频编号或链接，也不要编造发布日期、点赞数、播放量。",
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

/** Sites that show nothing without signing in; reading them only wastes time and tokens. */
const LOGIN_SITES: [RegExp, string][] = [
  [/(^|\.)(x|twitter)\.com$/, "X（推特）"],
  [/(^|\.)(xiaohongshu\.com|xhslink\.com)$/, "小红书"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)facebook\.com$/, "Facebook"],
  [/(^|\.)threads\.(net|com)$/, "Threads"],
];

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

/** What the model hears when a site can't be read, so it stops trying and says so. */
const unreadable = (site: string) =>
  isDesktop
    ? `${site} 的网页 read_page 读不到（要登录或会拦截自动访问），换这个网站的其他网址也一样。改用 browser_open 在内置浏览器里打开：用户在内置浏览器登录过就能读；读到登录页时请用户先在右侧浏览器里登录。没有 browser_open 时，只用搜索结果里的标题、链接和摘要，并注明“只看到搜索摘要，没打开原文”。`
    : `${site} 的网页要登录或会拦截自动访问，研伴读不到正文，换这个网站的其他网址也一样，不要再试。只用搜索结果里出现过的标题、链接和摘要（注明“只看到搜索摘要，没打开原文”），不要补写摘要里没有的内容；告诉用户这个平台的帖子需要他自己登录查看。`;

/** A short page that is only a sign-in prompt or a block notice, not the content. */
function walled(text: string) {
  const body = text.replace(/^(Title|URL Source|Published Time|Markdown Content):.*$/gm, "").trim();
  if (body.length > 1500) return false;
  return /log ?in to (continue|see|view)|sign in to (continue|see|view)|you've been blocked|whoa there, pardner|access denied|verify you are (a )?human|登录后查看|请先登录|登录后才能|安全验证|访问受限/i.test(body);
}

/** web_search and read_page. Result numbers keep counting across searches within one reply. */
export function webTools(report: Report): ToolSet {
  let next = 1;
  // Sites that already failed in this reply: another page of the same site fails the same way.
  const failed = new Map<string, number>();
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
        const host = hostOf(url);
        const login = LOGIN_SITES.find(([re]) => re.test(host))?.[1];
        if (login) {
          report({ ...base, status: "error", detail: "要登录才能看，读不到" });
          return unreadable(login);
        }
        if ((failed.get(host) ?? 0) >= 2) {
          report({ ...base, status: "error", detail: "这个网站前两次都没读到，不再尝试" });
          return unreadable(host);
        }
        report({ ...base, status: "running" });
        const miss = (detail: string) => {
          const n = (failed.get(host) ?? 0) + 1;
          failed.set(host, n);
          report({ ...base, status: "error", detail });
          return n >= 2 ? unreadable(host) : `读取失败：${detail}`;
        };
        try {
          const text = await readPage(useData.getState().search, url, abortSignal);
          if (walled(text)) return miss("页面要求登录或拦截了访问");
          report({ ...base, status: "done", detail: `${text.length} 字` });
          return text;
        } catch (e) {
          return miss(fail(e));
        }
      },
    }),
  };
}
