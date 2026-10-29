import clsx from "clsx";
import { Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "./ui";

/** A row of tabs with close buttons and a "+" at the end, for the terminal and browser views. */
export function DockTabs<T extends { key: string; title: string }>({
  tabs,
  active,
  icon,
  note,
  hint,
  onPick,
  onClose,
  onNew,
  newLabel,
}: {
  tabs: T[];
  active: string | null;
  icon: ReactNode;
  note?: (t: T) => ReactNode;
  hint?: (t: T) => string | undefined;
  onPick: (key: string) => void;
  onClose: (key: string) => void;
  onNew: () => void;
  newLabel: string;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line pl-2 pr-1.5">
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <div
            key={t.key}
            className={clsx("flex h-8 max-w-48 shrink-0 items-center gap-1.5 rounded-lg pl-2.5 pr-1 text-[13px]", t.key === active ? "bg-active text-fg" : "text-fg-2 hover:bg-hover")}
          >
            <button type="button" onClick={() => onPick(t.key)} className="flex min-w-0 items-center gap-1.5" title={hint?.(t) ?? t.title}>
              <span className="shrink-0">{icon}</span>
              <span className="truncate">{t.title}</span>
              {note?.(t)}
            </button>
            <button type="button" aria-label={`关闭 ${t.title}`} onClick={() => onClose(t.key)} className="grid size-5 shrink-0 place-items-center rounded opacity-60 hover:bg-hover hover:opacity-100">
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <IconButton aria-label={newLabel} title={newLabel} onClick={onNew} className="size-8">
        <Plus size={17} />
      </IconButton>
    </div>
  );
}

/** What a view shows before it has anything: an icon, a line or two, and a button. */
export function DockEmpty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
      <span className="text-fg-3">{icon}</span>
      <div className="font-medium">{title}</div>
      <p className="max-w-72 text-[13px] leading-relaxed text-fg-3">{text}</p>
      {action}
    </div>
  );
}
