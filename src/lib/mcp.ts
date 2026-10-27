// A small client for remote MCP servers over Streamable HTTP: initialize, list tools, call tools.
// Requests go through the relay like model calls (plain-http and local servers are called directly).
import { jsonSchema, tool, type ToolSet } from "ai";
import { useData } from "../store";
import type { McpServer } from "../types";
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

class Session {
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
    await this.request("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "yanban", version: "0.1.0" } });
    const res = await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
    void res.body?.cancel();
  }
}

// One session and one tool list per server while the page is open.
const sessions = new Map<string, Promise<Session>>();
const toolLists = new Map<string, Promise<McpTool[]>>();
const key = (s: McpServer) => `${s.id}|${s.url}|${JSON.stringify(s.headers)}`;

function session(server: McpServer, fresh = false) {
  const k = key(server);
  if (fresh) sessions.delete(k);
  let s = sessions.get(k);
  if (!s) {
    const created = new Session(server);
    s = created.start().then(() => created);
    s.catch(() => sessions.delete(k));
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
  const servers = useData.getState().mcpServers.filter((s) => s.enabled && s.url);
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
