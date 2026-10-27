// A local MCP server over stdio for testing the desktop app's 本机程序（stdio） connection.
// In 设置 → MCP, choose 本机程序 and enter: node D:\yanban\scripts\mock-mcp-stdio.mjs
import { createInterface } from "node:readline";

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
console.error("mock stdio MCP started");

createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  if (msg.method === "initialize") {
    return send({ id: msg.id, result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "mock-stdio", version: "1" } } });
  }
  if (msg.method === "tools/list") {
    return send({ id: msg.id, result: { tools: [{ name: "word_count", description: "数一段文字有多少字", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] } });
  }
  if (msg.method === "tools/call") {
    const text = String(msg.params.arguments?.text ?? "");
    return send({ id: msg.id, result: { content: [{ type: "text", text: `${text.replace(/\s/g, "").length} 字` }] } });
  }
  send({ id: msg.id, error: { code: -32601, message: `unknown method ${msg.method}` } });
});
