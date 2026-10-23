/**
 * Trial model: lets new visitors chat before connecting their own provider.
 * Speaks the OpenAI Chat Completions format so the app treats it like any other service.
 * Backends, tried in order: an OpenAI-compatible service whose key lives only in a server
 * secret (Zhipu GLM-4.7-Flash by default), then Cloudflare Workers AI through a binding.
 * Each visitor gets a daily number of requests, counted in D1 under a hashed IP.
 */

import { fromOtherSite, json } from "./handler";

export interface TrialEnv {
  AI?: { run: (model: string, input: Record<string, unknown>) => Promise<unknown> };
  DB?: D1;
  TRIAL_API_KEY?: string;
  TRIAL_BASE_URL?: string;
  TRIAL_MODEL?: string;
  TRIAL_AI_MODEL?: string;
  TRIAL_DAILY?: string;
}

/** The slice of Cloudflare D1 used here. */
export interface D1 {
  prepare: (sql: string) => { bind: (...values: unknown[]) => { first: <T>() => Promise<T | null>; run: () => Promise<unknown> }; run: () => Promise<unknown> };
}

export interface Limiter {
  used: (visitor: string, day: string) => Promise<number>;
  /** Counts one request and returns the new total. */
  take: (visitor: string, day: string) => Promise<number>;
  refund: (visitor: string, day: string) => Promise<void>;
}

const ZHIPU = "https://open.bigmodel.cn/api/paas/v4";
const AI_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";
const MAX_BODY = 256 * 1024;
const MAX_CHARS = 48_000;
const MAX_OUTPUT = 4096;

const QUOTA = "体验次数今天用完了，明天再来，或在设置里连接自己的模型服务";
const UNAVAILABLE = "体验模型暂时不可用，稍后再试，或在设置里连接自己的模型服务";

type Backend = { kind: "openai"; baseUrl: string; apiKey: string; model: string } | { kind: "ai"; model: string };

function backends(env: TrialEnv): Backend[] {
  const list: Backend[] = [];
  if (env.TRIAL_API_KEY) {
    list.push({
      kind: "openai",
      baseUrl: (env.TRIAL_BASE_URL || ZHIPU).replace(/\/+$/, ""),
      apiKey: env.TRIAL_API_KEY,
      model: env.TRIAL_MODEL || "glm-4.7-flash",
    });
  }
  if (env.AI) list.push({ kind: "ai", model: env.TRIAL_AI_MODEL || AI_MODEL });
  return list;
}

const label = (b: Backend) => b.model.split("/").pop()!;

/** Days roll over at midnight China time. */
export const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

/** `purpose` keeps the trial and search counts apart in the same table. */
export async function hashVisitor(ip: string, day: string, purpose = "trial") {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`yanban-${purpose}|${day}|${ip}`));
  return [...new Uint8Array(bytes).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let tableReady = false;

export function d1Limiter(db: D1): Limiter {
  const ensure = async () => {
    if (tableReady) return;
    await db.prepare("CREATE TABLE IF NOT EXISTS trial_usage (day TEXT NOT NULL, visitor TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (day, visitor))").run();
    tableReady = true;
  };
  return {
    used: async (visitor, day) => {
      await ensure();
      const row = await db.prepare("SELECT count FROM trial_usage WHERE day = ?1 AND visitor = ?2").bind(day, visitor).first<{ count: number }>();
      return row?.count ?? 0;
    },
    take: async (visitor, day) => {
      await ensure();
      // Old days are cleared now and then; the table only ever needs today's rows.
      if (Math.random() < 0.02) await db.prepare("DELETE FROM trial_usage WHERE day < ?1").bind(day).run();
      const row = await db
        .prepare("INSERT INTO trial_usage (day, visitor, count) VALUES (?1, ?2, 1) ON CONFLICT (day, visitor) DO UPDATE SET count = count + 1 RETURNING count")
        .bind(day, visitor)
        .first<{ count: number }>();
      return row?.count ?? 1;
    },
    refund: async (visitor, day) => {
      await db.prepare("UPDATE trial_usage SET count = MAX(count - 1, 0) WHERE day = ?1 AND visitor = ?2").bind(day, visitor).run();
    },
  };
}

/** For the dev server, where there is no D1. */
export function memoryLimiter(): Limiter {
  const counts = new Map<string, number>();
  const key = (v: string, d: string) => `${d}|${v}`;
  return {
    used: async (v, d) => counts.get(key(v, d)) ?? 0,
    take: async (v, d) => {
      const n = (counts.get(key(v, d)) ?? 0) + 1;
      counts.set(key(v, d), n);
      return n;
    },
    refund: async (v, d) => void counts.set(key(v, d), Math.max((counts.get(key(v, d)) ?? 1) - 1, 0)),
  };
}

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_calls?: ToolCall[]; tool_call_id?: string };

