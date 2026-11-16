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

// Telemetry for the chat stop-button E2E (see /api/__e2e/* endpoints).
const chatStream = {
  requests: 0,
  completed: 0,
  aborted: 0,
  lastAborted: false,
  lastCompleted: false,
  chunksSent: 0,
  lastText: "",
  mode: "normal", // "normal" | "silent-delay" | "all-fail"
  // Request-body telemetry (type-ahead/vision E2E): what did the
  // LAST /api/chatbot/stream request actually carry?
  lastBodyText: "",
  lastBodyHasImage: false,
  lastBodyImageSource: null,
};

/** Record the last stream request's user turn: text + image part presence. */
function recordStreamBody(raw) {
  try {
    const parsed = JSON.parse(raw);
    const msgs = Array.isArray(parsed?.messages) ? parsed.messages : [];
    const lastUser = [...msgs].reverse().find((m) => m?.role === "user");
    const content = lastUser?.content;
    chatStream.lastBodyText = typeof content === "string"
      ? content
      : (Array.isArray(content)
        ? (content.find((p) => p?.type === "text")?.text ?? "")
        : "");
    const imagePart = Array.isArray(content)
      ? content.find((p) => p?.type === "image_url")
      : undefined;
    chatStream.lastBodyHasImage = Boolean(imagePart?.image_url?.url);
    chatStream.lastBodyImageSource = imagePart?.source ?? null;
  } catch { /* unparsable body — telemetry stays stale */ }
}

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

// ── Subscribe-gate tRPC stubs (subscribe-gate E2E) ──────────────────────────
// Mirrors the REAL server contract: while the gate is enabled, lessonVideo/
// previewVideo answer 403 SUBSCRIBE_REQUIRED unless a ticket is presented,
// and completeSubscribeUnlock issues the ticket. Telemetry records what the
// client actually sent so the test can pin the wire contract:
//   • pre-unlock ⇒ ZERO video fetches (the client must not even ask)
//   • post-unlock ⇒ every video fetch carries the ticket
const trpcStub = {
gateMode: "enabled", // "enabled" | "disabled"
previewVideoCalls: [], // { hasTicket, ticket }
lessonVideoCalls: [],
unlockCalls: 0,
};

const STUB_COURSE = {
id: 1,
slug: "etap-basics",
titleAr: "أساسيات ETAP",
titleEn: "ETAP Basics",
descriptionAr: "كورس أساسيات ETAP التجريبي",
descriptionEn: "Stub ETAP basics course",
learningOutcomesAr: null,
learningOutcomesEn: null,
thumbnail: null,
price: "0",
originalPrice: null,
isPremium: false,
isPublished: true,
rating: "5",
studentCount: 10,
durationHours: 2,
category: { nameEn: "Electrical", nameAr: "كهربية" },
lessons: [
    {
      id: 101,
      titleAr: "مقدمة في ETAP",
      titleEn: "Intro to ETAP",
      isFree: true,
      durationMinutes: 12,
      videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      type: "video",
    },
],
};

const STUB_VIDEO = {
videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ?origin=http://localhost:4173",
hlsUrl: null,
expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
watermarkToken: "e2e-watermark",
kind: "youtube",
youtubeId: "dQw4w9WgXcQ",
};

function trpcSend(res, payload) {
res.writeHead(200, { "Content-Type": "application/json" });
res.end(JSON.stringify({ result: { data: { json: payload } } }));
}

function trpcError(res, status, code, message, path) {
res.writeHead(status, { "Content-Type": "application/json" });
res.end(JSON.stringify({
    error: {
      json: {
        message,
        code: -32001,
        data: { code, httpStatus: status, path },
      },
    },
}));
}

function readTrpcInput(url, rawBody) {
try {
    if (rawBody !== null && rawBody !== undefined) {
      const parsed = JSON.parse(rawBody);
      return parsed?.json ?? parsed;
    }
    const inputRaw = url.searchParams.get("input");
    if (!inputRaw) return {};
    return JSON.parse(inputRaw)?.json ?? {};
} catch {
    return {};
}
}

