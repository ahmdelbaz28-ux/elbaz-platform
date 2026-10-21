"""LIVE production click-through verification — solid brand icons on https://ahmedelbaz.qzz.io
Requires Xvfb (:99) — Cloudflare passes headed Chromium only.
"""
import json, time
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

BASE = "https://ahmedelbaz.qzz.io"
OUT = "/home/z/my-project/work/elbaz-platform/scripts/shots_social"

EXPECTED = [
    ("YouTube",   "https://youtube.com/playlist?list=PLeeb5_Qjhcgc", "rgb(255, 0, 0)"),
    ("Telegram",  "https://t.me/engahmedetap",                       "rgb(34, 158, 217)"),
    ("Facebook",  "https://www.facebook.com/share/1Cm6U14ihR/",      "rgb(24, 119, 242)"),
    ("Instagram", "https://www.instagram.com/ahmedetap1",            "linear-gradient"),
    ("TikTok",    "https://www.tiktok.com/@ahmedetap",               "rgb(255, 255, 255)"),
    ("Email",     "mailto:contact@ahmedelbaz.com",                   "rgb(249, 115, 22)"),
]

def click_ok(platform, popup_url):
    u = urlparse(popup_url)
    host = u.netloc.lower()
    if platform == "YouTube":
        return host in ("youtube.com", "m.youtube.com", "www.youtube.com") and "PLeeb5_Qjhcgc" in popup_url
    if platform == "Telegram":
        return host == "t.me" and popup_url.startswith("https://t.me/engahmedetap")
    if platform == "Facebook":
        return host.endswith("facebook.com") and ("1Cm6U14ihR" in popup_url or "/share/" in popup_url)
    if platform == "Instagram":
        return host.endswith("instagram.com") and "ahmedetap1" in popup_url
    if platform == "TikTok":
        return host.endswith("tiktok.com")
    return False

results = {"pass": [], "fail": []}

def check(name, cond, detail=""):
    (results["pass"] if cond else results["fail"]).append(name if cond else f"{name} :: {detail}")

def verify(pg, ctx, label):
    for attempt in range(3):
        pg.goto(BASE + "/", wait_until="domcontentloaded", timeout=45000)
        time.sleep(10)
        if pg.locator("footer").count() > 0:
            break
        print(f"  … attempt {attempt+1} hit Cloudflare challenge, retrying")
        time.sleep(5)
    time.sleep(2)
    try:
        pg.get_by_role("button", name="Accept all").click(timeout=3000)
        time.sleep(1)
    except Exception:
        pass
    pg.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    time.sleep(3)

    row = pg.locator("footer div.mt-5.flex").first
    row.wait_for(state="visible", timeout=15000)
    links = row.locator("a")
    n = links.count()
    check(f"[{label}] 6 icons on PROD", n == 6, f"got {n}")

    for i, (want_label, want_href, want_bg) in enumerate(EXPECTED):
        if i >= n:
            check(f"[{label}] {want_label}", False, "missing")
            continue
        a = links.nth(i)
        href = a.get_attribute("href") or ""
        check(f"[{label}] {want_label} href", href == want_href, f"got '{href}'")

        bg = a.evaluate("el => { const s = getComputedStyle(el); return s.backgroundImage !== 'none' ? s.backgroundImage : s.backgroundColor; }")
        ok = ("linear-gradient" in bg) if want_bg == "linear-gradient" else (want_bg in bg)
        check(f"[{label}] {want_label} brand bg (PROD)", ok, f"got '{bg[:70]}'")

        shadow = a.evaluate("el => getComputedStyle(el).boxShadow")
        check(f"[{label}] {want_label} glow", shadow != "none", shadow[:50])

        if want_label != "Email":
            with ctx.expect_page(timeout=8000) as popup_info:
                a.click()
            popup = popup_info.value
            purl = popup.url
            check(f"[{label}] {want_label} LIVE CLICK → correct site", click_ok(want_label, purl), f"'{purl}'")
            popup.close()
            time.sleep(0.6)

    footer = pg.locator("footer").last
    footer.scroll_into_view_if_needed()
    time.sleep(1)
    pg.screenshot(path=f"{OUT}/PROD_solid_{label}.png")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False, args=["--disable-blink-features=AutomationControlled", "--no-sandbox"])
    d = browser.new_context(viewport={"width": 1440, "height": 900},
                            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
                            service_workers="block")
    verify(d.new_page(), d, "desktop")
    d.close()
    m = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                            is_mobile=True, has_touch=True, service_workers="block",
                            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
    verify(m.new_page(), m, "mobile")
    m.close()
    browser.close()

print(json.dumps({"PASS": len(results["pass"]), "FAIL": len(results["fail"])}, indent=2))
for f in results["fail"]:
    print("  ✗", f)
if not results["fail"]:
    print("PRODUCTION LIVE: SOLID BRAND ICONS + CLICK-THROUGH ALL CORRECT")
