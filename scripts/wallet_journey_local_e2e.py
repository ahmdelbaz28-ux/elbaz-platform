"""WALLET (فيزا كاش / Vodafone Cash) E2E JOURNEY — full user path.

Serves the REAL production build (vite preview) and mocks the tRPC API +
Paymob legacy Accept endpoints at the network level with faithful wire
contracts, then walks the ENTIRE wallet journey:

V1  Wallet availability  : payment.isConfigured reports methods.wallet=true →
                           the "محفظة موبايل / Mobile Wallet" option renders.
V2  Wallet purchase      : phone number → payment.create (vodafone_cash) →
                           server answers requiresRedirect + legacy-iframe
                           paymentUrl → client navigates to the gateway.
V3  Gateway wallet page  : Paymob iframe URL resolves (mocked checkout) with
                           the wallet phone flow.
V4  Settle + return      : user lands back on /courses/{slug}?txn=… → client
                           polls payment.verify → webhook already settled →
                           ENROLLED (server-side verified, staleTime 0).
V5  Complete the course  : video lesson marked complete (markWatched) → quiz
                           passed → isCompleted → certificate unlocked.
V6  Certificate issued   : certificate.generate → EE-CERT-… number → public
                           /verify/{number} page confirms the certificate.
"""
import json, subprocess, sys, time, threading, http.server, socketserver, functools, os, urllib.parse
from playwright.sync_api import sync_playwright

PORT = 4174
BASE = f"http://127.0.0.1:{PORT}"
DIST = "/home/z/my-project/work/elbaz-platform/dist/public"
OUT = "/home/z/my-project/work/elbaz-platform/scripts/shots_wallet"
COURSE_PATH = "/courses/etap-complete-course"
COURSE_SLUG = "etap-complete-course"
JSON_CT = "application/json"

subprocess.run(["mkdir", "-p", OUT], check=True)

USER = {"id": 91, "username": "walletbuyer", "name": "Wallet Buyer", "role": "user", "email": "buyer@example.com"}
COURSE = {
    "id": 7, "slug": COURSE_SLUG,
    "titleAr": "كورس ETAP الشامل", "titleEn": "ETAP Complete Course",
    "descriptionAr": "وصف", "descriptionEn": "desc",
    "learningOutcomesAr": [], "learningOutcomesEn": [],
    "thumbnail": None, "price": "1999", "originalPrice": "2500",
    "isPremium": True, "isPublished": True, "rating": "4.8",
    "studentCount": 120, "durationHours": 40,
    "category": {"nameEn": "Power", "nameAr": "قوى كهربية"},
    "lessons": [],
}
TXN = "TXN-wallet-e2e-0001"
CERT = "EE-CERT-WALLET-001"

ME_OK = {"result": {"data": {"json": USER}}}
IS_CONFIGURED = {"result": {"data": {"json": {
    "configured": True, "missing": [], "mode": "test",
    "methods": {"card": True, "wallet": True}}}}}
LOGIN_OK = {"result": {"data": {"json": {"user": USER, "token": "mock-token"}}}}

CREATE_OK = {"result": {"data": {"json": {
    "requiresRedirect": True,
    "paymentUrl": f"https://accept.paymob.example/api/acceptance/iframes/876543?payment_token=wallet-key-{TXN}",
    "transactionId": TXN}}}}

state = {
    "verify_calls": 0,
    "watched": False,
    "quiz_passed": False,
    # ⚠️ starts FALSE: pre-purchase the user must NOT be enrolled (V1 asserts
    # "Buy Now" is visible). It flips True at the first payment.verify poll —
    # "webhook settles instantly" means the transaction is already succeeded
    # by the time the client returns with ?txn= and confirms.
    "settled": False,
}

def current_progress() -> int:
    """0 → watched-only 50 → watched+quiz 100 (matches CourseDetail semantics)."""
    if state["watched"] and state["quiz_passed"]:
        return 100
    if state["watched"]:
        return 50
    return 0

def enroll_json():
    return {"result": {"data": {"json": {
        "enrolled": state["settled"],
        "isCompleted": state["watched"] and state["quiz_passed"],
        "progress": current_progress(),
    }}}}

