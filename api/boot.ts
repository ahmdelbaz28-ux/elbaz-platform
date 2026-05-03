import { Hono } from "hono";
import { createServer } from "http";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import fs from "fs";
import path from "path";

const app = new Hono();
const DIST_PUBLIC = path.resolve(process.cwd(), "dist/public");
const PORT = Number(process.env.PORT) || 7860;

app.use("*", logger());
app.use("*", cors({
  origin: [
    "https://ahmedelbaz.qzz.io",
    "http://localhost:5173",
    "http://localhost:3000",
  ],
  credentials: true,
}));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

app.get("/api/health", async (c) => {
  const db = process.env.DATABASE_URL ? "configured" : "not set";
  return c.json({ status: "ok", ts: new Date().toISOString(), db });
});

app.post("/api/chat", async (c) => {
  try {
    const k = process.env.OPENROUTER_API_KEY;
    if (!k) return c.json({ error: "Not configured" }, 503);
    const b = await c.req.json();
    const m = (b.message || "").trim();
    if (!m) return c.json({ error: "Message required" }, 400);
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + k, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b:free",
        messages: [
          { role: "system", content: "Helpful Elbaz LMS assistant." },
          { role: "user", content: m },
        ],
      }),
    });
    const d = await r.json();
    return c.json({ reply: d.choices?.[0]?.message?.content || "No response" });
  } catch (e) {
    return c.json({ error: "Server error" }, 500);
  }
});

app.use("*", async (c, next) => {
  const p = c.req.path;
  if (p.startsWith("/api")) return next();
  const fp = path.join(DIST_PUBLIC, p);
  try {
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      const ext = path.extname(fp).toLowerCase();
      return new Response(fs.readFileSync(fp), {
        headers: { "Content-Type": MIME[ext] || "application/octet-stream" },
      });
    }
  } catch {}
  return next();
});

app.get("*", async (c) => {
  const ip = path.join(DIST_PUBLIC, "index.html");
  try {
    if (fs.existsSync(ip)) return c.html(fs.readFileSync(ip, "utf-8"));
  } catch {}
  return c.text("Starting...", 503);
});

const server = createServer(async (req, res) => {
  const u = new URL(req.url || "/", "http://localhost:" + PORT);
  const h = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) h.set(k, v);
  }
  let body: Buffer | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const ch: Buffer[] = [];
    for await (const chunk of req) ch.push(chunk);
    body = Buffer.concat(ch);
  }
  const request = new Request(u.toString(), {
    method: req.method || "GET",
    headers: h,
    body: body ? String(body) : undefined,
  });
  try {
    const response = await app.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      const reader = response.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { res.end(); break; }
          res.write(Buffer.from(value));
        }
      };
      await pump();
    } else {
      res.end();
    }
  } catch (e) {
    res.writeHead(500);
    res.end("Error");
  }
});

console.log("===== Application Startup =====");
console.log("Server running on port " + PORT);
console.log("Static files: " + DIST_PUBLIC);
console.log("DB: " + (process.env.DATABASE_URL ? "OK" : "not set"));
console.log("Chat: " + (process.env.OPENROUTER_API_KEY ? "OK" : "not set"));
server.listen(PORT);