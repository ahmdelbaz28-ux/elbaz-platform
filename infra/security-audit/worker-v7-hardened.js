/**
 * Worker v7 - Security Hardened Edge Proxy
 * 
 * Changes from v6:
 *   - REMOVED: stage15_botScoring (was causing 403s on bot scores < 30)
 *   - REMOVED: stage3_rateLimit (moved to KV, still available separately)
 *   - REMOVED: stage1_allowCloudflareIPsOnly (redundant at edge)
 *   - REPLACED: blockUserAgent → blockScannersOnly (allows curl/wget, blocks sqlmap/nikto/nmap)
 *   - REMOVED: UA length check (< 10 chars block)
 *   - RELAXED: SQL injection - only checks query strings, not URL paths
 *   - RELAXED: XSS patterns reduced from 21 to 9 (removed alert/confirm/prompt etc.)
 *   - INCREASED: MAX_REQUEST_SIZE from 10MB to 20MB
 *   - CHANGED: X-Frame-Options from DENY to SAMEORIGIN
 *   - ADDED: STATIC_EXTENSIONS set for static file bypass
 *   - ADDED: API_PATHS set for API route identification
 *   - ADDED: X-Request-ID header on all responses
 *   - KEPT: All remaining security stages intact
 */

const ORIGIN = 'https://ahmdelbaz28-ahmdrtap.hf.space';
const ALLOWED_DOMAIN = 'ahmedelbaz.qzz.io';
// ✅ SECURITY (post-audit fix): module-scoped holder for the edge→origin HMAC
// secret. It MUST be declared — assigning an undeclared identifier inside an
// ES module (strict mode) throws ReferenceError, and `typeof` then reports
// 'undefined', silently disabling request signing while the origin enforces
// it (result: every worker-proxied request 404s). Populated from env in
// handleRequest before any proxying happens.
let EDGE_ORIGIN_SECRET;
// ─── Telegram transport relay secret ──────────────────────────────────────
// ROOT-CURE (2026-10-29): the HF Space's shared egress lost reachability to
// api.telegram.org (connect-level "fetch failed" while every other external
// host answered). The worker now relays Bot API calls for the origin. Declared
// at module scope for the same strict-mode reason as EDGE_ORIGIN_SECRET.
let TG_RELAY_SECRET;

// ─── IP Ranges ───────────────────────────────────────────────────────────────
// Cloudflare's published IPv4/IPv6 CIDR blocks, used to allowlist
// Cloudflare edge traffic. These MUST be hardcoded — they are published
// constants from https://www.cloudflare.com/ips/. Reviewed against
// SonarCloud S1313 — entire block suppressed as these are official Cloudflare ranges.
// Defined as a single string split on whitespace so S1313 fires once on the
// string literal (suppressed with NOSONAR) instead of 22 times on individual IPs.
const CLOUDFLARE_IP_RANGES = ( // NOSONAR — Cloudflare published IP ranges, see https://www.cloudflare.com/ips/
  '173.245.48/20 103.21.244/22 103.22.200/22 103.31.4/22 141.101.64/18 ' +
  '108.162.192/18 190.93.240/20 188.114.96/20 197.234.240/22 198.41.128/17 ' +
  '162.158.0/15 104.16.0/13 104.24.0/14 172.64.0/13 131.72/22 ' +
  '2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 ' +
  '2a06:98c0::/29 2c0f:f248::/32'
).split(/\s+/);

// ─── Blocked ASNs ────────────────────────────────────────────────────────────
// SonarCloud S7776: use a Set for O(1) membership tests instead of Array.includes.
const BLOCKED_ASNS = new Set([
  396982, 209242, 62240, 20473, 14061, 394244, 45090, 36351, 53667,
  212238, 209103, 208153, 200762, 206264, 201839, 64049, 132203,
  136552, 197595, 396928, 45090, 35914, 61317, 62217, 28920, 40676,
]);

// ─── Scanner UA (v7: only block actual scanners, NOT curl/wget) ──────────────
const BLOCKED_SCANNER_UA = [
  'sqlmap',
  'nikto',
  'nmap',
  'masscan',
  'zgrab',
  'dirbuster',
  'gobuster',
  'ffuf',
  'wfuzz',
  'hydra',
  'medusa',
  'acunetix',
  'nessus',
  'openvas',
  'nuclei',
  'w3af',
  'arachni',
  'burpsuite',
  'wpscan',
  'shellshock',
  'CVE-',
  'struts-pwn',
  'zmap',
  'ssh-scan',
  'exploit',
];

// ─── Sensitive Paths ────────────────────────────────────────────────────────
const BLOCKED_PATHS = [
  '/.env', '/.git', '/wp-admin', '/phpmyadmin', '/admin/config',
  '/backup.sql', '/debug', '/trace', '/actuator',
  '/.well-known/security.txt', '/server-status', '/server-info',
];

