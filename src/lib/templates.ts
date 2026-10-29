import { useData } from "../store";
import type { Agent, Group, TeamTemplate, TemplateMember } from "../types";
import { seedAgents } from "./seed";

/** A seed agent as a template member, so built-in teams and the first-run example stay the same people. */
function fromSeed(id: string): TemplateMember {
  const a = seedAgents.find((x) => x.id === id)!;
  return { key: a.id, name: a.name, color: a.color, look: a.look, tagline: a.tagline, role: a.role, params: a.params, memory: a.memory, web: a.web };
}

const butler = fromSeed("butler");
const writer = fromSeed("writer");
const checker = fromSeed("checker");
const reviewer = fromSeed("reviewer");

const researcher: TemplateMember = {
  key: "researcher",
  name: "调研员",
  color: "orange",
  look: 0.35,
  tagline: "联网查资料，写成带出处的报告",
  role: {
    duty: "围绕任务联网搜索，挑出可信、相关的资料，写成结构清楚的调研报告：结论、分点论述、必要时加对比表。",
    scope: "只写资料里有的事实，每条都标来源编号；查不到的如实写明，观点和事实分开写。",
    io: "输入：调研主题和要求。输出：完整报告，末尾列出全部来源（编号、标题、链接）。",
    protocol: "优先官方、学术和权威媒体来源，关键事实尽量找两个来源；按审查意见修订并说明改动。",
  },
  params: { temperature: 0.5 },
  web: true,
};

const planner: TemplateMember = {
  key: "planner",
  name: "策划",
  color: "sky",
  look: -0.25,
  tagline: "排结构、写每页内容和讲稿",
  role: {
    duty: "把主题或材料变成一份完整的演示稿：先定页数和结构，再写每页的标题、3–5 条要点和讲稿。",
    scope: "每页只讲一件事，要点短句不超过 20 字；数字和结论只用材料里有的。",
    io: "输入：主题、材料、时长或页数要求。输出：逐页的「第 n 页｜标题 / 要点 / 讲稿」，开头附整体结构。",
    protocol: "按审查意见修订，说明改了哪几页。",
  },
  params: { temperature: 0.7 },
};

/** Two searchers that look into different sub-questions at the same time. */
const searcher = (key: string, name: string, color: TemplateMember["color"], look: number): TemplateMember => ({
  key,
  name,
  color,
  look,
  tagline: "按分到的子问题联网检索，整理成带出处的要点",
  role: {
    duty: "只查分给你的子问题：先想好 2–3 个检索角度（定义与现状、关键数据、不同观点或争议），每个角度至少搜一次，重要的结果读原文。",
    scope: "只写搜到的内容，每条事实后标来源编号 [n]；查不到的写明没查到，不猜。",
    io: "输入：子问题。输出：分点的要点（事实 + 编号），末尾列出来源：编号、标题、链接。",
    protocol: "和另一位检索员各查各的，不重复；撰写人会用你的要点和来源写报告。",
  },
  params: { temperature: 0.4 },
  web: true,
});

const author: TemplateMember = {
  key: "author",
  name: "撰写人",
  color: "violet",
  look: 0.15,
  tagline: "把检索结果写成带引用编号的调研报告",
  role: {
    duty: "把检索员的要点整合成一篇调研报告：摘要、按子问题分节论述、需要时加对比表、结论和仍不确定的地方。",
    scope: "只用检索员给出的材料，不自己补充事实。引用编号全文重新从 [1] 连续编排；同一来源用同一个编号。",
    io: "输入：检索员的要点和来源。输出：完整报告，末尾「参考文献」按编号列出标题和链接，链接都来自检索员的来源列表。",
    protocol: "按核查员的意见修订，说明改了哪几处。",
  },
  params: { temperature: 0.5 },
};

