// Minimal static file server for Playwright e2e fixture.
// Serves the repo root so /dist/core/index.js and /test/e2e/fixture.html both resolve.
import { file } from "bun";
import { join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.env.E2E_PORT ?? 4173);

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/" || pathname === "") pathname = "/test/e2e/fixture.html";
    // Prevent path traversal
    const resolved = normalize(join(root, pathname));
    if (!resolved.startsWith(root)) return new Response("forbidden", { status: 403 });
    const f = file(resolved);
    if (!(await f.exists())) return new Response("not found", { status: 404 });
    const type = pathname.endsWith(".html")
      ? "text/html; charset=utf-8"
      : pathname.endsWith(".js")
      ? "application/javascript; charset=utf-8"
      : pathname.endsWith(".map")
      ? "application/json"
      : "application/octet-stream";
    return new Response(f, { headers: { "content-type": type } });
  },
});

console.log(`e2e fixture server: http://localhost:${port}`);
