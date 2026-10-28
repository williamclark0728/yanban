// Desktop work mode: an agent with a workspace folder can read and change files and run commands there.
// Each action goes through the approval level the user chose; dangerous commands always ask, twice.
import { jsonSchema, tool, type ToolSet } from "ai";
import { create } from "zustand";
import { resolveModel, useData, usePrefs } from "../store";
import type { Agent, LocalTool, TextMessage, ToolTrace } from "../types";
import { call, isDesktop } from "./desktop";
import { completeText } from "./llm";
import { diffLines, diffStats } from "./diff";
import type { Report } from "./tools";

export const hasWorkspace = (agent: Agent) => isDesktop && !!agent.workspace;

// ---------- approvals ----------

/** Steps waiting for the user, by trace id. The tool call resumes when the user answers. */
export const usePending = create<Record<string, (ok: boolean) => void>>(() => ({}));

export function answer(id: string, ok: boolean) {
  const resolve = usePending.getState()[id];
  if (!resolve) return;
  usePending.setState((s) => {
    const { [id]: _, ...rest } = s;
    return rest;
  }, true);
  resolve(ok);
}

const DANGER: [RegExp, string][] = [
  [/\b(rm|del|erase|rd|rmdir)\b[^|;]*\s[-/](r|rf|fr|s|q)\b/i, "递归删除文件"],
  [/Remove-Item\b[^|;]*-Recurse/i, "递归删除文件"],
  [/\bformat(-volume)?\b\s+[a-z]:?/i, "格式化磁盘"],
  [/\b(diskpart|mkfs|bcdedit|cipher\s+\/w)\b/i, "改动磁盘或启动配置"],
  [/\bgit\s+(push\s+[^|;]*(--force|-f)\b|reset\s+--hard|clean\s+-[a-z]*f)/i, "丢弃或强推 git 记录"],
  [/\b(shutdown|Restart-Computer|Stop-Computer)\b/i, "关机或重启"],
  [/\breg(\.exe)?\s+(delete|add)\b|Remove-ItemProperty|Set-ItemProperty\s+[^|;]*HK(LM|CU)/i, "改注册表"],
  [/\b(Invoke-Expression|iex)\b|\|\s*(iex|powershell|pwsh|cmd)\b/i, "执行下载或拼接出来的脚本"],
  [/Set-ExecutionPolicy|\bnetsh\b|\bsc(\.exe)?\s+(delete|config)\b|takeown|icacls/i, "改系统或权限设置"],
  [/\b(Stop-Process|taskkill)\b[^|;]*(-Force|\/f)/i, "强制结束进程"],
];

export function danger(command: string) {
  return DANGER.find(([re]) => re.test(command))?.[1];
}

const REVIEW_RULES = [
  "你是安全审查员。智能体正在用户电脑的一个工作文件夹里操作，下面是它要做的一步。判断这一步能不能不问用户直接执行：",
  "- 可以放行：在用户请求的范围内，只改工作区里和任务有关的文件，命令只是查看、编译、运行测试或脚本。",
  "- 要问用户：删除或覆盖大量内容、改和任务无关的文件、联网下载并执行、安装软件、改系统设置、看不懂在做什么。",
  '只输出一个 JSON 对象：{"safe": true 或 false, "reason": "一句话理由"}',
].join("\n");

/**
 * Smart approval: another model call decides whether a change fits the user's request.
 * Returns the reviewer's verdict, or null when it couldn't decide (then the user is asked).
 */
async function review(ask: NonNullable<ToolTrace["ask"]>, signal?: AbortSignal): Promise<{ safe: boolean; reason: string } | null> {
  const { messages, providers, defaultModel } = useData.getState();
  const target = resolveModel(undefined, providers, defaultModel);
  if (!target) return null;
  const request = messages.findLast((m): m is TextMessage => m.kind === "text" && m.sender === "me")?.text ?? "";
  const changed = (ask.diff ?? [])
    .filter((l) => l.type !== "same")
    .map((l) => `${l.type === "add" ? "+" : l.type === "del" ? "-" : "…"} ${l.text}`)
    .join("\n")
    .slice(0, 4000);
  try {
    const r = await completeText({
      provider: target.provider,
      modelId: target.modelId,
      system: REVIEW_RULES,
      messages: [{ role: "user", content: `用户最近的请求：${request.slice(0, 2000) || "（没有）"}\n\n要执行的操作：${ask.what}${changed ? `\n\n改动：\n${changed}` : ""}` }],
      params: { temperature: 0, topP: 1, maxTokens: 0, history: 0, effort: target.provider.protocol === "openai-chat" ? "off" : "auto" },
      signal: signal ?? new AbortController().signal,
    });
    const text = r.text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/gi, "");
    const data = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return { safe: data.safe === true || data.safe === "true", reason: String(data.reason ?? "").trim() };
  } catch {
    return null;
  }
}

