import clsx from "clsx";
import { Check, ChevronDown, Search } from "lucide-react";
import { useState } from "react";
import { isReady, useData, useUi } from "../store";
import type { ModelRef } from "../types";

/** Searchable model list grouped by provider. `inheritLabel` adds a "follow default" option. */
export function ModelList({
  value,
  onPick,
  inheritLabel,
}: {
  value: ModelRef | null;
  onPick: (ref: ModelRef | null) => void;
  inheritLabel?: string;
}) {
  const providers = useData((s) => s.providers).filter(isReady);
  const openSettings = useUi((s) => s.openSettings);
  const [q, setQ] = useState("");

  if (providers.length === 0) {
    return (
      <button
        type="button"
        onClick={() => openSettings("providers")}
        className="w-full rounded-xl px-3 py-3 text-center text-sm text-accent-text hover:bg-hover"
      >
        先连接一个模型服务
      </button>
    );
  }

  return (
    <>
      <div className="mb-1 flex items-center gap-2 rounded-xl bg-bg px-3">
        <Search size={15} className="text-fg-3" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索模型"
          className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-3"
        />
      </div>
      <div className="scroll max-h-72">
        {inheritLabel && !q && <Option label={inheritLabel} selected={value === null} onClick={() => onPick(null)} />}
        {providers.map((p) => {
          const models = p.models.filter((m) => m.toLowerCase().includes(q.toLowerCase()));
          if (models.length === 0) return null;
          return (
            <div key={p.id}>
              <div className="px-3 pb-1 pt-2.5 text-xs font-medium text-fg-3">{p.name}</div>
              {models.map((m) => (
                <Option
                  key={m}
                  label={m}
                  mono
                  selected={value?.provider === p.id && value.id === m}
                  onClick={() => onPick({ provider: p.id, id: m })}
                />
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Inline card that expands into the model list. */
export function ModelPicker({
  value,
  onChange,
  inheritLabel,
  shown,
}: {
  value: ModelRef | null;
  onChange: (ref: ModelRef | null) => void;
  inheritLabel?: string;
  shown: { title: string; subtitle?: string } | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-line bg-raise">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className={clsx("size-2 shrink-0 rounded-full", shown ? "bg-ok" : "bg-fg-3")} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{shown?.title ?? "未选择模型"}</span>
          {shown?.subtitle && <span className="block truncate text-[13px] text-fg-3">{shown.subtitle}</span>}
        </span>
        <ChevronDown size={16} className={clsx("text-fg-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-line p-2">
          <ModelList
            value={value}
            inheritLabel={inheritLabel}
            onPick={(ref) => {
              onChange(ref);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

function Option({ label, selected, mono, onClick }: { label: string; selected: boolean; mono?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-hover", mono && "font-mono text-[13px]")}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected && <Check size={15} className="text-accent-text" />}
    </button>
  );
}
