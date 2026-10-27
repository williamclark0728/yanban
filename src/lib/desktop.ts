// The Windows desktop app (Tauri). The same frontend runs there; this module is the bridge to the Rust side.
import type { InvokeArgs } from "@tauri-apps/api/core";

/** True inside the desktop app. */
export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** The newest Windows installer (the release asset keeps this name across versions). */
export const DESKTOP_DOWNLOAD = "https://github.com/williamclark0728/yanban/releases/latest/download/Yanban-Windows-x64-setup.exe";
export const DESKTOP_RELEASES = "https://github.com/williamclark0728/yanban/releases/latest";

export async function call<T>(command: string, args?: InvokeArgs): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    // Rust commands reject with a plain string that is already worded for the user.
    throw new Error(typeof e === "string" ? e : (e as Error)?.message || "出错了");
  }
}

/**
 * HTTP from the Rust side: no CORS, so model services, search and MCP servers are called directly
 * instead of through the site's relay.
 */
export const desktopFetch: typeof fetch = async (input, init) => {
  const { fetch } = await import("@tauri-apps/plugin-http");
  return fetch(input, init);
};

export async function pickFolder(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, multiple: false, title: "选择工作区文件夹" });
  return typeof picked === "string" ? picked : null;
}

/** Asks where to save a file, then writes it there. Returns the path, or null when the user cancels. */
export async function saveAs(name: string, data: Blob): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const ext = name.split(".").pop() ?? "";
  const path = await save({ defaultPath: name, title: "保存文件", filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [] });
  if (!path) return null;
  await call("save_file", { path, data: Array.from(new Uint8Array(await data.arrayBuffer())) });
  return path;
}

/** Shows a file in Explorer. */
export const reveal = (path: string) => call("reveal", { path });

export async function onEvent<T>(name: string, handler: (payload: T) => void) {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(name, (e) => handler(e.payload));
}
