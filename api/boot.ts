import { Hono } from "hono";
import { createServer } from "http";
import { cors } from "hono/cors";
import fs from "fs";
import path from "path";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { getDb } from "./queries/connection";
import { payments } from "@db/schema";
import { eq } from "drizzle-orm";

const app = new Hono();
const DIST_PUBLIC = path.resolve(process.cwd(), "dist/public");
const PORT = Number(process.env.PORT) || 7860;

app.use("*", cors({
  origin: [
    "https://ahmedelbaz.qzz.io",
    "http://localhost:5173",
    "http://localhost:3000",
  ],
  credentials: true,
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "x-auth-token"],
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
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
};

app.get("/api/health", async (c) => {
  var dbStatus = "ok";
  try {
    var db = getDb();
    await db.execute({ sql: "SELECT 1" });
  } catch (e) {
    dbStatus = "error";
  }
  return c.json({ status: dbStatus === "ok" ? "ok" : "degraded", ts: new Date().toISOString(), db: dbStatus });
});

// tRPC endpoint
app.all("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: createContext,
    onError: function(opts) {
      console.error("[tRPC Error] " + opts.path + ": " + opts.error.message);
    },
  });
});

// Chatbot endpoint (used by ChatBot component)
app.post("/api/chatbot", async (c) => {
  try {
    var body = await c.req.json();
    var messages = body.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return c.json({ success: false, error: "Messages array is required" }, 400);
    }
    var k = process.env.OPENROUTER_API_KEY;
    if (!k) return c.json({ success: false, error: "Not configured" }, 503);
    var r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + k, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemma-2-9b-it:free",
        messages: [
          { role: "system", content: "You are an expert electrical engineer. Answer only electrical engineering questions. Be concise and accurate." },
          ...messages.map(function(m) { return { role: m.role, content: m.content }; }),
        ],
        temperature: 0.3,
        max_tokens: 256,
      }),
    });
    var d = await r.json();
    var reply = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    return c.json({ success: true, reply: reply || "No response." });
  } catch (e) {
    return c.json({ success: false, error: "Service unavailable" }, 500);
  }
});

// Paymob webhook
app.post("/api/webhooks/paymob", async (c) => {
  try {
    var contentType = c.req.header("content-type") || "";
    var params;
    if (contentType.indexOf("application/json") !== -1) {
      var body = await c.req.json();
      var obj = body.obj || body;
      params = {
        hmac: body.hmac || "",
        amount_cents: String(obj.amount_cents || ""),
        created_at: String(obj.created_at || ""),
        currency: String(obj.currency || ""),
        error_occured: String(obj.error_occured || ""),
        has_parent_transaction: String(obj.has_parent_transaction || ""),
        id: String(obj.id || ""),
        integration_id: String(obj.integration_id || ""),
        is_3d_secure: String(obj.is_3d_secure || ""),
        is_auth: String(obj.is_auth || ""),
        is_capture: String(obj.is_capture || ""),
        is_refunded: String(obj.is_refunded || ""),
        is_standalone_payment: String(obj.is_standalone_payment || ""),
        is_voided: String(obj.is_voided || ""),
        order: String(obj.order ? (obj.order.id || obj.order) : ""),
        owner: String(obj.owner || ""),
        pending: String(obj.pending || ""),
        source_data_pan: String(obj.source_data ? obj.source_data.pan : ""),
        source_data_sub_type: String(obj.source_data ? obj.source_data.sub_type : ""),
        source_data_type: String(obj.source_data ? obj.source_data.type : ""),
        success: String(obj.success || ""),
      };
    } else {
      params = Object.fromEntries(new URL(c.req.url).searchParams);
    }
    console.log("[Paymob] webhook received, success=" + params.success + ", order=" + params.order);
    var isSuccess = params.success === "true";
    var isPending = params.pending === "true";
    var merchantOrderId = params.order;
    if (isSuccess && !isPending && merchantOrderId) {
      try {
        var db = getDb();
        var results = await db.select().from(payments).where(eq(payments.transactionId, merchantOrderId)).limit(1);
        if (results.length > 0 && results[0].status === "pending") {
          await db.update(payments).set({ status: "paid", paymobTransactionId: params.id }).where(eq(payments.transactionId, merchantOrderId));
          console.log("[Paymob] Payment confirmed: " + merchantOrderId);
        }
      } catch (e) {
        console.error("[Paymob] DB error: " + String(e));
      }
    } else if (!isSuccess && merchantOrderId) {
      try {
        var db2 = getDb();
        await db2.update(payments).set({ status: "failed" }).where(eq(payments.transactionId, merchantOrderId));
      } catch (e) { /* ignore */ }
    }
    return c.json({ received: true });
  } catch (e) {
    console.error("[Paymob] Error: " + String(e));
    return c.json({ received: true, error: "Processing failed" });
  }
});

// Static file serving
app.use("*", async (c, next) => {
  var p = c.req.path;
  if (p.startsWith("/api")) return next();
  var fp = path.join(DIST_PUBLIC, p);
  try {
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      var ext = path.extname(fp).toLowerCase();
      return new Response(fs.readFileSync(fp), {
        headers: { "Content-Type": MIME[ext] || "application/octet-stream" },
      });
    }
  } catch (e) { /* ignore */ }
  return next();
});

// SPA fallback - serve index.html for all non-API routes
app.get("*", async (c) => {
  var ip = path.join(DIST_PUBLIC, "index.html");
  try {
    if (fs.existsSync(ip)) return c.html(fs.readFileSync(ip, "utf-8"));
  } catch (e) { /* ignore */ }
  return c.text("Starting...", 503);
});

var server = createServer(async (req, res) => {
  var u = new URL(req.url || "/", "http://localhost:" + PORT);
  var h = new Headers();
  for (var _i = 0, _a = Object.entries(req.headers); _i < _a.length; _i++) {
    var entry = _a[_i];
    if (entry[1]) h.set(entry[0], entry[1]);
  }
  var body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    var chunks = [];
    for await (var chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }
  var request = new Request(u.toString(), {
    method: req.method || "GET",
    headers: h,
    body: body ? String(body) : undefined,
  });
  try {
    var response = await app.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      var reader = response.body.getReader();
      var pump = async () => {
        while (true) {
          var result = await reader.read();
          if (result.done) { res.end(); break; }
          res.write(Buffer.from(result.value));
        }
      };
      await pump();
    } else {
      res.end();
    }
  } catch (e) {
    console.error("[Server Error] " + String(e));
    res.writeHead(500);
    res.end("Error");
  }
});

console.log("===== Application Startup =====");
console.log("Server running on port " + PORT);
console.log("Static files: " + DIST_PUBLIC);
console.log("DB: " + (process.env.DATABASE_URL ? "OK" : "not set"));
console.log("Chat: " + (process.env.OPENROUTER_API_KEY ? "OK" : "not set"));
console.log("tRPC: /api/trpc/*");
server.listen(PORT);
