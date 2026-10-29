import clsx from "clsx";
import { ChevronDown, ListChecks, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { forgetJobs, refreshJobs, useJobs } from "../lib/jobs";
import { DockEmpty } from "./DockTabs";
import { JobRow } from "./Jobs";
import { IconButton } from "./ui";

/** The dock's background jobs, from every workspace: running ones first, then the finished ones. */
export function TasksView({ shown }: { shown: boolean }) {
  const jobs = useJobs((s) => s);
  const [doneOpen, setDoneOpen] = useState(true);
  // Finished jobs stop the app's own refreshing; keep the list current while it is on screen.
  useEffect(() => {
    if (!shown) return;
    void refreshJobs();
    const t = window.setInterval(() => void refreshJobs(), 3000);
    return () => clearInterval(t);
  }, [shown]);
  const running = jobs.filter((j) => !j.done).sort((a, b) => b.started - a.started);
  const done = jobs.filter((j) => j.done).sort((a, b) => b.started - a.started);
  if (!jobs.length) {
    return (
      <DockEmpty
        icon={<ListChecks size={28} />}
        title="没有后台任务"
        text="工作模式下，AI 会把很久才结束的命令（训练、编译、本地服务器）放到后台运行。它们会列在这里，可以看输出或停止。"
      />
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center border-b border-line pl-3 pr-1.5">
        <span className="flex-1 text-[13px] font-medium">后台任务</span>
        <IconButton aria-label="清除已结束的任务" title="清除已结束的任务" disabled={!done.length} onClick={() => void forgetJobs(done.map((j) => j.id))} className="size-8 disabled:opacity-30">
          <Trash2 size={15} />
        </IconButton>
      </div>
      <div className="scroll min-h-0 flex-1 space-y-3 p-2">
        {running.length > 0 && (
          <section>
            <div className="px-1.5 pb-1 text-[12px] text-fg-3">运行中 {running.length}</div>
            {running.map((j) => (
              <JobRow key={j.id} job={j} where onHide={() => {}} />
            ))}
          </section>
        )}
        {done.length > 0 && (
          <section>
            <button type="button" onClick={() => setDoneOpen((v) => !v)} className="flex items-center gap-1 px-1.5 pb-1 text-[12px] text-fg-3 hover:text-fg">
              <ChevronDown size={13} className={clsx("transition-transform", !doneOpen && "-rotate-90")} />
              已结束 {done.length}
            </button>
            {doneOpen && done.map((j) => <JobRow key={j.id} job={j} where onHide={() => void forgetJobs([j.id])} />)}
          </section>
        )}
      </div>
    </div>
  );
}