/** Exam review: one solves, one checks the answer independently, one writes practice questions when asked. */
const solver: TemplateMember = {
  key: "solver",
  name: "解题人",
  color: "sky",
  look: -0.15,
  tagline: "讲清考点和思路，写出完整解题步骤",
  role: {
    duty: "解答用户给的题目，按这个顺序写：① 考点：这题考哪几个知识点、用到哪些公式或定理；② 思路：先做什么、为什么这样做；③ 完整步骤：每一步写出公式、代入和中间结果，不跳步；④ 最终答案：单独一行加粗，带单位；⑤ 易错点：这类题常见的 1–3 个错误。",
    scope: "用户给了课件、笔记或资料库时，优先用其中的方法、符号和结论。公式用 LaTeX（行内 $…$，独立公式 $$…$$）。题目条件不全或有歧义时，写明你的假设再解。不确定的结论如实说明，不编造公式。",
    io: "输入：一道题（文字或图片），可能附带课件。输出：考点 / 思路 / 步骤 / 答案 / 易错点 五部分的完整解答。",
    protocol: "验算员指出问题时逐条核对：确实错了就改正并说明错在哪一步，没错就写出理由。",
  },
  params: { temperature: 0.3 },
};

const verifier: TemplateMember = {
  key: "verifier",
  name: "验算员",
  color: "teal",
  look: 0.25,
  tagline: "独立验算答案，逐步核对推导",
  role: {
    duty: "先不看解答，自己用另一种方法或估算算出答案，再和解题人的答案对比；然后逐步检查推导：公式是否用对、代入和计算是否正确、单位和量纲是否一致、结果在特殊情况或极限情况下是否合理。",
    scope: "只指出有依据的问题，写明是第几步、错在哪、正确应该是什么；表述方式不同但结果正确不算问题。",
    io: "输入：题目和解题人的解答。输出：你的独立结果，以及逐条问题清单。",
    protocol: "答案一致且步骤无误时明确写“验算通过”。",
  },
  params: { temperature: 0.2 },
};

const examiner: TemplateMember = {
  key: "examiner",
  name: "出题人",
  color: "amber",
  look: 0.45,
  tagline: "出同类练习题，答案放在最后",
  role: {
    duty: "按原题的考点出 2–3 道同类练习题，难度由浅到深：一道换数字、一道换问法、一道综合。",
    scope: "题目条件要完整、可解，答案你要自己算过。",
    io: "输入：原题。输出：练习题，最后单独一节「参考答案」给出每题的简要步骤和答案。",
    protocol: "只在用户要练习题时参与。",
  },
  params: { temperature: 0.6 },
};

export const builtInTemplates: TeamTemplate[] = [
  {
    id: "paper",
    name: "论文写作组",
    description: "写摘要、论文段落、实验报告，数字逐条核对，逻辑和措辞专人审读",
    members: [butler, writer, checker, reviewer],
    leadKey: butler.key,
    maxRounds: 3,
    consensus: "strict",
    builtIn: true,
  },
  {
    id: "research",
    name: "资料调研组",
    description: "联网搜集资料写成调研报告，来源逐条核对，结论和事实分开写",
    members: [butler, researcher, checker, reviewer],
    leadKey: butler.key,
    maxRounds: 2,
    consensus: "strict",
    builtIn: true,
  },
  {
    id: "deep",
    name: "深度调研组",
    description: "管家拆子问题，两位检索员并行查，撰写人写成带引用编号的报告，核查员逐条核对出处",
    members: [butler, searcher("searcher-a", "检索员甲", "teal", -0.3), searcher("searcher-b", "检索员乙", "amber", 0.3), author, checker],
    leadKey: butler.key,
    maxRounds: 2,
    consensus: "strict",
    guide: [
      "1. 把用户的主题拆成 2–4 个互不重叠的子问题，分给检索员甲和检索员乙（都是 produce），task 里写清各自负责哪几个子问题，两人同时开始。",
      "2. 撰写人（produce）的 after 写「检索员甲、检索员乙」，等两人都完成后把材料写成一篇报告，引用编号连续，末尾列参考文献。",
      "3. 核查员（review）核对报告里每条引用是否在检索员的来源里、数字是否一致、有没有没出处的结论。",
    ].join("\n"),
    builtIn: true,
  },
  {
    id: "exam",
    name: "期末复习组",
    description: "发一道题，解题人讲考点、思路和完整步骤，验算员独立验算，需要时出同类练习题",
    members: [butler, solver, verifier, examiner],
    leadKey: butler.key,
    maxRounds: 2,
    consensus: "strict",
    guide: [
      "1. 用户发来题目（或问某个知识点、公式怎么用）：解题人 produce，写出考点、思路、完整步骤、最终答案和易错点。",
      "2. 验算员 review：独立算一遍答案，再逐步核对解题人的推导和计算。",
      "3. 只有用户要练习题、类似题或“举一反三”时，才派出题人 produce：直接根据原题出题，和解题人同时开始，不写 after，task 里也不要提解题人。验算员同时审查两人的产出。不要练习题就不派出题人。",
      "4. 用户一次发了几道题时，让解题人按题号逐题解答。",
      "5. 用户只是闲聊或问复习安排，你直接回答，不用分工。",
    ].join("\n"),
    builtIn: true,
  },
  {
    id: "writing",
    name: "写作组",
    description: "文章、演讲稿、申请书、邮件，一人起草一人审改",
    members: [butler, writer, reviewer],
    leadKey: butler.key,
    maxRounds: 2,
    consensus: "relaxed",
    builtIn: true,
  },
  {
    id: "slides",
    name: "PPT 制作组",
    description: "把主题或材料变成逐页的标题、要点和讲稿，审稿人检查结构和篇幅",
    members: [butler, planner, reviewer],
    leadKey: butler.key,
    maxRounds: 2,
    consensus: "relaxed",
    builtIn: true,
  },
];

