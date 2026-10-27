// Desktop app updates: the app checks GitHub Releases for a newer signed installer and installs it on request.
import { create } from "zustand";
import { isDesktop } from "./desktop";

type Pending = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;

interface UpdateState {
  current: string;
  /** The newer version on offer, if any. */
  next: { version: string; notes?: string } | null;
  checking: boolean;
  /** Download progress 0..1 while installing. */
  progress: number | null;
  error: string;
  dismissed: boolean;
}

export const useUpdate = create<UpdateState>(() => ({ current: "", next: null, checking: false, progress: null, error: "", dismissed: false }));

let pending: Pending = null;

/** Looks for a newer version. `quiet` keeps network errors out of sight (the automatic check at startup). */
export async function checkUpdate(quiet = false) {
  if (!isDesktop) return;
  useUpdate.setState({ checking: true, error: "" });
  try {
    const [{ check }, { getVersion }] = await Promise.all([import("@tauri-apps/plugin-updater"), import("@tauri-apps/api/app")]);
    useUpdate.setState({ current: await getVersion() });
    pending = await check();
    useUpdate.setState({ next: pending ? { version: pending.version, notes: pending.body } : null, dismissed: false });
  } catch (e) {
    if (!quiet) useUpdate.setState({ error: `检查更新失败：${(e as Error)?.message ?? e}` });
  } finally {
    useUpdate.setState({ checking: false });
  }
}

/** Downloads and runs the new installer, then restarts into the new version. */
export async function installUpdate() {
  if (!pending) return;
  let total = 0;
  let received = 0;
  useUpdate.setState({ progress: 0, error: "" });
  try {
    await pending.downloadAndInstall((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? 0;
      else if (e.event === "Progress") {
        received += e.data.chunkLength;
        useUpdate.setState({ progress: total ? received / total : 0 });
      }
    });
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    useUpdate.setState({ progress: null, error: `更新失败：${(e as Error)?.message ?? e}` });
  }
}
