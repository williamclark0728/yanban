import clsx from "clsx";
import { useState } from "react";
import { fmtTokens } from "../lib/context";
import { dayKey, useUsage, type Tally } from "../lib/usage";
import { Segmented } from "./ui";

const sum = (tallies: Tally[]) => tallies.reduce((a, t) => ({ input: a.input + t.input, output: a.output + t.output, calls: a.calls + t.calls }), { input: 0, output: 0, calls: 0 });

const DAY = 86_400_000;

/** Token use by day and by model, counted on this device. */
export function UsagePanel() {
  const log = useUsage((s) => s.log);
  const [span, setSpan] = useState<"14" | "30" | "90">("14");
  const [hover, setHover] = useState<number | null>(null);
  const n = Number(span);
  const now = Date.now();
  const days = Array.from({ length: n }, (_, i) => {
    const t = now - (n - 1 - i) * DAY;
    const key = dayKey(t);
    return { key, t, ...sum(Object.values(log[key] ?? {})) };
  });
  const today = days.at(-1)!;
  const week = sum(days.slice(-7));
  const all = sum(Object.values(log).flatMap((d) => Object.values(d)));
  const peak = Math.max(1, ...days.map((d) => d.input + d.output));

  const models = new Map<string, Tally>();
  for (const d of days) for (const [model, t] of Object.entries(log[d.key] ?? {})) models.set(model, sum([models.get(model) ?? { input: 0, output: 0, calls: 0 }, t]));
  const byModel = [...models].sort((a, b) => b[1].input + b[1].output - (a[1].input + a[1].output));

  const shown = hover !== null ? days[hover] : null;
  const label = (t: number) => new Date(t).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });

  return (
    <div className="space-y-5">
      <p className="px-1 text-[13px] text-fg-3">
        按模型服务返回的用量统计，只记在这台设备上。费用以各服务的账单为准。
      </p>
      <div className="grid grid-cols-3 gap-2">
        <Tile label="今天" tally={today} />
        <Tile label="最近 7 天" tally={week} />
        <Tile label="累计" tally={all} />
      </div>

      <div className="rounded-2xl border border-line bg-raise p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium">每天的 token</div>
            <div className="h-5 truncate text-[12.5px] text-fg-3">
              {shown
                ? `${label(shown.t)}：输入 ${shown.input.toLocaleString()} · 输出 ${shown.output.toLocaleString()} · ${shown.calls} 次调用`
                : "把鼠标移到柱子上看当天明细"}
            </div>
          </div>
          <Segmented size="sm" value={span} onChange={setSpan} options={[{ value: "14", label: "14 天" }, { value: "30", label: "30 天" }, { value: "90", label: "90 天" }]} />
        </div>
        <div className="flex h-40 items-end gap-[2px] border-b border-line" onMouseLeave={() => setHover(null)}>
          {days.map((d, i) => {
            const total = d.input + d.output;
            return (
              <div key={d.key} className="flex h-full flex-1 cursor-default items-end" onMouseEnter={() => setHover(i)}>
                <div
                  className={clsx("w-full rounded-t-[4px] transition-opacity", hover !== null && hover !== i ? "opacity-50" : "")}
                  style={{ height: total ? `max(2px, ${(total / peak) * 100}%)` : 0, background: "var(--accent)" }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex justify-between text-[11.5px] text-fg-3">
          <span>{label(days[0].t)}</span>
          <span>最高 {fmtTokens(peak)}</span>
          <span>今天</span>
        </div>
      </div>

      <div>
        <div className="mb-2 px-1 text-sm font-medium">按模型（最近 {n} 天）</div>
        {byModel.length ? (
          <div className="overflow-hidden rounded-2xl border border-line bg-raise">
            <table className="w-full text-[13px]">
              <thead className="text-left text-xs text-fg-3">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-medium">模型</th>
                  <th className="px-2 py-2 text-right font-medium">输入</th>
                  <th className="px-2 py-2 text-right font-medium">输出</th>
                  <th className="px-4 py-2 text-right font-medium">调用</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {byModel.map(([model, t]) => (
                  <tr key={model}>
                    <td className="max-w-0 truncate px-4 py-2 font-mono text-[12.5px]">{model}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtTokens(t.input)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtTokens(t.output)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{t.calls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-2xl border border-line bg-raise px-4 py-6 text-center text-[13px] text-fg-3">这段时间还没有用量</div>
        )}
      </div>
    </div>
  );
}

function Tile({ label, tally }: { label: string; tally: Tally }) {
  return (
    <div className="rounded-2xl border border-line bg-raise px-3 py-3">
      <div className="text-xs text-fg-3">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{fmtTokens(tally.input + tally.output)}</div>
      <div className="text-[11.5px] text-fg-3 tabular-nums">
        入 {fmtTokens(tally.input)} · 出 {fmtTokens(tally.output)}
      </div>
    </div>
  );
}
