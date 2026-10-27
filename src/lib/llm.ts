import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, RetryError, generateText, isStepCount, streamText, type ModelMessage, type ToolSet } from "ai";
import { useData } from "../store";
import type { ModelParams, Provider, Source } from "../types";
import { desktopFetch, isDesktop } from "./desktop";

const RELAY = "/api/relay";

/**
 * Local and plain-http endpoints (Ollama, LAN gateways) and this site's own API (the trial model)
 * are called directly; everything else goes through the relay.
 */
export function isDirect(baseUrl: string) {
  if (baseUrl.startsWith("/")) return true;
  try {
    const u = new URL(baseUrl);
    return u.protocol === "http:" || ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

function fetchFor(p: Pick<Provider, "baseUrl">): typeof fetch {
  if (isDesktop) return desktopFetch;
  if (p.baseUrl.startsWith("/api/trial")) {
    return async (input, init) => {
      const res = await fetch(input, init);
      const left = res.headers.get("x-trial-remaining");
      if (left !== null) useData.getState().setTrialRemaining(Number(left));
      else if (res.status === 429) useData.getState().setTrialRemaining(0);
      return res;
    };
  }
  if (isDirect(p.baseUrl)) return (input, init) => fetch(input, init);
  return (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(init?.headers);
    headers.set("x-relay-target", url);
    return fetch(RELAY, { ...init, headers });
  };
}

/** Fetches any URL the way model calls do: directly when allowed, otherwise through the relay. */
export const proxiedFetch = (url: string, init?: RequestInit) => fetchFor({ baseUrl: url })(url, init);

const trimSlash = (s: string) => s.trim().replace(/\/+$/, "");
/** The SDKs need absolute URLs; this site's own API is stored as a path. */
const absolute = (s: string) => (s.startsWith("/") ? new URL(s, location.origin).href : s);

export type NativeSearch = "qwen" | "zhipu" | "kimi" | "gemini";

/** Kimi's built-in search is a tool call the client hands straight back. */
export const KIMI_SEARCH = "$web_search";

/**
 * Services whose models can search the web themselves. Gemini only from version 3:
 * older models can't use Google Search together with function tools.
 */
export function nativeSearch(p: Provider, modelId: string): NativeSearch | null {
  let host = "";
  try {
    host = new URL(p.baseUrl).hostname;
  } catch {
    return null;
  }
  if (p.protocol === "openai-chat") {
    if (/(^|\.)dashscope(-intl)?\.aliyuncs\.com$/.test(host)) return "qwen";
    if (/(^|\.)bigmodel\.cn$/.test(host) || host === "api.z.ai") return "zhipu";
    if (/(^|\.)moonshot\.(cn|ai)$/.test(host)) return "kimi";
  }
  if (p.protocol === "gemini" && host === "generativelanguage.googleapis.com" && /gemini-([3-9]|\d{2})/.test(modelId)) return "gemini";
  return null;
}

/** Turns on the service's own search in the request body (Gemini's goes in as a tool instead). */
function searchingFetch(base: typeof fetch, kind: NativeSearch): typeof fetch {
  return (input, init) => {
    if (typeof init?.body !== "string") return base(input, init);
    const body = JSON.parse(init.body);
    if (kind === "qwen") body.enable_search = true;
    if (kind === "zhipu") body.tools = [...(body.tools ?? []), { type: "web_search", web_search: { enable: true, search_engine: "search_std", search_result: true } }];
    if (kind === "kimi") {
      body.tools = body.tools?.map((t: { function?: { name?: string } }) =>
        t.function?.name === KIMI_SEARCH ? { type: "builtin_function", function: { name: KIMI_SEARCH } } : t,
      );
    }
    return base(input, { ...init, body: JSON.stringify(body) });
  };
}

export function languageModel(p: Provider, modelId: string, search = false) {
  const kind = search ? nativeSearch(p, modelId) : null;
  const fetch = kind && kind !== "gemini" ? searchingFetch(fetchFor(p), kind) : fetchFor(p);
  const baseURL = absolute(trimSlash(p.baseUrl));
  const apiKey = p.apiKey || "none";
  switch (p.protocol) {
    case "openai-chat":
      return createOpenAICompatible({ name: p.id, baseURL, apiKey, fetch, includeUsage: true })(modelId);
    case "openai-responses":
      return createOpenAI({ baseURL, apiKey, fetch }).responses(modelId);
    case "anthropic":
      return createAnthropic({ baseURL, apiKey, fetch })(modelId);
    case "gemini":
      return createGoogleGenerativeAI({ baseURL, apiKey, fetch })(modelId);
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`HTTP ${status}`);
  }
}

/** Lists model IDs the key can use. */
export async function listModels(p: Provider): Promise<string[]> {
  const base = trimSlash(p.baseUrl);
  const headers: Record<string, string> = {};
  let url = `${base}/models`;
  if (p.protocol === "anthropic") {
    headers["x-api-key"] = p.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    url += "?limit=1000";
  } else if (p.protocol === "gemini") {
    headers["x-goog-api-key"] = p.apiKey;
    url += "?pageSize=1000";
  } else if (p.apiKey) {
    headers.authorization = `Bearer ${p.apiKey}`;
  }
  const res = await fetchFor(p)(url, { headers });
  const body = await res.text();
  if (!res.ok) throw new HttpError(res.status, body);
  const data = JSON.parse(body);
  if (p.protocol === "gemini") {
    return (data.models ?? [])
      .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m: { name: string }) => m.name.replace(/^models\//, ""));
  }
  const ids: string[] = (data.data ?? data.models ?? []).map((m: { id?: string; name?: string }) => m.id ?? m.name).filter(Boolean);
  return [...new Set(ids)].sort();
}

export type TestResult = { ok: true; message: string; models?: string[] } | { ok: false; message: string; detail?: string };

/** Checks the key: model listing first, a one-word reply as fallback for services without /models. */
export async function testProvider(p: Provider): Promise<TestResult> {
  try {
    const models = await listModels(p);
    return { ok: true, message: `连接成功，可用 ${models.length} 个模型`, models };
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 0;
    if (status === 401 || status === 403 || p.models.length === 0) return { ok: false, ...describeError(e) };
  }
  try {
    const started = performance.now();
    await generateText({ model: languageModel(p, p.models[0]), prompt: "hi", maxOutputTokens: 16, maxRetries: 0 });
    return { ok: true, message: `连接成功，${p.models[0]} 用时 ${((performance.now() - started) / 1000).toFixed(1)} 秒` };
  } catch (e) {
    return { ok: false, ...describeError(e) };
  }
}

function bodyMessage(body?: string) {
  if (!body) return "";
  try {
    const j = JSON.parse(body);
    const m = j.error?.message ?? j.message ?? j.error ?? j.detail;
    if (typeof m === "string") return m;
  } catch {
    /* not JSON */
  }
  return body.slice(0, 300);
}

/** Turns any failure into one short line for the UI plus raw detail for developer mode. */
export function describeError(e: unknown): { message: string; detail?: string } {
  let err = e;
  if (RetryError.isInstance(err)) err = err.lastError;
  let status = 0;
  let body = "";
  if (APICallError.isInstance(err)) {
    status = err.statusCode ?? 0;
    body = err.responseBody ?? "";
  } else if (err instanceof HttpError) {
    status = err.status;
    body = err.body;
  }
  const raw = bodyMessage(body);
  const detail = [status ? `HTTP ${status}` : "", raw || (err as Error)?.message].filter(Boolean).join(" · ");

  if ((err as Error)?.name === "AbortError") return { message: "已停止" };
  // The trial and site search endpoints already word their errors for the user.
  if (/^(体验|联网搜索|本站)/.test(raw)) return { message: raw, detail };
  if (status === 401 || status === 403 || /api.?key.{0,20}(invalid|not valid)/i.test(raw)) return { message: "API Key 无效或没有权限", detail };
  if (status === 404) return { message: "找不到这个模型或接口地址", detail };
  if (status === 429) return { message: "请求太频繁，或账户额度不足", detail };
  if (status === 502 && raw.startsWith("upstream unreachable")) return { message: "连不上服务，检查 Base URL 或网络", detail };
  if (status >= 500) return { message: `服务暂时不可用（${status}）`, detail };
  if (status >= 400) return { message: raw ? `请求被拒绝：${raw}` : `请求被拒绝（${status}）`, detail };
  if (err instanceof TypeError) return { message: "连不上服务，检查 Base URL 或网络", detail };
  return { message: (err as Error)?.message || "出错了", detail };
}

interface CallOptions {
  provider: Provider;
  modelId: string;
  system: string;
  messages: ModelMessage[];
  params: ModelParams;
  signal: AbortSignal;
  /** Tools the model may call; calls run in a loop until it answers or `maxSteps` is reached. */
  tools?: ToolSet;
  maxSteps?: number;
  /** Use the service's own web search (see `nativeSearch`). */
  search?: boolean;
  /** Web pages the model cited, for services that report them (Gemini). */
  onSources?: (sources: Source[]) => void;
}

function citedPages(sources: { sourceType: string; url?: string; title?: string }[]): Source[] {
  const seen = new Set<string>();
  return sources.flatMap((s) => {
    if (s.sourceType !== "url" || !s.url || seen.has(s.url)) return [];
    seen.add(s.url);
    let site: string | undefined;
    try {
      site = new URL(s.url).hostname.replace(/^www\./, "");
    } catch {
      /* keep it without a site */
    }
    return [{ url: s.url, title: s.title || site || s.url, site }];
  });
}

export interface StreamResult {
  input: number;
  output: number;
  seconds: number;
}

// Models that rejected tool definitions this session; they are called without tools from then on.
const noTools = new Set<string>();
const NO_TOOLS_NOTE =
  "\n\n（当前模型不支持工具：不能联网搜索、不能调用 make_file，也不能把任务派到群里。用户需要这些时，如实告诉用户；要文件时把内容直接写在回复里，用户可以把回复下载为 Word。）";

/** A 400-class rejection that mentions tools or functions means the model cannot take tool definitions. */
function rejectsTools(e: unknown) {
  let err = e;
  if (RetryError.isInstance(err)) err = err.lastError;
  if (!APICallError.isInstance(err)) return false;
  const status = err.statusCode ?? 0;
  return status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 429 && /tool|function/i.test(err.responseBody ?? err.message);
}

function settings(opts: CallOptions, withTools: boolean) {
  const { provider, params } = opts;
  return {
    model: languageModel(provider, opts.modelId, opts.search),
    system: withTools ? opts.system : opts.tools ? opts.system + NO_TOOLS_NOTE : opts.system,
    messages: opts.messages,
    temperature: provider.protocol === "anthropic" ? Math.min(params.temperature, 1) : params.temperature,
    topP: params.topP < 1 ? params.topP : undefined,
    maxOutputTokens: params.maxTokens,
    abortSignal: opts.signal,
    maxRetries: 1,
    ...(withTools && opts.tools ? { tools: opts.tools, stopWhen: isStepCount(opts.maxSteps ?? 6) } : {}),
  };
}

/** Runs `call` with tools, and once more without them if the model turns tool definitions down. */
async function withToolFallback<T>(opts: CallOptions, call: (withTools: boolean) => Promise<T>, produced: () => boolean): Promise<T> {
  const key = `${opts.provider.id}/${opts.modelId}`;
  const useTools = !!opts.tools && !noTools.has(key);
  try {
    return await call(useTools);
  } catch (e) {
    if (!useTools || produced() || opts.signal.aborted || !rejectsTools(e)) throw e;
    noTools.add(key);
    return call(false);
  }
}

const seconds = (started: number) => Math.round((performance.now() - started) / 100) / 10;

/** One-shot call for structured steps (planning, review) where streaming adds nothing. */
export async function completeText(opts: CallOptions): Promise<StreamResult & { text: string; reasoning: string }> {
  const started = performance.now();
  const r = await withToolFallback(opts, (withTools) => generateText(settings(opts, withTools)), () => false);
  const pages = citedPages(r.sources);
  if (pages.length) opts.onSources?.(pages);
  return {
    text: r.text,
    reasoning: r.reasoningText ?? "",
    input: r.totalUsage.inputTokens ?? 0,
    output: r.totalUsage.outputTokens ?? 0,
    seconds: seconds(started),
  };
}

export async function streamReply(
  opts: CallOptions & {
    onText: (delta: string) => void;
    onReasoning: (delta: string) => void;
  },
): Promise<StreamResult> {
  const started = performance.now();
  let produced = false;
  const run = async (withTools: boolean) => {
    const result = streamText(settings(opts, withTools));
    // Text before and after a tool call arrives as separate steps; keep them apart.
    let stepHadText = false;
    let gap = false;
    for await (const part of result.stream) {
      if (part.type === "text-delta") {
        if (!part.text) continue;
        opts.onText(gap ? `\n\n${part.text}` : part.text);
        gap = false;
        stepHadText = produced = true;
      } else if (part.type === "reasoning-delta") {
        opts.onReasoning(part.text);
        produced = true;
      } else if (part.type === "finish-step") {
        gap = gap || stepHadText;
        stepHadText = false;
      } else if (part.type === "tool-call") produced = true;
      else if (part.type === "error") throw part.error;
      else if (part.type === "abort") break;
    }
    if (opts.signal.aborted) throw new DOMException("stopped", "AbortError");
    const pages = citedPages(await result.sources);
    if (pages.length) opts.onSources?.(pages);
    return result.totalUsage;
  };
  const usage = await withToolFallback(opts, run, () => produced);
  return { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0, seconds: seconds(started) };
}