/** Asks the user unless the approval level lets this kind of action through. */
export async function approve(report: Report, step: ToolTrace, kind: "read" | "change", ask: NonNullable<ToolTrace["ask"]>, signal?: AbortSignal) {
  const level = usePrefs.getState().approval;
  const needed = !!ask.danger || level === "ask" || (kind === "change" && level !== "full");
  if (!needed) return true;
  // Smart approval: a reviewer model lets safe changes through; dangerous commands always come to the user.
  if (level === "smart" && !ask.danger) {
    report({ ...step, status: "running", detail: "智能审批中" });
    const verdict = await review(ask, signal);
    if (signal?.aborted) return false;
    if (verdict?.safe) {
      // Callers keep reporting from this step object, so the note stays on the step.
      step.auto = verdict.reason || "在请求范围内";
      report({ ...step, status: "running", detail: undefined });
      return true;
    }
    ask = { ...ask, review: verdict ? verdict.reason || "审查认为需要你确认" : "智能审批没有给出结论" };
  }
  report({ ...step, status: "waiting", ask });
  const ok = await new Promise<boolean>((resolve) => {
    usePending.setState({ [step.id]: resolve });
    signal?.addEventListener("abort", () => answer(step.id, false), { once: true });
  });
  if (!ok) report({ ...step, status: "error", ask, detail: signal?.aborted ? "已停止" : "没有同意" });
  return ok;
}

/** Puts a changed file back the way it was. */
export async function undo(messageId: string, traceId: string) {
  const { messages, patchMessage } = useData.getState();
  const msg = messages.find((m) => m.id === messageId);
  if (!msg || msg.kind === "round") return;
  const trace = msg.tools?.find((t) => t.id === traceId);
  if (!trace?.undo || trace.undo.undone) return;
  const { root, path, before } = trace.undo;
  if (before === null) await call("ws_delete", { root, path });
  else await call("ws_write", { root, path, content: before });
  patchMessage(messageId, { tools: msg.tools!.map((t) => (t.id === traceId ? { ...t, undo: { ...trace.undo!, undone: true }, detail: "已撤销" } : t)) }, true);
}

/** Undoes every file change of a reply, newest first, so a file changed twice ends up as it was. */
export async function undoAll(messageId: string) {
  const msg = useData.getState().messages.find((m) => m.id === messageId);
  if (!msg || msg.kind === "round") return;
  const changes = (msg.tools ?? []).filter((t) => t.undo && !t.undo.undone).reverse();
  for (const t of changes) await undo(messageId, t.id);
}

// ---------- prompt ----------

