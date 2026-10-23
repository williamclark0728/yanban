import type { Agent, Group, Message, Run } from "../types";

const defaults = { temperature: 0.7, topP: 1, maxTokens: 2048, history: 20 };

export const seedAgents: Agent[] = [
  {
    id: "butler",
    name: "管家",
    color: "amber",
    look: 0.2,
    tagline: "拆任务、派活、收尾汇总",
    role: {
      duty: "接收用户的任务，拆分给合适的成员，控制轮次，最后汇总交付。",
      scope: "不亲自撰写或核查正文，只做分工、判定和汇总。",
      io: "输入：任务和附件。输出：分工单、每轮判定、最终交付稿。",
      protocol: "核查和审稿都通过才交付；到达最大轮数时，把未解决的疑点一并交给用户。",
    },
    model: null,
    params: { ...defaults, temperature: 0.3 },
    memory: ["交付稿默认用中文", "用户习惯先看结论，再看过程"],
  },
  {
    id: "writer",
    name: "主笔",
    color: "violet",
    look: -0.3,
    tagline: "起草和修订正文",
    role: {
      duty: "根据材料写初稿，按疑点逐条修订。",
      scope: "只使用给定材料中的数字和事实。",
      io: "输入：任务、材料、上一轮疑点。输出：完整稿件和修订说明。",
      protocol: "每条成立的疑点都要回应：已改或说明理由。",
    },
    model: null,
    params: { ...defaults, temperature: 0.8 },
    memory: [],
  },
  {
    id: "checker",
    name: "核查员",
    color: "teal",
    look: 0.5,
    tagline: "逐条核对数字和出处",
    role: {
      duty: "把稿件里的每个数字、事实和材料原文对照。",
      scope: "不改写文风，只判断对错并给出原文位置。",
      io: "输入：稿件和材料。输出：疑点清单，每条标为成立、不成立或存疑。",
      protocol: "疑点必须附原文出处；没有出处的疑点标为存疑。",
    },
    model: null,
    params: { ...defaults, temperature: 0.2 },
    memory: [],
  },
  {
    id: "reviewer",
    name: "审稿人",
    color: "rose",
    look: -0.1,
    tagline: "看逻辑、措辞和结构",
    role: {
      duty: "从读者角度检查论证是否成立、表述是否准确。",
      scope: "不重复核查数字。",
      io: "输入：稿件。输出：修改意见清单。",
      protocol: "意见要具体到句子，给出改法。",
    },
    model: null,
    params: { ...defaults },
    memory: [],
  },
  {
    id: "helper",
    name: "小助手",
    color: "sky",
    look: 0,
    tagline: "日常问答",
    role: {
      duty: "回答日常问题，帮忙查资料、解释概念、写东西。",
      scope: "通用助手。",
      io: "自由对话。",
      protocol: "独立使用。",
    },
    model: null,
    params: { ...defaults },
    memory: [],
  },
];

export const seedGroups: Group[] = [
  {
    id: "lab",
    name: "论文写作组",
    memberIds: ["butler", "writer", "checker", "reviewer"],
    leadId: "butler",
    maxRounds: 3,
    consensus: "strict",
  },
];

