/**
 * Functional harness for the Cloudflare Worker's /yt/* YouTube data relay
 * (infra/security-audit/worker-v7-hardened.js).
 *
 * Runs the REAL worker module in Node with:
 *   - a stubbed Cache API (caches.default) backed by a Map,
 *   - a mocked global fetch that answers YouTube upstreams from fixtures,
 *   - the derived auth token computed exactly like the Space side must
 *     (hex(HMAC-SHA256(secret, "yt-relay-v1"))) via node:crypto.
 *
 * Proves: stealth 404 gate, verbatim Arabic titles end-to-end (InnerTube +
 * escaped-HTML + RSS merge), edge-cache hit/miss markers, oEmbed verdict
 * mapping (ok / gone / unknown→502), strict parameter grammar, 405 on POST,
 * and that the /yt gate runs BEFORE the WAF (XSS-looking query still 200).
 *
 * Run: node scripts/youtube_relay_worker_test.mjs
 */
import { createHmac } from "node:crypto";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const SECRET = "yt-relay-harness-secret-" + "x".repeat(40);
const TOKEN = createHmac("sha256", SECRET).update("yt-relay-v1").digest("hex");

// ── Stub the Cache API BEFORE importing the worker ──
const cacheStore = new Map();
globalThis.caches = {
  default: {
    async match(key) {
      return cacheStore.get(key.url) ?? null;
    },
    async put(key, res) {
      cacheStore.set(key.url, res.clone());
    },
  },
};

// ── Mock upstream (YouTube) fetch ──
const upstreamCalls = [];
const AR_TITLE_1 = "كورس ETAP المجاني | تعلم ETAP من الصفر وحتى الاحتراف";
const AR_TITLE_2_RAW = "تحميل وتسطيب برنامج ETAP \\u0026 تسطيب #01"; // escaped form YouTube serves
const AR_TITLE_2_DECODED = "تحميل وتسطيب برنامج ETAP & تسطيب #01"; // what the relay must return

const innertubePayload = {
  contents: [
    {
      lockupViewModel: {
        contentId: "0l7WBjMF6uo",
        contentImage: { thumbnailViewModel: { image: { sources: [{ url: "https://i.ytimg.com/vi/0l7WBjMF6uo/hq720.jpg" }] } } },
        metadata: { lockupMetadataViewModel: { title: { content: AR_TITLE_1 } } },
      },
    },
  ],
};

const htmlFixture =
  `<html><script>var ytInitialData = {"lockupViewModel":{"contentImage":{"sources":[` +
  `{"url":"https://i.ytimg.com/vi/avugPlx0sXw/hq720.jpg"}]},"metadata":{"lockupMetadataViewModel":` +
  `{"title":{"content":"${AR_TITLE_2_RAW}"}}}}};</script></html>`;

const rssFixture =
  `<feed><entry><yt:videoId>0l7WBjMF6uo</yt:videoId><title>${AR_TITLE_1}</title></entry></feed>`;

globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof URL ? input : input?.url ?? input);
  upstreamCalls.push({ url, method: init.method ?? "GET" });
  const json = (body, status = 200) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  if (url.includes("/youtubei/v1/browse")) return json(innertubePayload);
  if (url.includes("/playlist?list=PLTEST")) return new Response(htmlFixture, { status: 200 });
  if (url.includes("/feeds/videos.xml")) return new Response(rssFixture, { status: 200 });
  if (url.includes("/oembed")) {
    const target = decodeURIComponent(new URL(url).searchParams.get("url") ?? "");
    const v = new URL(target).searchParams.get("v");
    if (v === "0l7WBjMF6uo") return json({ title: AR_TITLE_1, author_name: "AhmedEtap" });
    if (v === "avugPlx0sXw") return json({ error: "not found" }, 404);
    return json({ error: "boom" }, 503);
  }
  return json({ error: "unexpected upstream: " + url }, 500);
};

const worker = (await import(pathToFileURL(fileURLToPath(new URL("../infra/security-audit/worker-v7-hardened.js", import.meta.url))))).default;
const env = { TG_RELAY_SECRET: SECRET };
const ctx = { waitUntil() {} };

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : " — " + detail}`);
  if (cond) pass++;
  else fail++;
}

async function call(pathname, headers = {}, method = "GET") {
  return worker.fetch(new Request(`https://ahmedelbaz.ahmdelbaz28.workers.dev${pathname}`, { method, headers }), env, ctx);
}

