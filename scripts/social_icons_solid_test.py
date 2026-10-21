"""Verification of solid brand-colored social icons + CLICK-THROUGH test.

Serves dist/public via the real boot.ts server (sandbox env), then:
- Assert each of the 6 footer buttons has its OFFICIAL brand background
  (solid color or Instagram gradient) + a visible glow shadow → pops on dark bg
- CLICK each icon, capture the opened popup tab, assert its URL matches the
  official platform link (the actual user journey, not just the href attr)
- Email is mailto: → assert href only
- Desktop + mobile screenshots
"""
import subprocess, time, json, atexit
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

def click_ok(platform, popup_url):
    """Platform-side redirects (m.youtube.com, IG login?next=, TikTok bot-wall)
    are normal — accept when the destination domain + deep-link identity match."""
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
        return host.endswith("tiktok.com")  # headless traffic may hit the bot-wall; href is exact-checked separately
    return False

BASE = "http://127.0.0.1:3999"
OUT = "/home/z/my-project/work/elbaz-platform/scripts/shots_social"
subprocess.run(["mkdir", "-p", OUT], check=True)

EXPECTED = [
    ("YouTube",   "https://youtube.com/playlist?list=PLeeb5_Qjhcgc", "rgb(255, 0, 0)"),
    ("Telegram",  "https://t.me/engahmedetap",                       "rgb(34, 158, 217)"),
    ("Facebook",  "https://www.facebook.com/share/1Cm6U14ihR/",      "rgb(24, 119, 242)"),
    ("Instagram", "https://www.instagram.com/ahmedetap1",            "linear-gradient"),
    ("TikTok",    "https://www.tiktok.com/@ahmedetap",               "rgb(255, 255, 255)"),
    ("Email",     "mailto:contact@ahmedelbaz.com",                   "rgb(249, 115, 22)"),
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
                          stdout=open("/tmp/boot_social2.log", "w"),
                          stderr=subprocess.STDOUT)
atexit.register(lambda: server.terminate())
time.sleep(12)

results = {"pass": [], "fail": []}

def check(name, cond, detail=""):
    (results["pass"] if cond else results["fail"]).append(name if cond else f"{name} :: {detail}")

def verify(pg, ctx, label):
    pg.goto(BASE + "/", wait_until="domcontentloaded", timeout=30000)
    time.sleep(4)
    try:
        pg.get_by_role("button", name="Accept all").click(timeout=2500)
        time.sleep(1)
    except Exception:
        pass
    pg.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    time.sleep(2)

    row = pg.locator("footer div.mt-5.flex").first
    row.wait_for(state="visible", timeout=10000)
    links = row.locator("a")
    n = links.count()
    check(f"[{label}] 6 solid-brand icons", n == 6, f"got {n}")

    for i, (want_label, want_href, want_bg) in enumerate(EXPECTED):
        if i >= n:
            check(f"[{label}] {want_label}", False, "missing")
            continue
        a = links.nth(i)
        href = a.get_attribute("href") or ""
        check(f"[{label}] {want_label} href", href == want_href, f"got '{href}'")

        # computed background must be the official brand color/gradient
        bg = a.evaluate("el => { const s = getComputedStyle(el); return s.backgroundImage !== 'none' ? s.backgroundImage : s.backgroundColor; }")
        if want_bg == "linear-gradient":
            ok = "linear-gradient" in bg
        else:
            ok = want_bg in bg
        check(f"[{label}] {want_label} brand bg", ok, f"got '{bg[:80]}'")

        # glow shadow must exist (distinctive vs background)
        shadow = a.evaluate("el => getComputedStyle(el).boxShadow")
        check(f"[{label}] {want_label} glow shadow", "rgba" in shadow and shadow != "none", f"'{shadow[:60]}'")

        # glyph color: white (or black on TikTok's white bg)
        color = a.evaluate("el => getComputedStyle(el).color")
        want_fg = "rgb(1, 1, 1)" if want_label == "TikTok" else "rgb(255, 255, 255)"
        check(f"[{label}] {want_label} glyph color", want_fg in color, f"got '{color}'")

        # ── ACTUAL CLICK TEST: open popup, verify destination ──
        if want_label != "Email":
            with ctx.expect_page(timeout=6000) as popup_info:
                a.click()
            popup = popup_info.value
            popup_url = popup.url
            check(f"[{label}] {want_label} CLICK → correct site",
                  click_ok(want_label, popup_url),
                  f"popup url '{popup_url}'")
            popup.close()
            time.sleep(0.5)
        else:
            check(f"[{label}] Email mailto href", href.startswith("mailto:"), href)

    footer = pg.locator("footer").last
    footer.scroll_into_view_if_needed()
    time.sleep(1)
    pg.screenshot(path=f"{OUT}/solid_footer_{label}.png")
    row.screenshot(path=f"{OUT}/solid_row_{label}.png")

with sync_playwright() as p:
    browser = p.chromium.launch()
    d = browser.new_context(viewport={"width": 1440, "height": 900})
    verify(d.new_page(), d, "desktop")
    d.close()
    m = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                            is_mobile=True, has_touch=True,
                            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
    verify(m.new_page(), m, "mobile")
    m.close()
    browser.close()

print(json.dumps({"PASS": len(results["pass"]), "FAIL": len(results["fail"])}, indent=2))
for f in results["fail"]:
    print("  ✗", f)
if not results["fail"]:
    print("ALL SOLID-BRAND + CLICK-THROUGH CHECKS PASSED")
