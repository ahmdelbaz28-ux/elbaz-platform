"""LIVE production verification of footer social icons on https://ahmedelbaz.qzz.io"""
import json
from playwright.sync_api import sync_playwright

BASE = "https://ahmedelbaz.qzz.io"
OUT = "/home/z/my-project/work/elbaz-platform/scripts/shots_social"

EXPECTED = [
    ("YouTube",    "https://youtube.com/playlist?list=PLeeb5_Qjhcgc"),
    ("Telegram",   "https://t.me/engahmedetap"),
    ("Facebook",   "https://www.facebook.com/share/1Cm6U14ihR/"),
    ("Instagram",  "https://www.instagram.com/ahmedetap1"),
    ("TikTok",     "https://www.tiktok.com/@ahmedetap"),
    ("Email",      "mailto:contact@ahmedelbaz.com"),
]

results = {"pass": [], "fail": []}

def check(name, cond, detail=""):
    (results["pass"] if cond else results["fail"]).append(name if cond else f"{name} :: {detail}")

def verify(pg, label):
    pg.goto(BASE + "/", wait_until="domcontentloaded", timeout=45000)
    time.sleep(10)
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

    for i, (want_label, want_href) in enumerate(EXPECTED):
        if i >= n:
            check(f"[{label}] {want_label}", False, "missing")
            continue
        a = links.nth(i)
        href = a.get_attribute("href") or ""
        lab = a.get_attribute("aria-label") or ""
        tgt = a.get_attribute("target") or ""
        ok = href == want_href and lab == want_label and (tgt == "_blank" or want_label == "Email")
        check(f"[{label}] {want_label} PROD href+label+target", ok, f"href='{href}' label='{lab}' tgt='{tgt}'")
        sw = a.locator("svg").first.evaluate("el => el.getBoundingClientRect().width")
        check(f"[{label}] {want_label} svg visible", sw and sw > 10, f"{sw}")

    footer = pg.locator("footer").last
    footer.scroll_into_view_if_needed()
    time.sleep(1)
    pg.screenshot(path=f"{OUT}/PROD_footer_{label}.png")

import time
with sync_playwright() as p:
    browser = p.chromium.launch(headless=False, args=["--disable-blink-features=AutomationControlled", "--no-sandbox"])
    d = browser.new_context(viewport={"width": 1440, "height": 900},
                            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
                            service_workers="block")
    verify(d.new_page(), "desktop")
    d.close()
    m = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                            is_mobile=True, has_touch=True, service_workers="block",
                            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
    verify(m.new_page(), "mobile")
    m.close()
    browser.close()

print(json.dumps({"PASS": len(results["pass"]), "FAIL": len(results["fail"])}, indent=2))
for f in results["fail"]:
    print("  ✗", f)
if not results["fail"]:
    print("PRODUCTION LIVE CHECK: ALL SOCIAL ICONS CORRECT")
