"""TEXT-OVERLAP AUDIT — detect "كلام فوق بعضه" (overlapping text) across ALL routes.

Method (deterministic, geometry-based):
  1. Serve the built SPA from the local sandbox server (PORT=3999) like prior e2e scripts.
  2. Mock tRPC GET endpoints at the network level so logged-in pages render real content
     (wishlist.list, journey.timeline, dashboard/profile/documents data).
  3. For every route × {guest, logged-in} × {mobile 360×780, desktop 1280×900} × {closed, menu-open}:
     collect all leaf text elements via Range.getClientRects() and flag pairwise
     intersections (>2px on BOTH axes) between non ancestor/descendant elements.
  4. Screenshot every route; print a compact findings table.

Usage: python3 scripts/text_overlap_audit.py [--only-before]
"""
import json, subprocess, sys, time

BASE = "http://127.0.0.1:3999"
OUT = "/home/z/my-project/work/elbaz-platform/scripts/shots_overlap"
subprocess.run(["mkdir", "-p", OUT], check=True)

USER_JSON = {"id": 54, "username": "audit01", "name": "Audit User", "role": "user", "email": None}
ME_OK = {"result": {"data": {"json": USER_JSON}}}

WISHLIST_OK = {"result": {"data": {"json": {"items": []}}}}
JOURNEY_OK = {"result": {"data": {"json": {"stats": {
    "totalCourses": 0, "completedCourses": 0, "totalCertificates": 0,
    "totalLessonsCompleted": 0, "totalSpent": 0}, "timeline": []}}}}
CERTS_OK = {"result": {"data": {"json": []}}}
HISTORY_OK = {"result": {"data": {"json": []}}}
WATCHTIME_OK = {"result": {"data": {"json": {"totalSeconds": 0, "byCourse": []}}}}
ENROLL_OK = {"result": {"data": {"json": []}}}
REFS_OK = {"result": {"data": {"json": {"files": [], "total": 0}}}}
REFCATS_OK = {"result": {"data": {"json": []}}}
NOTIF_OK = {"result": {"data": {"json": {"notifications": [], "unread": 0}}}}
CONTACT_OK = {"result": {"data": {"json": {"whatsappNumber": "201012345678", "email": "x@y.z", "facebookUrl": "", "telegramUrl": "", "supportHours": ""}}}}

MOCK_GET = {
    "auth.me": ME_OK,
    "wishlist.list": WISHLIST_OK,
    "journey.timeline": JOURNEY_OK,
    "certificate.myCertificates": CERTS_OK,
    "payment.history": HISTORY_OK,
    "course.myWatchTime": WATCHTIME_OK,
    "course.enrollments": ENROLL_OK,
    "references.list": REFS_OK,
    "references.categories": REFCATS_OK,
    "notifications.list": NOTIF_OK,
    "settings.contact": CONTACT_OK,
}

