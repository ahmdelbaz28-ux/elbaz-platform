"""PRODUCTION E2E — Task 22: real ETAP category cover + scroll-to-top on
navigation + session persistence across reload + brain mode toggle in header.
https://ahmedelbaz.qzz.io

B1  ETAP Software card in Browse by Category shows the REAL application
    screenshot (/etap-category.jpg, naturalWidth>0) — mobile + desktop
B2  Navigation opens the new page at the TOP: scroll home to the ETAP card,
    click it -> /courses?category=N has scrollY≈0; same for a bottom-of-page
    navbar navigation (mobile + desktop)
B3  Admin login + auth.me 200
B4  Session survives a full reload: refresh home -> click chat FAB -> chat
    OPENS (never redirects to /login)
B5  Brain toggle in the chat header: aria-pressed flips on click, toast
    feedback, old full-width mode selector row is GONE (mobile + desktop)
B6  /etap-category.jpg served with image/jpeg and plausible size
Shots: scripts/shots_mobile/T22_*.png
"""
import os
import shutil
import subprocess
import sys

from playwright.sync_api import sync_playwright

PROD = "https://ahmedelbaz.qzz.io"
OUT = "/home/z/my-project/work/elbaz-platform/scripts/shots_mobile"
DL = "/home/z/my-project/download/task22_shots"
subprocess.run(["mkdir", "-p", OUT, DL], check=True)
ADMIN_PW = open("/home/z/my-project/.admin_pw").read().strip()
UA = ("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36")
VP = {"width": 390, "height": 844}

fails = []
def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'} {name}" + (f" — {detail}" if detail else ""))
    if not cond:
        fails.append(f"{name}: {detail}")

def dismiss_cookie(pg):
    for sel in ['[data-testid="cookie-accept-all"]', '[data-testid="cookie-accept-essential"]']:
        try:
            loc = pg.locator(sel).first
            if loc.is_visible(timeout=1200):
                loc.click(timeout=3000)
                pg.wait_for_timeout(500)
                return
        except Exception:
            continue
    try:
        pg.locator('[data-testid="cookie-consent-backdrop"]').click(timeout=3000, force=True)
        pg.wait_for_timeout(500)
    except Exception:
        pass

def open_page(pg, path="/"):
    pg.goto(PROD + path, wait_until="domcontentloaded", timeout=45000)
    pg.wait_for_timeout(3000)
    dismiss_cookie(pg)
    pg.wait_for_timeout(400)

def etap_card(pg):
    return pg.locator('a[href*="/courses?category="]', has_text="برنامج ETAP").first

def reveal_categories(pg, card):
    """ScrollReveal keeps cards hidden until scrolled into view — walk the page
    down to the categories section (h2 'تصفح حسب الفئة'), then wait for the card."""
    try:
        h2 = pg.locator("h2", has_text="تصفح حسب الفئة").first
        h2.scroll_into_view_if_needed(timeout=15000)
        pg.wait_for_timeout(900)
    except Exception:
        pass
    try:
        pg.evaluate("window.scrollBy(0, 300)")
        pg.wait_for_timeout(700)
    except Exception:
        pass
    card.wait_for(state="visible", timeout=25000)

def login(pg):
    open_page(pg, "/login")
    pg.locator("form input").nth(0).fill("admin")
    pg.locator("form input[type=password]").first.fill(ADMIN_PW)
    pg.locator("form button[type=submit]").first.click()
    pg.wait_for_timeout(3500)
    me = pg.evaluate("async()=>{const r=await fetch('/api/trpc/auth.me?input=%7B%22json%22%3Anull%7D',{credentials:'include'});return r.status;}")
    check("B3 admin login + auth.me 200", me == 200, f"auth.me={me}")

