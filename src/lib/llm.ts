import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, NoSuchToolError, RetryError, generateText, isStepCount, streamText, type ModelMessage, type ToolCallRepairFunction, type ToolSet } from "ai";
import { create } from "zustand";
import { useData } from "../store";
import type { Effort, ModelParams, Provider, Source } from "../types";
import { desktopFetch, isDesktop } from "./desktop";
import { recordUsage } from "./usage";

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
const hostOf = (baseUrl: string) => {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "";
  }
};
const isDashscope = (host: string) => /(^|\.)dashscope(-intl)?\.aliyuncs\.com$/.test(host);
const isZhipu = (host: string) => /(^|\.)bigmodel\.cn$/.test(host) || host === "api.z.ai";

export function nativeSearch(p: Provider, modelId: string): NativeSearch | null {
  const host = hostOf(p.baseUrl);
  if (!host) return null;
  if (p.protocol === "openai-chat") {
    // Bailian also hosts other vendors' models (DeepSeek, Kimi…); only Qwen's own take enable_search.
    if (isDashscope(host)) return /^(qwen|qwq)/i.test(modelId) ? "qwen" : null;
    if (isZhipu(host)) return "zhipu";
    if (/(^|\.)moonshot\.(cn|ai)$/.test(host)) return "kimi";
  }
  if (p.protocol === "gemini" && host === "generativelanguage.googleapis.com" && /gemini-([3-9]|\d{2})/.test(modelId)) return "gemini";
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;

/** Changes the JSON body of each request on its way out, for settings the SDK has no option for. */
function editingFetch(base: typeof fetch, edits: ((body: Body) => void)[]): typeof fetch {
  if (!edits.length) return base;
  return (input, init) => {
    if (typeof init?.body !== "string") return base(input, init);
    const body = JSON.parse(init.body);
    for (const edit of edits) edit(body);
    return base(input, { ...init, body: JSON.stringify(body) });
  };
}

/** Turns on the service's own search in the request body (Gemini's goes in as a tool instead). */
function searchEdit(kind: NativeSearch) {
  return (body: Body) => {
    if (kind === "qwen") body.enable_search = true;
    if (kind === "zhipu") body.tools = [...(body.tools ?? []), { type: "web_search", web_search: { enable: true, search_engine: "search_std", search_result: true } }];
    if (kind === "kimi") {
      body.tools = body.tools?.map((t: { function?: { name?: string } }) =>
        t.function?.name === KIMI_SEARCH ? { type: "builtin_function", function: { name: KIMI_SEARCH } } : t,
      );
    }
  };
}

const BUDGET = { low: 2048, medium: 8192, high: 16384, max: 32768 } as const;

/**
 * Thinking switches for services that take their own fields instead of `reasoning_effort`.
 * Bailian only allows thinking on streamed calls, so one-shot calls (planning, review) leave it off.
 */
function effortEdit(p: Provider, effort: Effort, streaming: boolean) {
  if (effort === "auto" || p.protocol !== "openai-chat") return null;
  const host = hostOf(p.baseUrl);
  if (isDashscope(host)) {
    return (body: Body) => {
      delete body.reasoning_effort;
      body.enable_thinking = streaming && effort !== "off";
      if (body.enable_thinking) body.thinking_budget = BUDGET[effort as keyof typeof BUDGET];
    };
  }
  if (isZhipu(host)) {
    return (body: Body) => {
      delete body.reasoning_effort;
      body.thinking = { type: effort === "off" ? "disabled" : "enabled" };
    };
  }
  return null;
}

/** The SDK's own reasoning setting, which each provider turns into its service's parameter. */
function reasoning(p: Provider, effort: Effort) {
  if (effort === "auto") return undefined;
  // OpenAI-style services mostly know low / medium / high only, and many reject "none".
  if (p.protocol === "openai-chat") return effort === "off" ? undefined : effort === "max" ? ("high" as const) : effort;
  if (effort === "off") return "none" as const;
  return effort;
}

/** Shown on a reply while its request waits: in the service's queue, or after being turned away for going too fast. */
export type Wait = (note: string | null) => void;

/** Wait notes by message id, for the reply bubble. */
export const useWaits = create<Record<string, string>>(() => ({}));

export const showWait =
  (id: string): Wait =>
  (note) =>
    useWaits.setState((s) => {
      if (note) return s[id] === note ? s : { ...s, [id]: note };
      if (!(id in s)) return s;
      const rest = { ...s };
      delete rest[id];
      return rest;
    }, true);

/**
 * Requests a service may have open at once; 0 means no limit.
 * The 书生 API turns away a second request while one runs, so it gets 1 unless set otherwise.
 */
export function concurrencyOf(p: Pick<Provider, "maxConcurrent" | "baseUrl">) {
  return p.maxConcurrent ?? (/(^|\.)intern-ai\.org\.cn$/.test(hostOf(p.baseUrl)) ? 1 : 0);
}

const stopped = () => new DOMException("stopped", "AbortError");

function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(stopped());
    const stop = () => {
      clearTimeout(timer);
      reject(stopped());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal?.addEventListener("abort", stop, { once: true });
  });
}

