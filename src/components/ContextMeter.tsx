import clsx from "clsx";
import { Brain, ChevronDown, Loader2 } from "lucide-react";
import { useState } from "react";
import { compact, contextUse, useBusy } from "../lib/chat";
import { AUTO_COMPACT, fmtTokens } from "../lib/context";
import { useData, useUi } from "../store";
import type { Agent, Effort } from "../types";

/** A ring showing how full the context is; opens details and a compress button. */
export function ContextMeter({ chat }: { chat: string }) {
  // Re-render as messages change.
  useData((s) => s.messages.length);
  useData((s) => s.messages.at(-1)?.at);
  const busy = useBusy((s) => !!s[chat]);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const use = contextUse(chat);
  if (!use) return null;
  const ratio = Math.min(1, use.used / use.window);
  const tone = ratio >= AUTO_COMPACT ? "text-bad" : ratio >= 0.5 ? "text-warn" : "text-fg-3";
  const r = 7;
  const c = 2 * Math.PI * r;

  const run = async () => {
    setWorking(true);
    await compact(chat);
    setWorking(false);
    setOpen(false);
  };

  return (
    <div className="relative shrink-0 self-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`上下文约 ${fmtTokens(use.used)} / ${fmtTokens(use.window)}`}
        className={clsx("flex h-8 items-center gap-1.5 rounded-full px-2 text-[12px] tabular-nums transition-colors hover:bg-active", tone, open && "bg-active")}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" className="-rotate-90">
          <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
          <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray={`${c * ratio} ${c}`} strokeLinecap="round" />
        </svg>
        <span className="hidden sm:inline">上下文 {percent(ratio)}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="rise absolute bottom-full right-0 z-20 mb-3 w-72 rounded-2xl border border-line bg-raise p-4 text-sm shadow-[var(--shadow)]">
            <div className="font-medium">上下文</div>
            <div className="mt-1 text-[13px] text-fg-2">
              约 {fmtTokens(use.used)} / {fmtTokens(use.window)} tokens（{(ratio * 100).toFixed(1)}%）
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raise-2">
              <div className={clsx("h-full rounded-full", ratio >= AUTO_COMPACT ? "bg-bad" : ratio >= 0.5 ? "bg-warn" : "bg-accent")} style={{ width: `${ratio * 100}%` }} />
            </div>
            <p className="mt-3 text-[12.5px] leading-relaxed text-fg-3">
              {use.model} 的窗口按 {fmtTokens(use.window)} 估算，包括设定、最近的消息、附件和工具说明。超过 {AUTO_COMPACT * 100}% 时，发下一条消息前会自动压缩：把之前的对话写成摘要，之后只带摘要。
            </p>
            <button
              type="button"
              disabled={busy || working || use.pending < 2}
              onClick={() => void run()}
              className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-raise-2 font-medium hover:bg-active disabled:opacity-40"
            >
              {working && <Loader2 size={15} className="animate-spin" />}
              {working ? "正在压缩…" : "现在压缩"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Small shares keep one decimal, so a chat that has started never reads 0%. */
const percent = (ratio: number) => {
  const p = ratio * 100;
  return p > 0 && p < 10 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`;
};

export const EFFORTS: { value: Effort; label: string; hint: string }[] = [
  { value: "auto", label: "默认", hint: "按模型服务自己的设置" },
  { value: "off", label: "不思考", hint: "直接回答，最快" },
  { value: "low", label: "低", hint: "简单问题" },
  { value: "medium", label: "中", hint: "一般任务" },
  { value: "high", label: "高", hint: "复杂推理、写代码、做方案" },
  { value: "max", label: "最高", hint: "最难的问题，最慢、最费 token" },
];

/** Composer button for the agent's thinking effort. Services that can't adjust it ignore the setting. */
export function EffortChip({ agent }: { agent: Agent }) {
  const setParam = useData((s) => s.setParam);
  const open = useUi((s) => s.chip === "effort");
  const setOpen = (v: boolean) => useUi.getState().setChip(v ? "effort" : null);
  const value = agent.params.effort ?? "auto";
  const current = EFFORTS.find((e) => e.value === value)!;
  return (
    <div className="relative hidden shrink-0 self-center sm:block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title="思考强度"
        className={clsx("flex h-8 items-center gap-1 rounded-full px-2.5 text-[13px] text-fg-2 transition-colors hover:bg-active hover:text-fg", open && "bg-active text-fg")}
      >
        <Brain size={14} />
        {value === "auto" ? "思考" : current.label}
        <ChevronDown size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="rise absolute bottom-full left-0 z-20 mb-3 w-64 rounded-2xl border border-line bg-raise p-2 shadow-[var(--shadow)]">
            <div className="px-2 pb-2 pt-1 text-xs text-fg-3">思考强度（不支持调节的模型会忽略）</div>
            {EFFORTS.map((e) => (
              <button
                key={e.value}
                type="button"
                onClick={() => {
                  setParam(agent.id, "effort", e.value);
                  setOpen(false);
                }}
                className={clsx("flex w-full items-baseline gap-2 rounded-xl px-2.5 py-2 text-left hover:bg-hover", e.value === value && "bg-active")}
              >
                <span className="w-12 shrink-0 text-sm font-medium">{e.label}</span>
                <span className="text-[12.5px] text-fg-3">{e.hint}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
