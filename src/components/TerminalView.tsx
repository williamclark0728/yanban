import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import clsx from "clsx";
import { TerminalSquare } from "lucide-react";
import { useEffect, useRef } from "react";
import { closeTerminal, markEnded, newTerminal, resizeShell, startShell, stopShell, useTerm, writeShell, type TermTab } from "../lib/terminal";
import { DockEmpty, DockTabs } from "./DockTabs";

const DARK = { background: "#141416", foreground: "#e6e6e8", cursor: "#e6e6e8", selectionBackground: "#3a3f4b" };
const LIGHT = { background: "#ffffff", foreground: "#1d1d1f", cursor: "#1d1d1f", selectionBackground: "#cfe0ff" };

/** The dock's terminal: tabs of PowerShell, kept running while another view or the chat is in front. */
export function TerminalView({ cwd, shown }: { cwd?: string; shown: boolean }) {
  const { tabs, active } = useTerm();
  if (!tabs.length) {
    return (
      <DockEmpty
        icon={<TerminalSquare size={28} />}
        title="终端"
        text="在当前对话的工作区打开 PowerShell；没有工作区时在你的用户文件夹。"
        action={
          <button type="button" onClick={() => newTerminal(cwd)} className="mt-1 h-9 rounded-full bg-fg px-4 text-[13px] font-semibold text-bg">
            新建终端
          </button>
        }
      />
    );
  }
  return (
    <div className="flex h-full flex-col">
      <DockTabs
        tabs={tabs}
        active={active}
        icon={<TerminalSquare size={14} />}
        note={(t) => t.ended && <span className="shrink-0 text-fg-3">已退出</span>}
        hint={(t) => t.cwd ?? "用户文件夹"}
        onPick={(key) => useTerm.setState({ active: key })}
        onClose={closeTerminal}
        onNew={() => newTerminal(cwd)}
        newLabel="新建终端（在当前对话的工作区打开）"
      />
      <div className="relative min-h-0 flex-1">
        {tabs.map((t) => (
          <Shell key={t.key} tab={t} shown={shown && t.key === active} />
        ))}
      </div>
    </div>
  );
}

/** One shell. It stays mounted (and running) while another tab or the chat is in front. */
function Shell({ tab, shown }: { tab: TermTab; shown: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const term = useRef<{ xterm: Terminal; fit: FitAddon; id?: string } | null>(null);

  useEffect(() => {
    const light = document.documentElement.dataset.theme === "light";
    const xterm = new Terminal({
      fontFamily: '"Cascadia Mono", Consolas, "Microsoft YaHei Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: light ? LIGHT : DARK,
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(box.current!);
    const state: { xterm: Terminal; fit: FitAddon; id?: string } = { xterm, fit };
    term.current = state;
    try {
      fit.fit();
    } catch {
      /* hidden: sized when shown */
    }
    let closed = false;
    startShell(tab.cwd, xterm.cols, xterm.rows, {
      data: (s) => xterm.write(s),
      exit: () => {
        xterm.write("\r\n\x1b[2m[进程已退出，关掉这个标签或新建一个]\x1b[0m\r\n");
        markEnded(tab.key);
      },
    })
      .then((id) => {
        if (closed) return void stopShell(id);
        state.id = id;
        xterm.onData((d) => void writeShell(id, d).catch(() => {}));
        xterm.onResize(({ cols, rows }) => void resizeShell(id, cols, rows).catch(() => {}));
      })
      .catch((e: Error) => xterm.write(`\x1b[31m${e.message ?? String(e)}\x1b[0m\r\n`));
    // Ctrl+C copies when text is selected; otherwise it goes to the shell as an interrupt. Ctrl+V pastes.
    xterm.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown" || !e.ctrlKey) return true;
      if (e.key === "c" && xterm.hasSelection()) {
        void navigator.clipboard.writeText(xterm.getSelection());
        xterm.clearSelection();
        return false;
      }
      if (e.key === "v") {
        e.preventDefault();
        void navigator.clipboard.readText().then((t) => t && xterm.paste(t));
        return false;
      }
      return true;
    });
    const ro = new ResizeObserver(() => {
      if (box.current?.offsetWidth) {
        try {
          fit.fit();
        } catch {
          /* not laid out yet */
        }
      }
    });
    ro.observe(box.current!);
    return () => {
      closed = true;
      ro.disconnect();
      if (state.id) void stopShell(state.id);
      xterm.dispose();
    };
    // A tab's shell starts once; its cwd never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!shown || !term.current) return;
    try {
      term.current.fit.fit();
    } catch {
      /* not laid out yet */
    }
    term.current.xterm.focus();
  }, [shown]);

  return <div ref={box} className={clsx("absolute inset-0 px-2 pt-2", !shown && "invisible")} />;
}
