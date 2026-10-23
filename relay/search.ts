/**
 * Site search: web search for visitors who have not connected a search service of their own.
 * The Tavily key lives only in a server secret. Each visitor gets a daily number of searches,
 * and the whole site a daily total, so a free monthly plan is not used up in a few days.
 */

import { fromOtherSite, json } from "./handler";
import { hashVisitor, today, type D1, type Limiter } from "./trial";

export interface SearchEnv {
  DB?: D1;
  SEARCH_TAVILY_KEY?: string;
  /** Overridden only to point at a local mock. */
  SEARCH_TAVILY_URL?: string;
  SEARCH_DAILY?: string;
  SEARCH_SITE_DAILY?: string;
}

const TAVILY = "https://api.tavily.com/search";
const SITE = "__site__";
const MAX_RESULTS = 8;

const VISITOR_QUOTA = "联网搜索今天的次数用完了，明天再来，或在设置里连接自己的搜索服务";
const SITE_QUOTA = "本站今天的联网搜索额度用完了，明天再来，或在设置里连接自己的搜索服务";
const UNAVAILABLE = "联网搜索暂时不可用，稍后再试";

const positive = (v: string | undefined, fallback: number) => Math.max(1, Number(v) || fallback);

export async function siteSearch(request: Request, env: SearchEnv, ip: string, limiter: Limiter | null): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (fromOtherSite(request)) return json(403, "search only serves this site");

  const path = new URL(request.url).pathname.replace(/^\/api\/search/, "") || "/";
  const enabled = !!env.SEARCH_TAVILY_KEY && !!limiter;
  const limit = positive(env.SEARCH_DAILY, 10);
  const siteLimit = positive(env.SEARCH_SITE_DAILY, 50);
  const day = today();
  const visitor = await hashVisitor(ip, day, "search");

  if (path === "/status" && request.method === "GET") {
    if (!enabled) return Response.json({ enabled: false });
    const [used, siteUsed] = await Promise.all([limiter!.used(visitor, day), limiter!.used(SITE, day)]);
    return Response.json({ enabled: true, limit, remaining: Math.max(0, Math.min(limit - used, siteLimit - siteUsed)) });
  }
  if (path !== "/" || request.method !== "POST") return json(404, "not found");
  if (!enabled) return json(503, UNAVAILABLE);

  let query = "";
  try {
    const body = (await request.json()) as { query?: unknown };
    query = typeof body.query === "string" ? body.query.trim().slice(0, 300) : "";
  } catch {
    /* handled below */
  }
  if (!query) return json(400, "query is required");

  const count = await limiter!.take(visitor, day);
  if (count > limit) {
    await limiter!.refund(visitor, day);
    return json(429, VISITOR_QUOTA);
  }
  const siteCount = await limiter!.take(SITE, day);
  if (siteCount > siteLimit) {
    await Promise.all([limiter!.refund(visitor, day), limiter!.refund(SITE, day)]);
    return json(429, SITE_QUOTA);
  }

  try {
    const res = await fetch(env.SEARCH_TAVILY_URL || TAVILY, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.SEARCH_TAVILY_KEY}` },
      body: JSON.stringify({ query, max_results: MAX_RESULTS, search_depth: "basic" }),
      signal: request.signal,
    });
    if (!res.ok) throw new Error(`tavily ${res.status}`);
    const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string; published_date?: string }[] };
    const results = (data.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({ title: r.title ?? r.url, url: r.url, content: r.content ?? "", published_date: r.published_date }));
    return Response.json({ results }, { headers: { "x-search-remaining": String(Math.min(limit - count, siteLimit - siteCount)), "cache-control": "no-store" } });
  } catch {
    await Promise.all([limiter!.refund(visitor, day), limiter!.refund(SITE, day)]);
    return json(503, UNAVAILABLE);
  }
}