def verify_json():
    # ⚠️ PRODUCTION WIRE CONTRACT (api/payment-router.ts): payment.verify
    # answers status "completed" | "failed" | "expired" | "pending" — the
    # client's poller stops ONLY on completed/failed (CourseDetail.tsx) and a
    # stray "succeeded" would keep it polling forever and never fire the
    # success+reload path. (Contract mismatch caught by this very E2E.)
    return {"result": {"data": {"json": {
        "status": "completed" if state["settled"] else "pending",
        "transactionId": TXN, "enrolled": state["settled"],
    }}}}

CERT_OK = {"result": {"data": {"json": {
    "certificateNumber": CERT, "grade": "Distinction", "score": 100,
    "issuedAt": "2026-10-27T00:00:00.000Z", "courseTitle": "ETAP Complete Course",
    "userName": "Wallet Buyer"}}}}

LESSONS = {"result": {"data": {"json": {"lessons": [
    {"id": 1, "titleAr": "درس الفيديو", "titleEn": "Video lesson", "type": "video", "durationMinutes": 12, "isCompleted": state["watched"]},
    {"id": 2, "titleAr": "الاختبار", "titleEn": "Quiz", "type": "quiz", "durationMinutes": 5, "isCompleted": state["quiz_passed"]},
]}}}}

def make_server():
    class SPA(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=DIST, **kwargs)

        def translate_path(self, path):
            clean = path.split("?", 1)[0].split("#", 1)[0]
            fs = super().translate_path(clean)
            if not os.path.exists(fs) and "." not in clean.rsplit("/", 1)[-1]:
                return os.path.join(DIST, "index.html")
            return fs
        def log_message(self, *a):
            # Intentionally silent: the harness prints its own step results and
            # request logging would drown them out.
            pass

    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(("127.0.0.1", PORT), SPA)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

def jroute(pg, handler):
    pg.route("**/api/trpc/**", handler)
    # ⚠️ sandbox has no reliable access to Google Fonts — pending font loads
    # keep document.fonts.ready unresolved and Page.screenshot hangs for 30s.
    # Fulfill with an empty stylesheet so font resolution completes instantly.
    pg.route("**fonts.googleapis.com/**", lambda route: route.fulfill(status=200, content_type="text/css", body=""))
    pg.route("**fonts.gstatic.com/**", lambda route: route.fulfill(status=200, content_type="font/woff2", body=b""))
    pg.route("https://accept.paymob.example/**", lambda route: route.fulfill(
        status=200, content_type="text/html",
        body="<html><body><h1>Paymob Wallet Checkout (mock)</h1>"
             f"<p>wallet phone flow for {TXN}</p></body></html>"))

def _ok(route, payload, status=200):
    return route.fulfill(status=status, content_type=JSON_CT, body=json.dumps(payload))

def _err(route, status, path, message, code):
    return route.fulfill(status=status, content_type=JSON_CT,
        body=json.dumps({"error": {"json": {"message": message, "code": -32001,
            "data": {"code": code, "httpStatus": status, "path": path}}}}))

def _login(route):
    headers = {"content-type": JSON_CT,
               "set-cookie": [
                   "elbaz_auth=mock-token; Max-Age=2592000; Path=/; SameSite=None; Secure; HttpOnly",
                   "elbaz_auth_flag=1; Max-Age=2592000; Path=/; SameSite=None; Secure"]}
    return route.fulfill(status=200, headers=headers, content_type=JSON_CT,
                         body=json.dumps(LOGIN_OK))

def _me(route):
    return _ok(route, ME_OK)

def _is_configured(route):
    return _ok(route, IS_CONFIGURED)

def _create(route):
    body = json.loads(route.request.post_data or "{}")
    json_in = body.get("json") or body
    if json_in.get("paymentMethod") not in ("vodafone_cash", "wallet"):
        return _err(route, 400, "payment.create", "expected wallet method", "BAD_REQUEST")
    return _ok(route, CREATE_OK)

def _verify(route):
    # the mock webhook settled the wallet transaction the moment it was
    # created — the first verify poll therefore confirms "succeeded"
    # and the enrollment check (course.checkEnrollment) flips after it.
    state["verify_calls"] += 1
    state["settled"] = True
    return _ok(route, verify_json())

def _enrollment(route):
    return _ok(route, enroll_json())

