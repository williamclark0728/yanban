import clsx from "clsx";
import { Check, CheckCircle2, Columns3 } from "lucide-react";
import { choose, MAX_COMPARE, sameModel, setCompare, useCompare } from "../lib/compare";
import { isReady, resolveModel, useData, useUi } from "../store";
import type { Agent, Message, ModelRef, TextMessage } from "../types";
import { MessageItem } from "./MessageItem";
import { useShallow } from "zustand/react/shallow";

const NONE: ModelRef[] = [];

/** Composer button: pick two or three models to answer side by side. */
export function CompareChip({ agent }: { agent: Agent }) {
  const { providers, defaultModel } = useData(useShallow((s) => ({ providers: s.providers, defaultModel: s.defaultModel })));
  const picked = useCompare((s) => s[agent.id] ?? NONE);
  const open = useUi((s) => s.chip === "compare");
  const setOpen = (v: boolean) => useUi.getState().setChip(v ? "compare" : null);
  const ready = providers.filter(isReady);
  const on = picked.length >= 2;

  const toggle = (ref: ModelRef) => {
    const has = picked.some((p) => sameModel(p, ref));
    if (has) setCompare(agent.id, picked.filter((p) => !sameModel(p, ref)));
    else if (picked.length < MAX_COMPARE) setCompare(agent.id, [...picked, ref]);
  };

  return (
    <div className="relative hidden shrink-0 self-center sm:block">
      <button
        type="button"
        onClick={() => {
          // Start from the model the agent uses now, so picking one more is enough.
          const current = resolveModel(agent, providers, defaultModel);
          if (!open && !picked.length && current) setCompare(agent.id, [{ provider: current.provider.id, id: current.modelId }]);
          setOpen(!open);
        }}
        title="多个模型同时回答同一个问题，并排比较"
        className={clsx(
          "flex h-8 items-center gap-1 rounded-full px-2.5 text-[13px] transition-colors",
          on ? "bg-accent-soft font-medium text-accent-text" : "text-fg-2 hover:bg-active hover:text-fg",
          open && !on && "bg-active text-fg",
        )}
      >
        <Columns3 size={14} />
        {/* Narrow column (the dock open): icon only, unless comparing. */}
        <span className={clsx(!on && "@max-[40rem]:hidden")}>{on ? `对比 ${picked.length}` : "对比"}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="rise absolute bottom-full left-0 z-20 mb-3 w-72 rounded-2xl border border-line bg-raise p-2 shadow-[var(--shadow)]">
            <div className="px-2 pb-2 pt-1 text-xs text-fg-3">
              选 2–{MAX_COMPARE} 个模型同时回答（已选 {picked.length}）。之后的对话带你选中的那个回答
            </div>
            <div className="scroll max-h-72">
              {ready.map((p) => (
                <div key={p.id}>
                  <div className="px-3 pb-1 pt-2 text-xs font-medium text-fg-3">{p.name}</div>
                  {p.models.map((m) => {
                    const ref = { provider: p.id, id: m };
                    const has = picked.some((x) => sameModel(x, ref));
                    const full = !has && picked.length >= MAX_COMPARE;
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={full}
                        onClick={() => toggle(ref)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-mono text-[13px] hover:bg-hover disabled:opacity-40"
                      >
                        <span className={clsx("grid size-4 shrink-0 place-items-center rounded border", has ? "border-accent bg-accent text-white" : "border-line-2")}>
                          {has && <Check size={11} strokeWidth={3} />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{m}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-end border-t border-line px-1 pt-2">
              <button
                type="button"
                onClick={() => {
                  setCompare(agent.id, []);
                  setOpen(false);
                }}
                className="rounded-full px-3 py-1 text-[13px] text-fg-2 hover:bg-hover hover:text-fg"
              >
                关闭对比
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const cols: Record<number, string> = { 1: "md:grid-cols-1", 2: "md:grid-cols-2", 3: "md:grid-cols-3" };

/** The answers of one comparison side by side; one of them carries on into the conversation. */
export function CompareRow({ replies, agents }: { replies: TextMessage[]; agents: Agent[] }) {
  const kept = replies.find((m) => m.chosen) ?? replies.find((m) => m.status !== "error" && m.status !== "streaming");
  const running = replies.some((m) => m.status === "streaming");
  return (
    <div className="mt-4">
      <div className="mb-1.5 px-1 text-[12.5px] text-fg-3">
        {replies.length} 个模型回答同一个问题{running ? "…" : "，之后的对话只带标着「接着用」的那个"}
      </div>
      <div className={clsx("grid grid-cols-1 gap-2", cols[replies.length] ?? "md:grid-cols-3")}>
        {replies.map((m) => {
          const picked = kept?.id === m.id && !running;
          return (
            <div
              key={m.id}
              id={`msg-${m.id}`}
              className={clsx("flex min-w-0 flex-col rounded-[22px] border p-1.5", picked ? "border-accent/60" : "border-line")}
            >
              <div className="flex items-center gap-2 px-2.5 pb-1 pt-0.5">
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg-2">{m.model ?? m.usage?.model}</span>
                {picked ? (
                  <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-accent-text">
                    <CheckCircle2 size={13} /> 接着用
                  </span>
                ) : (
                  !running &&
                  m.status !== "error" && (
                    <button type="button" onClick={() => choose(m.id)} className="shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium text-accent-text hover:bg-hover">
                      用这个继续
                    </button>
                  )
                )}
              </div>
              <MessageItem msg={m as Message} agents={agents} inGroup={false} first last column />
            </div>
          );
        })}
      </div>
    </div>
  );
}
