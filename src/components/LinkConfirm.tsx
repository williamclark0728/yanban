import { Check, Copy, ExternalLink, Globe } from "lucide-react";
import { useEffect, useState } from "react";
import { openExternal, useLink } from "../lib/links";
import { usePrefs } from "../store";

/** Before a source or link opens: the full address, so the user can check where it goes. */
export function LinkConfirm() {
  const url = useLink((s) => s.url);
  const [skip, setSkip] = useState(false);
  const [copied, setCopied] = useState(false);
  const close = () => useLink.setState({ url: null });

  useEffect(() => {
    if (!url) return;
    setSkip(false);
    setCopied(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [url]);

  if (!url) return null;
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // shown as written
  }
  const go = () => {
    if (skip) usePrefs.getState().set({ confirmLinks: false });
    openExternal(url);
    close();
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-[var(--scrim)] p-4" onClick={close}>
      <div role="dialog" aria-label="打开网页" className="rise w-full max-w-md rounded-3xl border border-line bg-raise p-5 shadow-[var(--shadow)]" onClick={(e) => e.stopPropagation()}>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Globe size={18} /> 在浏览器中打开？
        </h2>
        <div className="mt-1 text-[13px] text-fg-3">核对一下来源网站：</div>
        <div className="mt-2 rounded-xl bg-bg px-3 py-2.5">
          <div className="text-[15px] font-semibold">{host}</div>
          <div className="mt-0.5 max-h-24 overflow-auto break-all font-mono text-[12px] text-fg-2">{url}</div>
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px] text-fg-2 select-none">
          <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          以后直接打开，不再询问（可在设置 → 通用里改回）
        </label>
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
            className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-fg-2 hover:bg-hover"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "已复制" : "复制链接"}
          </button>
          <button type="button" onClick={close} className="ml-auto h-9 rounded-full border border-line-2 px-4 text-[13px] font-medium hover:bg-hover">
            取消
          </button>
          <button type="button" autoFocus onClick={go} className="flex h-9 items-center gap-1.5 rounded-full bg-fg px-4 text-[13px] font-semibold text-bg hover:opacity-90">
            <ExternalLink size={14} /> 打开
          </button>
        </div>
      </div>
    </div>
  );
}
