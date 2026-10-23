import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, RetryError, generateText, streamText, type ModelMessage } from "ai";
import { useData } from "../store";
import type { ModelParams, Provider } from "../types";

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

const trimSlash = (s: string) => s.trim().replace(/\/+$/, "");
/** The SDKs need absolute URLs; this site's own API is stored as a path. */
const absolute = (s: string) => (s.startsWith("/") ? new URL(s, location.origin).href : s);

export function languageModel(p: Provider, modelId: string) {
  const fetch = fetchFor(p);
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
  // The trial endpoint already words its errors for the user.
  if (raw.startsWith("体验")) return { message: raw, detail };
  if (status === 401 || status === 403 || /api.?key.{0,20}(invalid|not valid)/i.test(raw)) return { message: "API Key 无效或没有权限", detail };
  if (status === 404) return { message: "找不到这个模型或接口地址", detail };
  if (status === 429) return { message: "请求太频繁，或账户额度不足", detail };
  if (status === 502 && raw.startsWith("upstream unreachable")) return { message: "连不上服务，检查 Base URL 或网络", detail };
  if (status >= 500) return { message: `服务暂时不可用（${status}）`, detail };
  if (status >= 400) return { message: raw ? `请求被拒绝：${raw}` : `请求被拒绝（${status}）`, detail };
  if (err instanceof TypeError) return { message: "连不上服务，检查 Base URL 或网络", detail };
  return { message: (err as Error)?.message || "出错了", detail };
}

/** One-shot call for structured steps (planning) where streaming adds nothing. */
export async function completeText(opts: {
  provider: Provider;
  modelId: string;
  system: string;
  messages: ModelMessage[];
  params: ModelParams;
  signal: AbortSignal;
}): Promise<StreamResult & { text: string; reasoning: string }> {
  const { provider, params } = opts;
  const started = performance.now();
  const r = await generateText({
    model: languageModel(provider, opts.modelId),
    system: opts.system,
    messages: opts.messages,
    temperature: provider.protocol === "anthropic" ? Math.min(params.temperature, 1) : params.temperature,
    topP: params.topP < 1 ? params.topP : undefined,
    maxOutputTokens: params.maxTokens,
    abortSignal: opts.signal,
    maxRetries: 1,
  });
  return {
    text: r.text,
    reasoning: r.reasoningText ?? "",
    input: r.totalUsage.inputTokens ?? 0,
    output: r.totalUsage.outputTokens ?? 0,
    seconds: Math.round((performance.now() - started) / 100) / 10,
  };
}

export interface StreamResult {
  input: number;
  output: number;
  seconds: number;
}

export async function streamReply(opts: {
  provider: Provider;
  modelId: string;
  system: string;
  messages: ModelMessage[];
  params: ModelParams;
  signal: AbortSignal;
  onText: (delta: string) => void;
  onReasoning: (delta: string) => void;
}): Promise<StreamResult> {
  const { provider, params } = opts;
  const started = performance.now();
  const result = streamText({
    model: languageModel(provider, opts.modelId),
    system: opts.system,
    messages: opts.messages,
    temperature: provider.protocol === "anthropic" ? Math.min(params.temperature, 1) : params.temperature,
    topP: params.topP < 1 ? params.topP : undefined,
    maxOutputTokens: params.maxTokens,
    abortSignal: opts.signal,
    maxRetries: 1,
  });
  for await (const part of result.stream) {
    if (part.type === "text-delta") opts.onText(part.text);
    else if (part.type === "reasoning-delta") opts.onReasoning(part.text);
    else if (part.type === "error") throw part.error;
    else if (part.type === "abort") break;
  }
  if (opts.signal.aborted) throw new DOMException("stopped", "AbortError");
  const usage = await result.totalUsage;
  return {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    seconds: Math.round((performance.now() - started) / 100) / 10,
  };
}
