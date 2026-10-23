import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { resolveModel, useData } from "../store";
import type { Agent } from "../types";
import { ModelList } from "./ModelPicker";

/** Composer button showing the agent's model; opens a list to switch it for this agent only. */
export function ModelChip({ agent }: { agent: Agent }) {
  const { providers, defaultModel, updateAgent } = useData();
  const [open, setOpen] = useState(false);
  const target = resolveModel(agent, providers, defaultModel);
  const fallback = resolveModel(undefined, providers, defaultModel);
  if (!target) return null;

  return (
    <div className="relative hidden shrink-0 self-center sm:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${target.provider.name} · ${target.modelId}`}
        className={clsx(
          "flex h-8 max-w-[200px] items-center gap-1 rounded-full px-3 text-[13px] text-fg-2 transition-colors hover:bg-active hover:text-fg",
          open && "bg-active text-fg",
        )}
      >
        <span className="truncate">{target.modelId}</span>
        <ChevronDown size={14} className="shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="rise absolute bottom-full left-0 z-20 mb-3 w-72 rounded-2xl border border-line bg-raise p-2 shadow-[var(--shadow)]">
            <div className="px-2 pb-2 pt-1 text-xs text-fg-3">{agent.name}使用的模型</div>
            <ModelList
              value={agent.model}
              inheritLabel={fallback ? `跟随默认（${fallback.modelId}）` : "跟随默认"}
              onPick={(model) => {
                updateAgent(agent.id, { model });
                setOpen(false);
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
