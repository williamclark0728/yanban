import { ArrowLeft, ArrowRight, Globe, Loader2, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { closeTab, createView, go, history, newTab, place, useBrowser } from "../lib/browser";
import { useLink } from "../lib/links";
import { usePrefs, useUi } from "../store";
import { DockEmpty, DockTabs } from "./DockTabs";
import { useResizing } from "./Resizer";
import { IconButton } from "./ui";

/** Something drawn over the dock (a dialog, the side panel on a narrow window) would be hidden under the native browser view, so the view steps aside. */
function covered() {
  const ui = useUi.getState();
  // While a divider is dragged the view would swallow the mouse; it comes back at the new size.
  return useResizing.getState() || ui.settingsOpen || !!ui.editor || ui.helpOpen || !!useLink.getState().url || !!document.querySelector('[role="dialog"], [data-overlay]');
}

/** The dock's browser: tabs, an address bar, and the page itself (a native view laid over the box below). */
export function BrowserView({ shown }: { shown: boolean }) {
  const { tabs, active } = useBrowser();
  const tab = tabs.find((t) => t.key === active);
  const box = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState("");
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setAddress(tab?.url ?? "");
  }, [tab?.key, tab?.url]);

  // Keep every view where it belongs: the active one over the box, the rest hidden.
  useEffect(() => {
    let last = "";
    const sync = () => {
      const zoom = usePrefs.getState().zoom;
      const r = box.current?.getBoundingClientRect();
      const visible = shown && !!r && r.width > 0 && !covered();
      const b = visible && r ? { x: r.left * zoom, y: r.top * zoom, w: r.width * zoom, h: r.height * zoom } : null;
      const { tabs, active } = useBrowser.getState();
      // A tab with an address but no view yet gets one (hidden until it is in front).
      for (const t of tabs) if (!t.label && t.url) void createView(t.key, b ?? { x: 0, y: 0, w: 1, h: 1 });
      const key = JSON.stringify([b, active, tabs.map((t) => t.label)]);
      if (key === last) return;
      last = key;
      for (const t of tabs) if (t.label) void place(t.label, t.key === active ? b : null);
    };
    sync();
    const timer = window.setInterval(sync, 250);
    const unsub = useBrowser.subscribe(sync);
    return () => {
      clearInterval(timer);
      unsub();
    };
  }, [shown]);

  if (!tabs.length) {
    return (
      <DockEmpty
        icon={<Globe size={28} />}
        title="内置浏览器"
        text="在这里登录 X、小红书、Reddit 等网站后，AI 就能用你的登录状态读这些网站。登录信息只存在这台电脑上。"
        action={
          <form
            className="mt-2 flex w-full max-w-72 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (address.trim()) newTab(address);
            }}
          >
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="输入网址或要搜索的词"
              className="h-9 min-w-0 flex-1 rounded-full border border-line bg-raise px-3 text-[13px] outline-none focus:border-line-2"
            />
            <button type="submit" className="h-9 shrink-0 rounded-full bg-fg px-4 text-[13px] font-semibold text-bg">
              打开
            </button>
          </form>
        }
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <DockTabs
        tabs={tabs}
        active={active}
        icon={tab?.loading ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
        hint={(t) => t.url}
        onPick={(key) => useBrowser.setState({ active: key })}
        onClose={closeTab}
        onNew={() => newTab()}
        newLabel="新建标签页"
      />
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-1.5">
        <IconButton aria-label="后退" disabled={!tab?.label} onClick={() => tab?.label && history(tab.label, "back")} className="size-8 disabled:opacity-30">
          <ArrowLeft size={16} />
        </IconButton>
        <IconButton aria-label="前进" disabled={!tab?.label} onClick={() => tab?.label && history(tab.label, "forward")} className="size-8 disabled:opacity-30">
          <ArrowRight size={16} />
        </IconButton>
        <IconButton aria-label="刷新" disabled={!tab?.label} onClick={() => tab?.label && history(tab.label, "reload")} className="size-8 disabled:opacity-30">
          <RotateCw size={15} />
        </IconButton>
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            editing.current = false;
            if (tab && address.trim()) go(tab.key, address);
            (document.activeElement as HTMLElement | null)?.blur();
          }}
        >
          <input
            value={address}
            onFocus={(e) => {
              editing.current = true;
              e.target.select();
            }}
            onBlur={() => (editing.current = false)}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="输入网址或要搜索的词"
            className="h-8 w-full rounded-full border border-line bg-raise px-3 text-[13px] outline-none focus:border-accent"
          />
        </form>
      </div>
      <div ref={box} className="relative min-h-0 flex-1 bg-white">
        {tab && !tab.url && <div className="grid h-full place-items-center bg-panel text-[13px] text-fg-3">在上面输入网址</div>}
      </div>
    </div>
  );
}
