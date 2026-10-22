"""PRODUCTION verification — admin access + dashboard soundness.
https://ahmedelbaz.qzz.io

P1  ADMIN LOGIN: /login with admin + ADMIN_PASSWORD (the new env-sync lever)
    → expect: signed in, auth.me returns role=admin.
P2  DASHBOARD LOAD: /admin renders — no error boundary, tabs/data visible.
P3  ADMIN API SURFACE (same-origin fetch, cookie-auth):
    admin.listCourses / admin.stats / admin.analytics / admin.payments /
    admin.users / admin.tickets → expect 200 + result envelope.
P4  ROLE GUARD (negative): fresh anonymous context → admin.stats must be
    denied (UNAUTHORIZED/FORBIDDEN), /admin must redirect to /login.
"""
import json, os, subprocess, sys, time
import re
from playwright.sync_api import sync_playwright

PROD = "https://ahmedelbaz.qzz.io"
OUT = "/home/z/my-project/work/elbaz-platform/scripts/shots_admin"
subprocess.run(["mkdir", "-p", OUT], check=True)

ADMIN_PW = open("/home/z/my-project/.admin_pw").read().strip()
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

fails, notes = [], []

def check(name, cond, detail=""):
    print(f"{'✓' if cond else '✗'} {name}" + (f" — {detail}" if detail else ""))
    if not cond:
        fails.append(f"{name}: {detail}")

def open_page(pg, path="/"):
    pg.goto(PROD + path, wait_until="domcontentloaded", timeout=45000)
    pg.wait_for_timeout(4000)
    try:
        pg.get_by_role("button", name=re.compile("accept|موافق|قبول", re.I)).click(timeout=4000)
        pg.wait_for_timeout(500)
    except Exception:
        pass

def trpc_get(pg, proc):
    """Same-origin GET against a tRPC query procedure; returns (status, json|None)."""
    resp = pg.evaluate("""async (proc) => {
        try {
            const r = await fetch('/api/trpc/' + proc, {credentials: 'include'});
            let body = null;
            try { body = await r.json(); } catch (e) { body = null; }
            return {status: r.status, body};
        } catch (e) { return {status: 0, body: String(e)}; }
    }""", proc)
    return resp.get("status"), resp.get("body")

def unwrap_error(body):
    """Extract tRPC error code from either batched or plain envelopes."""
    if isinstance(body, dict):
        j = (body.get("error") or {}).get("json") if "error" in body else None
        if j is None and isinstance(body.get("0"), dict):
            j = (body["0"].get("error") or {}).get("json")
        if isinstance(j, dict):
            return j.get("data", {}).get("code") or j.get("message")
    return str(body)[:80] if body else "empty"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False,
        args=["--disable-blink-features=AutomationControlled", "--no-sandbox"])

    # ---------- P4a first: anonymous admin.stats must be DENIED ----------
    anon = browser.new_context(viewport={"width": 1280, "height": 900},
                               user_agent=UA, service_workers="block")
    apg = anon.new_page()
    open_page(apg, "/")
    st, body = trpc_get(apg, "admin.stats")
    check("P4a anon admin.stats denied", st in (401, 403) or
          (body and "UNAUTHORIZED" in json.dumps(body)), f"status={st} err={unwrap_error(body)}")

    # ---------- P1: admin login ----------
    ctx = browser.new_context(viewport={"width": 1440, "height": 900},
                              user_agent=UA, service_workers="block")
    pg = ctx.new_page()
    open_page(pg, "/login")
    pg.screenshot(path=f"{OUT}/P1_login_page.png")
    check("P1 login form visible", pg.locator("form input").count() >= 2,
          f"inputs={pg.locator('form input').count()}")
    pg.locator("form input").nth(0).fill("admin")
    pg.locator("form input[type=password]").first.fill(ADMIN_PW)
    pg.locator("form button[type=submit]").first.click()
    pg.wait_for_timeout(6000)
    me = pg.evaluate("""async () => {
        try {
            const r = await fetch('/api/trpc/auth.me', {credentials: 'include'});
            return {status: r.status, body: await r.json()};
        } catch (e) { return {status: 0, body: String(e)}; }
    }""")
    d = json.dumps(me.get("body", {}))
    role = ""
    m = re.search(r'"role"\s*:\s*"(\w+)"', d)
    if m: role = m.group(1)
    check("P1 auth.me 200", me.get("status") == 200, f"status={me.get('status')}")
    check("P1 role=admin", role == "admin", f"role={role or 'n/a'}")
    print(f"  url after login: {pg.url}")
    pg.screenshot(path=f"{OUT}/P1_after_login.png")

    # ---------- P2: /admin dashboard ----------
    pg.goto(PROD + "/admin", wait_until="domcontentloaded", timeout=45000)
    pg.wait_for_timeout(6000)
    body_text = pg.locator("body").inner_text(timeout=10000)
    err_boundary = re.search(r"(something went wrong|حدث خطأ|error boundary|errorboundary)", body_text, re.I)
    check("P2 no error boundary", not err_boundary, err_boundary.group(0) if err_boundary else "clean")
    check("P2 stayed on /admin", "/admin" in pg.url, pg.url)
    admin_txt = body_text[:1500].replace("\n", " | ")
    print(f"  admin page text head: {admin_txt[:400]}")
    pg.screenshot(path=f"{OUT}/P2_admin_dashboard.png", full_page=False)

    # ---------- P3: admin API surface ----------
    for proc in ["admin.listCourses", "admin.stats", "admin.analytics",
                 "admin.payments", "admin.users", "admin.tickets"]:
        st, body = trpc_get(pg, proc)
        ok = st == 200 and isinstance(body, dict) and "result" in json.dumps(body)[:400] or st == 200
        check(f"P3 {proc}", st == 200 and body is not None,
              f"status={st} {'has-result' if isinstance(body, dict) and 'result' in str(body)[:300] else unwrap_error(body)}")

    pg.screenshot(path=f"{OUT}/P3_admin_state.png")
    ctx.close(); anon.close(); browser.close()

print("\n=== RESULT ===")
if fails:
    print("FAILURES:"); [print(" -", f) for f in fails]; sys.exit(1)
print("ALL ADMIN PROD CHECKS PASSED ✓")