# JS: collect text-leaf elements and report pairwise visual overlaps
OVERLAP_JS = """
() => {
  const intersects = (a, b) => {
    const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return (x > 2 && y > 2) ? {x, y} : null;
  };
  const related = (a, b) => a.contains(b) || b.contains(a);
  // accumulate background alpha up the chain; true if a solid-ish surface (>= 0.5 total)
  const surfaceAlpha = (el) => {
    let alpha = 0;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      const m = bg && bg.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(',').map(s => parseFloat(s));
        const a = parts.length >= 4 ? parts[3] : 1;
        if (a > 0) { alpha = alpha === 0 ? a : alpha; if (a >= 0.9) { alpha = 1; break; } }
      }
      if (alpha >= 0.5) break;
    }
    return alpha;
  };
  // is the element visually covered by an opaque overlay/bar on top of it?
  const obscured = (el) => {
    const r = el.getBoundingClientRect();
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
    const cy = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
    let top = null;
    try { top = document.elementFromPoint(cx, cy); } catch (e) { return false; }
    if (!top) return false;
    if (top === el || top.contains(el) || el.contains(top)) return false;
    return surfaceAlpha(top) >= 0.5;
  };
  // two inline elements inside the same text block can never visually overlap
  const nearestTextBlock = (el) => el.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote, dt, dd, figcaption, label, summary');
  const inlineFlowPair = (a, b) => {
    const da = getComputedStyle(a).display, db = getComputedStyle(b).display;
    if (!da.startsWith('inline') || !db.startsWith('inline')) return false;
    const ba = nearestTextBlock(a), bb = nearestTextBlock(b);
    return !!(ba && bb && ba === bb);
  };
  // effective opacity/visibility across ancestors (opacity is NOT inherited,
  // so a leaf inside opacity-0 tooltip reports 1 — must accumulate)
  const hiddenByChain = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return true;
      if (parseFloat(cs.opacity) < 0.15) return true;
      if (n.getAttribute && n.getAttribute('aria-hidden') === 'true') return true;
      if (el === n && cs.clip !== 'auto') return true; // sr-only pattern
      if (el === n && cs.clipPath && cs.clipPath !== 'none' && cs.clipPath.includes('inset(50%')) return true;
    }
    return false;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  const items = [];
  while (walker.nextNode()) {
    const txt = walker.currentNode.textContent.trim();
    if (!txt) continue;
    const el = walker.currentNode.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (hiddenByChain(el)) continue;
    let r = null;
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = range.getClientRects();
      if (!rects.length) continue;
      const first = rects[0], last = rects[rects.length - 1];
      r = {left: Math.min(first.left, last.left), right: Math.max(first.right, last.right),
           top: Math.min(first.top, last.top), bottom: Math.max(first.bottom, last.bottom)};
    } catch (e) { continue; }
    if (r.right - r.left < 4 || r.bottom - r.top < 4) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    items.push({el, text: txt.slice(0, 42), r});
  }
  const out = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const A = items[i], B = items[j];
      if (related(A.el, B.el)) continue;
      // intentional ghost watermark: giant 404 number with centered label
      const ghost = (a, b) => (a === '404' && (b.includes('PAGE NOT FOUND') || b.includes('الصفحة غير موجودة')))
                           || (b === '404' && (a.includes('PAGE NOT FOUND') || a.includes('الصفحة غير موجودة')));
      if (ghost(A.text, B.text)) continue;
      if (inlineFlowPair(A.el, B.el)) continue;
      if (obscured(A.el) || obscured(B.el)) continue;
      // intentional floating popups (proactive welcome bubble / whatsapp tooltip)
      const popup = (el) => !!el.closest('#whatsapp-welcome, #whatsapp-tooltip');
      if (popup(A.el) || popup(B.el)) continue;
      const ov = intersects(A.r, B.r);
      if (ov) out.push({a: A.text, b: B.text, ax: Math.round(ov.x), ay: Math.round(ov.y),
                        at: Math.round(A.r.top), bt: Math.round(B.r.top)});
    }
  }
  return out.slice(0, 25);
}
"""

GUEST_ROUTES = ["/", "/courses", "/references", "/faq", "/articles", "/login", "/register",
                "/terms", "/privacy", "/refund", "/verify", "/nonexistent-page"]
AUTH_ROUTES = ["/dashboard", "/wishlist", "/journey", "/profile", "/documents", "/support",
               "/", "/courses", "/references", "/faq"]

fails, notes = [], []


def setup_routes(pg):
    def handler(route):
        url = route.request.url
        method = route.request.method
        if "/api/trpc/" not in url:
            return route.continue_()
        path = url.split("/api/trpc/")[1].split("?")[0]
        if method == "GET":
            for name, body in MOCK_GET.items():
                if path == name or path.startswith(name + ","):
                    route.fulfill(status=200, content_type="application/json",
                                  body=json.dumps(body))
                    return
            # unmocked queries → sandbox server (pages degrade to empty/error states, fine for layout audit)
            return route.continue_()
        return route.continue_()
    pg.route("**/api/trpc/**", handler)


def accept_cookies(pg):
    try:
        pg.get_by_role("button", name="Accept all").click(timeout=2500)
        pg.wait_for_timeout(300)
    except Exception:
        pass