/**
 * Keeps text turns and tool turns; image parts become a placeholder since the trial models read text only.
 * Only the fields each role needs are passed on.
 */
function cleanMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ChatMessage[] = [];
  for (const m of raw) {
    if (!m || !["system", "user", "assistant", "tool"].includes(m.role)) continue;
    let content = "";
    if (typeof m.content === "string") content = m.content;
    else if (Array.isArray(m.content)) {
      content = m.content
        .map((p: { type?: string; text?: string }) => (p?.type === "text" ? (p.text ?? "") : p?.type === "image_url" ? "[图片]" : ""))
        .filter(Boolean)
        .join("\n");
    }
    const msg: ChatMessage = { role: m.role, content };
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      msg.tool_calls = m.tool_calls.map((c: ToolCall) => ({
        id: String(c.id),
        type: "function",
        function: { name: String(c.function?.name), arguments: typeof c.function?.arguments === "string" ? c.function.arguments : JSON.stringify(c.function?.arguments ?? {}) },
      }));
    }
    if (m.role === "tool") msg.tool_call_id = String(m.tool_call_id ?? "");
    out.push(msg);
  }
  return out.length ? out : null;
}

/** Function tool definitions as the OpenAI format describes them; anything else is dropped. */
function cleanTools(raw: unknown) {
  if (!Array.isArray(raw)) return undefined;
  const tools = raw
    .filter((t) => t?.type === "function" && typeof t.function?.name === "string")
    .slice(0, 16)
    .map((t) => ({ type: "function", function: { name: t.function.name, description: String(t.function.description ?? ""), parameters: t.function.parameters ?? { type: "object" } } }));
  return tools.length ? tools : undefined;
}

const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : undefined);

export async function trial(request: Request, env: TrialEnv, ip: string, limiter: Limiter | null): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (fromOtherSite(request)) return json(403, "trial only serves this site");

  const path = new URL(request.url).pathname.replace(/^\/api\/trial/, "");
  const list = limiter ? backends(env) : [];
  const limit = Math.max(1, Number(env.TRIAL_DAILY) || 30);
  const day = today();
  const visitor = await hashVisitor(ip, day);

  if (path === "/status" && request.method === "GET") {
    if (!list.length || !limiter) return Response.json({ enabled: false });
    const used = await limiter.used(visitor, day);
    return Response.json({ enabled: true, model: label(list[0]), limit, remaining: Math.max(limit - used, 0) });
  }

  if (path !== "/v1/chat/completions" || request.method !== "POST") return json(404, "not found");
  if (!list.length || !limiter) return json(503, UNAVAILABLE);

  const text = await request.text();
  if (text.length > MAX_BODY) return json(413, "体验模型一次最多处理约 4 万字，内容太长了");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, "invalid json");
  }
  const messages = cleanMessages(body.messages);
  if (!messages) return json(400, "messages is required");
  if (messages.reduce((n, m) => n + m.content.length, 0) > MAX_CHARS) return json(413, "体验模型一次最多处理约 4 万字，内容太长了");

  const count = await limiter.take(visitor, day);
  if (count > limit) {
    await limiter.refund(visitor, day);
    return json(429, QUOTA);
  }
  const remaining = String(limit - count);

  const tools = cleanTools(body.tools);
  const input: Input = {
    messages,
    stream: body.stream === true,
    max_tokens: num(body.max_tokens, 1, MAX_OUTPUT) ?? 2048,
    temperature: num(body.temperature, 0, 2),
    top_p: num(body.top_p, 0, 1),
    ...(tools ? { tools, tool_choice: typeof body.tool_choice === "string" ? body.tool_choice : "auto" } : {}),
  };

  for (const b of list) {
    try {
      const res = b.kind === "openai" ? await callOpenAi(b, input, request.signal) : await callWorkersAi(b, env.AI!, input);
      if (res && !res.ok) {
        await limiter.refund(visitor, day);
        return res;
      }
      if (res) {
        res.headers.set("x-trial-remaining", remaining);
        res.headers.set("cache-control", "no-store");
        return res;
      }
    } catch {
      /* try the next backend */
    }
  }
  await limiter.refund(visitor, day);
  return json(503, UNAVAILABLE);
}