async function handleTrpcStub(req, res, pathName, url) {
// Procedure path after /api/trpc/ (httpLink ⇒ one procedure per request).
const proc = pathName.slice("/api/trpc/".length).split("/").pop() || "";
const method = req.method || "GET";
let rawBody = null;
if (method === "POST") {
    rawBody = "";
    await new Promise((resolve) => {
      req.on("data", (c) => { rawBody += c; });
      req.on("end", resolve);
      req.on("error", resolve);
    });
}
const input = readTrpcInput(url, rawBody);

switch (proc) {
    case "settings.getSection": {
      if (input?.section !== "subscribeGate") {
        trpcSend(res, {});
        return true;
      }
      trpcSend(res, {
        enabled: trpcStub.gateMode === "disabled" ? "false" : "true",
        days: "30",
        channelUrl: "https://www.youtube.com/@AhmedElbazEng",
      });
      return true;
    }
    case "course.bySlug": {
      trpcSend(res, STUB_COURSE);
      return true;
    }
    case "course.checkEnrollment": {
      trpcSend(res, { enrolled: true, isCompleted: false });
      return true;
    }
    case "course.previewVideo": {
      trpcStub.previewVideoCalls.push({ hasTicket: !!input?.subTicket, ticket: input?.subTicket ?? null });
      if (trpcStub.gateMode === "enabled" && !input?.subTicket) {
        trpcError(res, 403, "FORBIDDEN",
          "SUBSCRIBE_REQUIRED: subscribe to the YouTube channel first — lesson videos stay locked until the subscribe flow is done.",
          "course.previewVideo");
        return true;
      }
      trpcSend(res, STUB_VIDEO);
      return true;
    }
    case "course.lessonVideo": {
      trpcStub.lessonVideoCalls.push({ hasTicket: !!input?.subTicket, ticket: input?.subTicket ?? null });
      if (trpcStub.gateMode === "enabled" && !input?.subTicket) {
        trpcError(res, 403, "FORBIDDEN",
          "SUBSCRIBE_REQUIRED: subscribe to the YouTube channel first — lesson videos stay locked until the subscribe flow is done.",
          "course.lessonVideo");
        return true;
      }
      trpcSend(res, STUB_VIDEO);
      return true;
    }
    case "course.completeSubscribeUnlock": {
      trpcStub.unlockCalls += 1;
      trpcSend(res, { ticket: "e2e-signed-ticket.stubsig", days: 30 });
      return true;
    }
    default:
      return false; // not stubbed here — fall through to the generic 404
}
}

