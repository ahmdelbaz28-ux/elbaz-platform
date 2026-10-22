"""LOCAL CLIENT E2E — payment UNAUTHORIZED fix (client behaviors, deterministic).

Serves the built SPA from the local sandbox server and MOCKS the tRPC
endpoints at the network level, so the exact client-side behavior of commit
5d317f1 is verified deterministically:

 Scenario A (stale session): auth.me returns a user (client logged-in), but
   payment.create returns 401 UNAUTHORIZED → expect the friendly Arabic
   banner + auto-redirect to /login?redirect=<course-url>
 Scenario B (redirect honored): login form submits against mocked auth.login
   → expect navigation back to the course URL (redirect param honored)
 Scenario C (happy path): payment.create returns 200 with requiresRedirect +
   paymentUrl → expect client navigates to the gateway URL
"""
import json, subprocess, sys, time
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3999"
COURSE_PATH = "/courses/etap-complete-course"
OUT = "/home/z/my-project/work/elbaz-platform/scripts/shots_pay"
subprocess.run(["mkdir", "-p", OUT], check=True)

USER_JSON = {"id": 54, "username": "paytest01", "name": "Pay Test", "role": "user", "email": None}

COURSE_JSON = {
    "id": 1, "slug": "etap-complete-course",
    "titleAr": "كورس ETAP الشامل", "titleEn": "ETAP Complete Course",
    "descriptionAr": "وصف", "descriptionEn": "desc",
    "learningOutcomesAr": [], "learningOutcomesEn": [],
    "thumbnail": None, "price": "1999", "originalPrice": "2500",
    "isPremium": True, "isPublished": True, "rating": "4.8",
    "studentCount": 120, "durationHours": 40,
    "category": {"nameEn": "Power", "nameAr": "قوى كهربية"},
    "lessons": [],
}

ME_OK = {"result": {"data": {"json": USER_JSON}}}
IS_CONFIGURED = {"result": {"data": {"json": {
    "configured": True, "missing": [], "mode": "test",
    "methods": {"card": True, "wallet": True}}}}}
MANUAL = {"result": {"data": {"json": {"enabled": True, "vodafoneCashNumber": "010xxxx",
    "instapayHandle": "instapay//x", "bankTransferDetails": "ACC", "notesAr": "", "notesEn": ""}}}}
CHECK_ENROLL = {"result": {"data": {"json": {"enrolled": False, "isCompleted": False, "progress": 0}}}}

TRPC_401 = {"error": {"json": {
    "message": "Your session has expired. Please log in again.",
    "code": -32001, "data": {"code": "UNAUTHORIZED", "httpStatus": 401, "path": "payment.create"}}}}

CREATE_OK = {"result": {"data": {"json": {
    "requiresRedirect": True, "paymentUrl": "https://accept.paymob.example/checkout/abc123",
    "transactionId": "tx-test-1"}}}}

LOGIN_OK = {"result": {"data": {"json": {"user": USER_JSON, "token": "mock-token"}}}}

def envelope_for_get(name):
    if name == "auth.me": return 200, ME_OK
    if name == "payment.isConfigured": return 200, IS_CONFIGURED
    if name == "payment.manualDetails": return 200, MANUAL
    if name == "course.checkEnrollment": return 200, CHECK_ENROLL
    if name.startswith("course.bySlug"): return 200, {"result": {"data": {"json": COURSE_JSON}}}
    return None

fails, notes = [], []

def setup_routes(pg, create_body, create_status=200):
    # mock gateway domain so location.href navigation resolves
    pg.route("https://accept.paymob.example/**", lambda route: route.fulfill(
        status=200, content_type="text/html", body="<html><body>Paymob Mock Checkout</body></html>"))

    def handler(route):
        url = route.request.url
        method = route.request.method
        if "/api/trpc/" not in url:
            return route.continue_()
        path = url.split("/api/trpc/")[1].split("?")[0]
        if method == "GET":
            packed = envelope_for_get(path)
            if packed:
                st, body = packed
                route.fulfill(status=st, content_type="application/json", body=json.dumps(body))
                return
            return route.continue_()  # others → local sandbox server
        if method == "POST" and path == "payment.create":
            route.fulfill(status=create_status, content_type="application/json",
                          body=json.dumps(create_body))
            return
        if method == "POST" and path == "auth.login":
            route.fulfill(status=200, content_type="application/json", body=json.dumps(LOGIN_OK))
            return
        return route.continue_()
    pg.route("**/api/trpc/**", handler)

