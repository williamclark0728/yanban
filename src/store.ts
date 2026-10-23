import { create } from "zustand";
import { persist } from "zustand/middleware";
import { presets, fromPreset } from "./lib/catalog";
import { addExamples, db, ensureSeeded, getKv, setKv } from "./lib/db";
import type { Agent, ChatRef, Group, Message, ModelRef, Provider, Run } from "./types";

export type Theme = "dark" | "light" | "system";
export type PanelTab = "info" | "members" | "runs" | "memory";
export type SettingsTab = "general" | "providers";

interface Prefs {
  mode: "simple" | "dev";
  theme: Theme;
  /** What the user wants to be called; empty until they set it. */
  name: string;
  setMode: (mode: Prefs["mode"]) => void;
  setTheme: (theme: Theme) => void;
  setName: (name: string) => void;
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      mode: "simple",
      theme: "dark",
      name: "",
      setMode: (mode) => set({ mode }),
      setTheme: (theme) => set({ theme }),
      setName: (name) => set({ name: name.slice(0, 20) }),
    }),
    { name: "yanban.prefs" },
  ),
);

interface Ui {
  active: ChatRef | null;
  panelOpen: boolean;
  panelTab: PanelTab;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  editProvider: string | null;
  editor: { kind: "agent" | "group"; id?: string } | null;
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
}

export const useUi = create<Ui>()((set) => ({
  active: { kind: "agent", id: "helper" },
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
  setParam: (agentId: string, key: keyof Agent["params"], value: number) => void;
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

  load: async () => {
    await ensureSeeded();
    const [agents, groups, messages, runs, providers, defaultModel] = await Promise.all([
      db.agents.toArray(),
      db.groups.toArray(),
      db.messages.orderBy("at").toArray(),
      db.runs.toArray(),
      db.providers.toArray(),
      getKv<ModelRef | null>("defaultModel", null),
    ]);
    // A reply that was streaming when the page closed ends as stopped.
    const fixed = messages.map((m) => (m.kind === "text" && m.status === "streaming" ? { ...m, status: "stopped" as const } : m));
    const trial = get().trial;
    set({ loaded: true, agents, groups, messages: fixed, runs, providers: sortProviders(trial ? [...providers, trialProvider(trial)] : providers), defaultModel });
    void get().refreshTrial();
  },

  refreshTrial: async () => {
    let trial: Trial | null = null;
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
