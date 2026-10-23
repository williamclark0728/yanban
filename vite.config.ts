import { Readable } from "node:stream";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { relay } from "./relay/handler";

/** Serves /api/relay during development, same contract as the Cloudflare function. */
function devRelay(): Plugin {
  return {
    name: "yanban-dev-relay",
    configureServer(server) {
      server.middlewares.use("/api/relay", async (req, res) => {
        const controller = new AbortController();
        res.on("close", () => controller.abort());
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === "string") headers.set(k, v);
          else if (Array.isArray(v)) headers.set(k, v.join(", "));
        }
        const hasBody = !["GET", "HEAD"].includes(req.method ?? "GET");
        const request = new Request(`http://${req.headers.host ?? "localhost"}/api/relay`, {
          method: req.method,
          headers,
          body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
          signal: controller.signal,
          // @ts-expect-error Node needs duplex for streamed request bodies
          duplex: "half",
        });
        try {
          const response = await relay(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          if (!response.body) return void res.end();
          Readable.fromWeb(response.body as never).pipe(res);
        } catch (e) {
          if (!res.headersSent) res.statusCode = 502;
          res.end(JSON.stringify({ error: { message: (e as Error).message } }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devRelay()],
  server: { port: 5180, strictPort: true },
});
