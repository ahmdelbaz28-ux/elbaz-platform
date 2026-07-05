#!/usr/bin/env python3
"""
Elbaz Platform — HTTP Integration Test Suite using urllib
Tests every public endpoint of the live deployment and reports issues.

Uses only Python standard library (urllib, json, ssl) — no external deps.
"""
from __future__ import annotations

import urllib.request
import urllib.error
import json
import ssl
import time
import sys
from datetime import datetime
from dataclasses import dataclass, field, asdict
from typing import Any


BASE_URL: str = "https://ahmedelbaz.qzz.io"
TIMEOUT: int = 15
USER_AGENT: str = "ElbazPlatform-TestBot/1.0 (urllib integration test)"

# SSL context — verify certificates for security
# Python 3.12 already uses secure TLS defaults (TLS 1.2+)
ctx: ssl.SSLContext = ssl.create_default_context()  # NOSONAR — S4423: Python 3.12 uses secure defaults


@dataclass
class FetchResult:
    """HTTP fetch result."""
    status: int | None
    headers: dict[str, str]
    body: bytes
    duration: float
    error: str | None


@dataclass
class TestDef:
    """A test case definition."""
    name: str
    path: str
    method: str = "GET"
    body: dict[str, Any] | None = None
    headers: dict[str, str] | None = None
    expect_status: int | list[int] | None = None
    expect_contains: list[str] = field(default_factory=lambda: [])
    min_size: int | None = None
    is_json: bool = False
    check_headers: dict[str, str] = field(default_factory=lambda: {})


@dataclass
class TestResult:
    """A test execution result."""
    name: str
    status: int | None
    passed: bool
    warnings: list[str]
    duration_ms: int


def fetch(test: TestDef) -> FetchResult:
    """Make an HTTP request based on test definition."""
    url: str = BASE_URL + test.path
    data: bytes | None = json.dumps(test.body).encode() if test.body else None
    req = urllib.request.Request(url, data=data, method=test.method)
    req.add_header("User-Agent", USER_AGENT)
    req.add_header("Accept", "text/html,application/json,*/*")
    if test.headers:
        for k, v in test.headers.items():
            req.add_header(k, v)
    if data:
        req.add_header("Content-Type", "application/json")
    start: float = time.time()
    try:
        resp = urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx)
        dur: float = time.time() - start
        return FetchResult(
            status=resp.getcode(),
            headers=dict(resp.headers),
            body=resp.read(),
            duration=dur,
            error=None,
        )
    except urllib.error.HTTPError as e:
        dur = time.time() - start
        return FetchResult(
            status=e.code,
            headers=dict(e.headers),
            body=e.read(),
            duration=dur,
            error=None,
        )
    except Exception as e:
        dur = time.time() - start
        return FetchResult(
            status=None,
            headers={},
            body=b"",
            duration=dur,
            error=str(e),
        )


def check(test: TestDef, fr: FetchResult) -> tuple[bool, list[str]]:  # NOSONAR — S3776: test assertion logic is inherently conditional
    """Check if a test passed. Returns (passed, warnings)."""
    warnings: list[str] = []

    if fr.error:
        return False, [f"Connection error: {fr.error}"]

    # Check status
    if test.expect_status is not None:
        if isinstance(test.expect_status, list):
            if fr.status not in test.expect_status:
                return False, [f"Expected status {test.expect_status}, got {fr.status}"]
        else:
            if fr.status != test.expect_status:
                return False, [f"Expected status {test.expect_status}, got {fr.status}"]

    # Check min size
    if test.min_size is not None and len(fr.body) < test.min_size:
        return False, [f"Response too small: {len(fr.body)} bytes (min {test.min_size})"]

    # Check content contains
    body_text: str = fr.body.decode("utf-8", errors="replace").lower()
    for needle in test.expect_contains:
        if needle.lower() not in body_text:
            warnings.append(f"Expected '{needle}' in body")

    # Check headers (case-insensitive)
    headers_lower: dict[str, str] = {k.lower(): v for k, v in fr.headers.items()}
    for h, frag in test.check_headers.items():
        actual: str = headers_lower.get(h.lower(), "")
        if not actual:
            warnings.append(f"Missing header: {h}")
        elif frag.lower() not in actual.lower():
            warnings.append(f"Header {h} missing '{frag}'")

    # Check JSON
    if test.is_json:
        try:
            json.loads(fr.body)
        except json.JSONDecodeError:
            return False, [f"Expected JSON, got: {fr.body[:80]}"]

    return True, warnings