type Input = { messages: ChatMessage[]; stream: boolean; max_tokens: number; temperature?: number; top_p?: number; tools?: unknown[]; tool_choice?: string };

/** Returns null when the service is busy or failing, so the next backend can take over. */
async function callOpenAi(b: Extract<Backend, { kind: "openai" }>, input: Input, signal: AbortSignal) {
  const payload: Record<string, unknown> = { ...input, model: b.model };
  if (input.stream) payload.stream_options = { include_usage: true };
  // GLM-4.7-Flash thinks before answering by default; the trial skips that to answer faster.
  if (b.baseUrl.includes("bigmodel.cn")) payload.thinking = { type: "disabled" };
  const res = await fetch(`${b.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${b.apiKey}` },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok || !res.body) {
    // A model that cannot take tools says so with a 400; passing that on lets the app ask again without them.
    const body = await res.text();
    if (res.status === 400 && input.tools && /tool|function/i.test(body)) return json(400, "tools are not supported by this model");
    return null;
  }
  return new Response(res.body, { status: 200, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
}

async function callWorkersAi(b: Extract<Backend, { kind: "ai" }>, ai: NonNullable<TrialEnv["AI"]>, input: Input) {
  const messages = [...input.messages];
  // Qwen3 reasons at length by default, which spends the shared daily allowance; its soft switch turns that off.
  if (/qwen3/i.test(b.model)) {
    const sys = messages.findIndex((m) => m.role === "system");
    if (sys >= 0) messages[sys] = { ...messages[sys], content: `${messages[sys].content}\n/no_think` };
    else messages.unshift({ role: "system", content: "/no_think" });
  }
  const model = label(b);
  // Streamed tool calls from Workers AI are not documented, so a turn that offers tools is fetched whole
  // and replayed as a stream when one was asked for.
  if (input.tools) {
    const completion = toOpenAiCompletion(await ai.run(b.model, { ...input, messages, stream: false }), model);
    if (!input.stream) return Response.json(completion);
    return new Response(completionToStream(completion), { headers: { "content-type": "text/event-stream; charset=utf-8" } });
  }
  const result = await ai.run(b.model, { ...input, messages });
  if (input.stream) {
    if (!(result instanceof ReadableStream)) return null;
    return new Response(toOpenAiStream(result, model), { headers: { "content-type": "text/event-stream; charset=utf-8" } });
  }
  return Response.json(toOpenAiCompletion(result, model));
}

// ---------- Workers AI output → OpenAI format ----------

/** Splits a leading <think>…</think> block out of streamed text, since some models inline their reasoning. */
function thinkSplitter() {
  let mode: "start" | "think" | "text" = "start";
  let pending = "";
  return (piece: string, end = false): { content: string; reasoning: string } => {
    pending += piece;
    let content = "";
    let reasoning = "";
    if (mode === "start") {
      const lead = pending.trimStart();
      if (!end && lead.length < 7 && "<think>".startsWith(lead)) return { content, reasoning };
      if (lead.startsWith("<think>")) {
        mode = "think";
        pending = lead.slice(7);
      } else mode = "text";
    }
    if (mode === "think") {
      const close = pending.indexOf("</think>");
      if (close >= 0) {
        reasoning = pending.slice(0, close);
        pending = pending.slice(close + 8).replace(/^\s+/, "");
        mode = "text";
      } else {
        // Hold back a possible partial closing tag.
        const keep = end ? 0 : 8;
        reasoning = pending.slice(0, Math.max(pending.length - keep, 0));
        pending = pending.slice(reasoning.length);
        return { content, reasoning: reasoning.trim() ? reasoning : "" };
      }
    }
    content = pending;
    pending = "";
    return { content, reasoning: reasoning.trim() ? reasoning : "" };
  };
}

function toOpenAiStream(source: ReadableStream<Uint8Array>, model: string) {
  const id = `trial-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const split = thinkSplitter();
  let buffer = "";
  let usage: unknown;
  // Qwen3 opens both its (disabled) reasoning and its answer with blank lines; drop them.
  let reasoningStarted = false;
  let contentStarted = false;
  const chunk = (delta: Record<string, string>, finish: string | null = null, extra: Record<string, unknown> = {}) =>
    enc.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
  const emit = (ctl: TransformStreamDefaultController<Uint8Array>, content: string, reasoningIn = "", end = false) => {
    const { content: piece, reasoning } = split(content, end);
    let thought = reasoningIn + reasoning;
    let text = piece;
    if (!reasoningStarted) thought = thought.trimStart();
    if (!contentStarted) text = text.trimStart();
    reasoningStarted ||= !!thought;
    contentStarted ||= !!text;
    const delta: Record<string, string> = {};
    if (thought) delta.reasoning_content = thought;
    if (text) delta.content = text;
    if (Object.keys(delta).length) ctl.enqueue(chunk(delta));
  };
  const handle = (line: string, ctl: TransformStreamDefaultController<Uint8Array>) => {
    const t = line.trim();
    if (!t.startsWith("data:")) return;
    const data = t.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let j: { usage?: unknown; response?: unknown; choices?: { delta?: { content?: string; reasoning_content?: string } }[] };
    try {
      j = JSON.parse(data);
    } catch {
      return;
    }
    if (j.usage) usage = j.usage;
    if (Array.isArray(j.choices)) {
      const d = j.choices[0]?.delta ?? {};
      emit(ctl, d.content ?? "", d.reasoning_content ?? "");
    } else if (typeof j.response === "string" && j.response) emit(ctl, j.response);
  };
  return source.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(bytes, ctl) {
        buffer += dec.decode(bytes, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) handle(line, ctl);
      },
      flush(ctl) {
        if (buffer) handle(buffer, ctl);
        emit(ctl, "", "", true);
        ctl.enqueue(chunk({}, "stop", usage ? { usage } : {}));
        ctl.enqueue(enc.encode("data: [DONE]\n\n"));
      },
    }),
  );
}

type RawCall = { id?: string; name?: string; arguments?: unknown; function?: { name?: string; arguments?: unknown } };

/** Tool calls arrive either OpenAI-style (`function.name`) or flat (`name`, object `arguments`). */
function toolCalls(raw?: RawCall[]): ToolCall[] {
  return (raw ?? [])
    .map((c) => {
      const name = c.function?.name ?? c.name;
      const args = c.function?.arguments ?? c.arguments ?? {};
      return name ? { id: c.id || `call_${crypto.randomUUID().slice(0, 8)}`, type: "function" as const, function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } } : null;
    })
    .filter((c): c is ToolCall => !!c);
}

type Completion = ReturnType<typeof toOpenAiCompletion>;

function toOpenAiCompletion(result: unknown, model: string) {
  const r = (result ?? {}) as {
    response?: string;
    usage?: unknown;
    tool_calls?: RawCall[];
    choices?: { message?: { content?: string | null; reasoning_content?: string; tool_calls?: RawCall[] } }[];
  };
  const raw = r.choices?.[0]?.message ?? { content: typeof r.response === "string" ? r.response : "", tool_calls: r.tool_calls };
  const split = thinkSplitter();
  const { content, reasoning } = split(raw.content ?? "", true);
  const reasoningText = [raw.reasoning_content, reasoning].filter((s) => s?.trim()).join("\n").trim();
  const calls = toolCalls(raw.tool_calls);
  return {
    id: `trial-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content.trimStart(),
          ...(reasoningText ? { reasoning_content: reasoningText } : {}),
          ...(calls.length ? { tool_calls: calls } : {}),
        },
        finish_reason: calls.length ? "tool_calls" : "stop",
      },
    ],
    ...(r.usage ? { usage: r.usage } : {}),
  };
}

/** Replays a whole completion as stream chunks. */
function completionToStream(c: Completion) {
  const enc = new TextEncoder();
  const { message, finish_reason } = c.choices[0];
  const chunk = (delta: Record<string, unknown>, finish: string | null = null, extra: Record<string, unknown> = {}) =>
    enc.encode(`data: ${JSON.stringify({ id: c.id, object: "chat.completion.chunk", created: c.created, model: c.model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
  return new ReadableStream<Uint8Array>({
    start(ctl) {
      if (message.reasoning_content) ctl.enqueue(chunk({ role: "assistant", reasoning_content: message.reasoning_content }));
      if (message.content) ctl.enqueue(chunk({ role: "assistant", content: message.content }));
      message.tool_calls?.forEach((call, index) => ctl.enqueue(chunk({ tool_calls: [{ index, ...call }] })));
      ctl.enqueue(chunk({}, finish_reason, "usage" in c ? { usage: c.usage } : {}));
      ctl.enqueue(enc.encode("data: [DONE]\n\n"));
      ctl.close();
    },
  });
}
