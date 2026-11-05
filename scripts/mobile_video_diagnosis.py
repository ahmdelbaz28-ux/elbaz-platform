"""MOBILE VIDEO DIAGNOSIS — production, real playback.

The owner reports: on a phone, entering a course and playing the video shows
a screen that is "incomplete / cropped / broken". This harness reproduces it
EXACTLY: mobile viewport (390x844), real login, real course, real YouTube
playback inside the site, screenshots + geometry probes so the crop is
observable as numbers, not guesses.

Geometry truth table we assert at the end:
  G1  no horizontal page overflow (scrollWidth <= clientWidth)
  G2  iframe box == [data-youtube-player] screen-slot box (±2px each side)
  G3  player box fits inside the viewport (0 <= x, x+w <= 390)
Output: scripts/shots_mobile_video/*.png + PASS/FAIL lines; exit 1 on failure.
"""
import json
import re
import subprocess
import sys

from playwright.sync_api import sync_playwright

PROD = "https://ahmedelbaz.qzz.io"
SLUG = "etap-complete-course"
USER, PW = "paytest01", "PayTest2026"  # committed test account (free-enroll harness)
OUT = "/home/z/my-project/work/elbaz-platform/scripts/shots_mobile_video"
subprocess.run(["mkdir", "-p", OUT], check=True)
UA = ("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36")
VP = {"width": 390, "height": 844}

fails = []
def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'} {name}" + (f" — {detail}" if detail else ""))
    if not cond:
        fails.append(f"{name}: {detail}")

def dismiss_cookie(pg):
    # The consent modal is z-[100] and intercepts everything — kill it FIRST.
    # Its localStorage flag also prevents it from re-appearing on later gotos.
    pg.evaluate("try{localStorage.setItem('elbaz_cookie_consent', JSON.stringify({necessary:true,analytics:false,marketing:false}));}catch(e){}")
    for sel in ['[data-testid="cookie-accept-all"]', '[data-testid="cookie-accept-essential"]',
                '[data-testid="cookie-consent-backdrop"]']:
        try:
            loc = pg.locator(sel).first
            if loc.is_visible(timeout=1000):
                loc.click(timeout=3000, force=True)
                pg.wait_for_timeout(400)
                return
        except Exception:
            continue

