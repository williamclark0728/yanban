import { create } from "zustand";
import { usePrefs } from "../store";
import { call, isDesktop } from "./desktop";

/** The web address waiting for the user's OK before it opens. */
export const useLink = create<{ url: string | null }>(() => ({ url: null }));

/** Opens the page in the browser: the system's default one on the desktop, a new tab on the website. */
export function openExternal(url: string) {
  if (isDesktop) void call("open_url", { url });
  else window.open(url, "_blank", "noopener,noreferrer");
}

/** A link the user clicked: shows its full address first, unless they turned that off. */
export function openLink(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  if (usePrefs.getState().confirmLinks) useLink.setState({ url });
  else openExternal(url);
}

/** Click handler for an <a>: keeps the address on hover, opens through openLink. */
export const linkClick = (url: string) => (e: React.MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
  openLink(url);
};

/** Plain-text web addresses, for turning them into links (trailing punctuation left out). */
export const URL_RE = /https?:\/\/[^\s<>"'，。；、）)\]】]+[^\s<>"'，。；、）)\]】.,;:!?]/g;
