import { jsonSchema, tool, type ToolSet } from "ai";
import { useData } from "../store";
import type { Agent, Skill } from "../types";
import { call, isDesktop } from "./desktop";
import type { Report } from "./tools";
import { approve } from "./workmode";

/** Reads the YAML front matter fields we need: plain, quoted, and folded (`>` / `|`) values. */
function frontMatter(head: string) {
  const fields: Record<string, string> = {};
  const lines = head.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let value = m[2].trim();
    if (/^[>|][+-]?$/.test(value)) {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].trim());
      value = (value.startsWith(">") ? block.join(" ") : block.join("\n")).trim();
    } else if (/^(["']).*\1$/.test(value)) {
      value = value.slice(1, -1).replace(/\\"/g, '"');
    }
    fields[m[1]] = value;
  }
  return fields;
}

/** A SKILL.md file → a skill. `folder` names it when the front matter has no name. */
export function parseSkill(text: string, folder: string): Skill | null {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  const fields = m ? frontMatter(m[1]) : {};
  const body = (m ? m[2] : text).trim();
  const name = (fields.name || folder).trim();
  if (!name || !body) return null;
  const description = fields.description || body.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim() || "";
  return { id: crypto.randomUUID(), name, description, body, enabled: true };
}

/** Desktop: every SKILL.md in a folder (or the file itself). Each skill keeps its folder for its scripts and references. */
export async function skillsOnDisk(path: string): Promise<Skill[]> {
  const found = await call<{ dir: string; text: string }[]>("find_skills", { path });
  return found.flatMap(({ dir, text }) => {
    const folder = dir.split(/[\\/]/).pop() ?? "";
    const skill = parseSkill(text, /^skills?$/i.test(folder) ? "" : folder);
    return skill ? [{ ...skill, dir }] : [];
  });
}

/** Adds skills for every agent, replacing ones with the same name. */
export function installSkills(found: Skill[]) {
  const { skills, setSkills } = useData.getState();
  setSkills([...skills.filter((s) => !found.some((f) => f.name === s.name)), ...found]);
}

const active = () => useData.getState().skills.filter((s) => s.enabled);

const INSTALL_RULE = "用户让你安装技能时调用 install_skill：装好后长期保存，所有智能体以后都能用（设置 → 技能 里可以管理）。不要只在当前对话里读一遍就说装好了。";

/** Lists the skills by name and description; the full instructions load only when the agent asks (use_skill). */
export function skillRules() {
  const skills = active();
  if (!skills.length) return INSTALL_RULE;
  return [
    "你有以下技能。任务符合某个技能的说明时，先调用 use_skill 读取它的完整说明，再按说明完成：",
    ...skills.map((s) => `- ${s.name}：${s.description.length > 300 ? `${s.description.slice(0, 300)}…` : s.description}`),
    INSTALL_RULE,
  ].join("\n");
}

const isAbsolute = (p: string) => /^([a-z]:[\\/]|\\\\)/i.test(p);

export function skillTools(report: Report, agent?: Agent): ToolSet {
  const skills = active();
  const install = {
    install_skill: tool({
      description: isDesktop
        ? "安装技能，长期保存供所有智能体使用。path 是技能文件夹或 SKILL.md 的路径（相对路径按工作区算），会找出其中所有的 SKILL.md；也可以直接用 content 传 SKILL.md 全文。"
        : "安装技能，长期保存供所有智能体使用。content 传 SKILL.md 的全文（开头的 --- 里写 name 和 description）。",
      inputSchema: jsonSchema<{ path?: string; content?: string }>({
        type: "object",
        properties: {
          ...(isDesktop ? { path: { type: "string", description: "技能文件夹或 SKILL.md 的路径" } } : {}),
          content: { type: "string", description: "SKILL.md 全文" },
        },
      }),
      execute: async ({ path, content }, { toolCallId, abortSignal }) => {
        const step = { id: toolCallId, name: "install_skill" as const, label: path || "技能", status: "running" as const };
        try {
          let found: Skill[] = [];
          if (path && isDesktop) {
            const base = agent?.workspace?.replace(/[\\/]+$/, "");
            if (!isAbsolute(path) && !base) throw new Error("相对路径要在工作模式下才能用，请给出完整路径");
            found = await skillsOnDisk(isAbsolute(path) ? path : `${base}\\${path}`);
          } else if (content) {
            const skill = parseSkill(content, "");
            if (skill) found = [skill];
          }
          if (!found.length) throw new Error(path || content ? "没有找到可用的 SKILL.md" : isDesktop ? "需要 path 或 content" : "网页版需要用 content 传 SKILL.md 全文");
          const names = found.map((s) => s.name).join("、");
          if (!(await approve(report, { ...step, label: names }, "change", { what: `安装技能 ${names}（所有智能体都能用）` }, abortSignal))) return "用户没有同意安装。";
          installSkills(found);
          report({ ...step, label: names, status: "done", detail: `已安装 ${found.length} 个` });
          return `已安装：${names}。已长期保存，所有智能体以后都能用；这次对话里可以直接用 use_skill 读取。`;
        } catch (e) {
          report({ ...step, status: "error", detail: (e as Error).message });
          return `安装失败：${(e as Error).message}`;
        }
      },
    }),
  };
  if (!skills.length) return install;
  return {
    ...install,
    use_skill: tool({
      description: "读取一个技能的完整说明。",
      inputSchema: jsonSchema<{ name: string }>({
        type: "object",
        properties: { name: { type: "string", enum: skills.map((s) => s.name), description: "技能名" } },
        required: ["name"],
      }),
      execute: async ({ name }, { toolCallId }) => {
        const skill = skills.find((s) => s.name === name) ?? skills.find((s) => s.name.includes(name) || name.includes(s.name));
        if (!skill) {
          report({ id: toolCallId, name: "use_skill", label: name, status: "error", detail: "没有这个技能" });
          return `没有叫「${name}」的技能。可用：${skills.map((s) => s.name).join("、")}`;
        }
        report({ id: toolCallId, name: "use_skill", label: skill.name, status: "done" });
        if (skill.dir && isDesktop) {
          const files = await call<{ name: string; dir: boolean }[]>("ws_list", { root: skill.dir, path: "." }).catch(() => []);
          const run = agent?.workspace ? "用 run_command 加完整路径运行其中的脚本" : "运行其中的脚本需要先打开工作模式";
          return `${skill.body}\n\n技能文件夹：${skill.dir}\n其中有：${files.map((f) => (f.dir ? `${f.name}/` : f.name)).join("、")}\n说明里提到的参考文件用 read_skill_file 读取；${run}。`;
        }
        // Skills written for local agents may mention scripts; here only the instructions apply.
        return `${skill.body}\n\n（在这里你只能使用当前可用的工具，说明里提到的本地脚本和命令无法运行。）`;
      },
    }),
    ...(isDesktop && skills.some((s) => s.dir) ? { read_skill_file: readSkillFile(skills, report) } : {}),
  };
}

/** Reads a file in an installed skill's folder: its references, templates and scripts. */
function readSkillFile(skills: Skill[], report: Report) {
  const withDir = skills.filter((s) => s.dir);
  return tool({
    description: "读取已安装技能文件夹里的文件（参考资料、模板、脚本源码）。",
    inputSchema: jsonSchema<{ skill: string; path: string }>({
      type: "object",
      properties: {
        skill: { type: "string", enum: withDir.map((s) => s.name), description: "技能名" },
        path: { type: "string", description: "相对技能文件夹的路径，比如 references/spec.md；看目录就写文件夹路径" },
      },
      required: ["skill", "path"],
    }),
    execute: async ({ skill: name, path }, { toolCallId }) => {
      const skill = withDir.find((s) => s.name === name);
      const step = { id: toolCallId, name: "use_skill" as const, label: `${name}/${path}` };
      if (!skill) return `没有叫「${name}」的技能文件夹。`;
      try {
        const entries = await call<{ name: string; dir: boolean }[]>("ws_list", { root: skill.dir, path }).catch(() => null);
        if (entries) {
          report({ ...step, status: "done", detail: `${entries.length} 项` });
          return entries.map((e) => (e.dir ? `${e.name}/` : e.name)).join("\n") || "（空文件夹）";
        }
        const text = await call<string>("ws_read", { root: skill.dir, path });
        report({ ...step, status: "done", detail: `${text.length} 字` });
        return text;
      } catch (e) {
        report({ ...step, status: "error", detail: (e as Error).message });
        return `读取失败：${(e as Error).message}`;
      }
    },
  });
}