interface Lane {
  active: number;
  queue: { go: () => void; show: (place: number) => void }[];
}
const lanes = new Map<string, Lane>();

/**
 * Waits for one of the service's slots and returns the function that frees it (calling it twice is harmless).
 * A freed slot passes straight to the next request in line, so a new request can't jump the queue.
 */
async function takeSlot(p: Provider, signal: AbortSignal | undefined, onWait?: Wait): Promise<() => void> {
  const limit = concurrencyOf(p);
  if (!limit) return () => {};
  let lane = lanes.get(p.id);
  if (!lane) lanes.set(p.id, (lane = { active: 0, queue: [] }));
  const l = lane;
  const renumber = () => l.queue.forEach((q, i) => q.show(i + 1));
  if (l.active < limit) l.active++;
  else {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(stopped());
      const leave = () => {
        l.queue.splice(l.queue.indexOf(entry), 1);
        renumber();
        reject(stopped());
      };
      const entry = {
        go: () => {
          signal?.removeEventListener("abort", leave);
          resolve();
        },
        show: (place: number) => onWait?.(`排队中，前面还有 ${place} 个请求（${p.name}同时只处理 ${limit} 个）`),
      };
      signal?.addEventListener("abort", leave, { once: true });
      l.queue.push(entry);
      entry.show(l.queue.length);
    });
    onWait?.(null);
  }
  let freed = false;
  return () => {
    if (freed) return;
    freed = true;
    const next = l.queue.shift();
    if (next) {
      next.go();
      renumber();
    } else l.active--;
  };
}

