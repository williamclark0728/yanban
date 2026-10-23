import { useData } from "../store";
import type { SearchConfig, SearchProvider, Source } from "../types";
import { HttpError, proxiedFetch } from "./llm";

export interface SearchHit extends Source {
  snippet: string;
}

export const searchProviders: { value: SearchProvider; label: string; hint: string; keyUrl?: string }[] = [
  { value: "bocha", label: "博查", hint: "国内直连，中文结果好", keyUrl: "https://open.bochaai.com/" },
  { value: "tavily", label: "Tavily", hint: "面向 AI 的搜索，每月有免费额度", keyUrl: "https://app.tavily.com/home" },
  { value: "searxng", label: "SearXNG", hint: "自建的开源搜索，不需要 Key" },
];

/** Whether the user's own provider has what it needs to run. */
export const searchReady = (c: SearchConfig | null) =>
  !!c && (c.provider === "searxng" ? !!c.searxngUrl?.trim() : !!c.keys[c.provider]?.trim());

/** Web search works with the user's own service, or else with the site's. */
export const canSearch = () => {
  const { search, siteSearch } = useData.getState();
  return searchReady(search) || !!siteSearch;
};

/** Searches with the user's own service when it is set up, otherwise with the site's. */
export function searchWeb(query: string, signal?: AbortSignal) {
  const { search } = useData.getState();
  return searchReady(search) ? webSearch(search, query, signal) : siteWebSearch(query, signal);
}

async function siteWebSearch(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const res = await fetch("/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }), signal });
  const left = res.headers.get("x-search-remaining");
  if (left !== null) useData.getState().setSiteSearchRemaining(Number(left));
  else if (res.status === 429) useData.getState().setSiteSearchRemaining(0);
  const data = await json(res);
  const items: Record<string, string>[] = data?.results ?? [];
  return items.map((r) => ({ title: r.title ?? r.url, url: r.url, site: site(r.url), date: r.published_date?.slice(0, 10), snippet: clip(r.content, 600) }));
}

const MAX_HITS = 8;

async function json(res: Response) {
  const body = await res.text();
  if (!res.ok) throw new HttpError(res.status, body);
  return JSON.parse(body);
}

const site = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
};

const clip = (s: unknown, n: number) => {
  const t = typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

export async function webSearch(c: SearchConfig, query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  if (c.provider === "bocha") {
    const data = await json(
      await proxiedFetch("https://api.bochaai.com/v1/web-search", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${c.keys.bocha?.trim()}` },
        body: JSON.stringify({ query, summary: true, count: MAX_HITS, freshness: "noLimit" }),
        signal,
      }),
    );
    const items: Record<string, string>[] = data?.data?.webPages?.value ?? data?.webPages?.value ?? [];
    return items.map((r) => ({
      title: r.name ?? r.url,
      url: r.url,
      site: r.siteName || site(r.url),
      date: (r.datePublished ?? r.dateLastCrawled)?.slice(0, 10),
      snippet: clip(r.summary || r.snippet, 600),
    }));
  }
  if (c.provider === "tavily") {
    const data = await json(
      await proxiedFetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${c.keys.tavily?.trim()}` },
        body: JSON.stringify({ query, max_results: MAX_HITS, search_depth: "basic" }),
        signal,
      }),
    );
    const items: Record<string, string>[] = data?.results ?? [];
    return items.map((r) => ({ title: r.title ?? r.url, url: r.url, site: site(r.url), date: r.published_date?.slice(0, 10), snippet: clip(r.content, 600) }));
  }
  const base = (c.searxngUrl ?? "").trim().replace(/\/+$/, "");
  const data = await json(await proxiedFetch(`${base}/search?format=json&q=${encodeURIComponent(query)}`, { signal }));
  const items: Record<string, string>[] = data?.results ?? [];
  return items
    .slice(0, MAX_HITS)
    .map((r) => ({ title: r.title ?? r.url, url: r.url, site: site(r.url), date: r.publishedDate?.slice(0, 10), snippet: clip(r.content, 600) }));
}

const MAX_PAGE = 12_000;

/** A web page as plain text, through Jina Reader. */
export async function readPage(c: SearchConfig | null, url: string, signal?: AbortSignal) {
  if (!/^https?:\/\//i.test(url)) throw new Error("只能读取 http 或 https 网址");
  const headers: Record<string, string> = { accept: "text/plain", "x-return-format": "markdown" };
  if (c?.jinaKey?.trim()) headers.authorization = `Bearer ${c.jinaKey.trim()}`;
  const res = await proxiedFetch(`https://r.jina.ai/${url}`, { headers, signal });
  const body = await res.text();
  if (!res.ok) throw new HttpError(res.status, body);
  return body.length > MAX_PAGE ? `${body.slice(0, MAX_PAGE)}\n\n（页面较长，只读取了前 ${MAX_PAGE} 字）` : body;
}
