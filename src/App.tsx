import clsx from "clsx";
import { useEffect, useSyncExternalStore } from "react";
import { ChatView } from "./components/ChatView";
import { DetailPanel } from "./components/DetailPanel";
import { Editors } from "./components/Editors";
import { ExplainPanel } from "./components/ExplainPanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { Shortcuts } from "./components/Shortcuts";
import { Sidebar } from "./components/Sidebar";
import { UpdateCard } from "./components/UpdateCard";
import { isDesktop, setZoom } from "./lib/desktop";
import { CHAT_WIDTH_MAX, stepZoom, useData, usePrefs, useUi } from "./store";

function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
  );
}

function useTheme() {
  const theme = usePrefs((s) => s.theme);
  const prefersLight = useMedia("(prefers-color-scheme: light)");
  const resolved = theme === "system" ? (prefersLight ? "light" : "dark") : theme;
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "light" ? "#ffffff" : "#0e0e10");
  }, [resolved]);
  const size = usePrefs((s) => s.fontSize);
  useEffect(() => {
    document.documentElement.dataset.size = size;
  }, [size]);
  // How wide the conversation column may get; at the top of the range it fills the window.
  const width = usePrefs((s) => s.chatWidth);
  useEffect(() => {
    document.documentElement.style.setProperty("--chat-w", width >= CHAT_WIDTH_MAX ? "100%" : `${width}px`);
  }, [width]);
}

/**
 * Desktop: Ctrl + plus / minus / 0 and Ctrl + wheel zoom the whole window, and the level is kept.
 * The website leaves zooming to the browser, which already does this.
 */
function useZoom() {
  const zoom = usePrefs((s) => s.zoom);
  useEffect(() => {
    if (isDesktop) setZoom(zoom).catch(() => {});
  }, [zoom]);
  useEffect(() => {
    if (!isDesktop) return;
    let last = 0;
    const change = (dir: 1 | -1 | 0) => {
      const { zoom, set } = usePrefs.getState();
      set({ zoom: dir === 0 ? 1 : stepZoom(zoom, dir) });
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const dir = e.key === "=" || e.key === "+" ? 1 : e.key === "-" || e.key === "_" ? -1 : e.key === "0" ? 0 : null;
      if (dir === null) return;
      e.preventDefault();
      change(dir);
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      // A touchpad pinch sends many small events; one step per 150 ms.
      if (e.timeStamp - last < 150) return;
      last = e.timeStamp;
      change(e.deltaY < 0 ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
    };
  }, []);
}

export default function App() {
  useTheme();
  useZoom();
  const { active, panelOpen, togglePanel, aside, closeAside } = useUi();
  const { loaded, load } = useData();
  const wide = useMedia("(min-width: 1280px)");

  useEffect(() => {
    void load();
  }, [load]);

  if (!loaded) return null;
  // The explain side chat takes the details panel's place while it is open for this chat.
  const explain = aside && aside.chat === active?.id ? aside : null;

  return (
    <div className="flex h-full overflow-hidden">
      <UpdateCard />
      <div className={clsx("h-full w-full md:block md:w-auto", active ? "hidden" : "block")}>
        <Sidebar />
      </div>
      <div className={clsx("h-full min-w-0 flex-1 md:flex", active ? "flex" : "hidden")}>
        <ChatView />
      </div>
      {explain && wide && (
        <div className="h-full w-[400px] shrink-0 border-l border-line">
          <ExplainPanel key={explain.key} aside={explain} />
        </div>
      )}
      {explain && !wide && (
        <div className="fixed inset-0 z-40 flex justify-end bg-[var(--scrim)]" onClick={closeAside}>
          <div className="rise h-full w-full sm:w-[420px] sm:border-l sm:border-line" onClick={(e) => e.stopPropagation()}>
            <ExplainPanel key={explain.key} aside={explain} />
          </div>
        </div>
      )}
      {!explain && active && panelOpen && wide && (
        <div className="h-full w-[380px] shrink-0 border-l border-line">
          <DetailPanel />
        </div>
      )}
      {!explain && active && panelOpen && !wide && (
        <div className="fixed inset-0 z-40 flex justify-end bg-[var(--scrim)]" onClick={() => togglePanel(false)}>
          <div className="rise h-full w-full sm:w-[400px] sm:border-l sm:border-line" onClick={(e) => e.stopPropagation()}>
            <DetailPanel />
          </div>
        </div>
      )}
      <SettingsDialog />
      <Shortcuts />
      <Editors />
    </div>
  );
}
