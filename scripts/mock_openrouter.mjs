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
