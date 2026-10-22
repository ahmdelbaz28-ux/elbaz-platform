"""PRODUCTION verification — chatbot FAB auth gate on https://ahmedelbaz.qzz.io
Scenario 1 (fresh): no cookies → FAB click → toast + /login redirect, 0 auth.me.
Scenario 2 (stale flag): elbaz_auth_flag=1 + dead session → bounded 401s
   (counted via performance resource entries — SW-proof), FAB click → /login.
"""
import subprocess, sys, time, json
from playwright.sync_api import sync_playwright

PROD = "https://ahmedelbaz.qzz.io"
OUT = "/home/z/my-project/work/elbaz-platform/scripts/shots_chatgate"
subprocess.run(["mkdir", "-p", OUT], check=True)

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

fails, notes = [], []

def me_count(pg):
    return pg.evaluate("""() => performance.getEntriesByType('resource')
        .filter(e => e.name.includes('/api/trpc/auth.me')).length""")

def open_home(pg):
    pg.goto(PROD + "/", wait_until="domcontentloaded", timeout=45000)
    pg.wait_for_timeout(4000)
    try:
        pg.get_by_role("button", name=re.compile("accept|موافق|قبول", re.I)).click(timeout=4000)
        pg.wait_for_timeout(500)
    except Exception:
        pass

import re

def click_fab(pg):
    if pg.locator("button.chatbot-fab").count() == 0:
        return False
    pg.evaluate("() => document.querySelector('button.chatbot-fab')?.click()")
    return True

def toast_text(pg):
    try:
        return pg.locator("[data-sonner-toast]").first.inner_text(timeout=2000).strip()
    except Exception:
        return ""

def wait_url(pg, needle, seconds):
    dl = time.time() + seconds
    while time.time() < dl:
        if needle in pg.url:
            return True
        pg.wait_for_timeout(300)
    return False

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False, args=["--disable-blink-features=AutomationControlled", "--no-sandbox"])

    # ---------- Scenario 1: fresh visitor ----------
    ctx = browser.new_context(viewport={"width": 1280, "height": 900},
                              user_agent=UA, service_workers="block")
    pg = ctx.new_page()
    open_home(pg)
    c0 = me_count(pg)
    if not click_fab(pg):
        fails.append("[P1] FAB not found on production home")
    else:
        toast = toast_text(pg)
        went = wait_url(pg, "/login", 6)
        c1 = me_count(pg)
        print(f"P1 fresh → auth.me={c1} toast={toast!r} redirect={went} url={pg.url}")
        pg.screenshot(path=f"{OUT}/P1_fresh_login.png")
        if not went:
            fails.append(f"[P1] no /login redirect (at {pg.url})")
        if not (("تسجيل" in toast) or ("log in" in toast.lower())):
            fails.append(f"[P1] no gate toast, got {toast!r}")
        if c1 > 1:
            fails.append(f"[P1] fresh visitor fired {c1} auth.me calls (expected 0-1)")
    ctx.close()

    # ---------- Scenario 2: stale flag cookie + dead session ----------
    ctx = browser.new_context(viewport={"width": 1280, "height": 900},
                              user_agent=UA, service_workers="block")
    ctx.add_cookies([{"name": "elbaz_auth_flag", "value": "1",
                      "domain": "ahmedelbaz.qzz.io", "path": "/"}])
    pg = ctx.new_page()
    open_home(pg)
    pg.wait_for_timeout(6000)  # let any 401 cycle settle
    c_settled = me_count(pg)
    flag = pg.evaluate("() => document.cookie.includes('elbaz_auth_flag=1')")
    if not click_fab(pg):
        fails.append("[P2] FAB not found (stale-flag)")
    else:
        toast = toast_text(pg)
        went = wait_url(pg, "/login", 6)
        time.sleep(3)
        c_final = me_count(pg)
        print(f"P2 stale → auth.me settled={c_settled} final={c_final} "
              f"flag_cleared={not flag} toast={toast!r} redirect={went} url={pg.url}")
        pg.screenshot(path=f"{OUT}/P2_stale_login.png")
        if c_final - c_settled > 2:
            fails.append(f"[P2] refetch loop alive: {c_final - c_settled} auth.me calls after settle")
        else:
            notes.append(f"P2 loop dead — {c_settled}→{c_final} auth.me calls ✓")
        if not went:
            fails.append(f"[P2] no /login redirect (at {pg.url})")
    ctx.close()

    browser.close()

print("\n=== NOTES ===")
for n in notes: print("•", n)
print("=== RESULT ===")
if fails:
    print("FAILURES:"); [print(" -", f) for f in fails]; sys.exit(1)
print("PRODUCTION VERIFICATION PASSED ✓")
