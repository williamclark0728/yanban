import { create } from "zustand";
import { persist } from "zustand/middleware";
import { presets, fromPreset } from "./lib/catalog";
import { addExamples, db, ensureSeeded, getKv, setKv } from "./lib/db";
import { isDesktop } from "./lib/desktop";
import { loadUsage } from "./lib/usage";
import type { Agent, Attachment, ChatRef, Doc, Group, Library, Schedule, McpServer, Memory, Message, ModelParams, ModelRef, Provider, Run, SearchConfig, Skill, TeamTemplate } from "./types";

export type Theme = "dark" | "light" | "system";
export type PanelTab = "info" | "members" | "runs" | "memory";
export type SettingsTab = "general" | "providers" | "search" | "skills" | "mcp" | "library" | "memory" | "schedules" | "usage";

/** Desktop work mode: which local actions need the user's OK. Dangerous commands always do. */
export type Approval = "ask" | "read" | "smart" | "full";

export type FontSize = "small" | "medium" | "large" | "xlarge";

interface Prefs {
  mode: "simple" | "dev";
  theme: Theme;
  /** What the user wants to be called; empty until they set it. */
  name: string;
  approval: Approval;
  /** Text size of the messages. */
  fontSize: FontSize;
  /** "brief" folds a reply's tool steps into one line until clicked; approvals always show. */
  steps: "full" | "brief";
  /** Desktop: the whole window's zoom (Ctrl + plus / minus); the website leaves this to the browser. */
  zoom: number;
  /** Agents may save what they learn about the user (remember). */
  autoMemory: boolean;
  /** Replies may end with suggested next steps, shown as buttons. */
  suggest: boolean;
  /** Widest the conversation column gets, in pixels; CHAT_WIDTH_MAX fills the window. */
  chatWidth: number;
  setMode: (mode: Prefs["mode"]) => void;
  setTheme: (theme: Theme) => void;
  setName: (name: string) => void;
  setApproval: (approval: Approval) => void;
  set: (patch: Partial<Pick<Prefs, "fontSize" | "steps" | "zoom" | "autoMemory" | "suggest" | "chatWidth">>) => void;
}

export const CHAT_WIDTH_MIN = 640;
export const CHAT_WIDTH_MAX = 1600;
/** Most rounds of review and revision a group may run. */
export const MAX_ROUNDS = 10;

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2;
const ZOOM_STEPS = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2];

/** The next zoom level up (+1) or down (-1), like a browser's steps. */
export function stepZoom(zoom: number, dir: 1 | -1) {
  return dir > 0 ? (ZOOM_STEPS.find((z) => z > zoom + 0.001) ?? ZOOM_MAX) : (ZOOM_STEPS.findLast((z) => z < zoom - 0.001) ?? ZOOM_MIN);
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      mode: "simple",
      theme: "dark",
      name: "",
      approval: "read",
      fontSize: "medium",
      steps: "full",
      zoom: 1,
      autoMemory: true,
      suggest: true,
      chatWidth: 820,
      setMode: (mode) => set({ mode }),
      setTheme: (theme) => set({ theme }),
      setName: (name) => set({ name: name.slice(0, 20) }),
      setApproval: (approval) => set({ approval }),
      set: (patch) => set(patch),
    }),
    { name: "yanban.prefs" },
  ),
);

/** A passage the user selected in a reply, explained in a side chat. */
export interface Aside {
  chat: string;
  messageId: string;
  quote: string;
  /** Changes on every open, so asking about the same passage again starts over. */
  key: string;
}

/** What the right-hand panel shows besides the details: a file, or the chat's shared document. */
export type Pane =
  | { kind: "file"; root: string; path: string; key: string }
  | { kind: "attachment"; file: Attachment; key: string }
  | { kind: "doc"; chat: string; key: string };

