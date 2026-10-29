// The built-in browser (desktop): tabs are WebView2 views that Rust lays over a box in the dock (browser.rs).
// They share the app's browser profile, so a site the user signs into here stays signed in, and the agents
// can read it with browser_open / browser_read.
import readability from "@mozilla/readability/Readability.js?raw";
import { create } from "zustand";
import { call, onEvent } from "./desktop";
import { showDock } from "./dock";
import { openLink } from "./links";

export interface WebTab {
  key: string;
  /** The Rust view's label, once it has been created. */
  label?: string;
  url: string;
  title: string;
  loading: boolean;
  /** The agent that opened this tab; its next browser_open reuses it. Its name stays in front of the title. */
  owner?: string;
  ownerName?: string;
}

export const useBrowser = create<{ tabs: WebTab[]; active: string | null }>(() => ({ tabs: [], active: null }));

const patch = (key: string, p: Partial<WebTab>) => useBrowser.setState((s) => ({ tabs: s.tabs.map((t) => (t.key === key ? { ...t, ...p } : t)) }));
const byLabel = (label: string) => useBrowser.getState().tabs.find((t) => t.label === label);

/** "x.com" or "https://…" → a full address; anything without a dot searches Bing. */
export function toUrl(input: string) {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^[^\s]+\.[^\s]{2,}(\/.*)?$/.test(s)) return `https://${s}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(s)}`;
}

const hostTitle = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

let listening: Promise<unknown> | null = null;
function listen() {
  listening ??= Promise.all([
    // Views left over from before a page reload would float over the page with no tab to manage them.
    call("web_reset"),
    onEvent<{ label: string; url?: string; title?: string; loading?: boolean }>("web-state", ({ label, url, title, loading }) => {
      const tab = byLabel(label);
      if (!tab) return;
      // Each event carries one of these; the others arrive as null.
      const named = title && (tab.ownerName ? `${tab.ownerName} · ${title}` : title);
      patch(tab.key, { ...(url ? { url } : {}), ...(named ? { title: named } : {}), ...(loading != null ? { loading } : {}) });
      for (const w of waiters.get(label) ?? []) w();
    }),
    // mailto:, app links and the like open outside, after the usual confirmation.
    onEvent<string>("web-external", (url) => openLink(url)),
  ]);
  return listening;
}

/** At startup: closes views a previous page left behind (a reload in development). */
export function resetBrowser() {
  void listen();
}

/** Opens a new tab and shows the browser; the view itself is created once its box is laid out. */
export function newTab(url = "", owner?: { id: string; name: string }) {
  void listen();
  const host = url ? hostTitle(toUrl(url)) : "新标签页";
  const tab: WebTab = { key: crypto.randomUUID(), url: url ? toUrl(url) : "", title: owner ? `${owner.name} · ${host}` : host, loading: !!url, owner: owner?.id, ownerName: owner?.name };
  useBrowser.setState((s) => ({ tabs: [...s.tabs, tab], active: tab.key }));
  showDock("browser");
  return tab.key;
}

export function closeTab(key: string) {
  const tab = useBrowser.getState().tabs.find((t) => t.key === key);
  if (tab?.label) void call("web_close", { label: tab.label });
  useBrowser.setState((s) => {
    const tabs = s.tabs.filter((t) => t.key !== key);
    return { tabs, active: s.active === key ? (tabs.at(-1)?.key ?? null) : s.active };
  });
}

type Box = { x: number; y: number; w: number; h: number };

const creating = new Set<string>();

/** Creates the tab's view at `box` (window coordinates), the first time it has a page to show. */
export async function createView(key: string, box: Box) {
  const tab = useBrowser.getState().tabs.find((t) => t.key === key);
  if (!tab || tab.label || !tab.url || creating.has(key)) return;
  creating.add(key);
  try {
    await listen();
    const label = await call<string>("web_open", { url: tab.url, ...box });
    // Closed while it was being made.
    if (!useBrowser.getState().tabs.some((t) => t.key === key)) return void call("web_close", { label });
    patch(key, { label });
  } catch (e) {
    // Cleared so it isn't retried every moment; typing the address again tries once more.
    patch(key, { url: "", loading: false, title: `打不开：${e instanceof Error ? e.message : String(e)}` });
  } finally {
    creating.delete(key);
  }
}

export function place(label: string, box: Box | null) {
  return call("web_place", { label, x: box?.x ?? 0, y: box?.y ?? 0, w: box?.w ?? 1, h: box?.h ?? 1, visible: !!box }).catch(() => {});
}

