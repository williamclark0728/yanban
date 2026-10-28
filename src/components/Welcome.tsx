import { GraduationCap, Sparkles } from "lucide-react";
import { useState } from "react";
import { DEMO_IDS } from "../lib/seed";
import { useData, useUi } from "../store";
import { START } from "./Guide";

const KEY = "yanban.welcomed";

function seen() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** First visit: what 研伴 is and three steps to start, with the tutorial one click away. */
export function Welcome() {
  // Someone who has already sent messages knows their way around; they never see this.
  const fresh = useData((s) => !s.messages.some((m) => m.kind === "text" && m.sender === "me" && !DEMO_IDS.has(m.id)));
  const openSettings = useUi((s) => s.openSettings);
  const [open, setOpen] = useState(() => !seen());
  if (!open || !fresh) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* private window: it shows again next time, nothing worse */
    }
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--scrim)] p-4">
      <div role="dialog" aria-label="欢迎使用研伴" className="rise w-full max-w-md rounded-3xl border border-line bg-raise p-6 shadow-[var(--shadow)]">
        <div className="flex items-center gap-2 text-xl font-semibold">
          <Sparkles size={20} className="text-accent-text" /> 欢迎使用研伴
        </div>
        <p className="mt-2 text-[14px] leading-relaxed text-fg-2">
          研伴是一个科研助手：可以和单个 AI 私聊，也可以把任务交给“群聊”，让几个 AI 分工写作、互相核查后再交付。不用注册，打开就能用。
        </p>
        <ol className="mt-4 space-y-2 text-[13.5px] text-fg-2">
          {START.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11.5px] font-semibold text-accent-text">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[12.5px] text-fg-3">以后点左下角的问号，或者打开 设置 → 新手教程，随时能再看。</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              close();
              openSettings("guide");
            }}
            className="flex h-10 items-center gap-1.5 rounded-full border border-line-2 px-4 text-sm font-medium hover:bg-hover"
          >
            <GraduationCap size={16} /> 看新手教程
          </button>
          <button type="button" autoFocus onClick={close} className="h-10 rounded-full bg-fg px-5 text-sm font-semibold text-bg hover:opacity-90">
            开始使用
          </button>
        </div>
      </div>
    </div>
  );
}
