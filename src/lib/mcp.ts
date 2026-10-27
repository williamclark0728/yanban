// A small client for remote MCP servers over Streamable HTTP: initialize, list tools, call tools.
// Requests go through the relay like model calls (plain-http and local servers are called directly).
import { jsonSchema, tool, type ToolSet } from "ai";
import { useData } from "../store";
import type { McpServer } from "../types";
import { call as invoke, isDesktop, onEvent } from "./desktop";
import { describeError, HttpError, proxiedFetch } from "./llm";
import type { Report } from "./tools";

const PROTOCOL = "2025-06-18";

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface RpcMessage {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message?: string };
}

/** The JSON-RPC response with `id` from a server-sent event stream. */
async function fromStream(res: Response, id: number): Promise<RpcMessage | null> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return null;
    buffer += value;
    let end: number;
    while ((end = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const event = buffer.slice(0, end);
      buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, "");
      const data = event
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        const msg = JSON.parse(data) as RpcMessage;
        if (msg.id === id) {
          void reader.cancel();
          return msg;
        }
      } catch {
        /* not JSON; keep reading */
      }
    }
  }
}

interface Session {
  start(): Promise<void>;
  request(method: string, params?: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
  close?(): void;
}

const INIT = { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "yanban", version: "0.1.0" } };

class HttpSession implements Session {
  private sessionId?: string;
  private next = 1;
  constructor(private server: McpServer) {}

  private async post(body: unknown, signal?: AbortSignal) {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL,
      ...this.server.headers,
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    const res = await proxiedFetch(this.server.url, { method: "POST", headers, body: JSON.stringify(body), signal });
    this.sessionId = res.headers.get("mcp-session-id") ?? this.sessionId;
    return res;
  }

  async request(method: string, params?: unknown, signal?: AbortSignal) {
    const id = this.next++;
    const res = await this.post({ jsonrpc: "2.0", id, method, params }, signal);
    if (!res.ok) throw new HttpError(res.status, await res.text());
    const msg = (res.headers.get("content-type") ?? "").includes("text/event-stream") ? await fromStream(res, id) : ((await res.json()) as RpcMessage);
    if (!msg) throw new Error("服务没有返回结果");
    if (msg.error) throw new Error(msg.error.message || "服务返回了错误");
    return msg.result ?? {};
  }

  async start() {
    await this.request("initialize", INIT);
    const res = await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
    void res.body?.cancel();
  }
}

interface StdioLine {
  id: string;
  line: string;
}

/** Desktop only: a local server process, one JSON-RPC message per line on stdin / stdout. */
class StdioSession implements Session {
  private next = 1;
  private waiting = new Map<number, { resolve: (m: RpcMessage) => void; reject: (e: Error) => void }>();
  private log: string[] = [];
  private stops: (() => void)[] = [];
  constructor(private server: McpServer) {}

  private send = (msg: unknown) => invoke("mcp_send", { id: this.server.id, line: JSON.stringify(msg) });

  async start() {
    const mine = (f: (p: StdioLine) => void) => (p: StdioLine) => p.id === this.server.id && f(p);
    this.stops.push(
      await onEvent<StdioLine>(
        "mcp-stdout",
        mine(({ line }) => {
          try {
            const msg = JSON.parse(line) as RpcMessage;
            if (typeof msg.id === "number") this.waiting.get(msg.id)?.resolve(msg);
          } catch {
            /* a log line on stdout */
          }
        }),
      ),
      await onEvent<StdioLine>(
        "mcp-stderr",
        mine(({ line }) => {
          this.log.push(line);
          this.log.splice(0, this.log.length - 5);
        }),
      ),
      await onEvent<StdioLine>(
        "mcp-exit",
        mine(() => {
          const why = new Error(`服务进程已退出${this.log.length ? `：${this.log.join(" ")}` : ""}`);
          this.waiting.forEach((w) => w.reject(why));
          this.waiting.clear();
          sessions.delete(key(this.server));
          toolLists.delete(key(this.server));
        }),
      ),
    );
    await invoke("mcp_start", { id: this.server.id, command: this.server.command });
    // The first start may download the server (npx, uvx), so allow it longer.
    await this.request("initialize", INIT, undefined, 120_000);
    await this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  async request(method: string, params?: unknown, signal?: AbortSignal, timeout = 60_000) {
    const id = this.next++;
    const reply = new Promise<RpcMessage>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        this.waiting.delete(id);
      };
      const timer = setTimeout(() => {
        done();
        reject(new Error(`服务 ${timeout / 1000} 秒没有回应${this.log.length ? `：${this.log.join(" ")}` : ""}`));
      }, timeout);
      this.waiting.set(id, { resolve: (m) => (done(), resolve(m)), reject: (e) => (done(), reject(e)) });
      signal?.addEventListener("abort", () => this.waiting.get(id)?.reject(new DOMException("stopped", "AbortError")), { once: true });
    });
    await this.send({ jsonrpc: "2.0", id, method, params });
    const msg = await reply;
    if (msg.error) throw new Error(msg.error.message || "服务返回了错误");
    return msg.result ?? {};
  }

  close() {
    this.stops.forEach((s) => s());
    void invoke("mcp_stop", { id: this.server.id }).catch(() => {});
  }
}

