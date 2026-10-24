/**
 * MOCK OpenRouter-compatible upstream for local zero-gap e2e.
 *
 * Listens on 127.0.0.1:47777 and serves POST /v1/chat/completions:
 *   - Records every request body (plugins/stream/model) in memory.
 *   - Per-model behavior:
 *       mock/grounded        → 200 JSON reply (always)
 *       mock/grounded-stream → 200 SSE stream (2 content deltas + [DONE])
 *       mock/charged         → 402 on the FIRST call, 200 JSON afterwards
 *                              (exercises the web-plugin breaker retry)
 *   - GET  /__log   → JSON of recorded calls
 *   - POST /__reset → clears the log
 */
import http from "node:http";

const PORT = 47777;
const log = [];

function sseReply(res) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const chunks = ["رد موثق", " تجريبي متدفق"];
  let i = 0;
  const timer = setInterval(() => {
    if (i < chunks.length) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i] } }] })}\n\n`);
      i++;
    } else {
      res.write("data: [DONE]\n\n");
      res.end();
      clearInterval(timer);
    }
  }, 20);
}

function jsonReply(res, content) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { content } }] }));
}

/** SSE winner whose first byte lands after 6s (SSE-first + keepalive probe). */
function slowReply(res) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const deltas = ["بداية الرد البطيء ", " والكمال بعده"];
  setTimeout(() => {
    let i = 0;
    const timer = setInterval(() => {
      if (i < deltas.length) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: deltas[i] } }] })}\n\n`);
        i++;
      } else {
        res.write("data: [DONE]\n\n");
        res.end();
        clearInterval(timer);
      }
    }, 40);
  }, 6000);
}

/**
 * DUD winner — passes the liveness peek (emits a reasoning-only delta) then
 * closes with ZERO visible content and no [DONE]. Exactly the prod failure
 * the zero-content re-walk was built for: a free-tier model that peeks alive
 * and dies silently.
 */
function dudReply(res) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  // reasoning_content delta = liveness proof for the peek gate, never content
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "thinking silently..." } }] })}\n\n`);
  setTimeout(() => {
    // closes WITHOUT any content delta and WITHOUT [DONE] — premature death
    res.end();
  }, 300);
}

/**
 * VISION PASS-1 reader reply — a factual extraction description. Used ONLY
 * for requests whose messages contain image_url parts (the extraction pass).
 */
function visionReadReply(res) {
  jsonReply(res, "لقطة شاشة من ETAP — نافذة Load Flow Study. القيمة 0.95 p.u وحقل [غير مقروء]. العنوان: Study Report.");
}

const server = http.createServer((req, res) => {
  const url = req.url || "";
  if (url === "/__log") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(log));
    return;
  }
  if (url === "/__reset" && req.method === "POST") {
    log.length = 0;
    chargedCalls = 0;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"ok":true}');
    return;
  }
  if (url.endsWith("/chat/completions") && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let parsed = {};
      try { parsed = JSON.parse(body || "{}"); } catch { /* ignore */ }
      const modelId = parsed.model || "";
      log.push({
        model: modelId,
        stream: parsed.stream === true,
        plugins: parsed.plugins ?? null,
        systemChars: (parsed.messages?.[0]?.content || "").length,
      });
      // NOTE: model-specific behaviors BEFORE the generic stream short-circuit,
      // otherwise a stream:true request would never see the 429/slow paths.
      if (modelId === "mock/daily-429") {
        // Account-level daily-quota exhaustion — arms the 30-min breaker.
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: { code: 429, message: "Rate limit exceeded: free-models-per-day (Limit: 50, Used: 50, Requested: 1). Please try again in 12h." },
        }));
        return;
      }
      if (modelId === "mock/slow-stream") {
        // First byte delayed 6s — proves the endpoint streams SSE headers +
        // `: ping` keepalives BEFORE any content is available (SSE-first).
        slowReply(res);
        return;
      }
      if (modelId === "mock/vl-reader") {
        // TWO-PASS VISION policy probe: with image parts → this is PASS 1
        // (the read) → serve the factual description. Plain text → this is
        // PASS 2 (the persona answer) → the VL model REFUSES to serve it (500)
        // — the answer writer must be the text cascade, never a vision model.
        const hasImage = (parsed.messages || []).some((m) =>
          Array.isArray(m.content) && m.content.some((part) => part?.type === "image_url"));
        if (hasImage) {
          visionReadReply(res);
        } else {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { code: 500, message: "VL model never writes chat answers" } }));
        }
        return;
      }
      if (modelId === "mock/dud-stream") {
        // Peeks alive (reasoning delta) then dies with zero visible content —
        // the resilient stream records the failure and the endpoint's
        // zero-content re-walk must serve the user from the next candidate.
        dudReply(res);
        return;
      }
      if (modelId === "mock/kilo-exhausted") {
        // KILO-LANE T6: per-model upstream quota exhaustion — a 429 whose body
        // is NOT the OpenRouter account-level daily shape, so only THIS model
        // cools down (90s) while the walk moves to the next kilo model.
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: { message: "Provider returned error", code: 429, metadata: { raw: "mock/kilo-exhausted:free is temporarily rate-limited upstream. Please retry shortly." } },
        }));
        return;
      }
      if (modelId === "mock/kilo-dead") {
        // KILO-LANE T6: dead model id (live-verified shape: NVIDIA function
        // not found) — 404 → dead_model cooldown (10 min) → next candidate.
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: { message: "Provider returned error", code: 404, metadata: { raw: "{\"status\":404,\"title\":\"Not Found\",\"detail\":\"Function not found for account\"}" } },
        }));
        return;
      }
      if (modelId === "mock/quota-exhaust") {
        // TOKEN-EXHAUSTION T7: this model's tokens are FINISHED — 402 on every
        // call (OpenRouter-style gateways use 402 for "insufficient credits").
        // Classified rate_limited → 90s model cooldown → the walk continues on
        // the next model in the SAME request; the user never sees an error.
        res.writeHead(402, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: { code: 402, message: "Not enough credits: this model's free tokens are exhausted. Try another model." },
        }));
        return;
      }
      if (parsed.stream === true) return sseReply(res); // any streaming model
      if (modelId === "mock/charged") {
        chargedCalls += 1;
        if (chargedCalls === 1) {
          res.writeHead(402, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { code: 402, message: "Not enough credits for web results" } }));
          return;
        }
        return jsonReply(res, "رد بعد كسر القاطع — نجاح بدون plugin");
      }
      return jsonReply(res, "رد موثق تجريبي: **خطوة 1** ثم خطوة 2 (رد من الخادم الوهمي)");
    });
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end('{"error":"not found"}');
});

let chargedCalls = 0;
server.listen(PORT, "127.0.0.1", () => console.log(`mock openrouter on ${PORT}`));
