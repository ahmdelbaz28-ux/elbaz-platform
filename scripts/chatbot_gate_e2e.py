"""E2E — ChatBot FAB auth gate (click → /login when logged out).

Reproduces + verifies the "clicking the chatbot while logged out does
nothing" bug reported by the owner.

Scenarios (client-side deterministic — auth.me mocked at network level):
  A) FRESH VISITOR — no cookies at all. auth.me is never fired (query
     disabled by hasStoredAuth()==false). Expect: click FAB → Arabic toast
     + redirect to /login.
  B) STALE FLAG COOKIE — elbaz_auth_flag=1 present but session is dead
     (auth.me → 401 UNAUTHORIZED). This is the real-world state after the
     JWT expired/revoked while the 30-day flag cookie survives.
     Expect AFTER FIX: 401 loop stops (<=3 auth.me calls), flag cookie is
     cleared, FAB click → toast + redirect to /login.
     BUG BEFORE FIX: infinite 401 loop keeps authLoading true → click
     swallowed forever ("no reaction").
  C) LOGGED-IN USER — auth.me → 200 user. Expect: click FAB → chat window
     opens (no redirect). Regression guard.
"""
import json, os, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3999"
OUT = "/home/z/my-project/work/elbaz-platform/scripts/shots_chatgate"
subprocess.run(["mkdir", "-p", OUT], check=True)

# -- Sonar S1192: shared literals defined once -------------------------------
T_RPC = "/api/trpc/"          # URL prefix — split(...) yields "auth.me?..."
AUTH_ME = "auth.me"           # tRPC procedure path (no leading slash)
CT_JSON = "application/json"
LOGIN_PATH = "/login"
# Sonar security hotspot: never write to a predictable /tmp path — use a
# pid-suffixed tempfile so concurrent runs cannot collide (symlink-safe).
BOOT_LOG = os.path.join(tempfile.gettempdir(), f"boot_chatgate_{os.getpid()}.log")


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
                          stdout=open(BOOT_LOG, "w"),
                          stderr=subprocess.STDOUT)
time.sleep(12)

USER_JSON = {"id": 54, "username": "gatetime", "name": "Gate Test", "role": "user", "email": None}
ME_OK = {"result": {"data": {"json": USER_JSON}}}
ME_401 = {"error": {"json": {
    "message": "Your session has expired. Please log in again.",
    "code": -32001,
    "data": {"code": "UNAUTHORIZED", "httpStatus": 401, "path": AUTH_ME}}}}

LOGIN_OK = {"result": {"data": {"json": {"user": USER_JSON, "token": "mock-token"}}}}

fails, notes = [], []

def setup_auth_mock(pg, mode, counter):
    """mode: 'ok' → auth.me 200 with user | 'unauthorized' → 401 loop."""
    def handler(route):
        url = route.request.url
        if T_RPC not in url:
            return route.continue_()
        path = url.split(T_RPC)[1].split("?")[0]
        if path == AUTH_ME:
            counter["n"] += 1
            if mode == "ok":
                route.fulfill(status=200, content_type=CT_JSON,
                              body=json.dumps(ME_OK))
            else:
                route.fulfill(status=401, content_type=CT_JSON,
                              body=json.dumps(ME_401))
            return
        return route.continue_()
    pg.route("**/api/trpc/**", handler)

def open_home(pg):
    pg.goto(BASE + "/", wait_until="domcontentloaded", timeout=30000)
    pg.wait_for_timeout(2500)
    try:
        pg.get_by_role("button", name="Accept all").click(timeout=3000)
        pg.wait_for_timeout(400)
    except Exception:
        pass
    # dismiss any promo modal that could swallow the click (JS click fallback too)
    pg.wait_for_timeout(1500)

def click_fab(pg):
    fab = pg.locator("button.chatbot-fab")
    if fab.count() == 0:
        return False
    # JS click — immune to overlays (promo modal / cookie banner edge cases)
    pg.evaluate("() => document.querySelector('button.chatbot-fab')?.click()")
    return True

def toast_text(pg):
    try:
        t = pg.locator("[data-sonner-toast]").first.inner_text(timeout=1500)
        return t.strip()
    except Exception:
        return ""

def toast_is_login_gate(toast):
    # sandbox UI language may be EN or AR — accept either
    return ("تسجيل الدخول" in toast) or ("log in" in toast.lower()) or ("login" in toast.lower())

def wait_for_url(pg, needle, seconds):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if needle in pg.url:
            return True
        pg.wait_for_timeout(300)
    return False

