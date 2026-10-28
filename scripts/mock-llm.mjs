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
  // Streamable HTTP MCP server at http://127.0.0.1:5199/mcp with one tool, lookup_paper.
  // tools/list answers as JSON, tools/call as an event stream, so both response kinds get exercised.
  if (req.url === "/mcp" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const msg = JSON.parse(raw);
    const head = { ...cors, "access-control-expose-headers": "mcp-session-id", "mcp-session-id": "mock-session" };
    if (msg.id === undefined) return res.writeHead(202, head).end();
    if (msg.method !== "initialize" && req.headers["mcp-session-id"] !== "mock-session") return res.writeHead(404, head).end();
    const result =
      msg.method === "initialize"
        ? { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "mock-mcp", version: "1" } }
        : msg.method === "tools/list"
          ? { tools: [{ name: "lookup_paper", description: "按标题查论文信息", inputSchema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties: { title: { type: "string" } }, required: ["title"] } }] }
          : { content: [{ type: "text", text: `《${msg.params.arguments.title}》：2025 年发表，引用 42 次。` }] };
    if (msg.method === "tools/call") {
      res.writeHead(200, { ...head, "content-type": "text/event-stream" });
      res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: {} })}\n\n`);
      return res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n\n`);
    }
    res.writeHead(200, { ...head, "content-type": "application/json" });
    return res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
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
    `- temperature=${payload.temperature} max_tokens=${payload.max_tokens ?? payload.max_completion_tokens} reasoning_effort=${payload.reasoning_effort}`;
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
  // 0.4.0 checks: "列步骤" ticks a step list, "问我" asks the user, "重复搜索" keeps calling the same search.
  const toolCalls = msgs.filter((m) => m.role === "tool").length;
  if (/列步骤/.test(last) && tools.includes("update_todos") && toolCalls < 3) {
    const todos = ["读需求", "查资料", "写结论"].map((text, i) => ({ text, status: i < toolCalls ? "done" : i === toolCalls ? "in_progress" : "pending" }));
    call = { name: "update_todos", arguments: { todos } };
  } else if (/问我/.test(last) && tools.includes("ask_user") && lastMsg?.role !== "tool") {
    call = { name: "ask_user", arguments: { question: "报告要用中文还是英文？", options: ["中文", "英文", "中英双语"] } };
  } else if (/重复搜索/.test(last) && tools.includes("web_search") && toolCalls < 4) {
    call = { name: "web_search", arguments: { query: "同一个问题" } };
  } else if (lastMsg?.role === "tool" && /列步骤/.test(last)) {
    reply = "三步都做完了。";
  } else if (lastMsg?.role === "tool" && /重复搜索/.test(last)) {
    reply = `最后一次工具结果：${String(lastMsg.content).slice(0, 60)}`;
  } else if (lastMsg?.role === "tool" && /问我/.test(last)) {
    reply = `收到：${String(lastMsg.content)}`;
  } else if (lastMsg?.role === "tool") {
    const result = String(lastMsg.content);
    reply = result.startsWith("[1]")
      ? `根据搜索结果，${last.slice(0, 20)} 有三条相关信息 [1][2]，其中第三条较新 [3]。`
      : result.startsWith("已生成") || result.startsWith("没有生成")
        ? `${result} 文件附在下面。`
        : lastMsg.name === "use_skill" || /^[#\n]/.test(result) || result.includes("本地脚本")
          ? `已按技能说明处理（说明 ${result.length} 字）。`
          : result.startsWith("《")
            ? `查到了：${result}`
            : /^(已写入|退出码|用户没有同意|失败|内容没有变化|已安装|安装失败)/.test(result)
              ? `工作区操作结果：${result.slice(0, 120)}`
              : `群里已经完成：${result.slice(0, 80)}`;
  } else if (!system.includes("只输出一个 JSON 对象")) {
    // "生成 Word / Excel / PPT" asks for make_file with sample content.
    const kind = /生成/.test(last) && (/PPT|幻灯片/i.test(last) ? "pptx" : /Excel|表格/i.test(last) ? "xlsx" : /Word|文档/i.test(last) ? "docx" : null);
    // Desktop work mode: "写文件" / "改文件" / "运行命令" / "危险命令" call the workspace tools.
    if (/写文件/.test(last) && tools.includes("write_file")) {
      call = { name: "write_file", arguments: { path: "hello.md", content: "# 你好\n\n这是研伴写的文件。\n" } };
    } else if (/改文件/.test(last) && tools.includes("edit_file")) {
      call = { name: "edit_file", arguments: { path: "hello.md", old_text: "这是研伴写的文件。", new_text: "这一行被改过了。" } };
    } else if (/危险命令/.test(last) && tools.includes("run_command")) {
      call = { name: "run_command", arguments: { command: "Remove-Item -Recurse -Force notes" } };
    } else if (/运行命令/.test(last) && tools.includes("run_command")) {
      call = { name: "run_command", arguments: { command: "Get-ChildItem -Name" } };
    } else if (/安装技能/.test(last) && tools.includes("install_skill")) {
      call = { name: "install_skill", arguments: { content: "---\nname: 周报助手\ndescription: 把一周的实验记录整理成周报\n---\n\n# 周报助手\n\n按“本周进展 / 问题 / 下周计划”三段写。" } };
    } else if (/技能/.test(last) && tools.includes("use_skill")) {
      const name = payload.tools.find((t) => t.function.name === "use_skill").function.parameters.properties.name.enum[0];
      call = { name: "use_skill", arguments: { name } };
    } else if (/查论文/.test(last) && tools.includes("lookup_paper")) {
      call = { name: "lookup_paper", arguments: { title: "研伴" } };
    } else if (kind && tools.includes("make_file")) {
      call = {
        name: "make_file",
        arguments:
          kind === "docx"
            ? { format: "docx", name: "实验摘要", markdown: "# 实验摘要\n\n我们提出一种**稀疏压缩**方法，准确率由 71.3% 提升至 73.3%。\n\n## 主要结果\n\n1. 推理速度提升 1.8 倍\n2. 显存降低 60%\n   - 从 16 GB 降到 6.4 GB\n\n| 指标 | 基线 | 本文 |\n| --- | --- | --- |\n| Top-1 | 71.3% | 73.3% |\n| 显存 | 16 GB | 6.4 GB |\n\n> 结果只和一个基线比较。\n\n- [x] 数字已核对\n- [ ] 补充消融实验\n\n```\npython eval.py --sparsity 0.7\n```" }
            : kind === "xlsx"
              ? { format: "xlsx", name: "实验数据", sheets: [{ name: "主结果", rows: [["方法", "Top-1 (%)", "显存 (GB)", "编号"], ["基线", "71.3", "16", "007"], ["本文", "73.3", "6.4", "008"]] }, { name: "消融", rows: [["稀疏度", "速度倍数"], ["0.7", "2.9"], ["0.8", "3.4"]] }] }
              : { format: "pptx", name: "组会汇报", title: "边缘设备上的稀疏压缩", subtitle: "组会汇报 · 2026 年 10 月", slides: [{ title: "研究背景", bullets: ["边缘设备显存有限", "大模型推理慢", "需要免训练的压缩方法"], notes: "先讲为什么要做这件事。" }, { title: "实验结果", bullets: [] }, { title: "主要结果", bullets: ["准确率 71.3% → 73.3%", "速度提升 1.8 倍", "显存降低 60%", "只和一个基线比较"], notes: "强调数字都已核对。" }] },
      };
    } else if (tools.includes("dispatch_to_group") && /交给群|派到群/.test(last)) {
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