/** Work-mode rules plus the workspace's AGENTS.md, which serves as the agent's memory for that folder. */
export async function workRules(agent: Agent) {
  if (!hasWorkspace(agent)) return "";
  const root = agent.workspace!;
  let notes = "";
  try {
    notes = (await call<string | null>("ws_peek", { root, path: "AGENTS.md" })) ?? "";
  } catch {
    /* no readable AGENTS.md */
  }
  return [
    `你在工作模式，工作区是 ${root}，路径都相对这个文件夹。`,
    "list_dir 看目录，read_file 读文件，search_files 按正则搜内容；write_file 新建或整体重写文件，edit_file 替换文件里的一段；run_command 在工作区运行一条 PowerShell 命令。",
    "改文件前先读；小改动用 edit_file。修改和命令要用户同意，被拒绝时换个做法或问用户。完成后简单说明改了哪些文件、命令结果如何。",
    notes && `\n工作区的 AGENTS.md（这个项目的约定，照着做）：\n${notes.slice(0, 20_000)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------- tools ----------

const numbered = (text: string, from: number) =>
  text
    .split(/\r?\n/)
    .map((l, i) => `${from + i}\t${l}`)
    .join("\n");

interface Hit {
  path: string;
  line: number;
  text: string;
}

interface Output {
  code: number | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
}

export function workTools(agent: Agent, report: Report): ToolSet {
  if (!hasWorkspace(agent)) return {};
  const root = agent.workspace!;
  const step = (id: string, name: LocalTool, label: string): ToolTrace => ({ id, name, label, status: "running", root });
  const fail = (s: ToolTrace, e: unknown) => {
    const message = (e as Error).message;
    report({ ...s, status: "error", detail: message });
    return `失败：${message}`;
  };

  return {
    list_dir: tool({
      description: "列出工作区里一个文件夹的内容。",
      inputSchema: jsonSchema<{ path?: string }>({ type: "object", properties: { path: { type: "string", description: "相对工作区的路径，默认是根目录" } } }),
      execute: async ({ path = "." }, { toolCallId, abortSignal }) => {
        const s = step(toolCallId, "list_dir", path);
        if (!(await approve(report, s, "read", { what: `查看文件夹 ${path}` }, abortSignal))) return "用户没有同意。";
        try {
          const entries = await call<{ name: string; dir: boolean; size: number }[]>("ws_list", { root, path });
          report({ ...s, status: "done", detail: `${entries.length} 项` });
          return entries.map((e) => (e.dir ? `${e.name}/` : `${e.name}  (${e.size} 字节)`)).join("\n") || "（空文件夹）";
        } catch (e) {
          return fail(s, e);
        }
      },
    }),

    read_file: tool({
      description: "读取工作区里的一个文本文件，返回带行号的内容。",
      inputSchema: jsonSchema<{ path: string; start?: number; end?: number }>({
        type: "object",
        properties: {
          path: { type: "string" },
          start: { type: "number", description: "起始行（从 1 开始），可省略" },
          end: { type: "number", description: "结束行，可省略" },
        },
        required: ["path"],
      }),
      execute: async ({ path, start, end }, { toolCallId, abortSignal }) => {
        const s = step(toolCallId, "read_file", path);
        if (!(await approve(report, s, "read", { what: `读取 ${path}` }, abortSignal))) return "用户没有同意。";
        try {
          const lines = (await call<string>("ws_read", { root, path })).split(/\r?\n/);
          const from = Math.max(1, Math.floor(start ?? 1));
          const to = Math.min(lines.length, Math.floor(end ?? from + 1999));
          report({ ...s, status: "done", detail: `第 ${from}–${to} 行，共 ${lines.length} 行` });
          const more = to < lines.length ? `\n（还有 ${lines.length - to} 行，用 start 继续读）` : "";
          return numbered(lines.slice(from - 1, to).join("\n"), from) + more;
        } catch (e) {
          return fail(s, e);
        }
      },
    }),

    search_files: tool({
      description: "在工作区里按正则表达式搜索文件内容（跳过 .gitignore 忽略的文件），返回 文件:行号: 内容。",
      inputSchema: jsonSchema<{ pattern: string; path?: string; glob?: string }>({
        type: "object",
        properties: {
          pattern: { type: "string", description: "正则表达式，忽略大小写用 (?i) 开头" },
          path: { type: "string", description: "只搜这个子文件夹，可省略" },
          glob: { type: "string", description: "只搜匹配的文件，比如 *.ts，可省略" },
        },
        required: ["pattern"],
      }),
      execute: async ({ pattern, path, glob }, { toolCallId, abortSignal }) => {
        const s = step(toolCallId, "search_files", pattern);
        if (!(await approve(report, s, "read", { what: `搜索「${pattern}」` }, abortSignal))) return "用户没有同意。";
        try {
          const hits = await call<Hit[]>("ws_search", { root, pattern, path, glob });
          report({ ...s, status: "done", detail: `${hits.length} 处${hits.length >= 200 ? "（只列前 200 处）" : ""}` });
          return hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join("\n") || "没有找到。";
        } catch (e) {
          return fail(s, e);
        }
      },
    }),

    write_file: tool({
      description: "新建文件或整体重写一个文件。",
      inputSchema: jsonSchema<{ path: string; content: string }>({
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string", description: "文件的完整新内容" } },
        required: ["path", "content"],
      }),
      execute: async ({ path, content }, { toolCallId, abortSignal }) => {
        const s = step(toolCallId, "write_file", path);
        try {
          const before = await call<string | null>("ws_peek", { root, path });
          return await change(s, path, before, content, abortSignal);
        } catch (e) {
          return fail(s, e);
        }
      },
    }),

    edit_file: tool({
      description: "把文件里的一段文字替换成新文字。old_text 必须和文件内容完全一致，并且只出现一次。",
      inputSchema: jsonSchema<{ path: string; old_text: string; new_text: string }>({
        type: "object",
        properties: {
          path: { type: "string" },
          old_text: { type: "string", description: "要替换的原文，带足够的上下文保证唯一" },
          new_text: { type: "string", description: "替换后的文字" },
        },
        required: ["path", "old_text", "new_text"],
      }),
      execute: async ({ path, old_text, new_text }, { toolCallId, abortSignal }) => {
        const s = step(toolCallId, "edit_file", path);
        try {
          const before = await call<string | null>("ws_peek", { root, path });
          if (before === null) return fail(s, new Error(`${path} 不存在，新文件用 write_file`));
          // Models often send LF while Windows files use CRLF; match either way.
          const crlf = before.includes("\r\n");
          const from = crlf ? old_text.replace(/\r?\n/g, "\r\n") : old_text;
          const to = crlf ? new_text.replace(/\r?\n/g, "\r\n") : new_text;
          const count = before.split(from).length - 1;
          if (count !== 1) return fail(s, new Error(count ? `原文出现了 ${count} 次，多带一些上下文` : "文件里没有这段原文，先用 read_file 看准确内容"));
          return await change(s, path, before, before.replace(from, () => to), abortSignal);
        } catch (e) {
          return fail(s, e);
        }
      },
    }),

    run_command: tool({
      description: "在工作区里运行一条 PowerShell 命令，返回退出码和输出。",
      inputSchema: jsonSchema<{ command: string; timeout?: number }>({
        type: "object",
        properties: {
          command: { type: "string" },
          timeout: { type: "number", description: "最长等待秒数，默认 120，最多 600" },
        },
        required: ["command"],
      }),
      execute: async ({ command, timeout }, { toolCallId, abortSignal }) => {
        const s = step(toolCallId, "run_command", command);
        const risk = danger(command);
        if (!(await approve(report, s, "change", { what: `运行命令：${command}`, danger: risk }, abortSignal))) return "用户没有同意运行这条命令。";
        report(s);
        try {
          const out = await call<Output>("run_command", { root, command, timeoutSecs: timeout });
          if (out.timed_out) {
            report({ ...s, status: "error", detail: "超时，已结束" });
            return "命令超时，已被结束。";
          }
          report({ ...s, status: out.code === 0 ? "done" : "error", detail: `退出码 ${out.code ?? "未知"}` });
          return [`退出码：${out.code}`, out.stdout && `输出：\n${out.stdout}`, out.stderr && `错误输出：\n${out.stderr}`].filter(Boolean).join("\n\n");
        } catch (e) {
          return fail(s, e);
        }
      },
    }),
  };

  /** Shows the change, waits for approval, writes, and keeps the old content for undo. */
  async function change(s: ToolTrace, path: string, before: string | null, after: string, signal?: AbortSignal) {
    if (before === after) {
      report({ ...s, status: "done", detail: "内容没有变化" });
      return "内容没有变化，没有写入。";
    }
    const diff = diffLines(before ?? "", after);
    const { added, removed } = diffStats(diff);
    const summary = before === null ? `新建，${added} 行` : `+${added} −${removed}`;
    if (!(await approve(report, s, "change", { what: `${before === null ? "新建" : "修改"} ${path}`, diff }, signal))) return "用户没有同意这次修改。";
    report({ ...s, status: "running", ask: { what: path, diff } });
    await call("ws_write", { root, path, content: after });
    // Very large files are not kept for undo.
    const keep = before === null || before.length <= 1_000_000;
    report({ ...s, status: "done", detail: summary, ask: { what: path, diff }, undo: keep ? { root, path, before } : undefined });
    return `已写入 ${path}（${summary}）。`;
  }
}