def audit_page(pg, route_label, shot_name, open_menu=False):
    pg.wait_for_timeout(2200)  # let queries/animations settle
    if open_menu:
        try:
            pg.locator('button[aria-label="Toggle menu"], button[aria-label="فتح القائمة"]').first.click(timeout=2500)
            pg.wait_for_timeout(700)
        except Exception:
            pass
    found = pg.evaluate(OVERLAP_JS)
    pg.screenshot(path=f"{OUT}/{shot_name}.png")
    if not open_menu:
        # second pass: scrolled to bottom (catches mid-page / bottom-of-page overlaps)
        try:
            pg.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            pg.wait_for_timeout(600)
            found += pg.evaluate(OVERLAP_JS)
            pg.evaluate("window.scrollTo(0, 0)")
            pg.wait_for_timeout(300)
        except Exception:
            pass
    if open_menu:
        try:
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(300)
        except Exception:
            pass
    for f in found:
        fails.append(f"[{route_label}] '{f['a']}' ⨯ '{f['b']}' (Δx={f['ax']}px Δy={f['ay']}px tops={f['at']}/{f['bt']})")
    return found


def run_context(browser, label, viewport, authed, is_mobile):
    ctx = browser.new_context(viewport=viewport, device_scale_factor=2 if is_mobile else 1,
                              service_workers="block",
                              user_agent="Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36" if is_mobile else None)
    if authed:
        ctx.add_cookies([{"name": "elbaz_auth_flag", "value": "1", "url": BASE}])
    pg = ctx.new_page()
    setup_routes(pg)
    routes = AUTH_ROUTES if authed else GUEST_ROUTES
    for r in routes:
        tag = f"{label}{'/auth' if authed else '/guest'}"
        shot = f"{label}_{r.strip('/').replace('/', '_') or 'home'}{'_auth' if authed else ''}"
        try:
            pg.goto(BASE + r, wait_until="domcontentloaded", timeout=30000)
            accept_cookies(pg)
            audit_page(pg, f"{tag} {r}", shot, open_menu=False)
            if is_mobile:  # also check with the hamburger menu open (القوائم)
                audit_page(pg, f"{tag} {r} +menu", shot + "_menu", open_menu=True)
        except Exception as e:
            notes.append(f"[{tag} {r}] ERROR: {type(e).__name__}: {str(e)[:120]}")
    pg.close(); ctx.close()


def main():
    env_cmd = [
        "env",
        "DATABASE_URL=mysql://user:pass@127.0.0.1:3306/testdb",
        "APP_SECRET=local-test-secret-0123456789abcdef",
        "GOOGLE_CLIENT_ID=test.apps.googleusercontent.com",
        "SESSION_SECRET=local-session-0123456789abcdef",
        "JWT_SECRET=local-jwt-0123456789abcdef",
        "OPENROUTER_API_KEY=sk-or-test",
        "PORT=3999",
        "NODE_ENV=development",
        "npx", "tsx", "api/boot.ts",
    ]
    server = subprocess.Popen(env_cmd, cwd="/home/z/my-project/work/elbaz-platform",
                              stdout=open("/tmp/boot_overlap.log", "w"), stderr=subprocess.STDOUT)
    time.sleep(12)
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            MOBILE = {"width": 360, "height": 780}
            DESKTOP = {"width": 1280, "height": 900}
            run_context(browser, "mob", MOBILE, authed=False, is_mobile=True)
            run_context(browser, "mob", MOBILE, authed=True, is_mobile=True)
            run_context(browser, "dsk", DESKTOP, authed=False, is_mobile=False)
            run_context(browser, "dsk", DESKTOP, authed=True, is_mobile=False)
            browser.close()
    finally:
        server.terminate()

    print("\n" + "=" * 72)
    print(f"OVERLAP FINDINGS: {len(fails)}")
    for f in fails:
        print("  " + f)
    print(f"ERRORS/NOTES: {len(notes)}")
    for n in notes:
        print("  " + n)
    print("=" * 72)
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
