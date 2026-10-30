"""LIVE E2E — Web Push toggle on production (ahmedelbaz.qzz.io), real Chromium.

Reproduces the user's exact path as a healthy browser would take it:
  login → open notification center → grant notifications permission →
  click the push toggle → capture [Push] console trail + row state + screenshots
  → verify subscription exists → toggle off (cleanup) → verify unsubscribed.

Answers: does pushManager.subscribe() succeed on a HEALTHY Chrome against
production (valid VAPID, valid SW)? If yes, the user's "browser refused"
failure is device/browser-specific and the fix is precise client diagnosis.

Run: DISPLAY=:99 python3 scripts/push_toggle_live_e2e.py
"""

import re
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


PROBE_STATE_JS = """
async () => {
  const out = {};
  try {
    if (!('serviceWorker' in navigator)) { out.sw = false; return out; }
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 12000)),
    ]);
    out.sw = true;
    out.scope = reg.scope;
    const sub = await reg.pushManager.getSubscription();
    out.subscribed = Boolean(sub);
    if (sub) out.endpointHost = new URL(sub.endpoint).host;
    out.perm = Notification.permission;
  } catch (e) { out.error = String(e.message || e).slice(0, 160); }
  return out;
}
"""

with sync_playwright() as p:
    # PERSISTENT context on purpose: Playwright's regular new_context() runs as
    # an incognito context, and Chrome DELIBERATELY refuses pushManager
    # subscriptions there (crbug.com/401439) — measured on this very flow.
    # A persistent profile is not incognito, so the real happy path is testable.
    import shutil
    profile_dir = "/tmp/push-e2e-profile"
    shutil.rmtree(profile_dir, ignore_errors=True)  # always a true first visit
    ctx = p.chromium.launch_persistent_context(
        profile_dir,
        headless=False,
        viewport={"width": 1280, "height": 850},
        user_agent=UA,
        args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    )
    ctx.grant_permissions(["notifications"], origin=PROD)
    pg = ctx.new_page()
    console_trail = []
    pg.on("console", lambda m: console_trail.append(f"{m.type}: {m.text}"))
    pg.on("pageerror", lambda e: console_trail.append(f"pageerror: {e}"))

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

    # ── 2. open the notification center panel ──
    bell = pg.locator("[data-notification-center] > button").first
    bell.click()
    pg.wait_for_timeout(1_500)
    dialog = pg.locator("[data-notification-center] [role=dialog]")
    check("panel opens", dialog.count() > 0 and dialog.first.is_visible())
    pg.screenshot(path=f"{OUT}/01-panel-before.png")

    # ── 3. push row state BEFORE ──
    row = dialog.locator("[role=switch]").first
    check("push row visible", row.count() > 0)
    before_state = pg.evaluate(PROBE_STATE_JS)
    print("   pre-toggle browser state:", before_state)
    before_pill = row.inner_text()
    print("   row text before:", before_pill.replace("\n", " | ")[:160])

    # ── 4. click the toggle ON ──
    t0 = time.time()
    row.click()
    # permission prompt may appear — Chromium with granted permission won't.
    # Wait for the row to settle (busy → final state) then verify.
    settled = False
    final_state = {}
    for _ in range(60):  # up to ~60s (subscribe may wait ~45s for SW activation)
        pg.wait_for_timeout(1_000)
        final_state = pg.evaluate(PROBE_STATE_JS)
        row_text = row.inner_text().replace("\n", " | ")
        busy = "جاري" in row_text or "Working" in row_text
        if not busy and (final_state.get("subscribed") or "error" in row_text.lower()
                         or "فشل" in row_text or time.time() - t0 > 50):
            settled = True
            break
    check("toggle settles", settled, f"after {time.time()-t0:.0f}s")
    print("   post-toggle browser state:", final_state)

    row_text = row.inner_text().replace("\n", " | ")
    print("   row text after:", row_text[:200])
    pg.screenshot(path=f"{OUT}/02-panel-after-toggle.png")

    check("subscription created", final_state.get("subscribed") is True,
          f"endpointHost={final_state.get('endpointHost')}")

    # server-side mirror: subscription endpoint stored? (visible via a fresh
    # getSubscription + the row pill "مفعّلة/On")
    check("row pill shows ON", ("مفعّلة" in row_text) or ("| On" in row_text or "On" in row_text),
          row_text[:120])

    # ── 5. console trail with [Push] markers ──
    push_logs = [l for l in console_trail if "[Push]" in l or "push" in l.lower()]
    print("--- console [Push] trail ---")
    for l in push_logs[-12:]:
        print("  ", l[:220])

    # ── 6. toggle OFF (cleanup) ──
    row.click()
    time.sleep(4)
    off_state = pg.evaluate(PROBE_STATE_JS)
    check("unsubscribed cleanly", off_state.get("subscribed") is False, str(off_state)[:160])
    pg.screenshot(path=f"{OUT}/03-panel-after-off.png")

    ctx.close()

fails = [n for n, ok in results if not ok]
print(f"\nRESULT: {len(results) - len(fails)}/{len(results)} passed" + (f" — FAILURES: {fails}" if fails else ""))
sys.exit(1 if fails else 0)