def brain_toggle(pg):
    return pg.locator(".chatbot-window button[aria-pressed]").first

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False,
        args=["--disable-blink-features=AutomationControlled", "--no-sandbox"])

    # ════════════════ MOBILE (390x844, touch, Arabic) ════════════════
    ctx = browser.new_context(viewport=VP, user_agent=UA, service_workers="block",
                              is_mobile=True, has_touch=True)
    ctx.add_init_script("try{localStorage.setItem('language','ar');}catch(e){}")
    pg = ctx.new_page()

    # ---------- B1: real ETAP cover on the category card ----------
    open_page(pg, "/")
    card = etap_card(pg)
    reveal_categories(pg, card)
    check("B1a ETAP category card present (mobile)", card.count() > 0, "")
    cover = card.locator('img[src="/etap-category.jpg"]').first
    check("B1b cover = real ETAP screenshot", cover.count() == 1, "")
    nw = 0
    try:
        cover.scroll_into_view_if_needed()
        pg.wait_for_timeout(1200)
        nw = cover.evaluate("el => el.naturalWidth")
    except Exception:
        pass
    check("B1c cover actually loaded (naturalWidth>0)", nw and nw > 500, f"naturalWidth={nw}")
    pg.wait_for_timeout(600)
    pg.screenshot(path=f"{OUT}/T22_B1_etap_card_mobile.png")

    # ---------- B2: navigation opens at the TOP (the footer bug) ----------
    # user is deep in the page when they tap the card — reproduce exactly that
    card.scroll_into_view_if_needed()
    pg.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    pg.wait_for_timeout(700)
    y_before = pg.evaluate("window.scrollY")
    card.scroll_into_view_if_needed()
    pg.wait_for_timeout(500)
    card.click()
    pg.wait_for_timeout(2500)
    y_after = pg.evaluate("window.scrollY")
    on_courses = "/courses?category=" in pg.url
    check("B2a navigated to /courses?category=N", on_courses, f"url={pg.url}")
    check("B2b page opens at TOP (scrollY≈0, was deep)", y_after < 80, f"y_before={y_before} y_after={y_after}")
    pg.screenshot(path=f"{OUT}/T22_B2_after_nav_top_mobile.png")
    # second path: scroll to absolute bottom of /courses, then use the FOOTER
    # quick link (always visible at the bottom — the exact "navigate while deep"
    # scenario; the mobile navbar auto-hides on scroll-down)
    pg.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    pg.wait_for_timeout(600)
    footer_courses = pg.locator("footer").get_by_text("الكورسات", exact=True).first
    try:
        footer_courses.click(timeout=6000)
        pg.wait_for_timeout(2200)
        y2 = pg.evaluate("window.scrollY")
        check("B2c footer navigation from bottom -> TOP", y2 < 80 and "/courses" in pg.url, f"y={y2} url={pg.url}")
    except Exception as e:
        check("B2c footer navigation from bottom -> TOP", False, f"exc={e!r:.80}")

    # ---------- B3+B4: session survives a reload; chat opens ----------
    login(pg)
    open_page(pg, "/")
    me2 = pg.evaluate("async()=>{const r=await fetch('/api/trpc/auth.me?input=%7B%22json%22%3Anull%7D',{credentials:'include'});return r.status;}")
    check("B4a auth.me still 200 after full reload", me2 == 200, f"auth.me={me2}")
    chat_fab = pg.locator("button.chatbot-fab").first
    chat_fab.wait_for(state="visible", timeout=10000)
    chat_fab.click()
    pg.wait_for_timeout(2500)
    chat_open = pg.locator(".chatbot-window").first.is_visible()
    not_login = "/login" not in pg.url
    check("B4b after reload chat OPENS (no /login redirect)", chat_open and not_login, f"url={pg.url}")

    # ---------- B5: brain toggle in the header, mode row gone ----------
    bt = brain_toggle(pg)
    check("B5a brain toggle exists in header", bt.count() == 1 and bt.is_visible(), "")
    pressed0 = bt.get_attribute("aria-pressed")
    body0 = pg.locator(".chatbot-window").inner_text()
    # old full-width row had literal buttons labelled تفكير / سريع
    check("B5b old mode selector row is GONE",
          not any(t in body0 for t in ("وضع التفكير العميق ومُتحقق", "ردود فورية مختصرة — للأسئلة")),
          "")
    pg.screenshot(path=f"{OUT}/T22_B5_brain_thinking_mobile.png")
    bt.click()
    pg.wait_for_timeout(900)
    pressed1 = bt.get_attribute("aria-pressed")
    toast1 = pg.locator("[data-sonner-toast]").first.inner_text() if pg.locator("[data-sonner-toast]").count() else ""
    check("B5c click -> INSTANT (aria-pressed flips)", pressed0 == "true" and pressed1 == "false",
          f"{pressed0} -> {pressed1}")
    check("B5d instant toast feedback", "الوضع السريع" in toast1, f"toast={toast1!r:.60}")
    pg.screenshot(path=f"{OUT}/T22_B5_brain_instant_mobile.png")
    bt.click()
    pg.wait_for_timeout(900)
    pressed2 = bt.get_attribute("aria-pressed")
    toast2 = pg.locator("[data-sonner-toast]").first.inner_text() if pg.locator("[data-sonner-toast]").count() else ""
    check("B5e second click -> THINKING again", pressed2 == "true", f"pressed={pressed2}")
    check("B5f thinking toast feedback", "التفكير" in toast2, f"toast={toast2!r:.60}")
    # messages area directly follows the header — no mode strip between them
    structure_ok = pg.evaluate("""() => {
      const w = document.querySelector('.chatbot-window');
      if (!w) return false;
      const kids = [...w.firstElementChild.children];
      const idx = kids.findIndex(k => k.querySelector('button[aria-pressed]'));
      if (idx < 0) return false;
      const next = kids[idx + 1];
      return !!next && (next.classList.contains('chatbot-messages') || !!next.querySelector('.chatbot-messages'));
    }""")
    check("B5g messages area directly after header (space reclaimed)", structure_ok, "")
    pg.locator('.chatbot-window button[title="إغلاق"]').first.click()
    pg.wait_for_timeout(600)

    # ---------- B6: asset sanity ----------
    asset = pg.evaluate("""async () => {
      const r = await fetch('/etap-category.jpg', {credentials:'omit'});
      const b = await r.blob();
      return {status: r.status, type: r.headers.get('content-type')||'', size: b.size};
    }""")
    check("B6 /etap-category.jpg served (jpeg, >80KB)",
          asset["status"] == 200 and "jpeg" in asset["type"] and asset["size"] > 80000,
          f"{asset}")

    ctx.close()

    # ════════════════ DESKTOP (1366x900) ════════════════
    dctx = browser.new_context(viewport={"width": 1366, "height": 900},
                               user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
                               service_workers="block")
    dctx.add_init_script("try{localStorage.setItem('language','ar');}catch(e){}")
    dp = dctx.new_page()
    open_page(dp, "/")
    dcard = etap_card(dp)
    reveal_categories(dp, dcard)
    dcover = dcard.locator('img[src="/etap-category.jpg"]').first
    dnw = 0
    try:
        dcover.scroll_into_view_if_needed()
        dp.wait_for_timeout(1000)
        dnw = dcover.evaluate("el => el.naturalWidth")
    except Exception:
        pass
    check("D1 desktop ETAP card shows real cover", dnw > 500, f"naturalWidth={dnw}")
    dp.wait_for_timeout(500)
    dp.screenshot(path=f"{OUT}/T22_D1_etap_card_desktop.png")

    dcard.scroll_into_view_if_needed()
    dp.wait_for_timeout(400)
    dcard.click()
    dp.wait_for_timeout(2500)
    dy = dp.evaluate("window.scrollY")
    check("D2 desktop navigation opens at TOP", "/courses?category=" in dp.url and dy < 80, f"y={dy} url={dp.url}")

    # desktop chat + brain toggle (session was already proven on mobile)
    login(dp)
    open_page(dp, "/")
    dfab = dp.locator("button.chatbot-fab").first
    dfab.wait_for(state="visible", timeout=10000)
    dfab.click()
    dp.wait_for_timeout(2000)
    dbt = brain_toggle(dp)
    check("D3a desktop chat brain toggle exists", dbt.count() == 1 and dbt.is_visible(), "")
    dp0 = dbt.get_attribute("aria-pressed")
    dbt.click()
    dp.wait_for_timeout(900)
    dp1 = dbt.get_attribute("aria-pressed")
    check("D3b toggle flips (thinking->instant)", dp0 == "true" and dp1 == "false", f"{dp0}->{dp1}")
    dp.screenshot(path=f"{OUT}/T22_D3_chat_brain_desktop.png")
    dp.locator('.chatbot-window button[title="إغلاق"]').first.click()

    dctx.close()
    browser.close()

# ---------- summary ----------
print()
print(f"RESULT: {18 - len(fails)}/18 checks passed" if not fails else f"RESULT: {18 - len(fails)}/18 checks passed")
if fails:
    print("FAILURES:")
    for f in fails:
        print("  ✗", f)
    sys.exit(1)

# copy shots for user download
for f in os.listdir(OUT):
    if f.startswith("T22_"):
        shutil.copy(os.path.join(OUT, f), os.path.join(DL, f))
print(f"shots copied to {DL}")