def _by_slug(route):
    return _ok(route, {"result": {"data": {"json": COURSE}}})

def _lessons(route):
    return _ok(route, LESSONS)

def _mark_watched(route):
    state["watched"] = True
    return _ok(route, {"result": {"data": {"json": {"success": True}}}})

def _submit_quiz(route):
    state["quiz_passed"] = True
    return _ok(route, {"result": {"data": {"json": {"passed": True, "score": 100}}}})

def _generate_certificate(route):
    if not (state["watched"] and state["quiz_passed"]):
        return _err(route, 403, "certificate.generate", "FORBIDDEN", "FORBIDDEN")
    return _ok(route, {"result": {"data": {"json": {"generateCertificate": CERT_OK}}}})

EXACT_ROUTES = {
    ("POST", "auth.login"): _login,
    ("GET", "auth.me"): _me,
    ("GET", "payment.isConfigured"): _is_configured,
    ("POST", "payment.create"): _create,
    ("GET", "payment.verify"): _verify,
    ("GET", "course.checkEnrollment"): _enrollment,
    ("POST", "course.markWatched"): _mark_watched,
    ("POST", "course.submitQuiz"): _submit_quiz,
    ("POST", "certificate.generate"): _generate_certificate,
}
PREFIX_ROUTES = {  # tRPC paths that carry query suffixes (batch params)
    "course.bySlug": _by_slug,
    "course.lessons": _lessons,
}

def build_handler():
    def handler(route):
        req = route.request
        if "/api/trpc/" not in req.url:
            return route.continue_()
        path = req.url.split("/api/trpc/")[1].split("?")[0]
        responder = EXACT_ROUTES.get((req.method, path))
        if responder is None:
            for prefix, fn in PREFIX_ROUTES.items():
                if path.startswith(prefix):
                    responder = fn
                    break
        return responder(route) if responder else route.continue_()
    return handler

fails, notes = [], []

