#!/usr/bin/env node
/**
 * Local UI test server — serves dist/public with SPA fallback and minimal
 * API stubs so pages can render without the production backend.
 * Usage: node scripts/ui-test-server.mjs   (port 4173)
 */
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist", "public");
const PORT = 4173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".xml": "application/xml",
  ".txt": "text/plain",
};

function serveFile(res, filePath, withRange = false, rangeHeader = "") {
  const size = statSync(filePath).size;
  if (withRange && rangeHeader.match(/^bytes=(\d*)-(\d*)$/)) {
    const [, s, e] = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
    const start = s === "" ? 0 : parseInt(s, 10);
    const end = e === "" ? size - 1 : Math.min(parseInt(e, 10), size - 1);
    res.writeHead(206, {
      "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
    });
    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
    "Content-Length": size,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  });
  createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = decodeURIComponent(url.pathname);

  // API stubs
  if (path === "/api/version") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ version: "ui-test" }));
    return;
  }
  if (path === "/api/env") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ GOOGLE_CLIENT_ID: "" }));
    return;
  }
  if (path === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(ROOT, safe);
  if (!filePath.startsWith(ROOT)) filePath = join(ROOT, "index.html");

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    const isMedia = /\.(mp4|webm|mp3|jpg|jpeg|png)$/i.test(filePath);
    serveFile(res, filePath, isMedia, req.headers.range || "");
    return;
  }

  // SPA fallback
  const index = join(ROOT, "index.html");
  if (existsSync(index)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    createReadStream(index).pipe(res);
    return;
  }
  res.writeHead(404);
  res.end("dist/public not built — run npm run build first");
});

server.listen(PORT, () => console.log(`[ui-test] serving ${ROOT} on http://localhost:${PORT}`));
