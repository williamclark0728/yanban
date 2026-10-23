import clsx from "clsx";
import { useEffect, useSyncExternalStore } from "react";
import { ChatView } from "./components/ChatView";
import { DetailPanel } from "./components/DetailPanel";
import { Editors } from "./components/Editors";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sidebar } from "./components/Sidebar";
import { useData, usePrefs, useUi } from "./store";

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
}

export default function App() {
  useTheme();
  const { active, panelOpen, togglePanel } = useUi();
  const { loaded, load } = useData();
  const wide = useMedia("(min-width: 1280px)");

  useEffect(() => {
    void load();
  }, [load]);

  if (!loaded) return null;

  return (
    <div className="flex h-full overflow-hidden">
      <div className={clsx("h-full w-full md:block md:w-auto", active ? "hidden" : "block")}>
        <Sidebar />
      </div>
      <div className={clsx("h-full min-w-0 flex-1 md:flex", active ? "flex" : "hidden")}>
        <ChatView />
      </div>
      {active && panelOpen && wide && (
        <div className="h-full w-[380px] shrink-0 border-l border-line">
          <DetailPanel />
        </div>
      )}
      {active && panelOpen && !wide && (
        <div className="fixed inset-0 z-40 flex justify-end bg-[var(--scrim)]" onClick={() => togglePanel(false)}>
          <div className="rise h-full w-full sm:w-[400px] sm:border-l sm:border-line" onClick={(e) => e.stopPropagation()}>
            <DetailPanel />
          </div>
        </div>
      )}
      <SettingsDialog />
      <Editors />
    </div>
  );
}
