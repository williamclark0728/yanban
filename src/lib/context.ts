// How much of the model's context window a chat fills, and compressing old messages into a summary.
import type { Message, TextMessage } from "../types";

/** Context windows by model family, in tokens. Unknown models count as 128K so the meter errs on the full side. */
const WINDOWS: [RegExp, number][] = [
  [/gemini/i, 1_048_576],
  [/claude|opus|sonnet|haiku|fable/i, 200_000],
  [/gpt-4\.1/i, 1_047_576],
  [/gpt-5|o3|o4/i, 400_000],
  [/qwen-long/i, 10_000_000],
  [/qwen3?-max|qwen3-coder/i, 262_144],
  [/qwen-(plus|flash|turbo)|qwen3\.[5-9]/i, 1_000_000],
  [/kimi|moonshot/i, 262_144],
  [/minimax|abab/i, 1_000_000],
  [/doubao|seed/i, 256_000],
  [/glm-4\.[5-9]|glm-[5-9]/i, 200_000],
];

export const contextWindow = (modelId: string) => WINDOWS.find(([re]) => re.test(modelId))?.[1] ?? 128_000;

/** A rough count: Chinese runs about 0.75 tokens a character, other text about 3.5 characters a token. */
export function estimateTokens(text: string) {
  const cjk = text.match(/[　-鿿가-힯＀-￯]/g)?.length ?? 0;
  return Math.round(cjk * 0.75 + (text.length - cjk) / 3.5);
}

/** Roughly what tool definitions add to every request. */
export const TOOL_OVERHEAD = 2_500;

/** Above this share of the window, the chat is compressed before the next reply. */
export const AUTO_COMPACT = 0.8;

/** A finished summary; one that failed or was stopped doesn't count. */
export const isSummary = (m: Message): m is TextMessage => m.kind === "text" && !!m.summary && !m.status;

/** A chat's messages after its latest summary, and that summary. */
export function sinceSummary(messages: Message[]) {
  const i = messages.findLastIndex(isSummary);
  return { summary: i >= 0 ? (messages[i] as TextMessage) : undefined, rest: i >= 0 ? messages.slice(i + 1) : messages };
}

export const SUMMARY_PROMPT = [
  "把上面的对话压缩成一份摘要，之后的对话只能看到这份摘要，看不到原文。要求：",
  "- 写清用户的目标和要求（格式、字数、语气等约束）、已经确定的结论和关键数据、做过的决定和理由。",
  "- 列出已经生成或修改的文件（文件名、位置、内容要点）、用过的资料来源。",
  "- 列出还没完成的事、悬而未决的问题和下一步。",
  "- 只写事实，不加评价；用条目，控制在 1500 字以内。",
].join("\n");

export const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : n >= 1000 ? `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K` : String(n));
