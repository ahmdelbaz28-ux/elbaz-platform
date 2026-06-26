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

// ─── IP Ranges ───────────────────────────────────────────────────────────────
const CLOUDFLARE_IP_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

// ─── Blocked ASNs ────────────────────────────────────────────────────────────
const BLOCKED_ASNS = [
  396982, 209242, 62240, 20473, 14061, 394244, 45090, 36351, 53667,
  212238, 209103, 208153, 200762, 206264, 201839, 64049, 132203,
  136552, 197595, 396928, 45090, 35914, 61317, 62217, 28920, 40676,
];

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
  /\.\.[\/\\]/,
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
const API_PATHS = [
  '/api/health',
  '/api/trpc/ping',
  '/api/trpc/',
  '/api/webhooks/',
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
  const mask = ~(2 ** (32 - parseInt(bits, 10)) - 1);
  const ipInt = ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
  const rangeInt = range.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
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
    } catch (e) {}
  }
  if (url.protocol === 'http:') {
    return Response.redirect(url.toString().replace(/^http:/, 'https:'), 301);
  }
  return null;
}

// Stage 2: Block Bad ASNs
function stage2_blockBadASNs(request) {
  const asn = request.cf && request.cf.asn;
  if (asn && BLOCKED_ASNS.includes(Number(asn))) {
    return new Response('Forbidden', { status: 403, headers: { 'Content-Type': 'text/plain' } });
  }
  return null;
}

// Stage 3: Block Sensitive Paths
function stage3_blockSensitivePaths(request) {
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname).toLowerCase();
  for (const blockedPath of BLOCKED_PATHS) {
    if (path === blockedPath || path.startsWith(blockedPath + '/') || path.includes(blockedPath)) {
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
  if (contentLength && parseInt(contentLength, 10) > MAX_REQUEST_SIZE) {
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
  newHeaders.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
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

// Add CORS headers
function addCORSHeaders(response) {
  const newHeaders = new Headers(response.headers);
  newHeaders.set('Access-Control-Allow-Origin', ALLOWED_DOMAIN);
  newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

function addRequestHeaders(request) {
  const headers = new Headers(request.headers);
  headers.set('X-Forwarded-Host', ALLOWED_DOMAIN);
  headers.set('X-Real-IP', request.headers.get('CF-Connecting-IP') || '');
  headers.set('X-Security-Worker', 'ahmedelbaz-v7');
  headers.delete('CF-Connecting-IP');

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

async function handleRequest(request, env, ctx) {
  const requestUrl = new URL(request.url);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return addSecurityHeaders(addCORSHeaders(new Response(null, { status: 204 })), requestUrl);
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
    response = addCORSHeaders(response);
    response = addSecurityHeaders(response, requestUrl);
    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Bad Gateway' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─── Export ──────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
