import clsx from "clsx";
import { CheckCircle2, ChevronDown, Circle, Loader2, XCircle } from "lucide-react";
import { useState } from "react";
import { useData } from "../store";
import type { BoardItem } from "../types";
import { BotAvatar } from "./Avatar";

const typeLabel: Record<BoardItem["type"], string> = { produce: "产出", review: "审查", summary: "汇总" };

/** Who is doing what in the group's running task, above the composer. */
export function TaskBoard({ group }: { group: string }) {
  const run = useData((s) => s.runs.findLast((r) => r.groupId === group));
  const agents = useData((s) => s.agents);
  const [open, setOpen] = useState(true);
  if (!run || run.status !== "running" || !run.board?.length) return null;
  const done = run.board.filter((b) => b.status === "done").length;
  return (
    <div className="mb-2 rounded-2xl border border-line bg-raise px-3 py-2 shadow-[var(--shadow)]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left text-[13px] font-medium">
        <Loader2 size={14} className="animate-spin text-accent-text" />
        <span className="flex-1">
          任务看板 · {done}/{run.board.length} 完成
        </span>
        <ChevronDown size={14} className={clsx("text-fg-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1">
          {run.board.map((b, i) => {
            const agent = agents.find((a) => a.id === b.agentId);
            return (
              <li key={i} className="flex items-center gap-2 text-[13px]">
                {b.status === "done" ? (
                  <CheckCircle2 size={14} className="shrink-0 text-ok" />
                ) : b.status === "failed" ? (
                  <XCircle size={14} className="shrink-0 text-bad" />
                ) : b.status === "working" ? (
                  <Loader2 size={14} className="shrink-0 animate-spin text-accent-text" />
                ) : (
                  <Circle size={14} className="shrink-0 text-fg-3" />
                )}
                {agent && <BotAvatar agent={agent} size={18} />}
                <span className="shrink-0 font-medium">{agent?.name ?? "成员"}</span>
                <span className="shrink-0 rounded-md bg-hover px-1.5 text-[11.5px] text-fg-2">{b.note ?? typeLabel[b.type]}</span>
                <span className="min-w-0 truncate text-fg-2">{b.task}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