/** Keeps the slot until the response has been read to the end (a streamed reply holds it while it streams). */
function holdUntilRead(res: Response, release: () => void, signal?: AbortSignal): Response {
  if (!res.body) {
    release();
    return res;
  }
  const reader = res.body.getReader();
  signal?.addEventListener("abort", release, { once: true });
  const body = new ReadableStream<Uint8Array>({
    async pull(c) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          release();
          c.close();
        } else c.enqueue(value);
      } catch (e) {
        release();
        c.error(e);
      }
    },
    cancel(reason) {
      release();
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/** Seconds to wait between tries after being turned away for going too fast. */
const BACKOFF = [2, 4, 8, 16, 30];
const TOO_FAST = /rate.?limit|too many requests|频繁|频率|限流|并发/i;
const NO_CREDIT = /insufficient|balance|billing|余额|欠费|额度不足|额度已用|arrear|exceeded your current quota/i;

/** Too fast, as opposed to out of credit (waiting won't help) or this site's trial running out. */
function tooFast(status: number, body: string) {
  if (NO_CREDIT.test(body) || /^(体验|本站)/.test(bodyMessage(body))) return false;
  return status === 429 || status === 503 || status === 529 || TOO_FAST.test(body);
}

/** How long the service asked us to wait, from the headers or (Gemini) the error body. */
function askedWait(res: Response, body: string): number | null {
  const ms = Number(res.headers.get("retry-after-ms"));
  if (ms > 0) return ms;
  const after = res.headers.get("retry-after");
  if (after) {
    const s = Number(after);
    if (!Number.isNaN(s)) return s * 1000;
    const at = Date.parse(after);
    if (!Number.isNaN(at)) return at - Date.now();
  }
  const delay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  return delay ? Number(delay[1]) * 1000 : null;
}

/**
 * Every model request goes through here: it waits for a free slot with the service, and when the service
 * says it's going too fast, waits (as long as the service asks, else 2 → 4 → 8 → 16 → 30 s) and tries again.
 * Each step of a tool loop is its own request, so a step after the reply began can wait and retry too.
 */
function pacedFetch(base: typeof fetch, p: Provider, onWait?: Wait): typeof fetch {
  return async (input, init) => {
    const signal = init?.signal ?? undefined;
    let release = () => {};
    try {
      release = await takeSlot(p, signal, onWait);
      for (let tries = 0; ; tries++) {
        let res: Response;
        try {
          res = await base(input, init);
        } catch (e) {
          // A dropped connection gets one more go, as the SDK's own retry gave it.
          if (signal?.aborted || tries > 0 || !(e instanceof TypeError)) throw e;
          await pause(1500, signal);
          continue;
        }
        if (res.ok) return holdUntilRead(res, release, signal);
        const body = await res.text();
        if (tooFast(res.status, body) && tries < BACKOFF.length) {
          const asked = askedWait(res, body);
          const ms = Math.min(Math.max(asked ?? BACKOFF[tries] * 1000, 1000), 60_000) + Math.random() * 500;
          const end = Date.now() + ms;
          for (let left = ms; left > 0; left = end - Date.now()) {
            onWait?.(`被限速，${Math.ceil(left / 1000)} 秒后自动重试（第 ${tries + 1} 次，最多 ${BACKOFF.length} 次）`);
            await pause(Math.min(left, 1000), signal);
          }
          onWait?.(null);
          continue;
        }
        if (res.status >= 500 && tries === 0 && !tooFast(res.status, body)) {
          await pause(1500, signal);
          continue;
        }
        release();
        return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
      }
    } catch (e) {
      release();
      throw e;
    } finally {
      onWait?.(null);
    }
  };
}

export function languageModel(p: Provider, modelId: string, search = false, effort: Effort = "auto", streaming = true, onWait?: Wait) {
  const kind = search ? nativeSearch(p, modelId) : null;
  const edits = [kind && kind !== "gemini" ? searchEdit(kind) : null, effortEdit(p, effort, streaming)].filter((e) => !!e);
  const fetch = editingFetch(pacedFetch(fetchFor(p), p, onWait), edits);
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
  if (status === 429) {
    if (NO_CREDIT.test(body)) return { message: "账户余额或额度不足", detail };
    return { message: "请求太频繁：自动等待重试几次后仍被限速。过一会再试，或在服务设置里把「同时请求数」调小", detail };
  }
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
  /** Messages the user sent while this reply runs; the model reads them before its next step. */
  steer?: () => string[];
  /** A tool call that failed before its tool ran (unreadable arguments, unknown tool), so it can be shown as a step. */
  onToolError?: (call: { id: string; name: string; message: string }) => void;
  /** Queue and rate-limit waits, to show on the reply (see `showWait`). */
  onWait?: Wait;
}

/**
 * Almost-JSON from a model: code fences, trailing commas, Windows paths with single backslashes.
 * Returns valid JSON text, or null when it still can't be read.
 */
export function repairJson(text: string): string | null {
  const s = text
    .trim()
    .replace(/^```(?:json)?\s*|\s*```$/g, "")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/\\(["\\/bfnrtu])|\\/g, (whole, valid?: string) => (valid ? whole : "\\\\"));
  try {
    JSON.parse(s);
    return s;
  } catch {
    return null;
  }
}

/** Tool arguments that aren't valid JSON get one repair attempt before the call counts as failed. */
const repairToolCall: ToolCallRepairFunction<ToolSet> = async ({ toolCall, error }) => {
  if (NoSuchToolError.isInstance(error)) return null;
  const fixed = repairJson(toolCall.input);
  return fixed && fixed !== toolCall.input ? { ...toolCall, input: fixed } : null;
};

/** Tool steps one reply may take. Work-mode tasks (read a skill, look around, write files) need many. */
export const MAX_STEPS = 60;

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

function settings(opts: CallOptions, withTools: boolean, streaming: boolean) {
  const { provider, params } = opts;
  const effort = params.effort ?? "auto";
  // Claude only thinks at its default sampling settings.
  const thinkingClaude = provider.protocol === "anthropic" && effort !== "auto" && effort !== "off";
  return {
    model: languageModel(provider, opts.modelId, opts.search, effort, streaming, opts.onWait),
    system: withTools ? opts.system : opts.tools ? opts.system + NO_TOOLS_NOTE : opts.system,
    messages: opts.messages,
    temperature: thinkingClaude ? undefined : provider.protocol === "anthropic" ? Math.min(params.temperature, 1) : params.temperature,
    topP: params.topP < 1 && !thinkingClaude ? params.topP : undefined,
    maxOutputTokens: params.maxTokens > 0 ? params.maxTokens : undefined,
    reasoning: reasoning(provider, effort),
    abortSignal: opts.signal,
    // pacedFetch does the retrying; letting the SDK retry too would start the waits over.
    maxRetries: 0,
    ...(withTools && opts.tools ? { tools: opts.tools, stopWhen: isStepCount(opts.maxSteps ?? MAX_STEPS), repairToolCall } : {}),
    // Added messages carry forward to the later steps of the reply.
    ...(withTools && opts.tools && opts.steer
      ? {
          prepareStep: ({ messages }: { messages: ModelMessage[] }) => {
            const added = opts.steer!();
            return added.length ? { messages: [...messages, ...added.map((text) => ({ role: "user" as const, content: text }))] } : {};
          },
        }
      : {}),
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
  const r = await withToolFallback(opts, (withTools) => generateText(settings(opts, withTools, false)), () => false);
  const pages = citedPages(r.sources);
  if (pages.length) opts.onSources?.(pages);
  recordUsage(opts.modelId, r.totalUsage.inputTokens ?? 0, r.totalUsage.outputTokens ?? 0);
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
    const result = streamText(settings(opts, withTools, true));
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
      else if (part.type === "tool-error") {
        const message = part.error instanceof Error ? part.error.message : String(part.error);
        opts.onToolError?.({ id: part.toolCallId, name: part.toolName, message });
      } else if (part.type === "error") throw part.error;
      else if (part.type === "abort") break;
    }
    if (opts.signal.aborted) throw new DOMException("stopped", "AbortError");
    const pages = citedPages(await result.sources);
    if (pages.length) opts.onSources?.(pages);
    return result.totalUsage;
  };
  const usage = await withToolFallback(opts, run, () => produced);
  recordUsage(opts.modelId, usage.inputTokens ?? 0, usage.outputTokens ?? 0);
  return { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0, seconds: seconds(started) };
}
