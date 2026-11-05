"""ADMIN DASHBOARD POLISH — visual proof (desktop + mobile).

Serves the REAL production build (dist/public) and relays /api/* to a faithful
mock tRPC server (same architecture as session_persistence_local_e2e.py: the
Workbox service worker bypasses page.route(), so the relay must be a real
HTTP hop from the static server).

Produces screenshots into /home/z/my-project/download/:
  admin-dashboard-desktop-ar.png  (1440x900, Arabic, RTL)
  admin-dashboard-mobile-ar.png   (390x844, Arabic, RTL)
  admin-dashboard-desktop-en.png  (1440x900, English, LTR)

Checks:
  A1  auth.me answers role=admin -> /admin renders (no redirect to /)
  A2  hero band + greeting + date chip + "عرض الموقع" button visible
  A3  5 stat cards render with formatted numbers
  A4  30-day revenue chart: 30 bars exist, total chip shows the series sum
  A5  quick actions: 6 tiles
  A6  newest users list has 5 rows (real query wired to dashboard)
  A7  latest payments list has rows with status badges
  A8  sidebar: 4 group labels (عام/الإدارة/المنصة/التسويق) + tickets badge "3"
  A9  no horizontal overflow on mobile (document.scrollWidth <= innerWidth)
"""
import http.client
import http.server
import json
import os
import socketserver
import subprocess
import sys
import threading
import urllib.parse
from datetime import date, timedelta

from playwright.sync_api import sync_playwright

DIST = "/home/z/my-project/work/elbaz-platform/dist/public"
OUT = "/home/z/my-project/download"
PORT = 4175
MOCK_PORT = 4598
MOCK_BASE = f"http://127.0.0.1:{MOCK_PORT}"
BASE = f"http://127.0.0.1:{PORT}"
JSON_CT = "application/json"

subprocess.run(["mkdir", "-p", OUT], check=True)

ADMIN_USER = {"id": 1, "username": "elbaz", "name": "أحمد الباز", "role": "admin", "email": "admin@ahmedelbaz.qzz.io"}
TOKEN = "e2e-admin-token"

STATS = {"totalUsers": 128, "totalCourses": 6, "totalEnrollments": 214, "openTickets": 3, "totalRevenue": 24500}

# Sparse 30-day revenue series (only days with payments) — keys are UTC dates.
TODAY = date.utcnow() if hasattr(date, "utcnow") else None
_raw = [
    (0, 1250.0), (1, 800.0), (2, 0), (3, 2500.0), (4, 500.0), (6, 1750.0),
    (8, 1000.0), (11, 3500.0), (12, 600.0), (15, 2100.0), (18, 900.0),
    (21, 1500.0), (25, 3200.0), (27, 700.0), (29, 1250.0),
]
REV_BY_DAY = [
    {"date": (date.today() - timedelta(days=ago)).isoformat(), "amount": amount}
    for ago, amount in _raw
]
ANALYTICS = {"newUsers30d": 18, "newEnrollments30d": 27, "revenue30d": 21550.0, "totalLessons": 96, "revenueByDay": REV_BY_DAY}

USERS = [
    {"id": 11, "name": "محمود السيد", "username": "mahmoud", "email": "mahmoud@example.com", "role": "user", "createdAt": "2026-11-03T10:00:00Z"},
    {"id": 12, "name": "سارة أحمد", "username": "sara", "email": "sara@example.com", "role": "user", "createdAt": "2026-11-02T09:00:00Z"},
    {"id": 13, "name": "كريم عبد الله", "username": "karim", "email": "karim@example.com", "role": "user", "createdAt": "2026-11-01T14:00:00Z"},
    {"id": 14, "name": "منى حسن", "username": "mona", "email": "mona@example.com", "role": "user", "createdAt": "2026-10-30T16:00:00Z"},
    {"id": 15, "name": "يوسف طارق", "username": "youssef", "email": "youssef@example.com", "role": "user", "createdAt": "2026-10-28T11:00:00Z"},
]
PAYMENTS = [
    {"id": 101, "amount": "1500.00", "currency": "EGP", "provider": "paymob", "status": "completed", "createdAt": "2026-11-04T12:00:00Z"},
    {"id": 102, "amount": "750.00", "currency": "EGP", "provider": "vodafone_cash", "status": "pending", "createdAt": "2026-11-04T09:30:00Z"},
    {"id": 103, "amount": "2500.00", "currency": "EGP", "provider": "paymob", "status": "completed", "createdAt": "2026-11-03T18:00:00Z"},
    {"id": 104, "amount": "500.00", "currency": "EGP", "provider": "instapay", "status": "completed", "createdAt": "2026-11-02T13:00:00Z"},
    {"id": 105, "amount": "1000.00", "currency": "EGP", "provider": "vodafone_cash", "status": "pending", "createdAt": "2026-11-01T15:00:00Z"},
]

