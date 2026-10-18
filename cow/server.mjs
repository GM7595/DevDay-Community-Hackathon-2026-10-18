import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleDecision } from "./src/decisions.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const publicFiles = new Set(["index.html", "style.css", "details.css", "game.js", "assets/tibo-avatar.jpg"]);

const server = createServer(async (req, res) => {
  try {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === "/api/decisions") {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 32_000) {
        res.writeHead(413, { "content-type": "application/json" }).end('{"error":"Request too large"}');
        return;
      }
    }
    const response = await handleDecision({ method: req.method, body, ip: req.socket.remoteAddress });
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(await response.text());
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" }).end();
    return;
  }
  const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).slice(1);
  if (!publicFiles.has(relative)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(`${root}${path.sep}`)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (await realpath(filename) !== filename) {
      res.writeHead(404).end("Not found");
      return;
    }
    const content = await readFile(filename);
    res.writeHead(200, { "content-type": types[path.extname(filename)] || "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
  }
  } catch (error) {
    if (!res.headersSent) res.writeHead(error instanceof URIError ? 400 : 500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Unable to process request");
  }
});

server.listen(port, process.env.HOST || "127.0.0.1", () => {
  process.stdout.write(`TIBO SIMULATOR listening on http://localhost:${port}\n`);
});
server.on("error", (error) => {
  process.stderr.write(`Server could not start: ${error.code || "unknown error"}\n`);
  process.exitCode = 1;
});
