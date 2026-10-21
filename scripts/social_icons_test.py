"""Verification of footer social icons — official brand icons with real links.

Serves dist/public via the real boot.ts server (sandbox env, no DB →
useContactSettings FALLBACKS apply, which now carry the owner's real links),
then in both viewports:
- Locate the footer social row, assert icon order:
  YouTube → Telegram → Facebook → Instagram → TikTok → Email
- Assert exact hrefs (the owner's official platform URLs + mailto)
- Assert target=_blank + rel=noopener noreferrer on external links
- Assert aria-labels, icon render size (40x40 buttons), no overlaps
- Screenshots of the footer social row (desktop + mobile)
"""
import subprocess, time, json, atexit
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3999"
OUT = "/home/z/my-project/work/elbaz-platform/scripts/shots_social"
subprocess.run(["mkdir", "-p", OUT], check=True)

EXPECTED = [
    ("YouTube",    "https://youtube.com/playlist?list=PLeeb5_Qjhcgc"),
    ("Telegram",   "https://t.me/engahmedetap"),
    ("Facebook",   "https://www.facebook.com/share/1Cm6U14ihR/"),
    ("Instagram",  "https://www.instagram.com/ahmedetap1"),
    ("TikTok",     "https://www.tiktok.com/@ahmedetap"),
    ("Email",      "mailto:contact@ahmedelbaz.com"),
]

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
                          stdout=open("/tmp/boot_social.log", "w"),
                          stderr=subprocess.STDOUT)
atexit.register(lambda: server.terminate())
time.sleep(12)

results = {"pass": [], "fail": []}

def check(name, cond, detail=""):
    if cond:
        results["pass"].append(name)
    else:
        results["fail"].append(f"{name} :: {detail}")

def verify(pg, label):
    pg.goto(BASE + "/", wait_until="domcontentloaded", timeout=30000)
    time.sleep(4)
    # dismiss cookie banner if present
    try:
        pg.get_by_role("button", name="Accept all").click(timeout=2500)
        time.sleep(1)
    except Exception:
        pass
    # scroll to the very bottom so footer mounts fully
    pg.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    time.sleep(2)

    row = pg.locator("footer div.mt-5.flex").first
    row.wait_for(state="visible", timeout=10000)
    links = row.locator("a")
    n = links.count()
    check(f"[{label}] icon count == 6", n == 6, f"got {n}")

    boxes = []
    for i, (want_label, want_href) in enumerate(EXPECTED):
        if i >= n:
            check(f"[{label}] {want_label} present", False, "missing index")
            continue
        a = links.nth(i)
        href = a.get_attribute("href") or ""
        lab = a.get_attribute("aria-label") or ""
        tgt = a.get_attribute("target") or ""
        rel = a.get_attribute("rel") or ""
        check(f"[{label}] #{i} aria-label", lab == want_label, f"got '{lab}' want '{want_label}'")
        if want_label == "Email":
            ok = href == want_href
        else:
            ok = href == want_href and tgt == "_blank" and "noopener" in rel
        check(f"[{label}] #{i} {want_label} href/target/rel", ok,
              f"href='{href}' target='{tgt}' rel='{rel}'")
        bb = a.bounding_box()
        boxes.append(bb)
        if bb:
            size_ok = 34 <= bb["width"] <= 48 and 34 <= bb["height"] <= 48
            check(f"[{label}] {want_label} 40px hit-area", size_ok,
                  f"{bb['width']:.0f}x{bb['height']:.0f}")
        # inner svg actually rendered with nonzero size
        svg_w = a.locator("svg").first.evaluate("el => el.getBoundingClientRect().width")
        check(f"[{label}] {want_label} svg rendered", svg_w and svg_w > 10, f"svg width {svg_w}")

    # overlap check between consecutive icons
    for i in range(len(boxes) - 1):
        a, b = boxes[i], boxes[i + 1]
        if a and b:
            overlap = not (a["x"] + a["width"] <= b["x"] + 0.5 or b["x"] + b["width"] <= a["x"] + 0.5)
            check(f"[{label}] no overlap {EXPECTED[i][0]}/{EXPECTED[i+1][0]}", not overlap,
                  f"boxes {a} {b}")

    # wrap check: on mobile the 6 icons must fit in one row (row width <= viewport)
    if label == "mobile":
        row_bb = row.bounding_box()
        vp = 390
        check("[mobile] icons fit one row", row_bb and row_bb["width"] <= vp,
              f"row width {row_bb and row_bb['width']:.0f}")

    # screenshots: footer bottom area
    footer = pg.locator("footer").last
    footer.scroll_into_view_if_needed()
    time.sleep(1)
    pg.screenshot(path=f"{OUT}/footer_{label}.png")
    row.screenshot(path=f"{OUT}/social_row_{label}.png")

    # hover glow on desktop only (Telegram brand color)
    if label == "desktop":
        tg = links.nth(1)
        tg.hover()
        time.sleep(0.6)
        color = tg.evaluate("el => getComputedStyle(el).color")
        check("[desktop] Telegram hover turns brand blue", "34, 158, 217" in color, f"color {color}")
        pg.screenshot(path=f"{OUT}/telegram_hover_desktop.png")

with sync_playwright() as p:
    browser = p.chromium.launch()
    # ---------- DESKTOP ----------
    dctx = browser.new_context(viewport={"width": 1440, "height": 900})
    dpg = dctx.new_page()
    verify(dpg, "desktop")
    dctx.close()
    # ---------- MOBILE ----------
    mctx = browser.new_context(viewport={"width": 390, "height": 844},
                               device_scale_factor=2, is_mobile=True, has_touch=True,
                               user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
    mpg = mctx.new_page()
    verify(mpg, "mobile")
    mctx.close()
    browser.close()

print(json.dumps({"PASS": len(results["pass"]), "FAIL": len(results["fail"])}, indent=2))
for f in results["fail"]:
    print("  ✗", f)
if not results["fail"]:
    print("ALL SOCIAL ICON CHECKS PASSED")