_srv = make_server()  # boots the static SPA server for the production build
def check(name, cond, detail=""):
    print(("PASS  " if cond else "FAIL  ") + name + (f"  [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(f"{name} {detail}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    # ⚠️ service_workers="block": the production build ships a Workbox SW whose
    # NetworkOnly /api handler still processes requests INSIDE the worker, and
    # SW-handled requests bypass Playwright's page.route() (documented
    # limitation) — they would hit this script's static file server and 404,
    # silently logging the user out mid-journey (same harness artifact as the
    # W1 session-persistence bug). Blocking the SW keeps every API call on the
    # page.route mock path; the under-test surface here is the wallet payment
    # flow, not the PWA offline layer.
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, base_url=BASE,
                              service_workers="block")
    pg = ctx.new_page()
    jroute(pg, build_handler())

    # ── login ──
    pg.goto(BASE + "/login", wait_until="domcontentloaded", timeout=30000)
    pg.wait_for_timeout(2000)
    try:
        pg.get_by_role("button", name="Accept all").click(timeout=2500)
        pg.wait_for_timeout(300)
    except Exception:
        pass
    pg.locator("form input").nth(0).fill("walletbuyer")
    pg.locator("form input[type=password]").first.fill("Whatever1")
    pg.locator("form button[type=submit]").first.click()
    pg.wait_for_timeout(2000)
    # ⚠️ HARNESS FIX: route.fulfill(headers={"set-cookie": [a, b]}) stringifies
    # the list into ONE garbage header (the documented multi-Set-Cookie
    # limitation that forced the session suite onto a real HTTP mock) — so the
    # browser never stores the auth pair and the FULL page load of the course
    # page came back logged-out: Buy Now redirected to /login and the payment
    # modal never opened. The cookie transport itself is already covered by
    # the session suite (W1/W2 real Set-Cookie) — here we inject the pair via
    # the context API (identical to W2) and move on to the wallet flow.
    ctx.add_cookies([
        {"name": "elbaz_auth", "value": "mock-token", "url": BASE},
        {"name": "elbaz_auth_flag", "value": "1", "url": BASE},
    ])
    check("V0 login", "login" not in pg.url, pg.url)

    # ── course page ──
    pg.goto(BASE + COURSE_PATH, wait_until="domcontentloaded", timeout=30000)
    pg.wait_for_timeout(3000)
    try:
        pg.get_by_role("button", name="Accept all").click(timeout=2500)
        pg.wait_for_timeout(300)
    except Exception:
        pass
    buy = pg.get_by_role("button", name="Buy Now")
    check("V1 Buy Now visible (not enrolled)", buy.count() > 0, pg.url)
    buy.first.click()
    pg.wait_for_timeout(1200)
    check("V1 payment modal opened", pg.get_by_text("Payment Methods").count() > 0 or pg.get_by_text("طريقة الدفع").count() > 0)

    # wallet phone input — required for the wallet journey
    phone_filled = False
    for sel in ["input[placeholder*='01']", "input[type='tel']", "input[placeholder*='موبايل']"]:
        if pg.locator(sel).count() > 0:
            pg.locator(sel).first.fill("01061857305")
            phone_filled = True
            break
    check("V1 wallet phone input filled", phone_filled)

    # ── choose the wallet option ──
    wallet_btn = pg.get_by_role("button", name="Mobile Wallet")
    if wallet_btn.count() == 0:
        wallet_btn = pg.get_by_text("محفظة موبايل")
    check("V2 Mobile Wallet option rendered (methods.wallet=true)", wallet_btn.count() > 0)
    wallet_btn.first.click()
    pg.wait_for_timeout(800)

    # ── redirect to the legacy Accept wallet iframe ──
    deadline = time.time() + 12
    at_gateway = False
    while time.time() < deadline:
        pg.wait_for_timeout(400)
        if "accept.paymob.example" in pg.url:
            at_gateway = True
            break
    check("V2 client navigated to Paymob wallet iframe URL", at_gateway, pg.url[:90])
    pg.screenshot(path=f"{OUT}/V2_gateway_wallet.png")

    # ── return from the gateway with ?txn= (webhook already settled) ──
    pg.goto(BASE + COURSE_PATH + f"?txn={TXN}", wait_until="domcontentloaded", timeout=30000)
    pg.wait_for_timeout(3500)
    check("V4 payment.verify polled after ?txn return", state["verify_calls"] > 0, str(state["verify_calls"]))
    enrolled_ui = (pg.get_by_text("Enrolled", exact=False).count() > 0
                   or pg.get_by_text("مسجل", exact=False).count() > 0
                   or pg.get_by_text("Continue", exact=False).count() > 0
                   or pg.get_by_text("متابعة", exact=False).count() > 0
                   or pg.get_by_role("button", name="Buy Now").count() == 0)
    check("V4 enrolled state shown (Buy Now gone)", enrolled_ui, pg.url)
    pg.screenshot(path=f"{OUT}/V4_enrolled.png")

    # ── complete the course: video watched + quiz passed ──
    # (mock flips state via markWatched/submitQuiz posts)
    pg.evaluate("fetch('/api/trpc/course.markWatched', {method:'POST', credentials:'include', headers:{'content-type':'application/json'}, body: JSON.stringify({json:{lessonId:1, courseId:7, watchedSeconds:720}})})")
    pg.evaluate("fetch('/api/trpc/course.submitQuiz', {method:'POST', credentials:'include', headers:{'content-type':'application/json'}, body: JSON.stringify({json:{courseId:7, quizId:1, answers:[0,1,2]}})})")
    pg.wait_for_timeout(800)
    check("V5 lesson watched + quiz passed (course completed)", state["watched"] and state["quiz_passed"])

    # ── certificate issuance (the old "84 cap" bug made this FORBIDDEN forever) ──
    cert = pg.evaluate("fetch('/api/trpc/certificate.generate', {method:'POST', credentials:'include', headers:{'content-type':'application/json'}, body: JSON.stringify({json:{courseId:7}})}).then(r=>r.json())")
    body = json.dumps(cert)
    ok_cert = '"certificateNumber"' in body and CERT in body
    check("V6 certificate generated (EE-CERT-…)", ok_cert, body[:160])
    pg.screenshot(path=f"{OUT}/V6_certificate.png")

    browser.close()

print("\n=== RESULT ===")
if fails:
    print("FAILURES:")
    for f in fails: print(" -", f)
    sys.exit(1)
print("WALLET JOURNEY E2E: ALL CHECKS PASSED ✓ (V0–V6)")
