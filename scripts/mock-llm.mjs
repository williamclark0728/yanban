// Local OpenAI-compatible mock for checking the chat pipeline without a key.
// Run: node scripts/mock-llm.mjs   → base URL http://127.0.0.1:5199/v1
import { createServer } from "node:http";

const PORT = 5199;
const models = ["mock-chat", "mock-think"];
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

createServer(async (req, res) => {
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
  if (req.url === "/v1/models") {
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    return res.end(JSON.stringify({ data: models.map((id) => ({ id, object: "model" })) }));
  }
  // SearXNG-style search, so web tools can be tried with base URL http://127.0.0.1:5199
  if (req.url.startsWith("/search?")) {
    const q = new URL(req.url, "http://x").searchParams.get("q") ?? "";
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    return res.end(JSON.stringify({
      results: [1, 2, 3].map((i) => ({ title: `${q} · 结果 ${i}`, url: `https://example.com/${i}`, content: `关于「${q}」的第 ${i} 条摘要。`, publishedDate: "2026-10-2" + i })),
    }));
  }
  // Tavily-style search, for the site search endpoint (SEARCH_TAVILY_URL=http://127.0.0.1:5199/tavily/search)
  if (req.url === "/tavily/search" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const q = JSON.parse(raw).query ?? "";
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    return res.end(JSON.stringify({
      query: q,
      results: [1, 2].map((i) => ({ title: `${q} · 站内搜索 ${i}`, url: `https://example.net/${i}`, content: `「${q}」的第 ${i} 条结果。`, published_date: "2026-10-23" })),
    }));
  }
  if (req.url !== "/v1/chat/completions" || req.method !== "POST") return res.writeHead(404, cors).end();

  let body = "";
  for await (const chunk of req) body += chunk;
  const payload = JSON.parse(body);
  const msgs = payload.messages ?? [];
  const lastUser = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
  // Content is a string, or an array of text / image_url parts when images are attached.
  const last = typeof lastUser === "string" ? lastUser : lastUser.filter((p) => p.type === "text").map((p) => p.text).join("\n");
  const images = typeof lastUser === "string" ? 0 : lastUser.filter((p) => p.type === "image_url").length;
  const files = (last.match(/<附件 文件名="([^"]+)"/g) ?? []).map((m) => m.slice(9, -1));
  const system = msgs.find((m) => m.role === "system")?.content ?? "";
  const me = /你是「(.+?)」/.exec(system)?.[1] ?? "助手";
  let reply =
    `我是${me}。收到：「${last.slice(-60)}」。\n\n` +
    `- 上下文里有 ${msgs.filter((m) => m.role !== "system").length} 条消息\n` +
    `- 系统提示 ${system.length} 字\n` +
    `- 附件：${files.length ? files.join("、") : "无"}；图片 ${images} 张\n` +
    `- temperature=${payload.temperature} max_tokens=${payload.max_tokens ?? payload.max_completion_tokens}`;
  if (system.includes("你负责审查")) {
    // Reviewer: round 1 finds problems, later rounds pass; a single-agent answer ("待审查稿件") gets two problems.
    const round = Number(/第 (\d+) 轮的产出/.exec(last)?.[1] ?? 0);
    const issues =
      round === 1 || last.includes("待审查稿件")
        ? [
            { text: "「提高了 2%」应写成「提高 2.0 个百分点」", status: "holds", evidence: "experiment.md 第 3–4 行" },
            { text: "「全面优于现有方案」结论过强", status: last.includes("待审查稿件") ? "holds" : "unsure", evidence: "" },
            { text: "推理速度 1.8 倍与原文一致", status: "rejected", evidence: "表 2" },
          ]
        : [{ text: "修订后的数字与原文一致", status: "rejected", evidence: "experiment.md" }];
    const open = issues.filter((i) => i.status !== "rejected").length;
    reply = JSON.stringify({ summary: open ? `发现 ${open} 处需要处理` : "核对通过", issues });
  } else if (system.includes("只输出一个 JSON 对象")) {
    // Group lead: greetings get a direct answer; otherwise the first member produces and the rest review.
    const members = [...system.matchAll(/^- (.+?)：/gm)].map((m) => m[1]);
    const latest = [...last.matchAll(/【用户】([^\n]*)/g)].at(-1)?.[1] ?? "";
    // "自我介绍" → everyone speaks; "先搜集" → a two-step chain (the second producer waits for the first) plus a reviewer.
    reply = /你好|hi/i.test(latest)
      ? JSON.stringify({ reply: "你好！有任务直接说。", mode: "answer", assignments: [] })
      : /自我介绍/.test(latest)
      ? JSON.stringify({ reply: "请大家介绍一下自己。", mode: "speak", assignments: members.map((m) => ({ member: m, type: "produce", task: "两三句话介绍自己" })) })
      : /先搜集/.test(latest)
      ? JSON.stringify({
          reply: "先搜集再写。",
          mode: "work",
          assignments: [
            { member: members[0], type: "produce", task: "搜集资料" },
            { member: members[1], type: "produce", task: "根据资料写稿", after: members[0] },
            ...members.slice(2, 3).map((m) => ({ member: m, type: "review", task: "审查稿件" })),
          ],
        })
      : "```json\n" +
        JSON.stringify({
          reply: "收到，分工如下：",
          assignments: members.slice(0, 3).map((m, i) => ({ member: m, type: i === 0 ? "produce" : "review", task: i === 0 ? `完成「${latest.slice(0, 30)}」` : `审查${members[0]}的产出` })),
        }) +
        "\n```";
  }
  // mock-plain behaves like a model without function calling.
  if (payload.model === "mock-plain" && payload.tools?.length) {
    res.writeHead(400, { ...cors, "content-type": "application/json" });
    return res.end(JSON.stringify({ error: { message: "This model does not support tools / function calling" } }));
  }
  // Tools: "搜索" asks for web_search, "交给群" asks for dispatch_to_group; after a tool result, answer from it.
  const tools = (payload.tools ?? []).map((t) => t.function?.name);
  const lastMsg = msgs.at(-1);
  let call = null;
  if (lastMsg?.role === "tool") {
    const result = String(lastMsg.content);
    reply = result.startsWith("[1]") ? `根据搜索结果，${last.slice(0, 20)} 有三条相关信息 [1][2]，其中第三条较新 [3]。` : `群里已经完成：${result.slice(0, 80)}`;
  } else if (!system.includes("只输出一个 JSON 对象")) {
    if (tools.includes("dispatch_to_group") && /交给群|派到群/.test(last)) {
      const group = payload.tools.find((t) => t.function.name === "dispatch_to_group").function.parameters.properties.group.enum?.[0];
      call = { name: "dispatch_to_group", arguments: { group, task: last.replace(/交给群|派到群/g, "").trim() } };
    } else if (tools.includes("web_search") && /搜索/.test(last)) {
      call = { name: "web_search", arguments: { query: last.replace(/搜索/g, "").trim().slice(0, 30) || "研伴" } };
    }
  }
  if (call) {
    const toolCall = { id: `call_${Date.now()}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } };
    if (!payload.stream) {
      res.writeHead(200, { ...cors, "content-type": "application/json" });
      return res.end(JSON.stringify({
        id: "mock", object: "chat.completion", created: Date.now() / 1000 | 0, model: payload.model,
        choices: [{ index: 0, message: { role: "assistant", content: "", tool_calls: [toolCall] }, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
      }));
    }
    res.writeHead(200, { ...cors, "content-type": "text/event-stream", "cache-control": "no-cache" });
    const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: Date.now() / 1000 | 0, model: payload.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    res.write(chunk({ role: "assistant", tool_calls: [{ index: 0, ...toolCall }] }));
    res.write(chunk({}, "tool_calls"));
    return res.end("data: [DONE]\n\n");
  }
  const thinking = payload.model === "mock-think" ? "先看用户问了什么，再组织回答。" : "";

  if (!payload.stream) {
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    return res.end(JSON.stringify({
      id: "mock", object: "chat.completion", created: Date.now() / 1000 | 0, model: payload.model,
      choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    }));
  }

  res.writeHead(200, { ...cors, "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (delta, finish = null) =>
    res.write(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: Date.now() / 1000 | 0, model: payload.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  send({ role: "assistant" });
  for (const ch of thinking) {
    send({ reasoning_content: ch });
    await sleep(15);
  }
  for (const ch of reply) {
    if (res.destroyed) return;
    send({ content: ch });
    await sleep(20);
  }
  send({}, "stop");
  res.write(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: JSON.stringify(msgs).length >> 2, completion_tokens: reply.length, total_tokens: 0 } })}\n\n`);
  res.end("data: [DONE]\n\n");
}).listen(PORT, "127.0.0.1", () => console.log(`mock llm on http://127.0.0.1:${PORT}/v1`));
