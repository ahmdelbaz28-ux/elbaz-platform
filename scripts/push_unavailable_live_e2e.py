"""LIVE E2E — the honest "push unavailable on this device" card on production.

Simulates the user's 2026-10-30 report EXACTLY: a real Chromium on production
whose push backend refuses registration with the measured Chrome error
("AbortError: Registration failed - push service error" — device/network-level
FCM refusal). Everything else stays REAL: login, VAPID key fetch, service
worker, /push/subscribe, telemetry endpoint.

Verifies the radical-fix contract end to end:
  1. toggle press → busy → the honest CARD renders (not a red "Failed" switch)
  2. card contains: device/network cause copy, Telegram alternative link,
     opt-in retry button, tap-to-copy diagnostics line with the RAW error
  3. the refusal is REMEMBERED: localStorage elbaz_push_device_block +
     /api/notifications/push/failure-report reached the server (200)
  4. after a full reload the card is STILL there (no doomed toggle loop)
  5. "جرّب مرة تانية" retries opt-in-style and the card honestly returns

Run: DISPLAY=:99 python3 scripts/push_unavailable_live_e2e.py
"""

import re
import shutil
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

PROD = "https://ahmedelbaz.qzz.io"
OUT = "/home/z/my-project/download/push-fix"
USER, PW = "chatfix_live_01", "ChatFix2026X"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

subprocess.run(["mkdir", "-p", OUT], check=True)
results = []


def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'} {name}" + (f" — {detail}" if detail else ""))
    results.append((name, bool(cond)))


# Injected BEFORE any page script on every navigation: the ONLY fake is the
# push backend refusal — the exact measured Chrome DOMException.
STUB_JS = """
(() => {
  const refusal = () => new DOMException(
    'Registration failed - push service error', 'AbortError');
  PushManager.prototype.subscribe = function () {
    return Promise.reject(refusal());
  };
})();
"""