const defaults = { temperature: 0.7, topP: 1, maxTokens: 0, history: 20 };

/** The agent a template member would be: an existing one with the same name, or none (it will be created). */
export const existingFor = (m: TemplateMember, agents: Agent[]) => agents.find((a) => a.name === m.name);

/** A name not yet taken by another group: "写作组", then "写作组 2", "写作组 3"… */
export function freeGroupName(base: string, groups: Group[]) {
  const taken = new Set(groups.map((g) => g.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/**
 * Creates a group from a template. Members whose name matches an existing agent reuse that agent
 * (keeping the user's own settings); the rest are created from the template.
 */
export function instantiate(t: TeamTemplate, name: string): string {
  const { agents, addAgent, addGroup } = useData.getState();
  const ids = new Map<string, string>();
  for (const m of t.members) {
    const same = existingFor(m, agents);
    if (same) {
      ids.set(m.key, same.id);
      continue;
    }
    const id = crypto.randomUUID().slice(0, 8);
    addAgent({
      id,
      name: m.name,
      color: m.color,
      look: m.look,
      tagline: m.tagline,
      role: { ...m.role },
      model: m.model ?? null,
      params: { ...defaults, ...m.params },
      memory: [...(m.memory ?? [])],
      web: m.web,
    });
    ids.set(m.key, id);
  }
  const memberIds = [...new Set(t.members.map((m) => ids.get(m.key)!))];
  const group: Group = {
    id: crypto.randomUUID().slice(0, 8),
    name,
    memberIds,
    leadId: ids.get(t.leadKey) ?? memberIds[0],
    maxRounds: t.maxRounds,
    consensus: t.consensus,
    guide: t.guide,
  };
  addGroup(group);
  return group.id;
}

/** A group's current members and rules as a template of the user's own. */
export function snapshot(group: Group, agents: Agent[], name: string, description: string): TeamTemplate {
  const members = group.memberIds
    .map((id) => agents.find((a) => a.id === id))
    .filter((a): a is Agent => !!a)
    .map(({ id, name, color, look, tagline, role, params, model, memory, web }) => ({ key: id, name, color, look, tagline, role, params, model, memory, web }));
  return {
    id: crypto.randomUUID().slice(0, 8),
    name,
    description,
    members,
    leadKey: group.leadId,
    maxRounds: group.maxRounds,
    consensus: group.consensus,
    guide: group.guide,
    createdAt: Date.now(),
  };
}