def open_course_and_buy(pg, shot_prefix):
    pg.goto(BASE + COURSE_PATH, wait_until="domcontentloaded", timeout=30000)
    pg.wait_for_timeout(3000)
    try:
        pg.get_by_role("button", name="Accept all").click(timeout=3000)
        pg.wait_for_timeout(400)
    except Exception:
        pass
    pg.get_by_role("button", name="Buy Now").first.click()
    pg.wait_for_timeout(1200)
    if pg.get_by_text("Payment Methods").count() == 0:
        fails.append(f"[{shot_prefix}] modal did not open")
        return False
    pg.locator("input[placeholder*='01']").first.fill("01061857305")
    return True

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # ---------- SCENARIO A: stale session ----------
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    ctx.add_cookies([{"name": "elbaz_auth_flag", "value": "1", "url": BASE}])
    pg = ctx.new_page()
    setup_routes(pg, create_body=TRPC_401, create_status=401)
    if open_course_and_buy(pg, "A"):
        pg.get_by_text("Card Payment").first.click()
        pg.wait_for_timeout(1200)
        banner = (pg.get_by_text("انتهت مدة جلسة الدخول").count() > 0
                  or pg.get_by_text("session has expired").count() > 0)
        raw = pg.get_by_text("UNAUTHORIZED").count() > 0
        print("A) friendly banner shown:", banner, "| raw UNAUTHORIZED still shown:", raw)
        pg.screenshot(path=f"{OUT}/A_stale_banner.png")
        if not banner:
            fails.append("[A] friendly session-expired banner not shown")
        deadline = time.time() + 6
        went = False
        while time.time() < deadline:
            pg.wait_for_timeout(400)
            if "/login" in pg.url and "redirect=" in pg.url:
                went = True
                break
        print("A) auto-redirect:", went, "|", pg.url)
        if not went:
            fails.append(f"[A] no redirect to /login?redirect= (at {pg.url})")
        elif "redirect=%2Fcourses%2Fetap-complete-course" not in pg.url:
            fails.append(f"[A] redirect param malformed: {pg.url}")
    ctx.close()

    # ---------- SCENARIO B: login honors redirect ----------
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    ctx.add_cookies([{"name": "elbaz_auth_flag", "value": "1", "url": BASE}])
    pg = ctx.new_page()
    setup_routes(pg, create_body=TRPC_401, create_status=401)
    pg.goto(BASE + "/login?redirect=%2Fcourses%2Fetap-complete-course",
            wait_until="domcontentloaded", timeout=30000)
    pg.wait_for_timeout(2500)
    try:
        pg.get_by_role("button", name="Accept all").click(timeout=3000)
        pg.wait_for_timeout(400)
    except Exception:
        pass
    pg.locator("form input").nth(0).fill("paytest01")
    pg.locator("form input[type=password]").first.fill("whatever")
    pg.locator("form button[type=submit]").first.click()
    pg.wait_for_timeout(3000)
    print("B) after login:", pg.url)
    pg.screenshot(path=f"{OUT}/B_back_on_course.png")
    if not pg.url.startswith(BASE + COURSE_PATH):
        fails.append(f"[B] redirect not honored — at {pg.url}")
    else:
        notes.append("B) ?redirect honored → back on the course ✓")
    ctx.close()

    # ---------- SCENARIO C: happy path redirects to gateway ----------
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    ctx.add_cookies([{"name": "elbaz_auth_flag", "value": "1", "url": BASE}])
    pg = ctx.new_page()
    setup_routes(pg, create_body=CREATE_OK, create_status=200)
    if open_course_and_buy(pg, "C"):
        pg.get_by_text("Card Payment").first.click()
        deadline = time.time() + 10
        went = False
        while time.time() < deadline:
            pg.wait_for_timeout(400)
            if "paymob.example" in pg.url:
                went = True
                break
        print("C) gateway navigation:", went, "|", pg.url[:80])
        if not went:
            fails.append(f"[C] no gateway redirect (at {pg.url[:100]})")
        else:
            notes.append("C) 200 + paymentUrl → client navigated to the gateway ✓")
    ctx.close()

    browser.close()

print("\n=== NOTES ===")
for n in notes: print("•", n)
print("=== RESULT ===")
if fails:
    print("FAILURES:"); [print(" -", f) for f in fails]; sys.exit(1)
print("ALL CLIENT E2E CHECKS PASSED ✓")
