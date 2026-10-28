// Translating a reply's reasoning into Chinese: many models think in English even when they answer in Chinese.
import { resolveModel, useData } from "../store";
import { completeText } from "./llm";

/** Mostly Latin letters and long enough to be worth translating. */
export function looksEnglish(text: string) {
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  const cjk = text.match(/[㐀-鿿]/g)?.length ?? 0;
  return text.length > 80 && latin > cjk * 3;
}

const RULES = "把下面这段模型的思考过程翻译成通顺的中文。公式、代码、文件名和专有名词保持原样，不增删内容，只输出译文。";

/** Translates with the model that wrote the reply and keeps the result on the message. */
export async function translateReasoning(messageId: string) {
  const { messages, agents, providers, defaultModel, patchMessage } = useData.getState();
  const m = messages.find((x) => x.id === messageId);
  if (!m || m.kind === "round" || !m.reasoning) return;
  const agent = agents.find((a) => a.id === m.sender);
  const target = resolveModel(agent, providers, defaultModel);
  if (!target) throw new Error("还没有连接模型服务");
  const r = await completeText({
    provider: target.provider,
    modelId: target.modelId,
    system: RULES,
    messages: [{ role: "user", content: m.reasoning.slice(0, 30_000) }],
    // No need to think about a translation; only chat-protocol services take "off" everywhere.
    params: { temperature: 0.2, topP: 1, maxTokens: 0, history: 0, effort: target.provider.protocol === "openai-chat" ? "off" : "auto" },
    signal: new AbortController().signal,
  });
  patchMessage(messageId, { reasoningZh: r.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim() }, true);
}