const server = http.createServer(async (req, res) => {
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

  // ── Auth stub (chat stop-button + subscribe-gate E2E): tRPC auth.me ──
  // Mirrors the REAL server contract: NO elbaz_auth_flag cookie ⇒ 401
  // UNAUTHORIZED. Answering success unconditionally used to flip EVERY
  // guest into "authenticated" through the zombie-session probe — which
  // rerouted the video flow through lessonVideo and made the guest gate
  // path (previewVideo) unreachable in tests.
  if (path === "/api/trpc/auth.me") {
    const hasFlag = (req.headers.cookie || "")
      .split(";")
      .some((c) => c.trim().startsWith("elbaz_auth_flag="));
    if (!hasFlag) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: {
          json: {
            message: "Not authenticated",
            code: -32001,
            data: { code: "UNAUTHORIZED", httpStatus: 401, path: "auth.me" },
          },
        },
      }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      result: {
        data: {
          json: {
            id: "e2e-user-1",
            username: "e2e-tester",
            email: "e2e@test.local",
            role: "user",
          },
        },
      },
    }));
    return;
  }

  // ── Chat history stub: empty history keeps the local conversation ──
  if (path === "/api/chatbot/history" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, messages: [] }));
    return;
  }
  if (path === "/api/chatbot/history" && req.method === "DELETE") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // ── Chatbot SSE stub (chat stop-button E2E) ──
  // Streams a slow Arabic reply so the test can press STOP mid-stream, and
  // records what happened to the connection: the client MUST abort it (the
  // server sees `close` before the final [DONE]) and MUST NOT re-request
  // (request counter === 1 — the silent-retry resurrection guard).
  if (path === "/api/chatbot/stream" && req.method === "POST") {
    chatStream.requests += 1;
    chatStream.lastAborted = false;
    chatStream.lastCompleted = false;
    chatStream.chunksSent = 0;
    let rawBody = "";
    req.on("data", (c) => { rawBody += c; });
    req.on("end", () => recordStreamBody(rawBody));
    if (chatStream.mode === "all-fail") {
      // Soft-busy shape the client's retry chain treats as retryable — used by
      // the vision-retry E2E to reach the error bubble + retry button.
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "The service is under heavy load right now" }));
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ model: "e2e-model" })}\n\n`);
    const mode = chatStream.mode;
    let timer = null;
    let finished = false; // close-after-end is a NORMAL request cycle, not an abort
    const finish = () => {
      if (timer) clearInterval(timer);
      timer = null;
      finished = true;
      chatStream.lastCompleted = true;
      chatStream.completed += 1;
      try { res.write("data: [DONE]\n\n"); res.end(); } catch { /* client gone */ }
    };
    const chunks = [
      "مرحبا بك! ",
      "المخطط الأحادي (SLD) ",
      "هو الرسم الأساسي ",
      "لأي منظومة كهربية، ",
      "وETAP يتيح لك تحليله ",
      "بشكل رقمي متكامل، ",
      "من حساب الأحمال ",
      "إلى دراسة القصر والدارة القصرية. ",
      "هذه الجملة الأخيرة طويلة عمدا ",
      "حتى يجد الاختبار وقتا كافيا ",
      "لضغط زر الإيقاف ",
      "قبل اكتمال الرد بالكامل.",
    ];
    if (mode === "silent-delay") {
      // Thinking phase: model event only, first text chunk after 10s —
      // lets the test press STOP before anything visible arrived.
      timer = setTimeout(finish, 10_000);
    } else {
      let i = 0;
      timer = setInterval(() => {
        if (i >= chunks.length) { finish(); return; }
        chatStream.chunksSent += 1;
        chatStream.lastText += chunks[i];
        try { res.write(`data: ${JSON.stringify({ text: chunks[i] })}\n\n`); } catch { /* client gone */ }
        i += 1;
      }, 600);
    }
    // ✅ Client-disconnect detection — MUST watch the RESPONSE stream, not
    // the request: since the request body is consumed for telemetry, Node
    // fires `req.close` the moment the body completes (a normal POST), which
    // the old handler misread as an abort and destroyed the SSE response
    // right after the first event (ERR_INCOMPLETE_CHUNKED_ENCODING → the
    // client silently fell back to the non-stream endpoint).
    // `res.close` with `writableEnded === false` is a REAL premature close.
    res.on("close", () => {
      if (finished || res.writableEnded) return; // response completed normally
      if (timer) { clearInterval(timer); timer = null; }
      chatStream.aborted += 1;
      chatStream.lastAborted = true;
    });
    return;
  }
  if (path === "/api/chatbot" && req.method === "POST") {
    if (chatStream.mode === "all-fail") {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "The service is under heavy load right now" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, reply: "رد كامل من الطرف غير المتدفق (fallback).", model: "e2e-model" }));
    return;
  }

  // ── E2E telemetry: what did the stream stub observe? ──
  if (path === "/api/__e2e/stream-state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(chatStream));
    return;
  }
  if (path === "/api/__e2e/stream-mode") {
    const nextMode = url.searchParams.get("mode") || "normal";
    chatStream.mode = nextMode;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, mode: chatStream.mode }));
    return;
  }
  if (path === "/api/__e2e/reset") {
    chatStream.requests = 0;
    chatStream.completed = 0;
    chatStream.aborted = 0;
    chatStream.lastAborted = false;
    chatStream.lastCompleted = false;
    chatStream.chunksSent = 0;
    chatStream.lastText = "";
    chatStream.lastBodyText = "";
    chatStream.lastBodyHasImage = false;
    chatStream.lastBodyImageSource = null;
    chatStream.mode = "normal";
    trpcStub.gateMode = "enabled";
    trpcStub.previewVideoCalls = [];
    trpcStub.lessonVideoCalls = [];
    trpcStub.unlockCalls = 0;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── Subscribe-gate stub telemetry + controls (subscribe-gate E2E) ──
  if (path === "/api/__e2e/trpc-state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(trpcStub));
    return;
  }
  if (path === "/api/__e2e/gate-mode") {
    const nextMode = url.searchParams.get("mode") === "disabled" ? "disabled" : "enabled";
    trpcStub.gateMode = nextMode;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, gateMode: trpcStub.gateMode }));
    return;
  }

  // Unmatched API route — JSON 404 (never the SPA document; code parsing
  // JSON must not choke on HTML).
  if (path.startsWith("/api/trpc/") && url.pathname.startsWith("/api/trpc/")) {
    const handled = await handleTrpcStub(req, res, path, url);
    if (handled) return;
  }
  if (path.startsWith("/api/")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not stubbed" }));
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