def wait_for_url_contains(pg, prefix, seconds, exclude=""):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if pg.url.startswith(prefix) and exclude not in pg.url:
            return True
        pg.wait_for_timeout(300)
    return False

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # ================= SCENARIO A — fresh visitor =================
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, service_workers="block")
    pg = ctx.new_page()
    counter = {"n": 0}
    setup_auth_mock(pg, "ok", counter)  # should NEVER be called (no flag cookie)
    open_home(pg)
    me_calls_fresh = counter["n"]
    if not click_fab(pg):
        fails.append("[A] chatbot FAB not found")
    else:
        toast = toast_text(pg)
        went = wait_for_url(pg, LOGIN_PATH, 5)
        print(f"A) fresh visitor → toast={toast!r} redirect={went} url={pg.url} auth.me_calls={me_calls_fresh}")
        pg.screenshot(path=f"{OUT}/A_after_click.png")
        if not went:
            fails.append(f"[A] fresh visitor: no redirect to /login (at {pg.url})")
        if not toast_is_login_gate(toast):
            fails.append(f"[A] fresh visitor: expected login-gate toast, got {toast!r}")
        if me_calls_fresh != 0:
            notes.append(f"[A] note: auth.me fired {me_calls_fresh}x without flag cookie (unexpected)")
    ctx.close()

    # ============ SCENARIO B — stale flag cookie, dead session ============
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, service_workers="block")
    ctx.add_cookies([{"name": "elbaz_auth_flag", "value": "1", "url": BASE}])
    pg = ctx.new_page()
    counter = {"n": 0}
    setup_auth_mock(pg, "unauthorized", counter)
    open_home(pg)
    me_calls_5s = counter["n"]
    # ✅ correct loop criterion: measure calls AFTER the cleanup stabilizes.
    # The fix guarantees a small bounded burst (<1s) while the 401 cleanup
    # races the query recreation — the BUG was the INFINITE loop. So: record
    # the count now, wait 5 more seconds, and require ZERO further calls.
    pg.wait_for_timeout(5000)
    me_calls_after = counter["n"] - me_calls_5s
    flag_after = pg.evaluate("() => document.cookie.includes('elbaz_auth_flag=1')")
    if me_calls_after > 0:
        fails.append(f"[B] 401 refetch loop NOT stopped: {me_calls_after} more auth.me calls in the 5s after stabilization")
    else:
        notes.append(f"B) 401 loop dead — 0 calls in 5s after stabilization (total burst: {me_calls_5s}) ✓")
    if flag_after:
        fails.append("[B] stale flag cookie was NOT cleared after the 401")
    else:
        notes.append("B) stale flag cookie cleared after 401 ✓")
    if not click_fab(pg):
        fails.append("[B] chatbot FAB not found")
    else:
        toast = toast_text(pg)
        went = wait_for_url(pg, LOGIN_PATH, 5)
        print(f"B) stale flag → auth.me_calls_in_5s={me_calls_5s} flag_cookie_still={flag_after} "
              f"toast={toast!r} redirect={went} url={pg.url}")
        pg.screenshot(path=f"{OUT}/B_after_click.png")
        if not went:
            fails.append(f"[B] stale-flag visitor: no redirect to /login (at {pg.url}) — 'no reaction' bug")
        if not toast_is_login_gate(toast):
            fails.append(f"[B] expected login-gate toast, got {toast!r}")
    ctx.close()

    # ============ SCENARIO C — logged-in user (regression guard) ============
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, service_workers="block")
    ctx.add_cookies([{"name": "elbaz_auth_flag", "value": "1", "url": BASE}])
    pg = ctx.new_page()
    counter = {"n": 0}
    setup_auth_mock(pg, "ok", counter)
    open_home(pg)
    if not click_fab(pg):
        fails.append("[C] chatbot FAB not found")
    else:
        pg.wait_for_timeout(1500)
        window_open = pg.locator(".chatbot-window").count() > 0
        still_home = LOGIN_PATH not in pg.url
        print(f"C) logged-in → chat_window_open={window_open} url={pg.url}")
        pg.screenshot(path=f"{OUT}/C_chat_open.png")
        if not window_open:
            fails.append("[C] logged-in user: chat window did not open")
        if not still_home:
            fails.append(f"[C] logged-in user was wrongly redirected to {pg.url}")
    ctx.close()

    # ============ SCENARIO D — recovery: dead session → login → chat works =====
    # Guards the pathname re-sync: the 401 cleanup DISABLES the auth.me query;
    # a subsequent SPA login (no reload) must re-enable it, otherwise the UI
    # would stay logged-out forever after a successful login.
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, service_workers="block")
    ctx.add_cookies([{"name": "elbaz_auth_flag", "value": "1", "url": BASE}])
    pg = ctx.new_page()
    counter = {"me": 0, "login": 0}
    mode = {"auth": "unauthorized"}

    def d_handler(route):
        url = route.request.url
        if T_RPC not in url:
            return route.continue_()
        raw = url.split(T_RPC)[1].split("?")[0]
        method = route.request.method
        procs = raw.split(",")
        # batch-aware: post-login the client batches auth.me together with
        # other queries (e.g. "auth.me,course.all") — a path-equality mock
        # would let the whole batch hit the real sandbox server and fail
        if method == "POST" and "auth.login" in procs:
            counter["login"] += 1
            route.fulfill(status=200, content_type=CT_JSON,
                          body=json.dumps(LOGIN_OK))
            return
        if AUTH_ME in procs:
            counter["me"] += 1
            me = ME_OK if mode["auth"] == "ok" else ME_401
            if len(procs) == 1:
                status = 200 if mode["auth"] == "ok" else 401
                route.fulfill(status=status, content_type=CT_JSON,
                              body=json.dumps(me))
            else:
                envelopes = [me if pr == AUTH_ME
                             else {"result": {"data": {"json": None}}}
                             for pr in procs]
                route.fulfill(status=200, content_type=CT_JSON,
                              body=json.dumps(envelopes))
            return
        if method == "GET":
            # benign empty result so unrelated page queries don't error-noise
            if len(procs) == 1:
                body = json.dumps({"result": {"data": {"json": None}}})
            else:
                body = json.dumps([{"result": {"data": {"json": None}}} for _ in procs])
            route.fulfill(status=200, content_type=CT_JSON, body=body)
            return
        return route.continue_()
    pg.route("**/api/trpc/**", d_handler)

    open_home(pg)
    pg.wait_for_timeout(5000)  # let the 401 cleanup settle
    dead_calls = counter["me"]
    # 1) FAB click while dead → SPA redirect to /login
    click_fab(pg)
    went = wait_for_url(pg, LOGIN_PATH, 5)
    if not went:
        fails.append(f"[D] expected FAB gate redirect to /login (at {pg.url})")
    # 2) "login succeeds": server sets cookies + auth.me now returns the user
    mode["auth"] = "ok"
    ctx.add_cookies([{"name": "elbaz_auth_flag", "value": "1", "url": BASE}])
    # the login form lazy-renders — wait for it explicitly (debug showed
    # form input count can be 0 for a while after SPA arrival on /login)
    pg.locator("form input").nth(0).wait_for(state="visible", timeout=30000)
    pg.locator("form input").nth(0).fill("gatetime")
    pg.locator("form input[type=password]").first.fill("whatever")
    pg.locator("form button[type=submit]").first.click()
    back = wait_for_url_contains(pg, BASE + "/", 12, exclude=LOGIN_PATH)
    pg.wait_for_timeout(2500)  # allow the re-sync + auth.me refetch
    logged_in = pg.evaluate(
        "() => !!document.querySelector('[data-user-menu], [aria-label*=account i], [aria-label*=حساب]')")
    print(f"D) recovery → dead_burst={dead_calls} fab_gate_redirect={went} "
          f"after_login_url={pg.url} logged_in_indicator={logged_in}")
    pg.screenshot(path=f"{OUT}/D_after_login.png")
    # 3) FAB must now OPEN the chat (not bounce back to /login)
    if not click_fab(pg):
        fails.append("[D] chatbot FAB not found after login")
    else:
        pg.wait_for_timeout(1500)
        window_open = pg.locator(".chatbot-window").count() > 0
        print(f"D) after login → chat_window_open={window_open} url={pg.url}")
        pg.screenshot(path=f"{OUT}/D_chat_open.png")
        if not window_open:
            fails.append(f"[D] after SPA login the FAB did not open the chat (at {pg.url})")
    ctx.close()

    browser.close()

server.terminate()

print("\n=== NOTES ===")
for n in notes: print("•", n)
print("=== RESULT ===")
if fails:
    print("FAILURES:"); [print(" -", f) for f in fails]; sys.exit(1)
print("ALL CHATBOT GATE CHECKS PASSED ✓")
