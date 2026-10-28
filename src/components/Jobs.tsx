import clsx from "clsx";
import { ChevronDown, CircleStop, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { readJob, stopJob, useJobs, type JobInfo } from "../lib/jobs";

const since = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s} 秒` : s < 3600 ? `${Math.floor(s / 60)} 分钟` : `${Math.floor(s / 3600)} 小时 ${Math.floor((s % 3600) / 60)} 分`;
};

/** One background job: status, its latest output while open, and a stop button. */
function JobRow({ job, onHide }: { job: JobInfo; onHide: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const box = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const pull = () =>
      readJob(job.id, undefined, 6000).then(
        (o) => alive && setText(o.text),
        () => {},
      );
    void pull();
    const t = window.setInterval(pull, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [open, job.id]);

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [text]);

  return (
    <div className="rounded-xl px-1.5 py-1 hover:bg-hover">
      <div className="flex items-center gap-2 text-[13px]">
        {job.done ? (
          <span className={clsx("size-2 shrink-0 rounded-full", job.code === 0 ? "bg-ok" : "bg-bad")} />
        ) : (
          <Loader2 size={13} className="shrink-0 animate-spin text-accent-text" />
        )}
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <span className="min-w-0 truncate font-mono text-[12.5px]">{job.command}</span>
          <ChevronDown size={13} className={clsx("shrink-0 text-fg-3 transition-transform", open && "rotate-180")} />
        </button>
        <span className="shrink-0 text-[12px] text-fg-3">
          {job.done ? `已结束 · 退出码 ${job.code ?? "—"}` : `已运行 ${since(job.started)}`}
        </span>
        {job.done ? (
          <button type="button" aria-label="收起" onClick={onHide} className="grid size-6 shrink-0 place-items-center rounded-full text-fg-3 hover:bg-active hover:text-fg">
            <X size={13} />
          </button>
        ) : (
          <button type="button" onClick={() => void stopJob(job.id)} className="flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] font-medium text-bad hover:bg-bad-soft">
            <CircleStop size={12} /> 停止
          </button>
        )}
      </div>
      {open && (
        <pre ref={box} className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-bg px-2.5 py-2 font-mono text-[12px] leading-[1.5] text-fg-2">
          {text || "（还没有输出）"}
        </pre>
      )}
    </div>
  );
}

/** Above the composer in work mode: the background jobs running in this workspace. */
export function JobsBar({ root }: { root: string }) {
  const jobs = useJobs((s) => s);
  const [hidden, setHidden] = useState<string[]>([]);
  const shown = jobs.filter((j) => j.root === root && !hidden.includes(j.id));
  if (!shown.length) return null;
  return (
    <div className="mb-2 rounded-2xl border border-line bg-raise p-1.5 shadow-[var(--shadow)]">
      <div className="px-1.5 pb-0.5 text-[12px] text-fg-3">后台任务（{shown.filter((j) => !j.done).length} 个在运行）</div>
      {shown.map((j) => (
        <JobRow key={j.id} job={j} onHide={() => setHidden((h) => [...h, j.id])} />
      ))}
    </div>
  );
}
