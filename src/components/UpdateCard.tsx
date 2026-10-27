import { ArrowUpCircle, Loader2, X } from "lucide-react";
import { useEffect } from "react";
import { isDesktop } from "../lib/desktop";
import { checkUpdate, installUpdate, useUpdate } from "../lib/update";
import { IconButton } from "./ui";

const EVERY = 6 * 3600_000;

/** Desktop only: a card in the corner when a newer version is out. Checks at startup and every few hours. */
export function UpdateCard() {
  const { next, progress, error, dismissed } = useUpdate();
  useEffect(() => {
    if (!isDesktop) return;
    void checkUpdate(true);
    const timer = setInterval(() => void checkUpdate(true), EVERY);
    return () => clearInterval(timer);
  }, []);
  if (!next || dismissed) return null;
  return (
    <div className="rise fixed bottom-4 left-4 z-50 w-[300px] rounded-2xl border border-line bg-raise p-4 shadow-[var(--shadow)]">
      <div className="flex items-start gap-3">
        <ArrowUpCircle size={20} className="mt-0.5 shrink-0 text-accent-text" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">研伴 {next.version} 可以更新了</div>
          {next.notes && <p className="mt-1 line-clamp-3 text-[13px] text-fg-3">{next.notes}</p>}
          {error && <p className="mt-1 text-[13px] text-bad">{error}</p>}
        </div>
        {progress === null && (
          <IconButton aria-label="稍后" className="-mr-1 -mt-1 size-7" onClick={() => useUpdate.setState({ dismissed: true })}>
            <X size={15} />
          </IconButton>
        )}
      </div>
      {progress === null ? (
        <button type="button" onClick={() => void installUpdate()} className="mt-3 h-9 w-full rounded-xl bg-fg text-sm font-semibold text-bg hover:opacity-90">
          更新并重启
        </button>
      ) : (
        <div className="mt-3">
          <div className="flex items-center gap-1.5 text-[13px] text-fg-2">
            <Loader2 size={14} className="animate-spin" /> 正在下载 {Math.round(progress * 100)}%，完成后自动安装并重启
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raise-2">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Settings row: the installed version and a manual check. */
export function VersionRow() {
  const { current, next, checking, error } = useUpdate();
  const status = error || [current && `当前 ${current}`, checking ? "正在检查…" : next ? `有新版本 ${next.version}` : current ? "已是最新" : ""].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center gap-3">
      <span className={error ? "text-[13px] text-bad" : "text-[13px] text-fg-3"}>{status}</span>
      {next ? (
        <button type="button" onClick={() => useUpdate.setState({ dismissed: false })} className="h-10 rounded-full bg-fg px-5 text-sm font-semibold text-bg hover:opacity-90">
          更新
        </button>
      ) : (
        <button
          type="button"
          disabled={checking}
          onClick={() => void checkUpdate()}
          className="h-10 rounded-full border border-line-2 px-5 text-sm font-medium hover:bg-hover disabled:opacity-50"
        >
          检查更新
        </button>
      )}
    </div>
  );
}
