// The desktop terminal: which shells are open. The shells live in Rust (term.rs); their output arrives
// as `term-data` events.
import { create } from "zustand";
import { call, onEvent } from "./desktop";
import { showDock } from "./dock";

export interface TermTab {
  /** The page's own id; the shell's id comes from term_open once it has started. */
  key: string;
  title: string;
  cwd?: string;
  ended?: boolean;
}

export const useTerm = create<{ tabs: TermTab[]; active: string | null }>(() => ({ tabs: [], active: null }));

const folderName = (cwd?: string) => cwd?.split(/[\\/]/).filter(Boolean).at(-1) ?? "PowerShell";

/** Opens a new shell tab in `cwd` (the home folder when unset) and shows it. */
export function newTerminal(cwd?: string) {
  const tab: TermTab = { key: crypto.randomUUID(), title: folderName(cwd), cwd };
  useTerm.setState((s) => ({ tabs: [...s.tabs, tab], active: tab.key }));
  showDock("terminal");
}

export function closeTerminal(key: string) {
  useTerm.setState((s) => {
    const tabs = s.tabs.filter((t) => t.key !== key);
    return { tabs, active: s.active === key ? (tabs.at(-1)?.key ?? null) : s.active };
  });
}

export const markEnded = (key: string) => useTerm.setState((s) => ({ tabs: s.tabs.map((t) => (t.key === key ? { ...t, ended: true } : t)) }));

// One listener for all shells, handing each its own output.
const sinks = new Map<string, { data: (s: string) => void; exit: () => void }>();
let listening: Promise<unknown> | null = null;

function listen() {
  listening ??= Promise.all([
    onEvent<{ id: string; data: string }>("term-data", ({ id, data }) => sinks.get(id)?.data(data)),
    onEvent<string>("term-exit", (id) => sinks.get(id)?.exit()),
  ]);
  return listening;
}

/** Starts a shell and connects it to `sink`; returns the shell's id. */
export async function startShell(cwd: string | undefined, cols: number, rows: number, sink: { data: (s: string) => void; exit: () => void }) {
  await listen();
  const id = await call<string>("term_open", { cwd: cwd ?? null, cols, rows });
  sinks.set(id, sink);
  return id;
}

export const writeShell = (id: string, data: string) => call("term_write", { id, data });
export const resizeShell = (id: string, cols: number, rows: number) => call("term_resize", { id, cols, rows });

export function stopShell(id: string) {
  sinks.delete(id);
  return call("term_close", { id });
}