// ── 1. Stealth gate ──
check("no token → stealth 404", (await call("/yt/playlist?list=PLTEST12345")).status === 404);
check("wrong token → stealth 404", (await call("/yt/playlist?list=PLTEST12345", { "X-Yt-Relay-Token": "wrong" })).status === 404);
check("POST without token → stealth 404 (gate before method)", (await call("/yt/playlist?list=PLTEST12345", {}, "POST")).status === 404);
check("unknown /yt route with token → 404", (await call("/yt/other", { "X-Yt-Relay-Token": TOKEN })).status === 404);
check("missing binding → stealth 404", (await worker.fetch(new Request("https://x/yt/playlist?list=PLTEST12345"), {}, ctx)).status === 404);

// ── 2. Playlist happy path ──
let r = await call("/yt/playlist?list=PLTEST12345", { "X-Yt-Relay-Token": TOKEN });
let body = await r.json();
check("playlist 200 ok:true", r.status === 200 && body.ok === true, `status=${r.status} body=${JSON.stringify(body)}`);
check("verbatim Arabic title #1 (InnerTube source)", body.items.some((v) => v.videoId === "0l7WBjMF6uo" && v.title === AR_TITLE_1), JSON.stringify(body.items));
check("HTML escaped title decoded verbatim (\\u0026 → &)", body.items.some((v) => v.videoId === "avugPlx0sXw" && v.title === AR_TITLE_2_DECODED), JSON.stringify(body.items));
check("sources counters (innertube/html/rss)", body.sources.innertube === 1 && body.sources.html === 1 && body.sources.rss === 1, JSON.stringify(body.sources));
check("first serve = X-Yt-Cache: miss", r.headers.get("X-Yt-Cache") === "miss", String(r.headers.get("X-Yt-Cache")));

// ── 3. Edge cache ──
r = await call("/yt/playlist?list=PLTEST12345", { "X-Yt-Relay-Token": TOKEN });
body = await r.json();
check("second serve = X-Yt-Cache: hit", r.headers.get("X-Yt-Cache") === "hit", String(r.headers.get("X-Yt-Cache")));
check("cache hit → zero extra upstream fetches (3 total)", upstreamCalls.length === 3, JSON.stringify(upstreamCalls));
check("cache hit returns same verbatim payload", body.items.length === 2 && body.items[0].title === AR_TITLE_1);

// ── 4. oEmbed verdicts ──
r = await call("/yt/oembed?v=0l7WBjMF6uo", { "X-Yt-Relay-Token": TOKEN });
body = await r.json();
check("oembed exists:true + verbatim title", body.ok === true && body.exists === true && body.title === AR_TITLE_1, JSON.stringify(body));
r = await call("/yt/oembed?v=avugPlx0sXw", { "X-Yt-Relay-Token": TOKEN });
body = await r.json();
check("oembed gone → exists:false (200)", body.ok === true && body.exists === false, JSON.stringify(body));
check("oembed upstream 5xx → 502 unknown (never cached)", (await call("/yt/oembed?v=ZZZZZZZZZZZ", { "X-Yt-Relay-Token": TOKEN })).status === 502);
check("bad video id → 400", (await call("/yt/oembed?v=short", { "X-Yt-Relay-Token": TOKEN })).status === 400);
check("bad playlist id → 400", (await call("/yt/playlist?list=bad%20id!", { "X-Yt-Relay-Token": TOKEN })).status === 400);

// ── 5. Gate runs BEFORE the WAF: raw <script> in query must NOT trip stage5 ──
r = await call("/yt/playlist?list=PLTEST12345b&x=<script>");
check("WAF bypassed for /yt (XSS-looking query → still stealth 404 on gate, not 403)", r.status === 404);
r = await call("/yt/playlist?list=PLTEST12345b&x=<script>", { "X-Yt-Relay-Token": TOKEN });
check("with token, XSS-looking query still 200 (gate order proven)", r.status === 200, `status=${r.status}`);

// ── 6. Method + headers ──
check("POST with token → 405", (await call("/yt/playlist?list=PLTEST12345", { "X-Yt-Relay-Token": TOKEN }, "POST")).status === 405);
r = await call("/yt/oembed?v=0l7WBjMF6uo", { "X-Yt-Relay-Token": TOKEN });
check("security headers still applied (X-Request-ID)", r.headers.get("X-Request-ID") !== null);
check("worker tag header present", r.headers.get("X-Content-Type-Options") === "nosniff");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