// ─── SQL Injection (v7: relaxed - only checked in query strings, NOT paths) ──
const SQL_INJECTION_PATTERNS = [
  /(\bUNION\b.*\bSELECT\b)/i,
  /(\bDROP\b.*\bTABLE\b)/i,
  /(\bOR\b\s+1\s*=\s*1)/i,
  /(\bAND\b\s+1\s*=\s*1)/i,
  /\bSLEEP\s*\(/i,
  /\bBENCHMARK\s*\(/i,
  /;\s*(DROP|ALTER|CREATE|TRUNCATE)\b/i,
  /'\s*OR\s+'/i,
  /CONCAT\s*\(/i,
  /WAITFOR\s+DELAY/i,
  /EXTRACTVALUE\s*\(/i,
  /UPDATEXML\s*\(/i,
];

// ─── XSS (v7: reduced from 21 to 9 patterns) ────────────────────────────────
const XSS_PATTERNS = [
  /<script[\s>]/i,
  /<\/script>/i,
  /javascript\s*:/i,
  /\bon\w+\s*=\s*["']/i,
  /<svg[^>]+onload/i,
  /<iframe[^>]+src/i,
  /document\.\s*cookie/i,
  /document\.\s*location/i,
  /String\.fromCharCode/i,
];

// ─── Path Traversal ─────────────────────────────────────────────────────────
const PATH_TRAVERSAL_PATTERNS = [
  /\.\.[/\\]/,
  /%2e%2e%2f/i,
  /%2e%2e%5c/i,
  /\.\.%2f/i,
  /%252e%252e%252f/i,
];

// ─── Command Injection ──────────────────────────────────────────────────────
const COMMAND_INJECTION_PATTERNS = [
  /;\s*(ls|cat|id|whoami|pwd|uname|ifconfig|netstat|ps|kill|rm)\b/i,
  /\|\s*(ls|cat|id|whoami|pwd|uname|ifconfig|netstat|ps|kill|rm)\b/i,
  /&&\s*(ls|cat|id|whoami|pwd|uname|ifconfig|netstat|ps|kill|rm)\b/i,
  /`[^`]*`/,
  /\$\([^)]*\)/,
];

// ─── Request Size (v7: increased from 10MB to 20MB) ────────────────────────
const MAX_REQUEST_SIZE = 20 * 1024 * 1024;

// ─── API Paths (v7: new) ────────────────────────────────────────────────────
// ✅ SECURITY FIX (audit run-1, worker.v7.dead-webhook-skiplist): list only
// REAL mounted routes. /api/paymob/webhook is the canonical Paymob endpoint
// and /api/webhooks/paymob is the dashboard-registered legacy alias of the
// same handler (api/boot.ts mounts both) — the previously-exempted
// /api/webhooks/ prefix matched no mounted route and died here.
const API_PATHS = [
  '/api/health',
  '/api/trpc/ping',
  '/api/trpc/',
  '/api/paymob',
  '/api/webhooks/paymob',
  '/api/chatbot',
];

// ─── Static Extensions (v7: new - skip UA checks for static assets) ─────────
const STATIC_EXTENSIONS = new Set([
  '.html', '.css', '.js', '.json', '.png', '.jpg', '.jpeg', '.gif',
  '.svg', '.ico', '.webp', '.woff', '.woff2', '.m3u8', '.ts',
  '.txt', '.pdf', '.map', '.xml',
]);

// ─── Helper Functions ────────────────────────────────────────────────────────

function isApiOrWebhook(pathname) {
  return API_PATHS.some(p => pathname.startsWith(p));
}

function isStaticAsset(pathname) {
  const ext = pathname.substring(pathname.lastIndexOf('.'));
  return STATIC_EXTENSIONS.has(ext);
}

function ipInCidr(ip, cidr) {
  const [range, bits] = cidr.split('/');
  const mask = ~(2 ** (32 - Number.parseInt(bits, 10)) - 1);
  const ipInt = ip.split('.').reduce((acc, octet) => (acc << 8) + Number.parseInt(octet, 10), 0) >>> 0;
  const rangeInt = range.split('.').reduce((acc, octet) => (acc << 8) + Number.parseInt(octet, 10), 0) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function matchesPatterns(str, patterns) {
  return patterns.some(pattern => {
    if (pattern instanceof RegExp) return pattern.test(str);
    return str.toLowerCase().includes(pattern.toLowerCase());
  });
}

// ─── Security Stages ─────────────────────────────────────────────────────────

// Stage 1: Enforce HTTPS
function stage1_enforceHTTPS(request) {
  const url = new URL(request.url);
  const cfVisitor = request.headers.get('CF-Visitor');
  if (cfVisitor) {
    try {
      const visitor = JSON.parse(cfVisitor);
      if (visitor.scheme === 'http') {
        return Response.redirect(url.toString().replace(/^http:/, 'https:'), 301);
      }
    } catch {
      // Intentionally ignored: malformed CF-Visitor header — fall through to the url.protocol check below. — SonarCloud S2486
    }
  }
  if (url.protocol === 'http:') {
    return Response.redirect(url.toString().replace(/^http:/, 'https:'), 301);
  }
  return null;
}

// Stage 2: Block Bad ASNs
function stage2_blockBadASNs(request) {
  const asn = request.cf?.asn;
  if (asn && BLOCKED_ASNS.has(Number(asn))) {
    return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
  }
  return null;
}

// Stage 3: Block Sensitive Paths
function stage3_blockSensitivePaths(request) {
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname).toLowerCase();
  for (const blockedPath of BLOCKED_PATHS) {
    if (path === blockedPath || path.startsWith(`${blockedPath}/`) || path.includes(blockedPath)) {
      return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    }
  }
  return null;
}

// Stage 4: Block SQL Injection (v7: only checks query string, not path)
function stage4_blockSQLInjection(request) {
  const url = new URL(request.url);
  const checkString = url.search;
  if (matchesPatterns(checkString, SQL_INJECTION_PATTERNS)) {
    return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
  }
  return null;
}

// Stage 5: Block XSS (v7: only checks query string, not path)
function stage5_blockXSS(request) {
  const url = new URL(request.url);
  const checkString = url.search;
  if (matchesPatterns(checkString, XSS_PATTERNS)) {
    return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
  }
  return null;
}

// Stage 6: Block Path Traversal
function stage6_blockPathTraversal(request) {
  const url = new URL(request.url);
  if (matchesPatterns(url.pathname, PATH_TRAVERSAL_PATTERNS)) {
    return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
  }
  return null;
}

// Stage 7: Block Command Injection (v7: only checks query string, not path)
function stage7_blockCommandInjection(request) {
  const url = new URL(request.url);
  const checkString = url.search;
  if (matchesPatterns(checkString, COMMAND_INJECTION_PATTERNS)) {
    return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
  }
  return null;
}

// Stage 8: Block Scanners Only (v7: replaces blockUserAgent - allows curl/wget)
function stage8_blockScannersOnly(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Skip UA checks for API routes and static assets
  if (isApiOrWebhook(pathname) || isStaticAsset(pathname)) {
    return null;
  }

  const ua = request.headers.get('User-Agent') || '';
  for (const scanner of BLOCKED_SCANNER_UA) {
    if (ua.toLowerCase().includes(scanner.toLowerCase())) {
      return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
    }
  }
  return null;
}

// Stage 9: Request Size Limit (v7: 20MB)
function stage9_requestSizeLimit(request) {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_REQUEST_SIZE) {
    return new Response(JSON.stringify({ error: 'Payload too large' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

// ─── Response Headers ───────────────────────────────────────────────────────

// 🚀 PERFORMANCE: Cache static assets at Cloudflare edge for 1 year.
// This means repeat visitors get assets from the nearest Cloudflare PoP
// instead of going all the way to the HF Space origin.
function addCacheHeaders(newHeaders, url) {
  const pathname = url.pathname;
  const ext = pathname.substring(pathname.lastIndexOf('.') + 1).toLowerCase();

  // Critical files: never cache
  const noCacheFiles = ['sw.js', 'cache-nuke.js', 'rtl-detect.js', 'clarity.js', 'pii-mask.js', 'build-id.json'];
  const filename = pathname.substring(pathname.lastIndexOf('/') + 1);

  if (noCacheFiles.includes(filename) || filename.startsWith('workbox-')) {
    // Already has no-cache from origin, don't override
    return;
  }

  // Hashed assets in /assets/ → cache for 1 year at edge
  if (pathname.startsWith('/assets/') && ['js', 'css', 'mjs'].includes(ext)) {
    newHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
    newHeaders.set('CDN-Cache-Control', 'public, max-age=31536000');
    newHeaders.set('Cloudflare-CDN-Cache-Control', 'public, max-age=31536000');
    return;
  }

  // Images and fonts → cache for 1 year at edge
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'woff', 'woff2', 'ttf', 'eot'].includes(ext)) {
    newHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
    newHeaders.set('CDN-Cache-Control', 'public, max-age=31536000');
    newHeaders.set('Cloudflare-CDN-Cache-Control', 'public, max-age=31536000');
    return;
  }

  // HTML pages: short cache at edge (30 seconds) for fast navigation
  // while still allowing updates to propagate quickly
  if (ext === '' || ext === 'html') {
    if (!newHeaders.get('Cache-Control') || newHeaders.get('Cache-Control').includes('no-cache')) {
      newHeaders.set('CDN-Cache-Control', 'public, max-age=30');
    }
  }
}

// Add security headers (v7: X-Frame-Options = SAMEORIGIN, + X-Request-ID)
function addSecurityHeaders(response, url) {
  const newHeaders = new Headers(response.headers);
  newHeaders.set('X-Content-Type-Options', 'nosniff');
  newHeaders.set('X-Frame-Options', 'SAMEORIGIN');  // v7: was DENY
  newHeaders.set('X-XSS-Protection', '1; mode=block');
  newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  newHeaders.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), display-capture=(self), payment=()');
  newHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  newHeaders.set('X-Permitted-Cross-Domain-Policies', 'none');
  // v7: Add X-Request-ID
  newHeaders.set('X-Request-ID', crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36));
  // Remove server fingerprinting
  newHeaders.delete('X-Powered-By');
  newHeaders.delete('Server');

  // 🚀 PERFORMANCE: Add cache headers for static assets
  if (url) {
    addCacheHeaders(newHeaders, url);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

// ✅ SESSION PERSISTENCE FIX: native shells (Capacitor Android/iOS WebView,
// Electron file://) are first-party surfaces — their preflight Origin must be
// REFLECTED or the browser kills every app request at CORS. Web requests
// (origin == ALLOWED_DOMAIN) keep the pinned domain; unknown origins keep the
// pinned domain too (no wildcard with credentials).
const NATIVE_APP_ORIGINS = new Set(['https://localhost', 'http://localhost', 'capacitor://localhost', 'null']);
function addCORSHeaders(response, request) {
  const newHeaders = new Headers(response.headers);
  let corsOrigin = ALLOWED_DOMAIN;
  if (request) {
    const reqOrigin = request.headers.get('Origin');
    if (reqOrigin && reqOrigin !== ALLOWED_DOMAIN && NATIVE_APP_ORIGINS.has(reqOrigin)) {
      corsOrigin = reqOrigin;
    }
  }
  newHeaders.set('Access-Control-Allow-Origin', corsOrigin);
  newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  // ✅ SESSION PERSISTENCE FIX: X-Capacitor-Platform rides on every native-app
  // request (preflight must allow it or the APK dies at OPTIONS), and
  // X-Renewed-Token must be EXPOSED so the app's fetch wrapper can read the
  // sliding-renewed JWT and keep its localStorage session alive.
  newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Token, X-Request-ID, X-Forwarded-For, X-Capacitor-Platform');
  newHeaders.set('Access-Control-Expose-Headers', 'X-Request-ID, X-Renewed-Token');
  newHeaders.set('Access-Control-Allow-Credentials', 'true');
  newHeaders.set('Access-Control-Max-Age', '86400');
  newHeaders.set('Vary', 'Accept-Encoding, Origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

// ─── Request Transformation ─────────────────────────────────────────────────

async function addRequestHeaders(request) {
  const headers = new Headers(request.headers);
  headers.set('X-Forwarded-Host', ALLOWED_DOMAIN);
  headers.set('X-Real-IP', request.headers.get('CF-Connecting-IP') || '');
  headers.set('X-Security-Worker', 'ahmedelbaz-v7');
  headers.delete('CF-Connecting-IP');
  // ✅ SECURITY FIX (audit run-1): optional edge→origin authentication.
  // When the worker var EDGE_ORIGIN_SECRET is configured, every proxied request
  // carries a fresh HMAC-SHA256 of the timestamp; the origin's shield middleware
  // rejects any request without it (closing the public direct-to-origin door).
  // Configure the SAME secret as a Space secret. Unset = unchanged behavior.
  if (typeof EDGE_ORIGIN_SECRET === 'string' && EDGE_ORIGIN_SECRET.length > 0) {
    try {
      const ts = String(Date.now());
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey('raw', enc.encode(EDGE_ORIGIN_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(ts));
      const sig = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
      headers.set('x-edge-ts', ts);
      headers.set('x-edge-sig', sig);
    } catch {
      // Signature is best-effort; origin enforcement only activates when the secret exists there too.
    }
  }

  const newUrl = new URL(request.url);
  newUrl.hostname = new URL(ORIGIN).hostname;
  newUrl.protocol = 'https:';

  return new Request(newUrl.toString(), {
    method: request.method,
    headers: headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    redirect: 'manual',
  });
}

// ─── Main Handler ───────────────────────────────────────────────────────────

// ─── Telegram transport relay (/tg/*) ────────────────────────────────────
// Pure transport relay: the path after /tg/ is forwarded verbatim to
// https://api.telegram.org/<path>. Gated by the X-Relay-Secret shared secret
// (stealth 404 when missing) — the relay is NEVER an open Telegram proxy.
// Runs BEFORE the WAF pipeline: bot message bodies can trip text heuristics,
// and the relay has its own strict path grammar + secret gate instead.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handleTelegramRelay(request, requestUrl) {
  const secret = (typeof TG_RELAY_SECRET !== 'undefined' && TG_RELAY_SECRET) ? TG_RELAY_SECRET : undefined;
  if (!secret) {
    return new Response(JSON.stringify({ ok: false, description: 'relay not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, description: 'POST only' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const provided = request.headers.get('X-Relay-Secret') || '';
  if (!safeEqual(provided, secret)) {
    // Stealth 404 — do not reveal that the route exists.
    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const methodPath = requestUrl.pathname.slice('/tg/'.length); // e.g. bot<token>/getMe
  if (!/^bot[0-9A-Za-z_:\-]+\/[A-Za-z]+$/.test(methodPath)) {
    return new Response(JSON.stringify({ ok: false, description: 'bad relay path' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const body = await request.text();
  const upstream = await fetch(`https://api.telegram.org/${methodPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(35_000), // getUpdates long-polls 25s + margin
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ─── YouTube data relay (/yt/*) ────────────────────────────────────────
// DATA relay (2026-11-05): the HF Space's shared datacenter egress is
// throttled by YouTube (429s / consent pages) — the origin's playlist watcher
// and the admin lesson-import dialog degrade exactly when they are needed
// (production incidents 2026-10-28 and 2026-11-05). Cloudflare → YouTube
// egress is clean (same property that fixed Telegram above). Two GET routes:
//   /yt/playlist?list=<id> → {ok, playlistId, items:[{videoId,title}], sources}
//   /yt/oembed?v=<id>      → {ok, exists:true,title} | {ok, exists:false}
// Titles are forwarded VERBATIM — this relay exists so the site can obey the
// owner rule "no invented titles, only the ones YouTube itself shows".
//
// AUTH — derived token, zero new secrets: header X-Yt-Relay-Token must equal
//   hex(HMAC-SHA256(TG_RELAY_SECRET, "yt-relay-v1"))
// The Space computes the same derivation from TELEGRAM_API_RELAY_SECRET
// (proven provisioned on BOTH sides by the live /tg relay — same GitHub
// secret feeds the worker binding and the Space secret). Deriving a route key
// instead of reusing the raw secret means one leaked header never grants the
// other route. Unauthenticated requests get the same stealth 404 as /tg —
// this is never an open YouTube proxy.
const YT_RELAY_CONTEXT = 'yt-relay-v1';
const YT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const YT_VIDEO_ID_RE = /^[\w-]{11}$/;
const YT_PLAYLIST_ID_RE = /^[\w-]{10,64}$/;
const YT_FETCH_TIMEOUT_MS = 12000;

async function ytRelayToken() {
  if (typeof TG_RELAY_SECRET !== 'string' || TG_RELAY_SECRET.length < 16) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(TG_RELAY_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(YT_RELAY_CONTEXT));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── YouTube parsers (standalone ports of api/lib/notification-utils.ts —
//    the worker is a single-file module and cannot import from api/) ──

function ytDecodeJsonStringLiteral(raw) {
  try { return JSON.parse(`"${raw}"`); } catch {
    return raw.replaceAll('\\u0026', '&').replaceAll('\\"', '"').replaceAll('\\\\', '\\');
  }
}

function ytCollect(out, seen, videoId, title) {
  if (!videoId || seen.has(videoId)) return;
  seen.add(videoId);
  out.push({ videoId, title });
}

function ytParsePlaylistHtml(html) {
  const out = [];
  const seen = new Set();
  // Layout A (legacy playlistVideoRenderer)
  const blocks = html.split('"playlistVideoRenderer"');
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].slice(0, 4000);
    const idMatch = /"videoId":"([\w-]{11})"/.exec(block);
    if (!idMatch) continue;
    const titleMatch = /"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/.exec(block);
    ytCollect(out, seen, idMatch[1], titleMatch ? ytDecodeJsonStringLiteral(titleMatch[1]) : '');
  }
  if (out.length > 0) return out;
  // Layout B (2025+ lockupViewModel)
  const lockups = html.split('{"lockupViewModel"');
  for (let i = 1; i < lockups.length; i++) {
    const block = lockups[i].slice(0, 10000);
    if (!block.includes('contentImage')) continue;
    const idMatch = /\/vi\/([\w-]{11})\//.exec(block);
    if (!idMatch) continue;
    const titleMatch =
      /"lockupMetadataViewModel":\{"title":\{"content":"((?:[^"\\]|\\.)*)"/.exec(block) ??
      /"title":\{"content":"((?:[^"\\]|\\.)*)"/.exec(block);
    ytCollect(out, seen, idMatch[1], titleMatch ? ytDecodeJsonStringLiteral(titleMatch[1]) : '');
  }
  if (out.length > 0) return out;
  // Loose fallback
  const looseIds = html.match(/"videoId":"([\w-]{11})"/g) ?? [];
  for (const raw of looseIds) {
    ytCollect(out, seen, /"videoId":"([\w-]{11})"/.exec(raw)?.[1], '');
  }
  return out;
}

function ytTitleFromNode(node) {
  const title = node.title;
  if (typeof title === 'string') return title;
  if (title && typeof title === 'object') {
    if (typeof title.content === 'string') return title.content;
    if (Array.isArray(title.runs)) {
      return title.runs.map((run) => (run && typeof run === 'object' ? String(run.text ?? '') : '')).join('');
    }
  }
  const metadata = node.metadata;
  if (metadata && typeof metadata === 'object' && metadata.lockupMetadataViewModel && typeof metadata.lockupMetadataViewModel === 'object') {
    return ytTitleFromNode(metadata.lockupMetadataViewModel);
  }
  return '';
}

function ytParseInnertube(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const out = [];
  const seen = new Set();
  const loose = [];
  const walk = (node) => {
    if (Array.isArray(node)) { for (const child of node) walk(child); return; }
    if (!node || typeof node !== 'object') return;
    const obj = node;
    const lockup = obj.lockupViewModel;
    if (lockup && typeof lockup === 'object') {
      let videoId = lockup.contentId;
      if (typeof videoId !== 'string' || !YT_VIDEO_ID_RE.test(videoId)) {
        videoId = /\/vi\/([\w-]{11})\//.exec(JSON.stringify(lockup.contentImage ?? ''))?.[1];
      }
      ytCollect(out, seen, videoId, ytTitleFromNode(lockup));
    }
    const renderer = obj.playlistVideoRenderer;
    if (renderer && typeof renderer === 'object') {
      ytCollect(out, seen, renderer.videoId, ytTitleFromNode(renderer));
    }
    if (typeof obj.videoId === 'string' && YT_VIDEO_ID_RE.test(obj.videoId)) loose.push(obj.videoId);
    for (const value of Object.values(obj)) walk(value);
  };
  walk(payload);
  if (out.length > 0) return out;
  for (const videoId of loose) ytCollect(out, seen, videoId, '');
  return out;
}

function ytParseRss(xml) {
  const out = [];
  const seen = new Set();
  const entries = xml.split('<entry>').slice(1);
  for (const entry of entries) {
    const idMatch = /<yt:videoId>([\w-]{11})<\/yt:videoId>/.exec(entry);
    if (!idMatch || seen.has(idMatch[1])) continue;
    const titleMatch = /<title>([^<]*)<\/title>/.exec(entry);
    seen.add(idMatch[1]);
    out.push({
      videoId: idMatch[1],
      title: titleMatch
        ? titleMatch[1].replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'")
        : '',
    });
  }
  return out;
}

function ytMergeSources(...sources) {
  const out = [];
  const indexById = new Map();
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const video of source) {
      if (!video?.videoId) continue;
      const existingIdx = indexById.get(video.videoId);
      if (existingIdx === undefined) {
        indexById.set(video.videoId, out.length);
        out.push({ videoId: video.videoId, title: video.title });
      } else if (!out[existingIdx].title && video.title) {
        out[existingIdx] = { ...out[existingIdx], title: video.title };
      }
    }
  }
  return out;
}

async function ytFetchText(url, init) {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': YT_UA, 'Accept-Language': 'ar,en;q=0.8', ...(init && init.headers) },
      signal: AbortSignal.timeout(YT_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function ytFetchPlaylistUpstream(playlistId) {
  const [innertubeRaw, htmlRaw, rssRaw] = await Promise.all([
    ytFetchText('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20241001.00.00', hl: 'ar', gl: 'EG' } },
        browseId: `VL${playlistId}`,
      }),
    }),
    ytFetchText(`https://www.youtube.com/playlist?list=${playlistId}&hl=ar`),
    ytFetchText(`https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`),
  ]);
  let innertube = [];
  try { innertube = innertubeRaw ? ytParseInnertube(JSON.parse(innertubeRaw)) : []; } catch { innertube = []; }
  const html = htmlRaw ? ytParsePlaylistHtml(htmlRaw) : [];
  const rss = rssRaw ? ytParseRss(rssRaw) : [];
  return {
    items: ytMergeSources(innertube, html, rss),
    sources: { innertube: innertube.length, html: html.length, rss: rss.length },
  };
}

/** YouTube oEmbed: existence check AND the authoritative title in one call. */
async function ytFetchOembedUpstream(videoId) {
  const target = encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`);
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&hl=ar&url=${target}`, {
      headers: { 'User-Agent': YT_UA, 'Accept-Language': 'ar,en;q=0.8' },
      signal: AbortSignal.timeout(YT_FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (data && typeof data.title === 'string' && data.title.trim()) {
        return { ok: true, exists: true, videoId, title: data.title };
      }
      return null; // 200 without a usable title — report "unknown", never guess
    }
    if (res.status === 400 || res.status === 401 || res.status === 404) {
      return { ok: true, exists: false, videoId };
    }
    return null; // throttled / 5xx — unknown
  } catch {
    return null;
  }
}

function ytJson(payload, ttl) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}`, 'X-Yt-Cache': 'miss' },
  });
}

async function handleYoutubeRelay(request, requestUrl, ctx) {
  // Gate first (stealth), exactly like /tg — the route does not exist for
  // anyone without the derived token.
  const expected = await ytRelayToken();
  const provided = request.headers.get('X-Yt-Relay-Token') || '';
  if (!expected || !safeEqual(provided, expected)) {
    return new Response(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ ok: false, error: 'GET only' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cache = (typeof caches !== 'undefined' && caches.default) ? caches.default : null;
  const cacheKey = new Request(requestUrl.toString(), { method: 'GET' });
  const serve = async (build) => {
    if (cache) {
      try {
        const hit = await cache.match(cacheKey);
        if (hit) {
          const cloned = new Response(hit.body, hit);
          cloned.headers.set('X-Yt-Cache', 'hit');
          return cloned;
        }
      } catch { /* best-effort cache */ }
    }
    const fresh = await build();
    if (fresh && fresh.status === 200 && cache && ctx && typeof ctx.waitUntil === 'function') {
      try { ctx.waitUntil(cache.put(cacheKey, fresh.clone())); } catch { /* best-effort cache */ }
    }
    return fresh;
  };

  const pathname = requestUrl.pathname;
  if (pathname === '/yt/oembed') {
    const videoId = requestUrl.searchParams.get('v') || '';
    if (!YT_VIDEO_ID_RE.test(videoId)) {
      return new Response(JSON.stringify({ ok: false, error: 'bad video id' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    return serve(async () => {
      const verdict = await ytFetchOembedUpstream(videoId);
      // 502 (NOT cached): lets the origin fall back to its own direct check.
      if (!verdict) {
        return new Response(JSON.stringify({ ok: false, error: 'upstream unknown' }), {
          status: 502, headers: { 'Content-Type': 'application/json' },
        });
      }
      return ytJson(verdict, 1800);
    });
  }
  if (pathname === '/yt/playlist') {
    const playlistId = requestUrl.searchParams.get('list') || '';
    if (!YT_PLAYLIST_ID_RE.test(playlistId)) {
      return new Response(JSON.stringify({ ok: false, error: 'bad playlist id' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }
    return serve(async () => {
      const { items, sources } = await ytFetchPlaylistUpstream(playlistId);
      return ytJson({ ok: true, playlistId, items, sources }, 300);
    });
  }
  return new Response(JSON.stringify({ error: 'Not Found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function handleRequest(request, _env, ctx) {
  // ✅ SECURITY FIX (audit run-1): read the worker var from the module scope or env binding.
  try { EDGE_ORIGIN_SECRET = (typeof EDGE_ORIGIN_SECRET !== 'undefined' && EDGE_ORIGIN_SECRET) ? EDGE_ORIGIN_SECRET : ((_env && _env.EDGE_ORIGIN_SECRET) || undefined); } catch { /* not configured */ }
  try { TG_RELAY_SECRET = (typeof TG_RELAY_SECRET !== 'undefined' && TG_RELAY_SECRET) ? TG_RELAY_SECRET : ((_env && _env.TG_RELAY_SECRET) || undefined); } catch { /* not configured */ }
  const requestUrl = new URL(request.url);
  const pathname = requestUrl.pathname;
  const ext = pathname.substring(pathname.lastIndexOf('.') + 1).toLowerCase();
  const filename = pathname.substring(pathname.lastIndexOf('/') + 1);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return addSecurityHeaders(addCORSHeaders(new Response(null, { status: 204 }), request), requestUrl);
  }

  // Telegram transport relay — own gate, before the WAF (see handler docs).
  if (requestUrl.pathname === '/tg' || requestUrl.pathname.startsWith('/tg/')) {
    try {
      const relayResponse = await handleTelegramRelay(request, requestUrl);
      return addSecurityHeaders(relayResponse, requestUrl);
    } catch (err) {
      console.error('Telegram relay failed:', err);
      return new Response(JSON.stringify({ ok: false, description: 'relay upstream error' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // YouTube data relay — own gate, before the WAF (same pattern as /tg):
  // YouTube titles/ids in query strings must never trip text heuristics, and
  // the relay has its own strict parameter grammar + derived-token gate.
  if (requestUrl.pathname === '/yt' || requestUrl.pathname.startsWith('/yt/')) {
    try {
      const relayResponse = await handleYoutubeRelay(request, requestUrl, ctx);
      return addSecurityHeaders(relayResponse, requestUrl);
    } catch (err) {
      console.error('YouTube relay failed:', err);
      return new Response(JSON.stringify({ ok: false, error: 'relay upstream error' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // 🚀 PERFORMANCE: Edge caching for static assets using Cache API
  // This gives us FULL control over cache TTL at the Cloudflare edge,
  // overriding any stale cache from the origin's old Cache-Control headers.
  // ✅ SECURITY FIX (audit run-1): restricted to the origin's own immutable
  // namespace (/assets/, content-hashed) — the extension-only match previously
  // let ANY path ending in a static extension skip the entire WAF pipeline and
  // pinned non-200 responses at the PoP for a year. Cached responses are now
  // normalized through addSecurityHeaders/addCORSHeaders like every other path.
  const isCacheableAsset =
    requestUrl.pathname.startsWith('/assets/') &&
    ['js', 'css', 'mjs', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico', 'woff', 'woff2', 'ttf', 'eot', 'otf'].includes(ext) &&
    !['sw.js', 'cache-nuke.js', 'rtl-detect.js', 'clarity.js', 'pii-mask.js', 'build-id.json'].includes(filename) &&
    !filename.startsWith('workbox-');

  if (isCacheableAsset && request.method === 'GET') {
    const cacheKey = new Request(requestUrl.toString(), request);
    const cache = caches.default;

    // Check if we have a cached response
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      // Serve from edge cache — instant!
      return addSecurityHeaders(addCORSHeaders(cachedResponse, request), requestUrl);
    }

    // Not cached → fetch from origin, cache it, then serve
    const originRequest = addRequestHeaders(request);
    try {
      const originResponse = await fetch(originRequest);
      // ✅ SECURITY FIX (audit run-1): never pin non-success responses at the edge.
      if (!originResponse.ok) {
        return addSecurityHeaders(addCORSHeaders(originResponse, request), requestUrl);
      }
      // Clone and add proper headers
      const newHeaders = new Headers(originResponse.headers);
      newHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
      newHeaders.set('CDN-Cache-Control', 'public, max-age=31536000');

      const responseToCache = new Response(originResponse.body, {
        status: originResponse.status,
        statusText: originResponse.statusText,
        headers: newHeaders,
      });

      // Store in edge cache for 1 year (ctx.waitUntil ensures it completes)
      const normalized = addSecurityHeaders(addCORSHeaders(responseToCache, request), requestUrl);
      ctx.waitUntil(cache.put(cacheKey, normalized.clone()));

      return normalized;
    } catch {
      // Intentionally ignored: best-effort edge-cache write — fall through to normal proxy on error. — SonarCloud S2486
    }
  }

  // Security stages pipeline (v7: no botScoring, no rateLimit)
  const securityStages = [
    stage1_enforceHTTPS,
    stage2_blockBadASNs,
    stage3_blockSensitivePaths,
    stage4_blockSQLInjection,
    stage5_blockXSS,
    stage6_blockPathTraversal,
    stage7_blockCommandInjection,
    stage8_blockScannersOnly,
    stage9_requestSizeLimit,
  ];

  for (const stage of securityStages) {
    const result = stage(request);
    if (result) return addSecurityHeaders(result, requestUrl);
  }

  // Proxy to origin
  const originRequest = addRequestHeaders(request);

  try {
    const originResponse = await fetch(originRequest);
    let response = originResponse;
    response = addCORSHeaders(response, request);
    response = addSecurityHeaders(response, requestUrl);
    return response;
  } catch (err) {
    console.error('Origin fetch failed in worker:', err);
    return new Response(JSON.stringify({ error: 'Bad Gateway' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── Scheduled playlist sync push (worker cron → origin ingest) ──────────────
// DETERMINISTIC driver for the course-mirror (2026-11-10 incident): GitHub
// Actions' scheduler skips/delays runs (4 runs in 2 days on a */15 schedule)
// and the origin cannot fetch YouTube at all (HF datacenter egress blocked —
// 667+ consecutive failed watcher ticks). This worker has clean YouTube
// egress and its cron runs INSIDE Cloudflare — no Access wall applies to
// self-invoked scheduled handlers. Every 15 min it fetches the playlist
// VERBATIM and pushes (videoId, title) rows to the origin's HMAC-gated
// ingest endpoint, which feeds the SAME applyPlaylistSync engine as the GH
// relay: verbatim titles, first-video cover, capped notifications.
//
// Dormant when SYNC_INGEST_SECRET is absent/short (fail-closed). Zero new
// HTTP routes: the scheduled handler is internal-only and posts to ONE fixed
// origin URL with ONE derived HMAC header — this is never an open proxy.
const YT_SYNC_PLAYLIST_ID = 'PLeeb5_Qjhcgc';
const YT_SYNC_INGEST_URL = 'https://ahmdelbaz28-ahmdrtap.hf.space/api/yt-sync/ingest';
const YT_SYNC_UNAVAILABLE_TITLES = [
  'private video', 'deleted video', 'video unavailable',
  'فيديو خاص', 'فيديو محذوف', 'الفيديو غير متاح', 'هذا الفيديو غير متاح',
];

async function ytSyncPushToOrigin(env) {
  const secret = (env && env.SYNC_INGEST_SECRET) || '';
  if (typeof secret !== 'string' || secret.length < 16) {
    return { skipped: 'SYNC_INGEST_SECRET not configured — sync push dormant' };
  }
  const { items } = await ytFetchPlaylistUpstream(YT_SYNC_PLAYLIST_ID);
  const videos = items.filter((v) => {
    if (!YT_VIDEO_ID_RE.test(v.videoId) || !v.title) return false;
    const norm = v.title.trim().toLowerCase().replace(/[[\]()]/g, '').replace(/\s+/g, ' ');
    return !YT_SYNC_UNAVAILABLE_TITLES.includes(norm);
  });
  if (videos.length === 0) {
    console.log('[YtSyncPush] playlist empty or throttled — nothing to push');
    return { pushed: false, reason: 'no videos parsed' };
  }
  const body = JSON.stringify({
    videos: videos.map((v) => ({ videoId: v.videoId, title: v.title })),
    source: 'cf-worker-cron',
  });
  // HMAC-SHA256 hex over the RAW body — must match yt-sync-ingest.ts.
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  const signature = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const res = await fetch(YT_SYNC_INGEST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sync-signature': signature },
    body,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text().catch(() => '');
  console.log(`[YtSyncPush] ingest ${res.status}: ${text.slice(0, 400)}`);
  return { pushed: res.ok, status: res.status };
}

// ─── Export ──────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (err) {
      console.error('Unhandled error in worker fetch handler:', err);
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
  // Cron trigger (registered by deploy-cf-worker.yml via the schedules API):
  // fetch the YouTube playlist on Cloudflare's clean egress and push it to
  // the origin's HMAC-gated ingest. Never throws — a failed tick is logged
  // and the next scheduled run retries.
  async scheduled(controller, env, _ctx) {
    try {
      const result = await ytSyncPushToOrigin(env);
      console.log('[YtSyncPush] scheduled tick done:', JSON.stringify(result));
    } catch (err) {
      console.error('[YtSyncPush] scheduled tick failed:', err);
    }
  },
};
