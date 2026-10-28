import clsx from "clsx";
import { CheckCircle2, Loader2, Play, Target, X } from "lucide-react";
import { useState } from "react";
import { useBusy } from "../lib/chat";
import { clearGoal, GOAL_ROUNDS, resumeGoal, startGoal, useGoal } from "../lib/goal";
import { Segmented } from "./ui";

/** Above a private chat's composer: set a goal (/goal), or follow one the agent is working toward. */
export function GoalBar({ chat, editing, onClose, send }: { chat: string; editing: boolean; onClose: () => void; send: (text: string) => void }) {
  const goal = useGoal((s) => s[chat]);
  const busy = useBusy((s) => !!s[chat]);
  const [text, setText] = useState("");
  const [max, setMax] = useState(String(GOAL_ROUNDS[1]));

  if (editing) {
    return (
      <form
        className="mb-2 space-y-2 rounded-2xl border border-accent/40 bg-accent-soft p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim() || busy) return;
          startGoal(chat, text, Number(max), send);
          setText("");
          onClose();
        }}
      >
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-accent-text">
          <Target size={14} /> 会话目标：设好后智能体会自动接着做，每轮检查一次是否完成
        </div>
        <textarea
          autoFocus
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="比如：把资料库里 5 篇论文的方法和实验结果整理成一张对比表，并写一段综述"
          className="w-full resize-none rounded-xl border border-line bg-raise px-3 py-2 text-[14px] outline-none placeholder:text-fg-3 focus:border-accent"
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-fg-2">最多</span>
          <Segmented size="sm" value={max} onChange={setMax} options={GOAL_ROUNDS.map((n) => ({ value: String(n), label: `${n} 轮` }))} />
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="h-8 rounded-full px-3 text-[13px] text-fg-2 hover:bg-hover">
            取消
          </button>
          <button type="submit" disabled={!text.trim() || busy} className="h-8 rounded-full bg-fg px-4 text-[13px] font-semibold text-bg disabled:opacity-40">
            开始
          </button>
        </div>
      </form>
    );
  }

  if (!goal) return null;
  const working = goal.status === "running";
  return (
    <div className={clsx("mb-2 flex items-center gap-2 rounded-2xl border px-3 py-2 text-[13px]", goal.status === "done" ? "border-ok/40 bg-ok-soft" : "border-line bg-raise")}>
      {goal.status === "done" ? <CheckCircle2 size={15} className="shrink-0 text-ok" /> : <Target size={15} className="shrink-0 text-accent-text" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{goal.text}</span>
        <span className="block truncate text-[12px] text-fg-3">
          {goal.status === "done"
            ? `已完成，用了 ${goal.round} 轮`
            : working
              ? `进行中 · 第 ${Math.min(goal.round + 1, goal.max)}/${goal.max} 轮${goal.left ? ` · 还差：${goal.left}` : ""}`
              : `已暂停（第 ${goal.round}/${goal.max} 轮）${goal.note ? `：${goal.note}` : ""}${goal.left ? ` · 还差：${goal.left}` : ""}`}
        </span>
      </span>
      {working && busy && <Loader2 size={14} className="shrink-0 animate-spin text-fg-3" />}
      {goal.status === "paused" && (
        <button type="button" disabled={busy} onClick={() => resumeGoal(chat, send)} className="flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 font-medium text-accent-text hover:bg-hover disabled:opacity-40">
          <Play size={13} /> 继续
        </button>
      )}
      <button type="button" aria-label="结束目标" title="结束目标" onClick={() => clearGoal(chat)} className="grid size-7 shrink-0 place-items-center rounded-full text-fg-2 hover:bg-hover hover:text-fg">
        <X size={14} />
      </button>
    </div>
  );
}
