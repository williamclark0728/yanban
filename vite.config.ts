import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { relay } from "./relay/handler";
import { memoryLimiter, trial } from "./relay/trial";

type Handler = (request: Request, req: IncomingMessage) => Promise<Response>;

/** Adapts a fetch-style handler (the same code Cloudflare runs) to a Node middleware. */
const serve = (handler: Handler) => async (req: IncomingMessage & { originalUrl?: string }, res: ServerResponse) => {
  const controller = new AbortController();
  res.on("close", () => controller.abort());
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  const hasBody = !["GET", "HEAD"].includes(req.method ?? "GET");
  const request = new Request(`http://${req.headers.host ?? "localhost"}${req.originalUrl ?? req.url}`, {
    method: req.method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    signal: controller.signal,
    // @ts-expect-error Node needs duplex for streamed request bodies
    duplex: "half",
  });
  try {
    const response = await handler(request, req);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (!response.body) return void res.end();
    Readable.fromWeb(response.body as never).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.statusCode = 502;
    res.end(JSON.stringify({ error: { message: (e as Error).message } }));
  }
};

/**
 * Serves /api/relay and /api/trial during development, same contract as the Cloudflare functions.
 * The trial reads TRIAL_* variables from .env.local (for example pointing at scripts/mock-llm.mjs).
 */
function devApi(env: Record<string, string>): Plugin {
  const limiter = memoryLimiter();
  return {
    name: "yanban-dev-api",
    configureServer(server) {
      server.middlewares.use("/api/relay", serve((request) => relay(request)));
      server.middlewares.use("/api/trial", serve((request, req) => trial(request, env, req.socket.remoteAddress ?? "local", limiter)));
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), devApi(loadEnv(mode, process.cwd(), "TRIAL_"))],
  server: { port: 5180, strictPort: true },
}));