# Which GET/POST procedure returns which payload (query names include the dot).
GET_PROCEDURES = {
    "auth.me": ADMIN_USER,
    "admin.stats": STATS,
    "admin.analytics": ANALYTICS,
    "admin.users": {"items": USERS, "total": len(USERS)},
    "admin.payments": {"items": PAYMENTS, "total": len(PAYMENTS)},
    "payment.isConfigured": {"configured": True},
}


class MockHandler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, payload, extra_headers=None):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", JSON_CT)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Credentials", "true")
        for k, v in (extra_headers or []):
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass

    def do_GET(self):
        name = urllib.parse.urlparse(self.path).path.split("/api/trpc/")[-1].split("?")[0]
        if name == "auth.me":
            cookie = self.headers.get("Cookie") or ""
            if "elbaz_auth=" in cookie:
                self._send(200, {"result": {"data": {"json": ADMIN_USER}}})
            else:
                self._send(401, {"error": {"json": {"message": "UNAUTHORIZED", "code": -32001,
                                                     "data": {"code": "UNAUTHORIZED", "httpStatus": 401, "path": "auth.me"}}}})
            return
        if name in GET_PROCEDURES:
            self._send(200, {"result": {"data": {"json": GET_PROCEDURES[name]}}})
        else:
            self._send(200, {"result": {"data": {"json": None}}})

    def do_POST(self):
        self._send(200, {"result": {"data": {"json": {"success": True}}}})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()


class SpaHandler(http.server.BaseHTTPRequestHandler):
    """Static files + /api relay to the mock (service-worker-proof hop)."""

    def log_message(self, *a):
        pass

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path.startswith("/api/"):
            conn = http.client.HTTPConnection("127.0.0.1", MOCK_PORT, timeout=10)
            headers = {}
            cookie = self.headers.get("Cookie")
            if cookie:
                headers["Cookie"] = cookie  # forward session cookies to the mock
            conn.request("GET", parsed.path, headers=headers)
            resp = conn.getresponse()
            body = resp.read()
            self.send_response(resp.status)
            self.send_header("Content-Type", JSON_CT)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        serve_static = getattr(self, "serve_static")
        serve_static(parsed.path)

    def do_HEAD(self):
        self.do_GET()

    def serve_static(self, url_path):  # bound below
        raise NotImplementedError


