// LOCAL REVERSE PROXY — measures the REAL production origin (HF Space with
// x-forwarded-host) without the qzz.io edge challenge. Lighthouse targets
// http://localhost:4174 and sees the exact production build + data.
//
// Security posture (Sonar S5146/S6109/S5144):
//   • fixed upstream host (constant, never user input) — no SSRF surface;
//   • explicit response-header allowlist — the client never receives an
//     attacker-influenced Location/set-cookie chain from the passthrough;
//   • GET/HEAD only — this is a measurement tool, no state mutations.
import http from "node:http";
import https from "node:https";

const ORIGIN_HOST = "ahmdelbaz28-ahmdrtap.hf.space"; // fixed constant
const FWD_HOST = "ahmedelbaz.qzz.io";
const PORT = Number(process.argv[2] || 4174);

// Response headers the browser is allowed to see (allowlist, not passthrough).
// set-cookie is included because login flows through the proxy must establish
// the session — the upstream host is a FIXED trusted constant.
const PASSTHROUGH_HEADERS = new Set([
  "content-type",
  "content-length",
  "content-encoding",
  "cache-control",
  "x-robots-tag",
  "link",
  "etag",
  "set-cookie",
]);

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST") {
    res.writeHead(405, { "content-type": "text/plain" });
    res.end("GET/HEAD/POST only");
    return;
  }
  // Only the session cookie is forwarded from the client — everything else in
  // the upstream request is a fixed constant (no user-controlled SSRF input).
  const headers = {
    "accept": "*/*",
    "accept-encoding": "gzip, deflate, br",
    "user-agent": "lighthouse-proxy/1",
    "x-forwarded-host": FWD_HOST,
    "x-forwarded-proto": "https",
    "host": ORIGIN_HOST,
  };
  if (req.headers.cookie) headers.cookie = String(req.headers.cookie);
  if (req.method === "POST") {
    headers["content-type"] = "application/json";
  }

  const upstream = https.request(
    { hostname: ORIGIN_HOST, port: 443, path: req.url, method: req.method, headers },
    (up) => {
      const out = {};
      for (const [k, v] of Object.entries(up.headers)) {
        if (PASSTHROUGH_HEADERS.has(k.toLowerCase())) out[k] = v;
      }
      res.writeHead(up.statusCode, out);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end("proxy upstream error");
  });
  if (req.method === "POST") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => upstream.end(Buffer.concat(chunks)));
  } else {
    upstream.end();
  }
});

server.listen(PORT, () => console.log(`production proxy on :${PORT} → ${ORIGIN_HOST} (host=${FWD_HOST})`));
