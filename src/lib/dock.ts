// The desktop tool dock on the right: terminal, browser, files and background jobs, one at a time.
// Every view stays mounted while the dock is closed, so shells and pages keep running.
import { create } from "zustand";

export type DockView = "terminal" | "browser" | "files" | "tasks";

export const useDock = create<{ open: boolean; view: DockView }>(() => ({ open: false, view: "terminal" }));

export const showDock = (view: DockView) => useDock.setState({ open: true, view });
export const hideDock = () => useDock.setState({ open: false });

/** Ctrl + ` and the header button: open on the last view, or close. */
export function toggleDock() {
  useDock.setState((s) => ({ open: !s.open }));
}
