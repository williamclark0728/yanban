// Moving setup between browsers and devices: agents, groups, templates, model services, search, skills and MCP servers.
// Chat history stays out. Keys are left out unless the user asks for them.
import { TRIAL_ID, useData } from "../store";
import type { Agent, Group, McpServer, ModelRef, Provider, SearchConfig, Skill, TeamTemplate } from "../types";
import { db, setKv } from "./db";

interface ConfigFile {
  app: "yanban";
  version: 1;
  exportedAt: string;
  agents: Agent[];
  groups: Group[];
  templates: TeamTemplate[];
  providers: Provider[];
  defaultModel: ModelRef | null;
  search: SearchConfig;
  skills: Skill[];
  mcpServers: McpServer[];
}

export function exportConfig(withKeys: boolean): ConfigFile {
  const s = useData.getState();
  return {
    app: "yanban",
    version: 1,
    exportedAt: new Date().toISOString(),
    agents: s.agents,
    groups: s.groups,
    templates: s.templates,
    providers: s.providers.filter((p) => p.id !== TRIAL_ID).map((p) => (withKeys ? p : { ...p, apiKey: "" })),
    defaultModel: s.defaultModel,
    search: withKeys ? s.search : { ...s.search, keys: {}, jinaKey: undefined },
    skills: s.skills,
    mcpServers: withKeys ? s.mcpServers : s.mcpServers.map((m) => ({ ...m, headers: {} })),
  };
}

export function saveConfigFile(withKeys: boolean) {
  const blob = new Blob([JSON.stringify(exportConfig(withKeys), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `研伴配置-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const byId = <T extends { id: string }>(mine: T[], theirs: T[]) => [...mine.filter((x) => !theirs.some((t) => t.id === x.id)), ...theirs];

/**
 * Merges a config file into this browser: items with the same id (skills: the same name) are replaced,
 * everything else is kept. A key left empty in the file never wipes one saved here.
 */
export async function importConfig(text: string) {
  let data: Partial<ConfigFile>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("不是有效的 JSON 文件");
  }
  if (data.app !== "yanban") throw new Error("不是研伴导出的配置文件");
  const s = useData.getState();
  const list = <T>(v: T[] | undefined) => (Array.isArray(v) ? v : []);

  const providers = list(data.providers).map((p) => ({ ...p, apiKey: p.apiKey || s.providers.find((x) => x.id === p.id)?.apiKey || "" }));
  await db.transaction("rw", [db.agents, db.groups, db.providers], async () => {
    await db.agents.bulkPut(list(data.agents));
    await db.groups.bulkPut(list(data.groups));
    await db.providers.bulkPut(providers);
  });

  const skills = list(data.skills);
  const servers = list(data.mcpServers).map((m) => ({ ...m, headers: Object.keys(m.headers ?? {}).length ? m.headers : (s.mcpServers.find((x) => x.id === m.id)?.headers ?? {}) }));
  const search = data.search ? { ...data.search, keys: { ...s.search.keys, ...stripEmpty(data.search.keys) }, jinaKey: data.search.jinaKey || s.search.jinaKey } : s.search;
  await Promise.all([
    setKv("templates", byId(s.templates, list(data.templates))),
    setKv("skills", [...s.skills.filter((x) => !skills.some((t) => t.name === x.name)), ...skills]),
    setKv("mcpServers", byId(s.mcpServers, servers)),
    setKv("search", search),
    data.defaultModel !== undefined ? setKv("defaultModel", data.defaultModel) : null,
  ]);
  await s.load();
  return `已导入 ${list(data.agents).length} 个智能体、${list(data.groups).length} 个群、${providers.length} 个模型服务、${skills.length} 个技能、${servers.length} 个 MCP 服务`;
}

const stripEmpty = (keys: SearchConfig["keys"] = {}) => Object.fromEntries(Object.entries(keys).filter(([, v]) => v));
