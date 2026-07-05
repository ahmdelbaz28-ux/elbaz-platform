#!/usr/bin/env python3
"""
Elbaz Platform — HTTP Integration Test Suite using urllib
Tests every public endpoint of the live deployment and reports issues.

Uses only Python standard library (urllib, json, ssl) — no external deps.
"""
import urllib.request
import urllib.error
import json
import ssl
import time
import sys
from datetime import datetime

BASE_URL = "https://ahmedelbaz.qzz.io"
TIMEOUT = 15
USER_AGENT = "ElbazPlatform-TestBot/1.0 (urllib integration test)"

# SSL context — verify certificates for security
ctx = ssl.create_default_context()

def fetch(path, method="GET", body=None, headers=None):
    url = BASE_URL + path
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("User-Agent", USER_AGENT)
    req.add_header("Accept", "text/html,application/json,*/*")
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    if data:
        req.add_header("Content-Type", "application/json")
    start = time.time()
    try:
        resp = urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx)
        dur = time.time() - start
        return resp.getcode(), dict(resp.headers), resp.read(), dur, None
    except urllib.error.HTTPError as e:
        dur = time.time() - start
        return e.code, dict(e.headers), e.read(), dur, None
    except Exception as e:
        dur = time.time() - start
        return None, {}, b"", dur, str(e)

def check(test, status, headers, body, error):  # NOSONAR — S3776: test assertion logic
    warnings = []
    if error:
        return False, [f"Connection error: {error}"]
    expect = test.get("expect_status")
    if expect:
        if isinstance(expect, list):
            if status not in expect:
                return False, [f"Expected status {expect}, got {status}"]
        elif status != expect:
            return False, [f"Expected status {expect}, got {status}"]
    min_size = test.get("min_size")
    if min_size and len(body) < min_size:
        return False, [f"Response too small: {len(body)} bytes (min {min_size})"]
    for needle in test.get("expect_contains", []):
        if needle.lower() not in body.decode("utf-8", errors="replace").lower():
            warnings.append(f"Expected '{needle}' in body")
    for h, frag in test.get("check_headers", {}).items():
        headers_lower = {k.lower(): v for k, v in headers.items()}
        actual = headers_lower.get(h.lower(), "")
        if not actual:
            warnings.append(f"Missing header: {h}")
        elif frag.lower() not in actual.lower():
            warnings.append(f"Header {h} missing '{frag}'")
    if test.get("is_json"):
        try:
            json.loads(body)
        except json.JSONDecodeError:
            return False, [f"Expected JSON, got: {body[:80]}"]
    return True, warnings