# ═══════════════════════════════════════════════════════════════
# Test definitions
# ═══════════════════════════════════════════════════════════════
TESTS: list[TestDef] = [
    # Public pages (SPA — all return same HTML shell)
    TestDef(name="Home", path="/", expect_status=200),
    TestDef(name="Courses", path="/courses", expect_status=200),
    TestDef(name="FAQ", path="/faq", expect_status=200),
    TestDef(name="Support", path="/support", expect_status=200),
    TestDef(name="References", path="/references", expect_status=200),
    TestDef(name="Login", path="/login", expect_status=200),
    TestDef(name="Register", path="/register", expect_status=200),
    TestDef(name="Forgot Password", path="/forgot-password", expect_status=200),
    TestDef(name="Privacy Policy", path="/privacy", expect_status=200),
    TestDef(name="Terms of Service", path="/terms", expect_status=200),
    TestDef(name="Refund Policy", path="/refund", expect_status=200),
    TestDef(name="Certificate Verify", path="/certificate", expect_status=200),
    TestDef(name="Dashboard (auth gate)", path="/dashboard", expect_status=200),
    TestDef(name="Wishlist (auth gate)", path="/wishlist", expect_status=200),
    TestDef(name="Journey (auth gate)", path="/journey", expect_status=200),
    TestDef(name="Profile (auth gate)", path="/profile", expect_status=200),
    TestDef(name="404 Page", path="/nonexistent-xyz123", expect_status=200),

    # API endpoints
    TestDef(name="API Health", path="/api/health", expect_status=200,
            expect_contains=["status", "ok"], is_json=True),
    TestDef(name="tRPC Ping", path="/api/trpc/ping", expect_status=200,
            expect_contains=["ok"], is_json=True),

    # tRPC queries (GET)
    TestDef(name="tRPC FAQ List",
            path="/api/trpc/faq.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%7D%7D%7D",
            expect_status=200, is_json=True),
    TestDef(name="tRPC References List",
            path="/api/trpc/references.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%7D%7D%7D",
            expect_status=200, is_json=True),
    TestDef(name="tRPC Software List",
            path="/api/trpc/software.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%7D%7D%7D",
            expect_status=200, is_json=True),
    TestDef(name="tRPC Courses List",
            path="/api/trpc/course.list?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%7D%7D%7D",
            expect_status=200, is_json=True),
    TestDef(name="tRPC Search",
            path="/api/trpc/search.global?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22query%22%3A%22test%22%2C%22limit%22%3A5%7D%7D%7D",
            expect_status=200, is_json=True),
    TestDef(name="tRPC FAQ Categories",
            path="/api/trpc/faq.categories?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%7D%7D%7D",
            expect_status=200, is_json=True),

    # tRPC error handling
    TestDef(name="tRPC Invalid Input",
            path="/api/trpc/faq.list?batch=1&input=invalid",
            expect_status=400),
    TestDef(name="tRPC Nonexistent Procedure",
            path="/api/trpc/nonexistent.proc?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%7D%7D%7D",
            expect_status=404),

    # Security tests
    TestDef(name="Path Traversal Blocked",
            path="/api/../../../etc/passwd",
            expect_status=[400, 403, 404]),
    TestDef(name="XSS Blocked",
            path="/api/trpc/search.global?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22query%22%3A%22%3Cscript%3Ealert(1)%3C%2Fscript%3E%22%2C%22limit%22%3A5%7D%7D%7D",
            expect_status=[200, 403]),
    TestDef(name="Long URL Blocked",
            path="/" + "a" * 10000,
            expect_status=[400, 414, 431]),

    # Static assets
    TestDef(name="Logo PNG", path="/logo.png", expect_status=200, min_size=10000),
    TestDef(name="Favicon", path="/favicon.ico", expect_status=200, min_size=100),
    TestDef(name="PWA Icon", path="/pwa-192x192.png", expect_status=200, min_size=5000),
    TestDef(name="Manifest", path="/manifest.webmanifest", expect_status=200,
            expect_contains=["name"], is_json=True),

    # Security headers
    TestDef(name="Security Headers", path="/", expect_status=200,
            check_headers={
                "strict-transport-security": "max-age",
                "x-content-type-options": "nosniff",
                "x-frame-options": "DENY",
                "content-security-policy": "default-src",
            }),

    # POST endpoints
    TestDef(name="Chatbot (no auth)", path="/api/chatbot", method="POST",
            body={"messages": [], "language": "en"}, expect_status=[200, 400, 429]),
    TestDef(name="Paymob Webhook (GET → 404)", path="/api/paymob/webhook",
            expect_status=[404, 405]),
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

passed: int = 0
warned: int = 0
failed: int = 0
results: list[TestResult] = []

for i, test in enumerate(TESTS, 1):
    fr: FetchResult = fetch(test)
    ok, warnings = check(test, fr)
    msg: str = f"HTTP {fr.status}, {len(fr.body)}B, {fr.duration:.2f}s" if not fr.error else fr.error

    if ok and not warnings:
        print(f"  ✅ [{i:2d}/{len(TESTS)}] {test.name:35s} {msg}")
        passed += 1
    elif ok:
        print(f"  ⚠️  [{i:2d}/{len(TESTS)}] {test.name:35s} {msg}")
        for w in warnings:
            print(f"         {w}")
        warned += 1
    else:
        print(f"  ❌ [{i:2d}/{len(TESTS)}] {test.name:35s} {msg}")
        for w in warnings:
            print(f"         {w}")
        failed += 1

    results.append(TestResult(
        name=test.name,
        status=fr.status,
        passed=ok,
        warnings=warnings,
        duration_ms=round(fr.duration * 1000),
    ))

print()
print("═" * 65)
print(f"  Total: {len(TESTS)} | ✅ {passed} | ⚠️  {warned} | ❌ {failed}")
print("═" * 65)

report: dict[str, Any] = {
    "timestamp": datetime.now().isoformat(),
    "target": BASE_URL,
    "total": len(TESTS),
    "passed": passed,
    "warned": warned,
    "failed": failed,
    "results": [asdict(r) for r in results],
}
with open("/tmp/urllib-test-results.json", "w") as f:  # NOSONAR — S5443: single-user dev container
    json.dump(report, f, indent=2)
print("\n  Report: /tmp/urllib-test-results.json")
sys.exit(1 if failed > 0 else 0)
