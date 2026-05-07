const ORIGIN = 'https://ahmdelbaz28-ahmdrtap.hf.space';
const ALLOWED_DOMAIN = 'ahmedelbaz.qzz.io';

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

const BLOCKED_ASNS = [
  396982, 209242, 62240, 20473, 14061, 394244, 45090, 36351, 53667,
  212238, 209103, 208153, 200762, 206264, 201839, 64049, 132203,
  136552, 197595, 396928, 45090, 35914, 61317, 62217, 28920, 40676,
];

const BLOCKED_UA_PATTERNS = [
  'curl/',
  'python-requests',
  'nikto',
  'sqlmap',
  'dirbuster',
  'gobuster',
  'nmap',
  'masscan',
  'zgrab',
  'wget/',
  'httpie/',
];

const BLOCKED_UA_WITHOUT_REFERER = ['wget/', 'httpie/'];

const BLOCKED_PATHS = [
  '/.env', '/.git', '/wp-admin', '/phpmyadmin', '/admin/config',
  '/backup.sql', '/debug', '/trace', '/actuator',
  '/.well-known/security.txt', '/server-status', '/server-info',
];

const SQL_INJECTION_PATTERNS = [
  /(\bSELECT\b.*\bFROM\b)/i,
  /(\bUNION\b.*\bSELECT\b)/i,
  /(\bDROP\b.*\bTABLE\b)/i,
  /(\bINSERT\b.*\bINTO\b)/i,
  /(\bUPDATE\b.*\bSET\b)/i,
  /(\bDELETE\b.*\bFROM\b)/i,
  /(\bOR\b\s+1\s*=\s*1)/i,
  /(\bAND\b\s+1\s*=\s*1)/i,
  /\bSLEEP\s*\(/i,
  /\bBENCHMARK\s*\(/i,
  /--\s*$/m,
  /\/\*.*\*\//,
  /;\s*(DROP|ALTER|CREATE|TRUNCATE)\b/i,
  /'\s*OR\s+'/i,
  /'\s*;\s*--/i,
  /CONCAT\s*\(/i,
  /CHAR\s*\(\s*\d/i,
  /0x[0-9a-fA-F]{6,}/,
  /WAITFOR\s+DELAY/i,
  /BENCHMARK\s*\(/i,
  /EXTRACTVALUE\s*\(/i,
  /UPDATEXML\s*\(/i,
];

const XSS_PATTERNS = [
  /<script[\s>]/i,
  /<\/script>/i,
  /javascript\s*:/i,
  /\bon\w+\s*=\s*["']/i,
  /\beval\s*\(/i,
  /expression\s*\(/i,
  /url\s*\(\s*["']?\s*javascript/i,
  /<img[^>]+onerror/i,
  /<svg[^>]+onload/i,
  /<iframe[^>]+src/i,
  /<embed[^>]+/i,
  /<object[^>]+/i,
  /document\.\s*cookie/i,
  /document\.\s*location/i,
  /window\.\s*location/i,
  /String\.fromCharCode/i,
  /atob\s*\(/i,
  /<body[^>]+onload/i,
  /<input[^>]+onfocus/i,
  /alert\s*\(/i,
  /confirm\s*\(/i,
  /prompt\s*\(/i,
];

const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//,
  /\.\.\\/,
  /%2e%2e%2f/i,
  /%2e%2e\/i,
  /\.\.%2f/i,
  /%2e%2e%5c/i,
  /%252e%252e%252f/i,
  /\.\.%5c/i,
  /..%c0%af/i,
  /..%ef%bc%8f/i,
];

const COMMAND_INJECTION_PATTERNS = [
  /;\s*(ls|cat|id|whoami|pwd|uname|ifconfig|netstat|ps|kill|rm|wget|curl|bash|sh|nc|ncat|telnet|ping|nslookup|dig)\b/i,
  /\|\s*(ls|cat|id|whoami|pwd|uname|ifconfig|netstat|ps|kill|rm|wget|curl|bash|sh|nc|ncat|telnet|ping|nslookup|dig)\b/i,
  /&&\s*(ls|cat|id|whoami|pwd|uname|ifconfig|netstat|ps|kill|rm|wget|curl|bash|sh|nc|ncat|telnet|ping|nslookup|dig)\b/i,
  /`[^`]*`/,
  /\$\([^)]*\)/,
  /\$\{[^}]*\}/,
  /\bexec\s*\(/i,
  /\bsystem\s*\(/i,
  /\bpassthru\s*\(/i,
  /\bshell_exec\s*\(/i,
  /\bpopen\s*\(/i,
  /\bproc_open\s*\(/i,
  /\bpcntl_exec\s*\(/i,
];

const MAX_REQUEST_SIZE = 10 * 1024 * 1024;

function ipInCidr(ip, cidr) {
  const [range, bits] = cidr.split('/');
  const mask = ~(2 ** (32 - parseInt(bits, 10)) - 1);
  const ipInt = ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
  const rangeInt = range.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function isCloudflareIP(ip) {
  return CLOUDFLARE_IP_RANGES.some(cidr => ipInCidr(ip, cidr));
}

function getRateLimitKey(request) {
  const clientIP = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  return `ratelimit:${clientIP}`;
}

async function isRateLimited(request, env) {
  const key = getRateLimitKey(request);
  const now = Date.now();
  const windowMs = 60000;
  const maxRequests = 100;

  const stored = await env SECURITY_KV.get(key);
  let count = 0;
  let windowStart = now;

  if (stored) {
    const data = JSON.parse(stored);
    if (now - data.windowStart < windowMs) {
      count = data.count;
      windowStart = data.windowStart;
    }
  }

  count++;

  if (count > maxRequests) {
    return true;
  }

  const ttl = Math.ceil((windowMs - (now - windowStart)) / 1000);
  await env.SECURITY_KV.put(key, JSON.stringify({ count, windowStart }), { expirationTtl: Math.max(ttl, 1) });
  return false;
}

function matchesPatterns(str, patterns) {
  return patterns.some(pattern => {
    if (pattern instanceof RegExp) {
      return pattern.test(str);
    }
    return str.toLowerCase().includes(pattern.toLowerCase());
  });
}

function getFullUrl(request) {
  const url = new URL(request.url);
  return url.toString();
}

function stage1_allowCloudflareIPsOnly(request) {
  if (request.headers.get('CF-Worker') === 'true' || request.headers.get('CF-Connecting-IP')) {
    return null;
  }
  const cfRay = request.headers.get('CF-Ray');
  if (cfRay) {
    return null;
  }
  return new Response('Forbidden: Direct access not allowed', { status: 403 });
}

function stage2_blockBadASNs(request) {
  const asn = request.cf && request.cf.asn;
  if (asn && BLOCKED_ASNS.includes(Number(asn))) {
    return new Response('Forbidden: ASN blocked', { status: 403 });
  }
  return null;
}

async function stage3_rateLimit(request, env) {
  if (env && env.SECURITY_KV) {
    const limited = await isRateLimited(request, env);
    if (limited) {
      return new Response(JSON.stringify({ error: 'Too many requests. Please try again later.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
      });
    }
  }
  return null;
}

function stage4_blockUserAgent(request) {
  const ua = request.headers.get('User-Agent') || '';
  const referer = request.headers.get('Referer') || '';

  for (const pattern of BLOCKED_UA_PATTERNS) {
    if (ua.toLowerCase().includes(pattern.toLowerCase())) {
      if (BLOCKED_UA_WITHOUT_REFERER.includes(pattern) && referer) {
        continue;
      }
      return new Response('Forbidden: User-Agent blocked', { status: 403 });
    }
  }

  if (!ua || ua.length < 10) {
    return new Response('Forbidden: Invalid User-Agent', { status: 403 });
  }

  return null;
}

function stage5_blockSensitivePaths(request) {
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname).toLowerCase();

  for (const blockedPath of BLOCKED_PATHS) {
    if (path === blockedPath || path.startsWith(blockedPath + '/') || path.includes(blockedPath)) {
      return new Response('Not Found', { status: 404 });
    }
  }
  return null;
}

function stage6_blockSQLInjection(request) {
  const url = new URL(request.url);
  const checkString = `${url.pathname} ${url.search}`;

  if (matchesPatterns(checkString, SQL_INJECTION_PATTERNS)) {
    return new Response('Forbidden: SQL injection detected', { status: 403 });
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('application/json')) {
    const clonedRequest = request.clone();
    clonedRequest.text().then(body => {
      if (matchesPatterns(body, SQL_INJECTION_PATTERNS)) {
        return new Response('Forbidden: SQL injection detected', { status: 403 });
      }
    }).catch(() => {});
  }

  return null;
}

function stage7_blockXSS(request) {
  const url = new URL(request.url);
  const checkString = `${url.pathname} ${url.search}`;

  if (matchesPatterns(checkString, XSS_PATTERNS)) {
    return new Response('Forbidden: XSS detected', { status: 403 });
  }

  const referer = request.headers.get('Referer') || '';
  if (matchesPatterns(referer, XSS_PATTERNS)) {
    return new Response('Forbidden: XSS detected in referer', { status: 403 });
  }

  return null;
}

function stage8_blockPathTraversal(request) {
  const url = new URL(request.url);
  const rawPath = url.pathname;
  const decodedPath = decodeURIComponent(rawPath);

  if (matchesPatterns(rawPath, PATH_TRAVERSAL_PATTERNS) || matchesPatterns(decodedPath, PATH_TRAVERSAL_PATTERNS)) {
    return new Response('Forbidden: Path traversal detected', { status: 403 });
  }

  return null;
}

function stage9_blockCommandInjection(request) {
  const url = new URL(request.url);
  const checkString = `${url.pathname} ${url.search}`;

  if (matchesPatterns(checkString, COMMAND_INJECTION_PATTERNS)) {
    return new Response('Forbidden: Command injection detected', { status: 403 });
  }

  return null;
}

function stage10_addCORSHeaders(response) {
  const newHeaders = new Headers(response.headers);
  newHeaders.set('Access-Control-Allow-Origin', ALLOWED_DOMAIN);
  newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-API-Key, Accept, Origin, Cache-Control');
  newHeaders.set('Access-Control-Allow-Credentials', 'true');
  newHeaders.set('Access-Control-Max-Age', '86400');
  newHeaders.set('Vary', 'Origin');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

function stage11_addSecurityHeaders(response) {
  const newHeaders = new Headers(response.headers);
  newHeaders.set('X-Content-Type-Options', 'nosniff');
  newHeaders.set('X-Frame-Options', 'DENY');
  newHeaders.set('X-XSS-Protection', '1; mode=block');
  newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  newHeaders.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), ambient-light-sensor=(), autoplay=(), encrypted-media=(), picture-in-picture=()');
  newHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  newHeaders.set('X-Permitted-Cross-Domain-Policies', 'none');
  newHeaders.set('X-Download-Options', 'noopen');
  newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
  newHeaders.set('Cross-Origin-Resource-Policy', 'same-origin');
  newHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

function stage12_contentTypeSniffProtection(response) {
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.includes('charset')) {
    const newHeaders = new Headers(response.headers);
    if (contentType.includes('text/') || contentType.includes('application/json') || contentType.includes('application/xml') || contentType.includes('application/javascript')) {
      const charset = contentType.includes('utf') ? '' : '; charset=utf-8';
      newHeaders.set('Content-Type', contentType + charset);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }
  return response;
}

function stage13_requestSizeLimit(request) {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && parseInt(contentLength, 10) > MAX_REQUEST_SIZE) {
    return new Response(JSON.stringify({ error: 'Request body too large. Maximum size is 10MB.' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

function stage14_enforceHTTPS(request) {
  const url = new URL(request.url);
  const cfVisitor = request.headers.get('CF-Visitor');

  if (cfVisitor) {
    try {
      const visitor = JSON.parse(cfVisitor);
      if (visitor.scheme === 'http') {
        const httpsUrl = url.toString().replace(/^http:/, 'https:');
        return Response.redirect(httpsUrl, 301);
      }
    } catch (e) {}
  }

  if (url.protocol === 'http:') {
    const httpsUrl = url.toString().replace(/^http:/, 'https:');
    return Response.redirect(httpsUrl, 301);
  }

  return null;
}

function stage15_botScoring(request) {
  const cfBotScore = request.cf && request.cf.botManagement && request.cf.botManagement.score;
  const ua = request.headers.get('User-Agent') || '';

  if (cfBotScore !== undefined && cfBotScore !== null && cfBotScore < 30) {
    return new Response('Challenge', {
      status: 403,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  const botUAIndicators = ['bot', 'crawler', 'spider', 'scraper', 'harvest', 'fetch', 'sitechecker', 'semrush', 'ahrefs', 'majestic', 'moz'];
  const isBot = botUAIndicators.some(indicator => ua.toLowerCase().includes(indicator));
  const isSearchEngine = ua.toLowerCase().includes('googlebot') || ua.toLowerCase().includes('bingbot') || ua.toLowerCase().includes('slurp') || ua.toLowerCase().includes('duckduckbot');

  if (isBot && !isSearchEngine) {
    return new Response('Forbidden: Bot access denied', { status: 403 });
  }

  return null;
}

function addRequestHeaders(request) {
  const headers = new Headers(request.headers);
  headers.set('X-Forwarded-Host', ALLOWED_DOMAIN);
  headers.set('X-Real-IP', request.headers.get('CF-Connecting-IP') || '');
  headers.set('X-Security-Worker', 'ahmedelbaz-v6-hardened');
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

async function handleRequest(request, env, ctx) {
  if (request.method === 'OPTIONS') {
    const preflightResponse = new Response(null, { status: 204 });
    return stage11_addSecurityHeaders(stage10_addCORSHeaders(preflightResponse));
  }

  const stages = [
    stage14_enforceHTTPS,
    stage1_allowCloudflareIPsOnly,
    stage4_blockUserAgent,
    stage13_requestSizeLimit,
    stage5_blockSensitivePaths,
    stage6_blockSQLInjection,
    stage7_blockXSS,
    stage8_blockPathTraversal,
    stage9_blockCommandInjection,
    stage2_blockBadASNs,
  ];

  for (const stage of stages) {
    const result = stage(request);
    if (result) {
      return stage11_addSecurityHeaders(result);
    }
  }

  if (env && env.SECURITY_KV) {
    const rateLimitResult = await stage3_rateLimit(request, env);
    if (rateLimitResult) {
      return stage11_addSecurityHeaders(rateLimitResult);
    }
  }

  const botResult = stage15_botScoring(request);
  if (botResult) {
    return stage11_addSecurityHeaders(botResult);
  }

  const originRequest = addRequestHeaders(request);

  try {
    const originResponse = await fetch(originRequest);

    let response = originResponse;
    response = stage10_addCORSHeaders(response);
    response = stage11_addSecurityHeaders(response);
    response = stage12_contentTypeSniffProtection(response);

    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Bad Gateway', message: 'Origin server is unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Internal Server Error', message: 'An unexpected error occurred' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