TESTS = [
    # Public pages (SPA — all return same HTML shell)
    {"name": "Home", "path": "/", "expect_status": 200},
    {"name": "Courses", "path": "/courses", "expect_status": 200},
    {"name": "FAQ", "path": "/faq", "expect_status": 200},
    {"name": "Support", "path": "/support", "expect_status": 200},
    {"name": "References", "path": "/references", "expect_status": 200},
    {"name": "Login", "path": "/login", "expect_status": 200},
    {"name": "Register", "path": "/register", "expect_status": 200},
    {"name": "Forgot Password", "path": "/forgot-password", "expect_status": 200},
    {"name": "Privacy Policy", "path": "/privacy", "expect_status": 200},
    {"name": "Terms of Service", "path": "/terms", "expect_status": 200},
    {"name": "Refund Policy", "path": "/refund", "expect_status": 200},
    {"name": "Certificate Verify", "path": "/certificate", "expect_status": 200},
    {"name": "Dashboard (auth gate)", "path": "/dashboard", "expect_status": 200},
    {"name": "Wishlist (auth gate)", "path": "/wishlist", "expect_status": 200},
    {"name": "Journey (auth gate)", "path": "/journey", "expect_status": 200},
    {"name": "Profile (auth gate)", "path": "/profile", "expect_status": 200},
    {"name": "404 Page", "path": "/nonexistent-xyz123", "expect_status": 200},

    # API endpoints
    {"name": "API Health", "path": "/api/health", "expect_status": 200,
     "expect_contains": ["status", "ok"], "is_json": True},
    {"name": "tRPC Ping", "path": "/api/trpc/ping", "expect_status": 200,
     "expect_contains": ["ok"], "is_json": True},

    # tRPC queries (GET)
    {"name": "tRPC FAQ List", "path": "/api/trpc/faq.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%7D%7D%7D",
     "expect_status": 200, "is_json": True},
    {"name": "tRPC References List", "path": "/api/trpc/references.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%7D%7D%7D",
     "expect_status": 200, "is_json": True},
    {"name": "tRPC Software List", "path": "/api/trpc/software.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%7D%7D%7D",
     "expect_status": 200, "is_json": True},
    {"name": "tRPC Courses List", "path": "/api/trpc/course.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%7D%7D%7D",
     "expect_status": 200, "is_json": True},
    {"name": "tRPC Search", "path": "/api/trpc/search.global?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22query%22%3A%22test%22%2C%22limit%22%3A5%7D%7D%7D",
     "expect_status": 200, "is_json": True},
    {"name": "tRPC FAQ Categories", "path": "/api/trpc/faq.categories?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%7D%7D%7D",
     "expect_status": 200, "is_json": True},

    # tRPC error handling
    {"name": "tRPC Invalid Input", "path": "/api/trpc/faq.list?batch=1&input=invalid",
     "expect_status": 400},
    {"name": "tRPC Nonexistent Procedure", "path": "/api/trpc/nonexistent.proc?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%7D%7D%7D",
     "expect_status": 404},

    # Security tests
    {"name": "Path Traversal Blocked", "path": "/api/../../../etc/passwd",
     "expect_status": [400, 403, 404]},
    {"name": "XSS Blocked", "path": "/api/trpc/search.global?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22query%22%3A%22%3Cscript%3Ealert(1)%3C%2Fscript%3E%22%2C%22limit%22%3A5%7D%7D%7D",
     "expect_status": [200, 403]},
    {"name": "Long URL Blocked", "path": "/" + "a" * 10000,
     "expect_status": [400, 414, 431]},

    # Static assets
    {"name": "Logo PNG", "path": "/logo.png", "expect_status": 200, "min_size": 10000},
    {"name": "Favicon", "path": "/favicon.ico", "expect_status": 200, "min_size": 100},
    {"name": "PWA Icon", "path": "/pwa-192x192.png", "expect_status": 200, "min_size": 5000},
    {"name": "Manifest", "path": "/manifest.webmanifest", "expect_status": 200,
     "expect_contains": ["name"], "is_json": True},

    # Security headers
    {"name": "Security Headers", "path": "/", "expect_status": 200,
     "check_headers": {
         "strict-transport-security": "max-age",
         "x-content-type-options": "nosniff",
         "x-frame-options": "DENY",
         "content-security-policy": "default-src",
     }},

    # POST endpoints
    {"name": "Chatbot (no auth)", "path": "/api/chatbot", "method": "POST",
     "body": {"messages": [], "language": "en"}, "expect_status": [200, 400, 429]},
    {"name": "Paymob Webhook (GET → 404)", "path": "/api/paymob/webhook",
     "expect_status": [404, 405]},
]

# ═══════════════════════════════════════════════════════════════
# Run tests
# ═══════════════════════════════════════════════════════════════
print("═" * 65)
print("  Elbaz Platform — urllib Integration Test Suite")
print("═" * 65)
print(f"  Target:  {BASE_URL}")
print(f"  Tests:   {len(TESTS)}")
print(f"  Time:    {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print()

passed = warned = failed = 0
results = []

for i, test in enumerate(TESTS, 1):
    status, headers, body, dur, error = fetch(
        test["path"], test.get("method", "GET"),
        test.get("body"), test.get("headers")
    )
    ok, warnings = check(test, status, headers, body, error)
    msg = f"HTTP {status}, {len(body)}B, {dur:.2f}s" if not error else error
    if ok and not warnings:
        print(f"  ✅ [{i:2d}/{len(TESTS)}] {test['name']:35s} {msg}")
        passed += 1
    elif ok:
        print(f"  ⚠️  [{i:2d}/{len(TESTS)}] {test['name']:35s} {msg}")
        for w in warnings:
            print(f"         {w}")
        warned += 1
    else:
        print(f"  ❌ [{i:2d}/{len(TESTS)}] {test['name']:35s} {msg}")
        for w in warnings:
            print(f"         {w}")
        failed += 1
    results.append({"name": test["name"], "status": status, "passed": ok,
                     "warnings": warnings, "duration_ms": round(dur * 1000)})

print()
print("═" * 65)
print(f"  Total: {len(TESTS)} | ✅ {passed} | ⚠️  {warned} | ❌ {failed}")
print("═" * 65)

report = {"timestamp": datetime.now().isoformat(), "target": BASE_URL,
           "total": len(TESTS), "passed": passed, "warned": warned, "failed": failed,
           "results": results}
with open("/tmp/urllib-test-results.json", "w") as f:  # NOSONAR — S5443: single-user dev container
    json.dump(report, f, indent=2)
print("\n  Report: /tmp/urllib-test-results.json")
sys.exit(1 if failed > 0 else 0)