const stdio = (s: McpServer) => s.transport === "stdio";

/** Servers this app can reach: stdio ones only in the desktop app. */
export const usable = (s: McpServer) => s.enabled && (stdio(s) ? isDesktop && !!s.command?.trim() : !!s.url);

// One session and one tool list per server while the page is open.
const sessions = new Map<string, Promise<Session>>();
const toolLists = new Map<string, Promise<McpTool[]>>();
const key = (s: McpServer) => `${s.id}|${s.transport ?? "http"}|${s.url}|${s.command ?? ""}|${JSON.stringify(s.headers)}`;

function session(server: McpServer, fresh = false) {
  const k = key(server);
  if (fresh) {
    sessions.get(k)?.then((s) => s.close?.(), () => {});
    sessions.delete(k);
  }
  let s = sessions.get(k);
  if (!s) {
    const created: Session = stdio(server) ? new StdioSession(server) : new HttpSession(server);
    s = created.start().then(() => created);
    s.catch(() => {
      created.close?.();
      sessions.delete(k);
    });
    sessions.set(k, s);
  }
  return s;
}

/** Runs a request; a server that forgot the session (404) gets one new session and a retry. */
async function call(server: McpServer, method: string, params?: unknown, signal?: AbortSignal) {
  try {
    return await (await session(server)).request(method, params, signal);
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 404)) throw e;
    return (await session(server, true)).request(method, params, signal);
  }
}

async function fetchTools(server: McpServer) {
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  do {
    const r = await call(server, "tools/list", cursor ? { cursor } : {});
    tools.push(...((r.tools as McpTool[]) ?? []));
    cursor = typeof r.nextCursor === "string" ? r.nextCursor : undefined;
  } while (cursor);
  return tools;
}

function listTools(server: McpServer, fresh = false) {
  const k = key(server);
  if (fresh) toolLists.delete(k);
  let list = toolLists.get(k);
  if (!list) {
    list = fetchTools(server);
    list.catch(() => toolLists.delete(k));
    toolLists.set(k, list);
  }
  return list;
}

/** Connects from scratch and returns the server's tool names, for the settings page. */
export async function testMcp(server: McpServer) {
  session(server, true);
  return (await listTools(server, true)).map((t) => t.name);
}

function resultText(r: Record<string, unknown>) {
  const parts = ((r.content as Record<string, unknown>[]) ?? []).map((c) => {
    if (c.type === "text") return String(c.text ?? "");
    if (c.type === "resource") {
      const res = c.resource as { text?: string; uri?: string } | undefined;
      return res?.text ?? res?.uri ?? "";
    }
    return `[${String(c.type)}]`;
  });
  if (!parts.length && r.structuredContent) parts.push(JSON.stringify(r.structuredContent));
  const text = parts.filter(Boolean).join("\n\n").slice(0, 20_000);
  return r.isError ? `工具出错：${text}` : text || "（没有返回内容）";
}

const toolName = (s: string) => s.replace(/[^\w-]/g, "_").slice(0, 60) || "tool";

/** Tools of every enabled server. A server that can't be reached is left out and shown as a failed step. */
export async function mcpTools(report: Report): Promise<ToolSet> {
  const servers = useData.getState().mcpServers.filter(usable);
  const set: ToolSet = {};
  await Promise.all(
    servers.map(async (server, i) => {
      let tools: McpTool[];
      try {
        tools = await listTools(server);
      } catch (e) {
        report({ id: `mcp-${server.id}`, name: "mcp", label: server.name, status: "error", detail: `连不上：${describeError(e).message}` });
        return;
      }
      for (const t of tools) {
        const name = set[toolName(t.name)] ? `${toolName(t.name)}_${i + 1}` : toolName(t.name);
        const { $schema: _, ...schema } = t.inputSchema ?? { type: "object", properties: {} };
        set[name] = tool({
          description: `${t.description ?? t.name}（来自 ${server.name}）`,
          inputSchema: jsonSchema<Record<string, unknown>>({ type: "object", properties: {}, ...schema }),
          execute: async (args, { toolCallId, abortSignal }) => {
            const base = { id: toolCallId, name: "mcp" as const, label: `${server.name} · ${t.name}` };
            report({ ...base, status: "running" });
            try {
              const text = resultText(await call(server, "tools/call", { name: t.name, arguments: args }, abortSignal));
              report({ ...base, status: text.startsWith("工具出错") ? "error" : "done", detail: `${text.length} 字` });
              return text;
            } catch (e) {
              const message = describeError(e).message;
              report({ ...base, status: "error", detail: message });
              return `调用失败：${message}`;
            }
          },
        });
      }
    }),
  );
  return set;
}