export function go(key: string, input: string) {
  const tab = useBrowser.getState().tabs.find((t) => t.key === key);
  if (!tab) return;
  const url = toUrl(input);
  patch(key, { url, loading: true, title: tab.label ? tab.title : tab.ownerName ? `${tab.ownerName} · ${hostTitle(url)}` : hostTitle(url) });
  if (tab.label) void call("web_navigate", { label: tab.label, url }).catch(() => patch(key, { loading: false }));
}

export const history = (label: string, to: "back" | "forward" | "reload") => call("web_go", { label, to }).catch(() => {});

// ---------- reading a page for the agents ----------

const waiters = new Map<string, Set<() => void>>();

/** Resolves on the tab's next state change, or after `ms`. */
function changed(label: string, ms: number) {
  return new Promise<void>((resolve) => {
    const set = waiters.get(label) ?? new Set();
    waiters.set(label, set);
    const done = () => {
      set.delete(done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, ms);
    set.add(done);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until the tab has a view and has finished loading (at most `ms`), then a moment for scripts to draw. */
async function settle(key: string, ms = 25_000) {
  const end = Date.now() + ms;
  for (;;) {
    const tab = useBrowser.getState().tabs.find((t) => t.key === key);
    if (!tab) throw new Error("浏览器标签被关掉了");
    if (tab.label && !tab.loading) break;
    if (Date.now() > end) break;
    if (tab.label) await changed(tab.label, 1000);
    else await sleep(200);
  }
  await sleep(1500);
}

/** Runs in the page: the readable text (Readability for articles, the whole page for feeds) and its links. */
const EXTRACT = `(() => {
  try {
    ${readability}
    let article = null;
    try { article = new Readability(document.cloneNode(true)).parse(); } catch (e) {}
    const body = (document.body && document.body.innerText) || "";
    const main = article && article.textContent ? article.textContent.trim() : "";
    const text = main.length > Math.min(800, body.length * 0.4) ? main : body;
    const links = [];
    const seen = new Set();
    for (const a of document.querySelectorAll("a[href]")) {
      const t = (a.innerText || a.getAttribute("aria-label") || "").trim().replace(/\\s+/g, " ");
      const h = a.href;
      if (t.length < 2 || seen.has(h) || !/^https?:/.test(h)) continue;
      seen.add(h);
      links.push(t.slice(0, 80) + " — " + h);
      if (links.length >= 60) break;
    }
    return JSON.stringify({ url: location.href, title: document.title, text: text.replace(/\\n{3,}/g, "\\n\\n").trim().slice(0, 15000), links });
  } catch (e) {
    return JSON.stringify({ error: String(e) });
  }
})()`;

interface PageText {
  url: string;
  title: string;
  text: string;
  links: string[];
  error?: string;
}

async function evalIn(label: string, script: string) {
  const raw = await call<string>("web_eval", { label, script });
  // ExecuteScript returns the script's value as JSON: here a JSON string holding our JSON.
  const inner = JSON.parse(raw || "null");
  return typeof inner === "string" ? JSON.parse(inner) : inner;
}

/** Reads a tab: optionally scrolls a few screens first so feeds load more posts. */
export async function readTab(key: string, more = false): Promise<PageText> {
  const tab = useBrowser.getState().tabs.find((t) => t.key === key);
  if (!tab?.label) throw new Error("浏览器里还没有打开页面");
  if (more) {
    for (let i = 0; i < 3; i++) {
      await call("web_eval", { label: tab.label, script: "window.scrollBy(0, innerHeight * 0.9); 1" });
      await sleep(1200);
    }
  }
  const page = (await evalIn(tab.label, EXTRACT)) as PageText;
  if (page?.error) throw new Error(page.error);
  return page;
}

/** An agent opens `url` in its own tab (reused across its calls) and reads it. */
export async function agentOpen(owner: string, ownerName: string, url: string, more = false) {
  void listen();
  const tabs = useBrowser.getState().tabs;
  let key = tabs.find((t) => t.owner === owner)?.key;
  if (key) {
    useBrowser.setState({ active: key });
    showDock("browser");
    go(key, url);
  } else key = newTab(url, { id: owner, name: ownerName });
  await settle(key);
  return readTab(key, more);
}

/** The tab the user is looking at, for browser_read. */
export const activeTab = () => {
  const { tabs, active } = useBrowser.getState();
  return tabs.find((t) => t.key === active) ?? tabs.at(-1);
};
