import { useRef } from "react";
import { create } from "zustand";

/** True while a divider is being dragged; the built-in browser's native view steps aside meanwhile. */
export const useResizing = create<boolean>(() => false);

/**
 * A draggable edge for a side column. `side` is where the handle sits on the column: "right" for the
 * left sidebar (drag right to widen), "left" for the panels on the right (drag left to widen).
 * Double-click puts the default width back.
 */
export function Resizer({ side, width, min, max, onChange, onReset }: { side: "left" | "right"; width: () => number; min: number; max: () => number; onChange: (w: number) => void; onReset: () => void }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const clamp = (w: number) => Math.round(Math.min(Math.max(w, min), Math.max(min, max())));
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="拖动调整宽度，双击还原"
      title="拖动调整宽度，双击还原"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: width() };
        useResizing.setState(true, true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const dx = e.clientX - start.current.x;
        onChange(clamp(start.current.w + (side === "right" ? dx : -dx)));
      }}
      onPointerUp={(e) => {
        start.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        useResizing.setState(false, true);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }}
      onDoubleClick={onReset}
      className={`group absolute inset-y-0 z-30 hidden w-2 cursor-col-resize md:block ${side === "right" ? "-right-1" : "-left-1"}`}
    >
      <div className="mx-auto h-full w-0.5 transition-colors group-hover:bg-accent/60 group-active:bg-accent" />
    </div>
  );
}