/** A finished example collaboration so the group page shows how a run looks. */
export function seedMessages(now: number): { messages: Message[]; runs: Run[] } {
  const t = (min: number) => now - (8 - min) * 60_000;
  const u = (model: string, input: number, output: number, seconds: number) => ({ model, input, output, seconds });
  const messages: Message[] = [
    {
      id: "m1", chat: "lab", kind: "text", sender: "me", at: t(0),
      text: "@管家 帮我把附件里压缩模型的实验结果写成一段 200 字左右的摘要，数字都要核对。",
      attachments: [{ name: "experiment.md", size: "4.2 KB" }],
    },
    {
      id: "m2", chat: "lab", kind: "text", sender: "butler", at: t(0.3), usage: u("qwen-plus", 1320, 146, 2.1),
      text: "收到，分三步：\n\n1. @主笔 根据 experiment.md 写初稿\n2. @核查员 逐条核对数字和出处\n3. @审稿人 看逻辑和措辞\n\n两人都通过就交付，最多 3 轮。",
    },
    {
      id: "m3", chat: "lab", kind: "text", sender: "writer", at: t(1), usage: u("deepseek-chat", 2210, 318, 6.4),
      text: "**初稿 v1**\n\n我们提出一种面向边缘设备的稀疏压缩方法。在 ImageNet 上，压缩后模型的 Top-1 准确率比基线提高了 2%，推理速度提升 1.8 倍，显存占用降低 65%。实验证明了该方法在资源受限场景下全面优于现有方案。",
    },
    {
      id: "m4", chat: "lab", kind: "review", sender: "checker", at: t(2), usage: u("qwen-plus", 2480, 264, 5.0),
      text: "对照 experiment.md 核对了 3 处数字：",
      issues: [
        { text: "「提高了 2%」：原文 71.3% → 73.3%，应写「提高 2.0 个百分点」（第 12 行）", status: "holds" },
        { text: "「推理速度提升 1.8 倍」：与表 2 一致（第 20 行）", status: "rejected" },
        { text: "「显存降低 65%」：原文 16 GB → 6.4 GB，降幅是 60%（第 23 行）", status: "holds" },
      ],
    },
    {
      id: "m5", chat: "lab", kind: "review", sender: "reviewer", at: t(2.2), usage: u("kimi-k2", 1890, 201, 4.2),
      text: "逻辑上有一处：",
      issues: [{ text: "「全面优于现有方案」：材料只和一个基线比较，建议改为「优于所比较的基线」", status: "unsure" }],
    },
    { id: "r1", chat: "lab", kind: "round", runId: "run1", round: 1, verdict: "revise", note: "2 条成立，1 条存疑，退回主笔修订", at: t(3) },
    {
      id: "m6", chat: "lab", kind: "text", sender: "writer", at: t(4), usage: u("deepseek-chat", 2960, 352, 7.1),
      text: "**修订稿 v2**\n\n我们提出一种面向边缘设备的稀疏压缩方法。在 ImageNet 上，压缩后模型的 Top-1 准确率由 71.3% 提升至 73.3%（+2.0 个百分点），推理速度提升 1.8 倍，显存占用由 16 GB 降至 6.4 GB（降低 60%）。结果表明，该方法在资源受限场景下优于所比较的基线。\n\n> 修订：改了 3 处，对应上一轮全部疑点。",
    },
    { id: "m7", chat: "lab", kind: "review", sender: "checker", at: t(5), usage: u("qwen-plus", 2710, 98, 3.3), text: "3 处数字全部与原文一致。", issues: [] },
    { id: "m8", chat: "lab", kind: "review", sender: "reviewer", at: t(5.2), usage: u("kimi-k2", 2010, 64, 2.6), text: "表述准确，可以交付。", issues: [] },
    { id: "r2", chat: "lab", kind: "round", runId: "run1", round: 2, verdict: "pass", note: "核查与审稿均通过", at: t(5.5) },
    {
      id: "m9", chat: "lab", kind: "text", sender: "butler", at: t(6), usage: u("qwen-plus", 3380, 412, 4.8),
      text: "完成了，2 轮通过。\n\n**最终摘要**\n\n我们提出一种面向边缘设备的稀疏压缩方法。在 ImageNet 上，压缩后模型的 Top-1 准确率由 71.3% 提升至 73.3%（+2.0 个百分点），推理速度提升 1.8 倍，显存占用由 16 GB 降至 6.4 GB（降低 60%）。结果表明，该方法在资源受限场景下优于所比较的基线。\n\n**各方结论**\n- 核查员：3 处数字均有原文出处\n- 审稿人：修正了一处过度结论\n- 第 1 轮发现的 3 个问题都已解决",
    },
  ];

  const runs: Run[] = [
    {
      id: "run1",
      groupId: "lab",
      task: "把压缩模型的实验结果写成 200 字摘要，数字都要核对",
      status: "done",
      startedAt: t(0),
      tokens: 20815,
      rounds: [
        {
          index: 1,
          verdict: "revise",
          steps: [
            { agentId: "butler", type: "plan", summary: "分配：主笔起草，核查员核数字，审稿人看逻辑", tokens: 1466 },
            { agentId: "writer", type: "draft", summary: "初稿 v1，约 120 字", tokens: 2528 },
            {
              agentId: "checker", type: "check", summary: "核对 3 处数字", tokens: 2744,
              issues: [
                { text: "「提高 2%」应为 2.0 个百分点", status: "holds" },
                { text: "「1.8 倍」与表 2 一致", status: "rejected" },
                { text: "「降低 65%」实为 60%", status: "holds" },
              ],
            },
            { agentId: "reviewer", type: "review", summary: "1 条措辞意见", tokens: 2091, issues: [{ text: "「全面优于现有方案」结论过强", status: "unsure" }] },
          ],
        },
        {
          index: 2,
          verdict: "pass",
          steps: [
            { agentId: "writer", type: "revise", summary: "修订稿 v2，改了 3 处", tokens: 3312 },
            { agentId: "checker", type: "check", summary: "3 处数字全部一致", tokens: 2808, issues: [] },
            { agentId: "reviewer", type: "review", summary: "通过", tokens: 2074, issues: [] },
            { agentId: "butler", type: "summary", summary: "交付最终摘要和各方结论", tokens: 3792 },
          ],
        },
      ],
    },
  ];
  return { messages, runs };
}
