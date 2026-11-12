"""MOBILE-SIZE VIDEO DIAGNOSIS ON PRODUCTION — real login, real playback.

Cloudflare's bot rules choke on the mobile-UA context, so the harness uses the
same context shape as the previously-successful prod runs (desktop UA + Chrome
args + locale ar-EG) but at a 390px viewport — CSS renders exactly the phone
layout (width=device-width), which is what we're diagnosing.

Flow: login (paytest01, committed test account) → free ETAP course → first
lesson → bypass the subscribe gate → wait for the YouTube player → press play
→ screenshots + geometry (iframe vs 16:9 slot vs viewport) → verdict.
"""
import json
import re
import subprocess
import sys

from playwright.sync_api import sync_playwright
import os as _os
import sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from _gate_unlock import unlock_subscribe_gate

PROD = "https://ahmedelbaz.qzz.io"
SLUG = "etap-complete-course"
USER, PW = "paytest01", "PayTest2026"  # committed test account (free-enroll harness)
OUT = "/home/z/my-project/work/elbaz-platform/scripts/shots_mobile_video"
subprocess.run(["mkdir", "-p", OUT], check=True)
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
VP = {"width": 390, "height": 844}

fails = []
def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'} {name}" + (f" — {detail}" if detail else ""))
    if not cond:
        fails.append(f"{name}: {detail}")

def pass_cf(pg):
    for _ in range(15):
        try:
            t = pg.title()
            if "لحظة" not in t and "moment" not in t.lower():
                return True
        except Exception:
            pass
        pg.wait_for_timeout(2000)
    return False

def dismiss_cookie(pg):
    for round_ in range(3):
        pg.evaluate("try{localStorage.setItem('elbaz_cookie_consent', JSON.stringify({necessary:true,analytics:false,marketing:false}));}catch(e){}")
        gone = True
        for sel in ['[data-testid="cookie-accept-all"]', '[data-testid="cookie-accept-essential"]',
                    '[data-testid="cookie-consent-backdrop"]']:
            try:
                loc = pg.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.click(timeout=2500, force=True)
                    pg.wait_for_timeout(400)
                    gone = False
            except Exception:
                continue
        if gone:
            return

def geom(pg):
    return pg.evaluate("""() => {
      const player = document.querySelector('[data-youtube-player]');
      const slot = player ? player.querySelector('.aspect-video') : null;
      const iframe = document.querySelector('[data-youtube-player] iframe');
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
        return {x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1)}; };
      return {vw: document.documentElement.clientWidth,
              overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              player: box(player), slot: box(slot), iframe: box(iframe),
              iframeAllow: iframe ? {allowfullscreen: iframe.hasAttribute('allowfullscreen'),
                                     allow: iframe.getAttribute('allow')} : null};
    }""")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False,
        args=["--disable-blink-features=AutomationControlled", "--no-sandbox",
              "--autoplay-policy=no-user-gesture-required"])
    ctx = browser.new_context(viewport=VP, user_agent=UA, service_workers="block", locale="ar-EG")
    ctx.add_init_script("try{localStorage.setItem('language','ar');}catch(e){}")
    pg = ctx.new_page()

    # ── login ──
    pg.goto(PROD + "/login", wait_until="domcontentloaded", timeout=60000)
    check("CF passed (login page)", pass_cf(pg), pg.title()[:40])
    dismiss_cookie(pg)
    pg.locator("form input").nth(0).fill(USER)
    pg.locator("form input[type=password]").first.fill(PW)
    pg.locator("form button[type=submit]").first.click()
    pg.wait_for_timeout(7000)
    ok = pg.evaluate("async()=>{const r=await fetch('/api/trpc/auth.me',{credentials:'include'});return r.status;}")
    check("LOGIN test user", ok == 200, f"auth.me={ok}")
    pg.screenshot(path=f"{OUT}/p0_after_login.png")

    # ── course page ──
    pg.goto(PROD + f"/courses/{SLUG}", wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(6000)
    dismiss_cookie(pg)
    pg.screenshot(path=f"{OUT}/p1_course.png")

    # click lesson #1 (dismiss any consent modal that may have re-rendered)
    dismiss_cookie(pg)
    rows = pg.locator("button:has(p)")
    clicked = False
    for i in range(min(rows.count(), 12)):
        t = " ".join((rows.nth(i).text_content() or "").split())
        if t.startswith("1."):
            rows.nth(i).scroll_into_view_if_needed()
            rows.nth(i).click(timeout=4000)
            clicked = True
            print("clicked:", t[:70])
            break
    check("LESSON clicked", clicked)
    pg.wait_for_timeout(4500)

    gate = pg.locator('[data-testid="subscribe-gate"]')
    if gate.count() >= 1 and gate.first.is_visible():
        print("gate shown → enforced subscribe flow (open → confirm)")
        pg.screenshot(path=f"{OUT}/p2_gate.png")
        unlock_subscribe_gate(pg, wait_ms=4000)

    for _ in range(15):
        if pg.locator("[data-youtube-player] iframe").count() >= 1:
            break
        pg.wait_for_timeout(1000)
    check("PLAYER iframe mounted", pg.locator("[data-youtube-player] iframe").count() >= 1)
    failui = pg.get_by_text("ماتحمّلش").count()
    print("failed-UI visible:", failui)
    pg.evaluate("document.querySelector('[data-youtube-player]')?.scrollIntoView({block:'center'})")
    pg.wait_for_timeout(700)
    g0 = geom(pg)
    print("GEOMETRY pre-play:", json.dumps(g0))
    pg.screenshot(path=f"{OUT}/p3_before_play.png")

    # press play inside the iframe
    played = False
    try:
        frame = pg.frame_locator("[data-youtube-player] iframe")
        btn = frame.locator(".ytp-large-play-button, button[aria-label*='Play'], button[aria-label*='تشغيل']")
        if btn.count() >= 1:
            btn.first.click(timeout=6000)
            played = True
        else:
            frame.locator("video").first.click(timeout=4000)
            played = True
    except Exception as e:
        print("frame click failed:", str(e)[:150])
    check("PLAY clicked", played)
    pg.wait_for_timeout(10000)
    g1 = geom(pg)
    print("GEOMETRY playing:", json.dumps(g1))
    print("iframe allow attrs:", json.dumps(g1.get("iframeAllow")))
    pg.screenshot(path=f"{OUT}/p4_playing_10s.png")
    pg.wait_for_timeout(8000)
    pg.screenshot(path=f"{OUT}/p5_playing_18s.png")

    # ── verdicts ──
    if g1 and g1.get("iframe") and g1.get("slot"):
        ib, sb = g1["iframe"], g1["slot"]
        check("G2 iframe fills the 16:9 slot",
              abs(ib["x"]-sb["x"])<=2 and abs(ib["y"]-sb["y"])<=2 and abs(ib["w"]-sb["w"])<=2 and abs(ib["h"]-sb["h"])<=2,
              f"iframe={ib} slot={sb}")
        check("G3 player inside 390px viewport", ib["x"] >= -1 and ib["x"]+ib["w"] <= g1["vw"]+1,
              f"iframe={ib} vw={g1['vw']}")
    check("G1 no horizontal overflow", g1 and g1.get("overflowX", 99) <= 0, f"overflowX={g1 and g1.get('overflowX')}")

    browser.close()

print("\n" + ("ALL CHECKS PASSED" if not fails else f"{len(fails)} FAILURES:\n" + "\n".join(fails)))
sys.exit(1 if fails else 0)