with sync_playwright() as p:
    # Persistent profile: regular Playwright contexts are incognito and Chrome
    # deliberately refuses push there (crbug.com/401439) — measured before.
    profile_dir = "/tmp/push-unavail-profile"
    shutil.rmtree(profile_dir, ignore_errors=True)
    ctx = p.chromium.launch_persistent_context(
        profile_dir,
        headless=False,
        viewport={"width": 1280, "height": 850},
        user_agent=UA,
        args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    )
    ctx.add_init_script(STUB_JS)
    ctx.grant_permissions(["notifications"], origin=PROD)
    pg = ctx.new_page()
    console_trail = []
    report_statuses = []
    pg.on("console", lambda m: console_trail.append(f"{m.type}: {m.text}"))
    pg.on("response", lambda r: report_statuses.append(r.status)
          if "/push/failure-report" in r.url else None)

    # ── 1. login ──
    pg.goto(PROD + "/login", wait_until="domcontentloaded", timeout=45_000)
    pg.wait_for_timeout(4_000)
    try:
        pg.get_by_role("button", name=re.compile("accept|موافق|قبول", re.I)).click(timeout=3_000)
    except Exception:
        pass
    pg.evaluate("() => document.querySelector('[data-testid=cookie-consent-backdrop]')?.click()")
    pg.wait_for_timeout(500)
    pg.locator("form input").nth(0).fill(USER)
    pg.locator("form input[type=password]").first.fill(PW)
    pg.locator("form button[type=submit]").first.click()
    pg.wait_for_timeout(6_000)
    me = pg.evaluate(
        "async () => { const r = await fetch('/api/trpc/auth.me', {credentials:'include'});"
        " return {s: r.status}; }"
    )
    check("login session", me["s"] == 200, f"status={me['s']}")

    # Clean slate: remove any remembered block from earlier runs.
    pg.evaluate("() => localStorage.removeItem('elbaz_push_device_block')")

    # ── 2. open the notification center ──
    bell = pg.locator("[data-notification-center] > button").first
    bell.click()
    pg.wait_for_timeout(1_500)
    dialog = pg.locator("[data-notification-center] [role=dialog]")
    check("panel opens", dialog.count() > 0 and dialog.first.is_visible())

    # ── 3. press the toggle → push backend refuses (stubbed) ──
    row = dialog.locator("[role=switch]").first
    # The row only renders after /public-key resolves + the SW mirror settles —
    # wait for it explicitly (a bare count() 1.5s after the click is a race).
    try:
        row.wait_for(state="visible", timeout=25_000)
        check("switch row visible (not yet blocked)", True)
    except Exception:
        check("switch row visible (not yet blocked)", False, "row never rendered in 25s")
    t0 = time.time()
    row.click()
    card = dialog.locator("[data-push-unavailable]").first
    card_up = False
    card_text = ""
    for _ in range(45):  # up to ~45s: key fetch + SW wait + classify
        pg.wait_for_timeout(1_000)
        if card.count() > 0 and card.is_visible():
            card_up = True
            card_text = card.inner_text().replace("\n", " | ")
            break
    check("honest unavailable card replaces the switch", card_up,
          f"after {time.time()-t0:.0f}s")
    pg.screenshot(path=f"{OUT}/04-unavailable-card.png")
    print("   card text:", card_text[:260])

    # 4a. pill says it is the device, not a generic failure
    check("pill names the device-level unavailability",
          ("غير متاحة على جهازك" in card_text) or ("Unavailable here" in card_text))
    # 4b. cause copy names device/network + the working alternative
    check("copy explains device/network cause",
          ("شبكة تانية" in card_text) or ("another network" in card_text))
    # 4c. Telegram alternative (the channel that DOES deliver closed-tab)
    tg = card.locator('a[href="https://t.me/engahmedetap"]')
    check("Telegram alternative link present", tg.count() > 0 and tg.first.is_visible())
    # 4d. opt-in retry affordance
    retry_btn = card.get_by_role("button", name=re.compile("جرّب|جرّب مرة تانية|Try again", re.I))
    check("opt-in retry button present", retry_btn.count() > 0)
    # 4e. raw diagnostics line (tap-to-copy) with the exact browser cause
    check("raw AbortError diagnostics shown",
          "AbortError" in card_text and "push service error" in card_text)
    # 4f. NO red "Failed" switch anymore — the old loop is gone
    check("old failure switch gone", dialog.locator("[role=switch]").count() == 0)

    # ── 5. the refusal is REMEMBERED + reported ──
    block = pg.evaluate(
        "() => JSON.parse(localStorage.getItem('elbaz_push_device_block') || 'null')")
    check("device block persisted (localStorage)",
          bool(block) and block.get("code") == "PUSH_SERVICE_UNAVAILABLE", str(block)[:140])
    check("failure-report reached the server (200)",
          any(s == 200 for s in report_statuses), f"statuses={report_statuses}")

    # ── 6. FULL reload → the card survives (no tempting broken toggle) ──
    pg.reload(wait_until="domcontentloaded")
    pg.wait_for_timeout(6_000)
    bell.click()
    pg.wait_for_timeout(1_500)
    card2 = dialog.locator("[data-push-unavailable]").first
    survived = card2.count() > 0 and card2.is_visible()
    check("card survives reload (remembered refusal)", survived)
    if survived:
        pg.screenshot(path=f"{OUT}/05-unavailable-after-reload.png")

    # ── 7. opt-in retry: clears the block, tries again, honestly returns ──
    if survived:
        retry_btn2 = card2.get_by_role("button", name=re.compile("جرّب|Try again", re.I)).first
        retry_btn2.click()
        pg.wait_for_timeout(9_000)
        card3 = dialog.locator("[data-push-unavailable]").first
        check("retry is opt-in and honest (card returns while device still refuses)",
              card3.count() > 0 and card3.is_visible())
        pg.screenshot(path=f"{OUT}/06-unavailable-after-retry.png")

    push_logs = [l for l in console_trail if "[Push]" in l]
    print("--- console [Push] trail (tail) ---")
    for l in push_logs[-6:]:
        print("  ", l[:200])

    ctx.close()

fails = [n for n, ok in results if not ok]
print(f"\nRESULT: {len(results) - len(fails)}/{len(results)} passed" + (f" — FAILURES: {fails}" if fails else ""))
sys.exit(1 if fails else 0)