interface Ui {
  active: ChatRef | null;
  aside: Aside | null;
  pane: Pane | null;
  openPane: (pane: DistributiveOmit<Pane, "key">) => void;
  closePane: () => void;
  /** A composer popover opened from a slash command. */
  chip: "model" | "effort" | "compare" | null;
  helpOpen: boolean;
  /** A message to scroll to and flash, e.g. picked from the history search. */
  focus: { id: string; key: number } | null;
  /** Text to quote into the open chat's composer, e.g. an old message from the history search. */
  quote: { text: string; key: number } | null;
  panelOpen: boolean;
  panelTab: PanelTab;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  editProvider: string | null;
  /**
   * The open editor. "templates" picks a team template; "template" edits one of the user's templates;
   * "saveTemplate" saves group `id` as a template.
   */
  editor: { kind: "agent" | "group" | "templates" | "template" | "saveTemplate"; id?: string } | null;
  search: string;
  edit: (editor: Ui["editor"]) => void;
  open: (chat: ChatRef) => void;
  back: () => void;
  togglePanel: (open?: boolean) => void;
  showPanel: (tab: PanelTab) => void;
  openSettings: (tab?: SettingsTab, provider?: string | null) => void;
  setEditProvider: (id: string | null) => void;
  closeSettings: () => void;
  setSearch: (q: string) => void;
  openAside: (aside: Omit<Aside, "key">) => void;
  closeAside: () => void;
  setChip: (chip: Ui["chip"]) => void;
  setHelp: (open: boolean) => void;
  focusMessage: (id: string | null) => void;
  quoteInto: (text: string | null) => void;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export const useUi = create<Ui>()((set) => ({
  active: { kind: "agent", id: "helper" },
  aside: null,
  pane: null,
  // One side panel at a time: opening a file or the document closes the explain chat, and the other way round.
  openPane: (pane) => set({ pane: { ...pane, key: crypto.randomUUID() } as Pane, aside: null }),
  closePane: () => set({ pane: null }),
  chip: null,
  helpOpen: false,
  focus: null,
  quote: null,
  panelOpen: false,
  panelTab: "info",
  settingsOpen: false,
  settingsTab: "general",
  editProvider: null,
  editor: null,
  search: "",
  edit: (editor) => set({ editor }),
  open: (chat) => set({ active: chat, panelTab: "info" }),
  back: () => set({ active: null }),
  togglePanel: (open) => set((s) => ({ panelOpen: open ?? !s.panelOpen })),
  showPanel: (tab) => set({ panelOpen: true, panelTab: tab }),
  openSettings: (tab, provider = null) =>
    set((s) => ({ settingsOpen: true, settingsTab: tab ?? s.settingsTab, editProvider: provider })),
  setEditProvider: (editProvider) => set({ editProvider }),
  closeSettings: () => set({ settingsOpen: false }),
  setSearch: (search) => set({ search }),
  openAside: (aside) => set({ aside: { ...aside, key: crypto.randomUUID() }, pane: null }),
  closeAside: () => set({ aside: null }),
  setChip: (chip) => set({ chip }),
  setHelp: (helpOpen) => set({ helpOpen }),
  focusMessage: (id) => set({ focus: id ? { id, key: Date.now() } : null }),
  quoteInto: (text) => set({ quote: text ? { text, key: Date.now() } : null }),
}));

interface Data {
  loaded: boolean;
  agents: Agent[];
  groups: Group[];
  messages: Message[];
  runs: Run[];
  providers: Provider[];
  defaultModel: ModelRef | null;
  unread: Record<string, number>;
  /** The site's free trial model, when the server offers one. */
  trial: Trial | null;
  /** Web search service and keys, kept in this browser like provider keys. */
  search: SearchConfig;
  saveSearch: (c: SearchConfig) => void;
  /** Team templates the user saved; the built-in ones live in lib/templates. */
  templates: TeamTemplate[];
  saveTemplate: (t: TeamTemplate) => void;
  deleteTemplate: (id: string) => void;
  skills: Skill[];
  setSkills: (skills: Skill[]) => void;
  mcpServers: McpServer[];
  setMcpServers: (servers: McpServer[]) => void;
  /** Long-term memory about the user, shared by every agent. */
  memories: Memory[];
  setMemories: (memories: Memory[]) => void;
  /** Knowledge bases; their passages are in the chunks table. */
  libraries: Library[];
  setLibraries: (libraries: Library[]) => void;
  /** Shared documents, one per chat. */
  docs: Doc[];
  saveDoc: (doc: Doc) => void;
  /** Messages sent to agents at set times. */
  schedules: Schedule[];
  setSchedules: (schedules: Schedule[]) => void;
  deleteDoc: (chat: string) => void;
  /** The site's own web search, when the server offers it. */
  siteSearch: { limit: number; remaining: number } | null;
  refreshSiteSearch: () => Promise<void>;
  setSiteSearchRemaining: (remaining: number) => void;
  load: () => Promise<void>;
  refreshTrial: () => Promise<void>;
  setTrialRemaining: (remaining: number) => void;
  restoreExamples: () => Promise<void>;
  saveProvider: (p: Provider) => Promise<void>;
  removeProvider: (id: string) => Promise<void>;
  setDefaultModel: (ref: ModelRef | null) => void;
  addAgent: (agent: Agent) => void;
  updateAgent: (id: string, patch: Partial<Agent>) => void;
  deleteAgent: (id: string) => void;
  setParam: <K extends keyof ModelParams>(agentId: string, key: K, value: ModelParams[K]) => void;
  addGroup: (group: Group) => void;
  updateGroup: (id: string, patch: Partial<Group>) => void;
  deleteGroup: (id: string) => void;
  setConsensus: (groupId: string, consensus: Group["consensus"]) => void;
  setMaxRounds: (groupId: string, maxRounds: number) => void;
  addMessage: (m: Message) => void;
  patchMessage: (id: string, patch: Partial<Message>, save?: boolean) => void;
  removeMessage: (id: string) => void;
  clearChat: (chat: string) => void;
  saveRun: (run: Run) => void;
  markRead: (chat: string) => void;
}

export const TRIAL_ID = "trial";
export interface Trial {
  model: string;
  limit: number;
  remaining: number;
}

/** Never saved: it exists only while the server says the trial is on. */
const trialProvider = (t: Trial): Provider => ({
  id: TRIAL_ID,
  name: "体验模型",
  protocol: "openai-chat",
  baseUrl: "/api/trial/v1",
  apiKey: "",
  models: [t.model],
  enabled: true,
  custom: false,
  keyless: true,
});

const presetOrder = new Map(presets.map((p, i) => [p.id, i]));
// The trial sorts last, so any service the user connects is picked before it.
const rank = (p: Provider) => (p.id === TRIAL_ID ? 10_000 : (presetOrder.get(p.id) ?? 999));
const sortProviders = (list: Provider[]) => [...list].sort((a, b) => rank(a) - rank(b));

export const useData = create<Data>()((set, get) => ({
  loaded: false,
  agents: [],
  groups: [],
  messages: [],
  runs: [],
  providers: [],
  defaultModel: null,
  unread: {},
  trial: null,
  search: { provider: "bocha", keys: {} },
  siteSearch: null,
  templates: [],
  skills: [],
  mcpServers: [],
  memories: [],
  libraries: [],
  docs: [],
  schedules: [],

  load: async () => {
    await ensureSeeded();
    const [stored, groups, messages, runs, providers, defaultModel, search, templates, skills, mcpServers, uncapped, memories, libraries, docs, schedules] = await Promise.all([
      db.agents.toArray(),
      db.groups.toArray(),
      db.messages.orderBy("at").toArray(),
      db.runs.toArray(),
      db.providers.toArray(),
      getKv<ModelRef | null>("defaultModel", null),
      getKv<SearchConfig>("search", { provider: "bocha", keys: {} }),
      getKv<TeamTemplate[]>("templates", []),
      getKv<Skill[]>("skills", []),
      getKv<McpServer[]>("mcpServers", []),
      getKv("uncapped", false),
      getKv<Memory[]>("memories", []),
      getKv<Library[]>("libraries", []),
      getKv<Doc[]>("docs", []),
      getKv<Schedule[]>("schedules", []),
    ]);
    // Replies used to stop at 2048 tokens by default, which cut long files short. That default now means no cap.
    const agents = uncapped ? stored : stored.map((a) => (a.params.maxTokens === 2048 ? { ...a, params: { ...a.params, maxTokens: 0 } } : a));
    if (!uncapped) {
      await db.agents.bulkPut(agents);
      await setKv("uncapped", true);
    }
    void loadUsage(messages);
    // A reply that was streaming when the page closed ends as stopped, and so do its unfinished steps.
    const fixed = messages.map((m) =>
      m.kind === "text" && m.status === "streaming"
        ? { ...m, status: "stopped" as const, tools: m.tools?.map((t) => (t.status === "running" || t.status === "waiting" ? { ...t, status: "error" as const, detail: "已停止" } : t)) }
        : m,
    );
    const trial = get().trial;
    set({ loaded: true, agents, groups, messages: fixed, runs, providers: sortProviders(trial ? [...providers, trialProvider(trial)] : providers), defaultModel, search, templates, skills, mcpServers, memories, libraries, docs, schedules });
    void get().refreshTrial();
    void get().refreshSiteSearch();
  },

  refreshSiteSearch: async () => {
    // The site's own endpoints serve the website only; the desktop app uses the user's services.
    if (isDesktop) return set({ siteSearch: null });
    try {
      const res = await fetch("/api/search/status");
      const s = res.ok ? await res.json() : null;
      set({ siteSearch: s?.enabled ? { limit: s.limit, remaining: s.remaining } : null });
    } catch {
      set({ siteSearch: null });
    }
  },

  setSiteSearchRemaining: (remaining) => set((s) => (s.siteSearch ? { siteSearch: { ...s.siteSearch, remaining } } : {})),

  refreshTrial: async () => {
    let trial: Trial | null = null;
    if (isDesktop) return;
    try {
      const res = await fetch("/api/trial/status");
      const s = res.ok ? await res.json() : null;
      if (s?.enabled) trial = { model: s.model, limit: s.limit, remaining: s.remaining };
    } catch {
      /* no trial on this host */
    }
    set((s) => {
      const rest = s.providers.filter((p) => p.id !== TRIAL_ID);
      return { trial, providers: sortProviders(trial ? [...rest, trialProvider(trial)] : rest) };
    });
  },

  saveTemplate: (t) => {
    const templates = [...get().templates.filter((x) => x.id !== t.id), t].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    set({ templates });
    void setKv("templates", templates);
  },

  deleteTemplate: (id) => {
    const templates = get().templates.filter((t) => t.id !== id);
    set({ templates });
    void setKv("templates", templates);
  },

  setSkills: (skills) => {
    set({ skills });
    void setKv("skills", skills);
  },

  setMcpServers: (mcpServers) => {
    set({ mcpServers });
    void setKv("mcpServers", mcpServers);
  },

  setSchedules: (schedules) => {
    set({ schedules });
    void setKv("schedules", schedules);
  },

  saveDoc: (doc) => {
    const docs = [...get().docs.filter((d) => d.chat !== doc.chat), doc];
    set({ docs });
    void setKv("docs", docs);
  },

  deleteDoc: (chat) => {
    const docs = get().docs.filter((d) => d.chat !== chat);
    set({ docs });
    void setKv("docs", docs);
  },

  setLibraries: (libraries) => {
    set({ libraries });
    void setKv("libraries", libraries);
  },

  setMemories: (memories) => {
    set({ memories });
    void setKv("memories", memories);
  },

  saveSearch: (search) => {
    set({ search });
    void setKv("search", search);
  },

  setTrialRemaining: (remaining) => set((s) => (s.trial ? { trial: { ...s.trial, remaining } } : {})),

  restoreExamples: async () => {
    await addExamples();
    await get().load();
  },

  saveProvider: async (p) => {
    await db.providers.put(p);
    set((s) => ({ providers: sortProviders([...s.providers.filter((x) => x.id !== p.id), p]) }));
  },

  removeProvider: async (id) => {
    const preset = presets.find((p) => p.id === id);
    if (preset) return get().saveProvider(fromPreset(preset));
    await db.providers.delete(id);
    set((s) => ({ providers: s.providers.filter((p) => p.id !== id) }));
  },

  setDefaultModel: (defaultModel) => {
    void setKv("defaultModel", defaultModel);
    set({ defaultModel });
  },

  addAgent: (agent) => {
    void db.agents.put(agent);
    set((s) => ({ agents: [...s.agents, agent] }));
  },

  deleteAgent: (id) => {
    const { groups, messages } = get();
    // Leave every group; a group that loses its lead hands over to the next member.
    for (const g of groups.filter((g) => g.memberIds.includes(id))) {
      const memberIds = g.memberIds.filter((m) => m !== id);
      get().updateGroup(g.id, { memberIds, leadId: g.leadId === id ? (memberIds[0] ?? "") : g.leadId });
    }
    const own = messages.filter((m) => m.chat === id).map((m) => m.id);
    void db.messages.bulkDelete(own);
    void db.agents.delete(id);
    set((s) => ({ agents: s.agents.filter((a) => a.id !== id), messages: s.messages.filter((m) => m.chat !== id) }));
    const ui = useUi.getState();
    if (ui.active?.id === id) ui.back();
  },

  addGroup: (group) => {
    void db.groups.put(group);
    set((s) => ({ groups: [...s.groups, group] }));
  },

  updateGroup: (id, patch) => {
    const group = get().groups.find((g) => g.id === id);
    if (!group) return;
    const next = { ...group, ...patch };
    void db.groups.put(next);
    set((s) => ({ groups: s.groups.map((g) => (g.id === id ? next : g)) }));
  },

  deleteGroup: (id) => {
    void db.messages.where("chat").equals(id).delete();
    void db.runs.where("groupId").equals(id).delete();
    void db.groups.delete(id);
    set((s) => ({
      groups: s.groups.filter((g) => g.id !== id),
      messages: s.messages.filter((m) => m.chat !== id),
      runs: s.runs.filter((r) => r.groupId !== id),
    }));
    const ui = useUi.getState();
    if (ui.active?.id === id) ui.back();
  },

  updateAgent: (id, patch) => {
    const agent = get().agents.find((a) => a.id === id);
    if (!agent) return;
    const next = { ...agent, ...patch };
    void db.agents.put(next);
    set((s) => ({ agents: s.agents.map((a) => (a.id === id ? next : a)) }));
  },

  setParam: (agentId, key, value) => {
    const agent = get().agents.find((a) => a.id === agentId);
    if (agent) get().updateAgent(agentId, { params: { ...agent.params, [key]: value } });
  },

  setConsensus: (groupId, consensus) => get().updateGroup(groupId, { consensus }),
  setMaxRounds: (groupId, maxRounds) => get().updateGroup(groupId, { maxRounds }),

  addMessage: (m) => {
    void db.messages.put(m);
    set((s) => {
      const active = useUi.getState().active?.id;
      const unread = m.chat !== active && m.kind === "text" && m.sender !== "me" ? { ...s.unread, [m.chat]: (s.unread[m.chat] ?? 0) + 1 } : s.unread;
      return { messages: [...s.messages, m], unread };
    });
  },

  patchMessage: (id, patch, save = false) => {
    set((s) => ({ messages: s.messages.map((m) => (m.id === id ? ({ ...m, ...patch } as Message) : m)) }));
    if (save) {
      const m = get().messages.find((x) => x.id === id);
      if (m) void db.messages.put(m);
    }
  },

  removeMessage: (id) => {
    void db.messages.delete(id);
    set((s) => ({ messages: s.messages.filter((m) => m.id !== id) }));
  },

  clearChat: (chat) => {
    void db.messages.where("chat").equals(chat).delete();
    void db.runs.where("groupId").equals(chat).delete();
    set((s) => ({ messages: s.messages.filter((m) => m.chat !== chat), runs: s.runs.filter((r) => r.groupId !== chat) }));
  },

  saveRun: (run) => {
    void db.runs.put(run);
    set((s) => ({ runs: s.runs.some((r) => r.id === run.id) ? s.runs.map((r) => (r.id === run.id ? run : r)) : [...s.runs, run] }));
  },

  markRead: (chat) => set((s) => (s.unread[chat] ? { unread: { ...s.unread, [chat]: 0 } } : s)),
}));

/** A provider is usable once it has a key (or needs none) and at least one model. */
export const isReady = (p: Provider) => p.enabled && (!!p.apiKey || !!p.keyless) && p.models.length > 0;

/** The model an agent will actually use: its own choice, else the default, else the first usable one. */
export function resolveModel(agent: Agent | undefined, providers: Provider[], fallback: ModelRef | null) {
  const pick = (ref: ModelRef | null) => {
    if (!ref) return null;
    const provider = providers.find((p) => p.id === ref.provider && isReady(p));
    return provider ? { provider, modelId: ref.id } : null;
  };
  const first = providers.find(isReady);
  return pick(agent?.model ?? null) ?? pick(fallback) ?? (first ? { provider: first, modelId: first.models[0] } : null);
}