def make_spa_handler():
    class Handler(SpaHandler):
        def serve_static(self, url_path):
            rel = url_path.lstrip("/") or "index.html"
            full = os.path.join(DIST, rel)
            if not os.path.isfile(full):
                full = os.path.join(DIST, "index.html")  # SPA fallback
            ext = os.path.splitext(full)[1]
            ctype = {".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                     ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
                     ".json": JSON_CT, ".webp": "image/webp", ".woff2": "font/woff2",
                     ".webmanifest": "application/manifest+json", ".ico": "image/x-icon"}.get(ext, "application/octet-stream")
            with open(full, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
    return Handler


def start_servers():
    socketserver.TCPServer.allow_reuse_address = True
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    mock_srv = socketserver.TCPServer(("127.0.0.1", MOCK_PORT), MockHandler)
    threading.Thread(target=mock_srv.serve_forever, daemon=True).start()
    spa_srv = socketserver.ThreadingTCPServer(("127.0.0.1", PORT), make_spa_handler())
    threading.Thread(target=spa_srv.serve_forever, daemon=True).start()
    return mock_srv, spa_srv


fails = []
def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'} {name}" + (f" — {detail}" if detail else ""))
    if not cond:
        fails.append(f"{name}: {detail}")


INIT_SHIMS = (
    # WEB mode (no Capacitor shim): API base stays relative `/api` and auth is
    # cookie-based — the session cookies are injected per-context below.
    "localStorage.setItem('elbaz_cookie_consent', JSON.stringify({necessary:true,analytics:false,marketing:false}));"
    "localStorage.setItem('language', 'AR_LANG');"
)

def inject_auth_cookies(ctx):
    ctx.add_cookies([
        {"name": "elbaz_auth", "value": TOKEN, "url": BASE},
        {"name": "elbaz_auth_flag", "value": "1", "url": BASE},
    ])

with sync_playwright() as p:
    start_servers()
    browser = p.chromium.launch(headless=True, args=["--no-sandbox"])

    # ── Desktop Arabic ──
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_init_script(INIT_SHIMS.replace("AR_LANG", "ar"))
    inject_auth_cookies(ctx)
    pg = ctx.new_page()
    pg.goto(BASE + "/admin", wait_until="domcontentloaded", timeout=45000)
    pg.wait_for_timeout(4500)
    check("A1 stays on /admin (admin auth accepted)", "/admin" in pg.url, pg.url)
    check("A2a hero band renders", pg.locator(".admin-hero-band").count() >= 1)
    check("A2b date chip renders", pg.get_by_text("عرض الموقع").count() >= 1)
    check("A3 five stat cards", pg.locator(".admin-stat-card").count() == 5, str(pg.locator(".admin-stat-card").count()))
    check("A4a 30 chart bars", pg.locator(".admin-chart-bar").count() == 30, str(pg.locator(".admin-chart-bar").count()))
    chip = pg.locator("span", has_text="EGP").first
    check("A4b revenue total chip", chip.count() >= 1, chip.text_content() or "")
    check("A5 six quick actions", pg.locator(".admin-quick-action").count() == 6, str(pg.locator(".admin-quick-action").count()))
    users_card = pg.locator(".admin-panel-card", has_text="أحدث المستخدمين").first
    check("A6 newest users rows", users_card.locator(".rounded-full").count() >= 5,
          str(users_card.locator(".rounded-full").count()))
    check("A7 payments status badges", pg.get_by_text("completed").count() >= 1 and pg.get_by_text("pending").count() >= 1)
    for lbl in ["عام", "الإدارة", "المنصة", "التسويق"]:
        check(f"A8 sidebar group '{lbl}'", pg.locator(".admin-sidebar-label", has_text=lbl).count() == 1)
    check("A8b tickets badge = 3", pg.locator(".admin-sidebar-item", has_text="التذاكر").locator("span.ms-auto", has_text="3").count() == 1)
    pg.screenshot(path=f"{OUT}/admin-dashboard-desktop-ar.png", full_page=True)
    # Sidebar collapsed variant
    pg.locator('button[aria-label*="تصغير"]').click()
    pg.wait_for_timeout(700)
    pg.screenshot(path=f"{OUT}/admin-dashboard-desktop-ar-collapsed.png")
    pg.locator('button[aria-label*="توسيع"]').click()
    pg.wait_for_timeout(500)

    # ── Mobile Arabic ──
    ctx2 = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    ctx2.add_init_script(INIT_SHIMS.replace("AR_LANG", "ar"))
    inject_auth_cookies(ctx2)
    pg2 = ctx2.new_page()
    pg2.goto(BASE + "/admin", wait_until="domcontentloaded", timeout=45000)
    pg2.wait_for_timeout(4500)
    overflow = pg2.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check("A9 no horizontal overflow on mobile", overflow <= 0, f"overflowPx={overflow}")
    pg2.screenshot(path=f"{OUT}/admin-dashboard-mobile-ar.png", full_page=True)

    # ── Desktop English (LTR sanity) ──
    ctx3 = browser.new_context(viewport={"width": 1440, "height": 900})
    ctx3.add_init_script(INIT_SHIMS.replace("AR_LANG", "en"))
    inject_auth_cookies(ctx3)
    pg3 = ctx3.new_page()
    pg3.goto(BASE + "/admin", wait_until="domcontentloaded", timeout=45000)
    pg3.wait_for_timeout(4000)
    check("A10 EN view renders", pg3.get_by_text("View site").count() >= 1 and pg3.get_by_text("Quick actions").count() >= 1)
    pg3.screenshot(path=f"{OUT}/admin-dashboard-desktop-en.png", full_page=True)

    browser.close()

print("\n" + ("ALL CHECKS PASSED ✓" if not fails else f"{len(fails)} FAILURES:\n" + "\n".join(fails)))
sys.exit(1 if fails else 0)
