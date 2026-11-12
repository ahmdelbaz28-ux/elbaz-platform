"""Playback proof v2 — patient retry until the YT player mounts, then play."""
import json, re
from playwright.sync_api import sync_playwright

PROD = "https://ahmedelbaz.qzz.io"
# Private state dir (0700) inside the repo — never /tmp (world-writable):
# the admin session state and browser profiles contain REAL credentials.
from pathlib import Path as _Path
STATE_DIR = _Path(__file__).resolve().parent.parent / ".local" / "state"
STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
OUT = "/home/z/my-project/download"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

def pass_cloudflare(pg):
    for _ in range(6):
        try:
            title = pg.title()
        except Exception:
            title = ""
        if "لحظة" not in title and "moment" not in title.lower():
            return True
        try:
            bb = pg.locator("iframe[src*='challenges.cloudflare.com']").first.bounding_box(timeout=3000)
            if bb:
                pg.mouse.click(bb["x"] + 32, bb["y"] + bb["height"] / 2)
        except Exception:
            pass
        pg.wait_for_timeout(6000)
    return False  # retries exhausted — challenge still active

def find_yt_frame(pg):
    for f in pg.frames:
        if "youtube-nocookie" in (f.url or ""):
            return f
    return None

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False,
        args=["--disable-blink-features=AutomationControlled", "--no-sandbox",
              "--autoplay-policy=no-user-gesture-required"])
    ctx = browser.new_context(viewport={"width": 1440, "height": 900},
                              user_agent=UA, locale="ar-EG", service_workers="block",
                              storage_state=str(STATE_DIR / "prod_admin_state.json"))
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(f"pageerror: {str(e)[:120]}"))
    pg.on("console", lambda m: errors.append(f"console.{m.type}: {m.text[:140]}")
          if m.type in ("error",) else None)

    mounted = False
    for attempt in range(4):
        if attempt == 0:
            pg.goto(PROD + "/courses/etap-complete-course", wait_until="domcontentloaded", timeout=60000)
        else:
            print(f"reload #{attempt} — player didn't mount yet")
            pg.reload(wait_until="domcontentloaded", timeout=60000)
        if not pass_cloudflare(pg):
            raise SystemExit("Cloudflare challenge not passed — playback proof aborted")
        pg.wait_for_timeout(6000)

        yt = None
        for _ in range(25):  # up to ~50s for the player to mount
            yt = find_yt_frame(pg)
            if yt:
                try:
                    btn = yt.locator("button.ytp-large-play-button")
                    if btn.count() > 0 and btn.first.is_visible():
                        mounted = True
                        break
                except Exception:
                    pass
            fallback_visible = pg.get_by_text("The embedded player couldn't load").count() > 0
            if fallback_visible:
                print("  site fallback showing — player failed to mount this round")
                break
            pg.wait_for_timeout(2000)
        if mounted:
            break

    print("player mounted:", mounted)
    if errors:
        print("page errors (head):")
        for e in errors[:6]:
            print("  ·", e)

    state = {}
    if mounted:
        yt = find_yt_frame(pg)
        try:
            yt.locator("button.ytp-large-play-button").first.click(timeout=8000)
            print("clicked large play button")
        except Exception as e:
            print("click failed:", str(e)[:80])
        for _ in range(15):
            pg.wait_for_timeout(2000)
            try:
                state = yt.evaluate("""() => {
                    const v = document.querySelector('video');
                    if (!v) return {found: false};
                    return {found: true, paused: v.paused, time: v.currentTime,
                            duration: v.duration, w: v.videoWidth, h: v.videoHeight};
                }""")
            except Exception as e:
                state = {"err": str(e)[:80]}
            if state.get("found") and not state.get("paused", True) and state.get("time", 0) > 0.5:
                break
        print("state:", json.dumps(state))
        playing = state.get("found") and not state.get("paused", True) and state.get("time", 0) > 0.5
        print("PLAYING ✓" if playing else "NOT PLAYING ✗")

        pg.screenshot(path=f"{OUT}/yt_playing_prod.png")
        pg.wait_for_timeout(2500)
        pg.screenshot(path=f"{OUT}/yt_playing_prod_2.png")
        try:
            bb = pg.locator("iframe[src*='youtube-nocookie']").first.bounding_box(timeout=5000)
            if bb:
                pg.screenshot(path=f"{OUT}/yt_playing_prod_zoom.png",
                              clip={"x": max(0, bb["x"] - 8), "y": max(0, bb["y"] - 8),
                                    "width": min(1432, bb["width"] + 16), "height": min(892, bb["height"] + 16)})
        except Exception:
            pass
        print("screenshots saved")
    browser.close()