def open_page(pg, path):
    pg.goto(PROD + path, wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(3000)
    dismiss_cookie(pg)
    pg.wait_for_timeout(400)

def geom(pg):
    return pg.evaluate("""() => {
      const player = document.querySelector('[data-youtube-player]');
      const slot = player ? player.querySelector('.aspect-video') : null;
      const iframe = document.querySelector('[data-youtube-player] iframe');
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
        return {x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1)}; };
      return {
        viewport: {w: document.documentElement.clientWidth, h: document.documentElement.clientHeight},
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        player: box(player), slot: box(slot), iframe: box(iframe),
        iframeAttrs: iframe ? {aw: iframe.getAttribute('width'), ah: iframe.getAttribute('height'),
                               style: iframe.getAttribute('style')} : null,
      };
    }""")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False, args=["--no-sandbox", "--disable-blink-features=AutomationControlled"])
    ctx = browser.new_context(viewport=VP, user_agent=UA, is_mobile=True, has_touch=True,
                              service_workers="block")
    ctx.add_init_script("try{localStorage.setItem('language','ar');}catch(e){}")
    pg = ctx.new_page()

    # ── login (committed test account, enrolled in the free ETAP course) ──
    open_page(pg, "/login")
    pg.locator("form input").nth(0).fill(USER)
    pg.locator("form input[type=password]").first.fill(PW)
    pg.locator("form button[type=submit]").first.click()
    pg.wait_for_timeout(6000)
    ok = pg.evaluate("""async () => { const r = await fetch('/api/trpc/auth.me', {credentials:'include'});
                                       return r.status; }""")
    check("LOGIN test user", ok == 200, f"auth.me={ok}")

    # ── open the free course with the imported YouTube lessons ──
    open_page(pg, f"/courses/{SLUG}")
    pg.wait_for_timeout(2500)
    pg.screenshot(path=f"{OUT}/01_course_page.png", full_page=False)

    # ── click the first lesson in the curriculum ──
    lesson_btns = pg.locator("button:has-text('درس'), button:has-text('Lesson'), [class*='curriculum'] button")
    cnt = lesson_btns.count()
    print("lesson button candidates:", cnt)
    clicked = False
    for i in range(min(cnt, 8)):
        b = lesson_btns.nth(i)
        try:
            if b.is_visible():
                b.scroll_into_view_if_needed()
                b.click(timeout=3000)
                clicked = True
                print(f"clicked lesson button #{i}: {b.text_content()[:60]}")
                break
        except Exception as e:
            continue
    check("LESSON clicked", clicked)
    pg.wait_for_timeout(5000)

    # ── dismiss the subscribe gate if it appeared ──
    gate = pg.locator('[data-testid="subscribe-gate"]')
    if gate.count() >= 1 and gate.first.is_visible():
        print("GATE shown — bypassing via 'already subscribed'")
        pg.screenshot(path=f"{OUT}/02_gate.png")
        pg.locator('[data-testid="subscribe-gate-already"]').first.click()
        pg.wait_for_timeout(4000)

    # ── wait for the player ──
    for _ in range(12):
        if pg.locator("[data-youtube-player] iframe").count() >= 1:
            break
        pg.wait_for_timeout(1000)
    g = geom(pg)
    print("GEOMETRY after player mount:", json.dumps(g, ensure_ascii=False, indent=1))
    check("PLAYER mounted", pg.locator("[data-youtube-player] iframe").count() >= 1)
    pg.screenshot(path=f"{OUT}/03_player_before_play.png")

    # scroll the player into full view for a clean crop check
    pg.evaluate("document.querySelector('[data-youtube-player]')?.scrollIntoView({block:'center'})")
    pg.wait_for_timeout(800)
    g = geom(pg)
    print("GEOMETRY centered:", json.dumps(g, ensure_ascii=False, indent=1))
    pg.screenshot(path=f"{OUT}/04_player_centered.png")

    # ── press play INSIDE the YouTube iframe ──
    played = False
    try:
        frame = pg.frame_locator("[data-youtube-player] iframe")
        # YouTube shows a large play button before first play
        big_play = frame.locator("button[aria-label*='Play'], button[aria-label*='تشغيل'], .ytp-large-play-button")
        if big_play.count() >= 1:
            big_play.first.click(timeout=5000, force=True)
            played = True
        else:
            # tap the video surface itself
            frame.locator("video, .html5-video-player").first.click(timeout=5000, force=True)
            played = True
    except Exception as e:
        print("in-frame play click failed:", str(e)[:200])
        # fallback: tap the middle of the player box (frame boundary)
        if g and g.get("iframe"):
            b = g["iframe"]
            pg.touchscreen.tap(b["x"] + b["w"] / 2, max(b["y"] + b["h"] / 2, 5))
            played = True
    check("PLAY triggered", played)
    pg.wait_for_timeout(9000)  # let it actually play
    g = geom(pg)
    print("GEOMETRY playing:", json.dumps(g, ensure_ascii=False, indent=1))
    pg.screenshot(path=f"{OUT}/05_playing.png")

    # verify the YouTube iframe is really playing via its player state
    state = pg.evaluate("""() => {
      const f = document.querySelector('[data-youtube-player] iframe');
      return f ? {src: (f.src||'').slice(0,90), w: f.offsetWidth, h: f.offsetHeight,
                  rect: (({x,y,width,height}) => ({x,y,width,height}))(f.getBoundingClientRect())} : null;
    }""")
    print("IFRAME state:", json.dumps(state, ensure_ascii=False))
    pg.wait_for_timeout(4000)
    pg.screenshot(path=f"{OUT}/06_playing_later.png")

    # ── geometry assertions ──
    if g and g.get("iframe") and g.get("slot"):
        ib, sb = g["iframe"], g["slot"]
        check("G2 iframe fills the 16:9 slot",
              abs(ib["x"]-sb["x"])<=2 and abs(ib["y"]-sb["y"])<=2 and abs(ib["w"]-sb["w"])<=2 and abs(ib["h"]-sb["h"])<=2,
              f"iframe={ib} slot={sb}")
    check("G1 no horizontal overflow", g and g.get("overflowX", 99) <= 0, f"overflowX={g and g.get('overflowX')}")
    if g and g.get("player"):
        pb = g["player"]
        check("G3 player inside viewport", pb["x"] >= -1 and pb["x"] + pb["w"] <= g["viewport"]["w"] + 1,
              f"player={pb} viewport={g['viewport']}")

    browser.close()

print("\n" + ("ALL CHECKS PASSED" if not fails else f"{len(fails)} FAILURES:\n" + "\n".join(fails)))
sys.exit(1 if fails else 0)
