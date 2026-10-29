import clsx from "clsx";
import { FolderTree, Globe, ListChecks, TerminalSquare, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { resetBrowser } from "../lib/browser";
import { useDock, type DockView } from "../lib/dock";
import { usePrefs, WIDTHS } from "../store";
import { Resizer } from "./Resizer";
import { useJobs } from "../lib/jobs";
import { BrowserView } from "./BrowserView";
import { FilesView } from "./FilesView";
import { TasksView } from "./TasksView";
import { TerminalView } from "./TerminalView";
import { IconButton } from "./ui";

const VIEWS: { view: DockView; label: string; icon: ReactNode }[] = [
  { view: "terminal", label: "终端", icon: <TerminalSquare size={15} /> },
  { view: "browser", label: "浏览器", icon: <Globe size={15} /> },
  { view: "files", label: "文件", icon: <FolderTree size={15} /> },
  { view: "tasks", label: "后台任务", icon: <ListChecks size={15} /> },
];

/**
 * The desktop tool dock on the right. Every view stays mounted while hidden, so shells keep running
 * and pages stay loaded; `cwd` is the open chat's workspace.
 */
export default function Dock({ cwd }: { cwd?: string }) {
  const { open, view } = useDock();
  const running = useJobs((s) => s.filter((j) => !j.done).length);
  useEffect(resetBrowser, []);
  const width = usePrefs((s) => s.dockWidth);
  return (
    <div className={clsx("relative h-full max-w-[75vw] shrink-0 flex-col border-l border-line bg-panel", open ? "flex" : "hidden")} style={{ width }}>
      <Resizer
        side="left"
        width={() => usePrefs.getState().dockWidth}
        min={340}
        max={() => window.innerWidth - usePrefs.getState().sidebarWidth - 420}
        onChange={(w) => usePrefs.getState().set({ dockWidth: w })}
        onReset={() => usePrefs.getState().set({ dockWidth: WIDTHS.dock })}
      />
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-line px-2">
        <div className="flex min-w-0 flex-1 gap-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.view}
              type="button"
              onClick={() => useDock.setState({ view: v.view })}
              className={clsx("flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px]", view === v.view ? "bg-active font-medium text-fg" : "text-fg-2 hover:bg-hover")}
            >
              {v.icon}
              {v.label}
              {v.view === "tasks" && running > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">{running}</span>}
            </button>
          ))}
        </div>
        <IconButton aria-label="收起工具区" title="收起（Ctrl + `），终端和网页继续运行" onClick={() => useDock.setState({ open: false })} className="size-8">
          <X size={17} />
        </IconButton>
      </div>
      <div className="relative min-h-0 flex-1">
        {VIEWS.map((v) => (
          <div key={v.view} className={clsx("absolute inset-0", view !== v.view && "invisible")}>
            {v.view === "terminal" && <TerminalView cwd={cwd} shown={open && view === "terminal"} />}
            {v.view === "browser" && <BrowserView shown={open && view === "browser"} />}
            {v.view === "files" && <FilesView root={cwd} />}
            {v.view === "tasks" && <TasksView shown={open && view === "tasks"} />}
          </div>
        ))}
      </div>
    </div>
  );
}
