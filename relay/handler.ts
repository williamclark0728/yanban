/**
 * Stateless request relay. The browser cannot call most model APIs directly
 * (CORS), so it sends the request here with the real URL in `x-relay-target`.
 * Keys pass through in the request headers and are never stored.
 * Runs on Cloudflare (functions/api/relay.ts) and in the Vite dev server.
 */

const DROP_REQUEST = [
  "host", "origin", "referer", "cookie", "x-relay-target", "content-length", "connection",
  "accept-encoding", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip",
];
const DROP_RESPONSE = ["content-encoding", "content-length", "transfer-encoding", "set-cookie", "connection"];

export const json = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

function isPrivateHost(host: string) {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\.|^10\.|^192\.168\.|^169\.254\.|^0\.|^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith("[")
  );
}

/** Browsers mark cross-site calls; only this site's own pages may use the relay. */
export function fromOtherSite(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
}

export async function relay(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (fromOtherSite(request)) return json(403, "relay only serves this site");

  const target = request.headers.get("x-relay-target");
  if (!target) return json(400, "missing x-relay-target");
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return json(400, "invalid target url");
  }
  if (url.protocol !== "https:") return json(400, "only https targets are relayed");
  if (isPrivateHost(url.hostname)) return json(400, "private hosts are not relayed");

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (!DROP_REQUEST.includes(k) && !k.startsWith("sec-") && !k.startsWith("cf-")) headers.set(key, value);
  });

  const hasBody = !["GET", "HEAD"].includes(request.method);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      signal: request.signal,
    });
  } catch (e) {
    return json(502, `upstream unreachable: ${(e as Error).message}`);
  }

  const out = new Headers(upstream.headers);
  for (const h of DROP_RESPONSE) out.delete(h);
  out.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}
