// Co-writing: one Markdown document per chat in the side panel. The user edits it, asks the model to rewrite
// a selected passage, and the agent can write into it with edit_doc.
import { jsonSchema, tool, type ToolSet } from "ai";
import { resolveModel, useData, useUi } from "../store";
import type { Doc } from "../types";
import { completeText } from "./llm";
import type { Report } from "./tools";

export const docOf = (chat: string) => useData.getState().docs.find((d) => d.chat === chat);

const fresh = (chat: string): Doc => ({ chat, title: "未命名文档", text: "", updatedAt: Date.now() });

/** Opens the chat's document, creating it; `append` adds a passage (a reply) at the end. */
export function openDoc(chat: string, append?: string) {
  const doc = docOf(chat) ?? fresh(chat);
  const text = append ? [doc.text.trimEnd(), append.trim()].filter(Boolean).join("\n\n") : doc.text;
  useData.getState().saveDoc({ ...doc, text, updatedAt: Date.now() });
  useUi.getState().openPane({ kind: "doc", chat });
}

/** Who writes in a chat: the agent, or the group's lead. */
function writer(chat: string) {
  const { agents, groups } = useData.getState();
  const group = groups.find((g) => g.id === chat);
  return agents.find((a) => a.id === (group ? group.leadId : chat));
}

const REWRITE_RULES = "你在帮用户改一份文档里的一段。按用户的要求改写选中的这段，和上下文保持一致的术语和语气；公式、数字和引用编号不要改错。只输出改写后的这段文字，不要解释，不要加引号。";

/** The selected passage rewritten as asked, using the chat's agent's model. */
export async function rewrite(chat: string, selected: string, instruction: string, signal: AbortSignal) {
  const doc = docOf(chat);
  const agent = writer(chat);
  const { providers, defaultModel } = useData.getState();
  const target = resolveModel(agent, providers, defaultModel);
  if (!target) throw new Error("还没有连接模型服务");
  const context = doc?.text ?? "";
  const r = await completeText({
    provider: target.provider,
    modelId: target.modelId,
    system: REWRITE_RULES,
    messages: [
      {
        role: "user",
        content: `文档全文（供参考）：\n<文档>\n${context.length > 12_000 ? `${context.slice(0, 12_000)}\n…` : context}\n</文档>\n\n要改的这段：\n<选中>\n${selected}\n</选中>\n\n要求：${instruction}`,
      },
    ],
    params: { ...(agent?.params ?? { temperature: 0.5, topP: 1, maxTokens: 0, history: 0 }), temperature: 0.5 },
    signal,
  });
  return r.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

// ---------- the agent's side ----------

export function docRules(chat: string) {
  const doc = docOf(chat);
  if (!doc) return "";
  const text = doc.text.length > 12_000 ? `${doc.text.slice(0, 12_000)}\n…（后面还有 ${doc.text.length - 12_000} 字）` : doc.text;
  return [
    `这个对话有一份共写文档《${doc.title}》，用户在侧栏里编辑。用户让你写进文档、改文档时用 edit_doc；只是聊天时不要动它。`,
    `文档当前内容：\n<文档>\n${text || "（空）"}\n</文档>`,
  ].join("\n");
}

export function docTools(chat: string, report: Report): ToolSet {
  if (!docOf(chat)) return {};
  return {
    edit_doc: tool({
      description: "修改这个对话的共写文档：append 在末尾追加；replace 把 old_text 换成 new_text（old_text 要和文档里完全一致）；rewrite 用 new_text 替换全文。",
      inputSchema: jsonSchema<{ mode: "append" | "replace" | "rewrite"; new_text: string; old_text?: string }>({
        type: "object",
        properties: {
          mode: { type: "string", enum: ["append", "replace", "rewrite"] },
          new_text: { type: "string" },
          old_text: { type: "string", description: "replace 时要替换的原文" },
        },
        required: ["mode", "new_text"],
      }),
      execute: async ({ mode, new_text, old_text }, { toolCallId }) => {
        const doc = docOf(chat);
        const step = { id: toolCallId, name: "edit_doc" as const, label: mode === "append" ? "追加" : mode === "replace" ? "修改一段" : "重写全文" };
        if (!doc) return "文档已经不在了。";
        let text = doc.text;
        if (mode === "append") text = [text.trimEnd(), new_text.trim()].filter(Boolean).join("\n\n");
        else if (mode === "rewrite") text = new_text;
        else {
          const n = old_text ? text.split(old_text).length - 1 : 0;
          if (n !== 1) {
            report({ ...step, status: "error", detail: n ? "原文出现了多次" : "文档里没有这段原文" });
            return n ? "old_text 在文档里出现了多次，多带一些上下文。" : "文档里没有这段原文，照文档当前内容准确复制。";
          }
          text = text.replace(old_text!, () => new_text);
        }
        useData.getState().saveDoc({ ...doc, text, updatedAt: Date.now() });
        report({ ...step, status: "done", detail: `${text.length} 字` });
        return `已更新文档《${doc.title}》，现在 ${text.length} 字。`;
      },
    }),
  };
}
