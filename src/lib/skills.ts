import { jsonSchema, tool, type ToolSet } from "ai";
import { useData } from "../store";
import type { Skill } from "../types";
import type { Report } from "./tools";

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

const active = () => useData.getState().skills.filter((s) => s.enabled);

/** Lists the skills by name and description; the full instructions load only when the agent asks (use_skill). */
export function skillRules() {
  const skills = active();
  if (!skills.length) return "";
  return [
    "你有以下技能。任务符合某个技能的说明时，先调用 use_skill 读取它的完整说明，再按说明完成：",
    ...skills.map((s) => `- ${s.name}：${s.description.length > 300 ? `${s.description.slice(0, 300)}…` : s.description}`),
  ].join("\n");
}

export function skillTools(report: Report): ToolSet {
  const skills = active();
  if (!skills.length) return {};
  return {
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
        // Skills written for local agents may mention scripts; here only the instructions apply.
        return `${skill.body}\n\n（在这里你只能使用当前可用的工具，说明里提到的本地脚本和命令无法运行。）`;
      },
    }),
  };
}
