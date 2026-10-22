"""PRODUCTION E2E — mobile UX verification (Task 16)
https://ahmedelbaz.qzz.io  |  viewport 390x844, touch, Arabic

M1  Navbar hamburger -> side drawer opens (300px, NOT fullscreen)
    -> tap "المقالات" -> navigates to /articles AND drawer closes (the root bug fix)
M2  /articles shows ETAP card -> opens /articles/etap-power-system-analysis-guide
M3  Admin login on mobile -> /admin -> sticky top bar hamburger visible,
    admin sidebar OFF-canvas (x < 0)
M4  Tap top-bar hamburger -> drawer slides in (x == 0, width ~264 < viewport)
    -> tap "المقالات" -> drawer closes + articles tab shows ETAP row "منشور"
M5  Backdrop tap closes the admin drawer
M6  Admin drawer drag-to-close
F   (Task 18) FAB stack: WhatsApp/chatbot/scroll-top hug the bottom edge
    in one compact 40px column on mobile; WhatsApp tooltip toggles;
    F5 chat auth-gate for guests (redirect to /login);
    F6 scroll-top appears after scrolling and scrolls back to top;
    F7 chat opens/minimizes-into-slot/closes for AUTHENTICATED user
L   (Task 19) circular logo everywhere: navbar/drawer/footer = circular
    asset (logo-circle.png), square box, fully rounded corners
D   (Task 19) desktop 1366x900: navbar + footer logo circular+square
F8  (Task 20) WhatsApp 3s delayed entrance: absent before 3s, glides in after
F9  (Task 20) YouTube-style: FABs dip away while scrolling down, glide back
    when the scroll stops (reveal debounce ~220ms)
F10 (Task 20) brand unification to the tab: circular favicon set + boot
    splash assets live + splash markup present in the HTML
Shots: scripts/shots_mobile/
"""
import json, re, subprocess, sys
from playwright.sync_api import sync_playwright

PROD = "https://ahmedelbaz.qzz.io"
OUT = "/home/z/my-project/work/elbaz-platform/scripts/shots_mobile"
subprocess.run(["mkdir", "-p", OUT], check=True)
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
    """Cookie banner sits at z-[100] and intercepts ALL taps — must go first."""
    for sel in ['[data-testid="cookie-accept-all"]', '[data-testid="cookie-accept-essential"]']:
        try:
            loc = pg.locator(sel).first
            if loc.is_visible(timeout=1200):
                loc.click(timeout=3000)
                pg.wait_for_timeout(500)
                return
        except Exception:
            continue
    try:  # fallback: backdrop itself is a dismiss button
        pg.locator('[data-testid="cookie-consent-backdrop"]').click(timeout=3000, force=True)
        pg.wait_for_timeout(500)
    except Exception:
        pass

def open_page(pg, path="/"):
    pg.goto(PROD + path, wait_until="domcontentloaded", timeout=45000)
    pg.wait_for_timeout(3000)
    dismiss_cookie(pg)
    pg.wait_for_timeout(400)

def fetch(pg, js, arg=None):
    return pg.evaluate(js, arg)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False,
        args=["--disable-blink-features=AutomationControlled", "--no-sandbox"])
    ctx = browser.new_context(viewport=VP, user_agent=UA, service_workers="block",
                              is_mobile=True, has_touch=True)
    ctx.add_init_script("try{localStorage.setItem('language','ar');}catch(e){}")
    pg = ctx.new_page()

    # ---------- M1: navbar hamburger -> drawer -> navigation ----------
    open_page(pg, "/")
    burger = pg.locator('nav[aria-label="التنقل الرئيسي"] button[aria-label="فتح القائمة"]')
    check("M0 hamburger exists (mobile)", burger.count() >= 1, f"count={burger.count()}")
    dismiss_cookie(pg)
    burger.first.click()
    pg.wait_for_timeout(1100)
    panel = pg.locator('aside[aria-label="قائمة التنقل"]')
    check("M1a drawer panel opens", panel.count() == 1 and panel.is_visible(), f"count={panel.count()}")
    if panel.count() == 1:
        bb = panel.bounding_box()
        check("M1b drawer is side panel not fullscreen",
              bb and bb["width"] < 340 and bb["width"] > 240 and bb["x"] >= 0,
              f"box={bb}")
        pg.screenshot(path=f"{OUT}/M1_drawer_open.png")
        art_link = panel.locator("a", has_text="المقالات")
        check("M1c drawer has Articles link", art_link.count() == 1, f"count={art_link.count()}")
        art_link.first.click()
        pg.wait_for_timeout(1500)
        on_articles = "/articles" in pg.url and "/articles/" not in pg.url
        check("M1d NAVIGATION WORKS -> /articles", on_articles, f"url={pg.url}")
        gone = pg.locator('aside[aria-label="قائمة التنقل"]').count() == 0
        check("M1e drawer closed after navigation", gone, f"panels={pg.locator('aside[aria-label=\"قائمة التنقل\"]').count()}")

    # ---------- N: bottom bar removed + drag-to-close (site drawer) ----------
    bottom = pg.locator('nav[aria-label="التنقل السفلي"]')
    check("N1 fixed bottom bar removed", bottom.count() == 0, f"count={bottom.count()}")
    dismiss_cookie(pg)
    burger.first.click()
    pg.wait_for_timeout(1100)
    panel_bb = pg.locator('aside[aria-label="قائمة التنقل"]').bounding_box()
    if panel_bb:
        cx, cy = panel_bb["x"] + panel_bb["width"] / 2, 420
        pg.mouse.move(cx, cy)
        pg.mouse.down()
        pg.mouse.move(cx + 150, cy, steps=10)
        pg.mouse.up()
        pg.wait_for_timeout(1200)
        closed = pg.locator('aside[aria-label="قائمة التنقل"]').count() == 0
        stayed = "/articles" in pg.url and "/articles/" not in pg.url
        check("N2 site drawer SWIPE-to-close works", closed, f"panels={pg.locator('aside[aria-label=\"قائمة التنقل\"]').count()}")
        check("N3 drag guard: no accidental navigation", stayed, f"url={pg.url}")
        pg.screenshot(path=f"{OUT}/N1_no_bottom_bar.png")
    else:
        check("N2 site drawer SWIPE-to-close works", False, "panel did not reopen")

    # ---------- L: circular logo everywhere (Task 19) ----------
    def logo_state(sel):
        return pg.evaluate("""(sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return { src: el.getAttribute('src') || '', w: r.width, h: r.height,
                     radius: parseFloat(s.borderTopLeftRadius) };
        }""", sel)

    def round_ok(l):
        return bool(l) and "logo-circle.png" in l["src"] \
            and abs(l["w"] - l["h"]) <= 1.5 and l["radius"] >= l["w"] / 2 - 1

    nav_l = logo_state('nav[aria-label="التنقل الرئيسي"] img[alt="Eng. Ahmed Elbaz Logo"]')
    check("L1a navbar logo = circular asset, square+round", round_ok(nav_l), f"{nav_l}")

    foot_l = logo_state('footer img[alt="Eng. Ahmed Elbaz Logo"]')
    check("L2a footer logo = circular asset, square+round", round_ok(foot_l), f"{foot_l}")

    dismiss_cookie(pg)
    burger.first.click()
    pg.wait_for_timeout(1100)
    dr_l = logo_state('aside[aria-label="قائمة التنقل"] img')
    check("L3a drawer logo = circular asset, square+round", round_ok(dr_l), f"{dr_l}")
    pg.screenshot(path=f"{OUT}/L1_drawer_circle_logo.png")
    drawer_link = pg.locator('aside[aria-label="قائمة التنقل"] a', has_text="المقالات")
    if drawer_link.count():
        drawer_link.first.click()
        pg.wait_for_timeout(1200)
    pg.screenshot(path=f"{OUT}/L2_navbar_circle_logo.png")

    # ---------- M2: articles public pages ----------
    etap_card = pg.locator("a", has_text="برنامج الإيتاب")
    for _ in range(8):  # list loads async — poll before judging
        if etap_card.count() >= 1:
            break
        pg.wait_for_timeout(800)
    check("M2a ETAP article card on /articles", etap_card.count() >= 1, f"count={etap_card.count()}")
    pg.screenshot(path=f"{OUT}/M2_articles_list.png")
    if etap_card.count() >= 1:
        etap_card.first.click()
        pg.wait_for_timeout(2500)
        check("M2b article detail opens", "/articles/etap-power-system-analysis-guide" in pg.url, f"url={pg.url}")
        body_txt = pg.locator("main").inner_text() if pg.locator("main").count() else pg.inner_text("body")
        check("M2c ETAP content renders (RTL)", "الإيتاب" in body_txt and "ETAP" in body_txt, body_txt[:80].replace("\n", " "))
        pg.screenshot(path=f"{OUT}/M2_article_detail.png")

    # ---------- F: floating FABs — compact bottom stack (Task 18/20) ----------
    pg.wait_for_timeout(1200)

    # F8 (Task 20): WhatsApp 3s delayed entrance — fresh reload catches the
    # early window: absent before 3s, present after (entrance anim 0.7s).
    pg.reload(wait_until="domcontentloaded")
    pg.wait_for_timeout(1200)
    early = pg.locator("button.whatsapp-fab").count()
    check("F8a WhatsApp FAB hidden during first 3s", early == 0, f"count={early}")
    pg.wait_for_selector("button.whatsapp-fab", timeout=8000)
    check("F8b WhatsApp FAB glides in after ~3s",
          pg.locator("button.whatsapp-fab").count() == 1)
    splash_gone = pg.evaluate("() => document.getElementById('boot-splash') === null")
    check("F8c boot splash removed after React mounts", splash_gone)
    pg.wait_for_timeout(900)  # let the 0.7s entrance animation settle

    def bbox(sel):
        loc = pg.locator(sel).first
        return loc.bounding_box() if loc.count() else None

    wa = bbox("button.whatsapp-fab")
    check("F1a WhatsApp FAB exists", wa is not None, f"box={wa}")
    if wa:
        check("F1b WhatsApp FAB 40px on mobile",
              abs(wa["width"] - 40) <= 2 and abs(wa["height"] - 40) <= 2,
              f"w={wa['width']} h={wa['height']}")
        gap_wa = VP["height"] - (wa["y"] + wa["height"])
        check("F1c WhatsApp hugs bottom edge (<=18px)", gap_wa <= 18, f"bottom_gap={gap_wa}")

    chat = bbox("button.chatbot-fab")
    check("F2a chatbot FAB exists", chat is not None, f"box={chat}")
    if chat and wa:
        check("F2b chatbot FAB 40px", abs(chat["width"] - 40) <= 2, f"w={chat['width']}")
        gap_c = wa["y"] - (chat["y"] + chat["height"])
        check("F2c stacked above WhatsApp with ~10px gap", abs(gap_c - 10) <= 4, f"gap={gap_c}")
        check("F2d same right column", abs(chat["x"] - wa["x"]) <= 2, f"dx={abs(chat['x'] - wa['x'])}")

    stop = bbox("button.scroll-top-fab")
    check("F3a scroll-top FAB exists", stop is not None, f"box={stop}")
    if stop and wa:
        check("F3b scroll-top 40px + same column",
              abs(stop["width"] - 40) <= 2 and abs(stop["x"] - wa["x"]) <= 2,
              f"w={stop['width']} dx={abs(stop['x'] - wa['x'])}")
        if chat:
            gap_s = chat["y"] - (stop["y"] + stop["height"])
            check("F3c sits above chatbot slot", abs(gap_s - 10) <= 4, f"gap={gap_s}")
        op0 = pg.evaluate("() => getComputedStyle(document.querySelector('button.scroll-top-fab span')).opacity")
        check("F3d hidden at page top", op0 == "0", f"opacity={op0}")

    pg.screenshot(path=f"{OUT}/F1_fab_stack_bottom.png")

    # F4: WhatsApp tooltip toggle
    pg.locator("button.whatsapp-fab").first.click()
    pg.wait_for_timeout(700)
    tip = pg.locator("#whatsapp-tooltip")
    tip_ok = tip.count() == 1 and tip.evaluate("el => getComputedStyle(el).opacity") == "1" \
        and "مساعدة" in tip.inner_text()
    check("F4a WhatsApp tooltip opens above button", tip_ok, f"count={tip.count()}")
    pg.screenshot(path=f"{OUT}/F2_whatsapp_tooltip.png")
    pg.locator("button.whatsapp-fab").first.click()
    pg.wait_for_timeout(500)

    # F5 (guest): chat FAB is auth-gated by design — click -> toast + /login
    pg.locator("button.chatbot-fab").first.click()
    pg.wait_for_timeout(1800)
    check("F5a chat GATED for guests -> redirect to /login", "/login" in pg.url, f"url={pg.url}")

    # F6 (guest, scrollable article page): scroll-top appears and works
    open_page(pg, "/articles/etap-power-system-analysis-guide")
    pg.evaluate("() => window.scrollTo({top: 900, behavior: 'instant'})")
    pg.wait_for_timeout(900)
    op1 = pg.evaluate("() => getComputedStyle(document.querySelector('button.scroll-top-fab span')).opacity")
    check("F6a scroll-top appears after scrolling", op1 == "1", f"opacity={op1}")
    pg.screenshot(path=f"{OUT}/F4_scrolled_fabs.png")
    y_before = pg.evaluate("() => window.scrollY")
    pg.locator("button.scroll-top-fab").first.click()
    pg.wait_for_timeout(2000)
    y_after = pg.evaluate("() => window.scrollY")
    check("F6b scroll-top scrolls back to top", y_before > 400 and y_after < 50, f"{y_before} -> {y_after}")

    # F9 (Task 20): YouTube-style hide-on-scroll-down + reveal-on-stop.
    # Single instant downward jump = one scroll event -> hidden at once;
    # after the events stop, the 220ms reveal debounce glides FABs back.
    pg.evaluate("() => window.scrollTo({top: 1600, behavior: 'instant'})")
    pg.wait_for_timeout(100)
    hid = pg.evaluate("() => !!document.querySelector('.whatsapp-fab-wrap.fab-scroll-hidden')")
    check("F9a FABs dip away while scrolling down", hid, f"hidden={hid}")
    pg.screenshot(path=f"{OUT}/F5_fabs_hidden_during_scroll.png")
    pg.wait_for_timeout(800)
    hid2 = pg.evaluate("() => !!document.querySelector('.whatsapp-fab-wrap.fab-scroll-hidden')")
    check("F9b FABs glide back when scrolling stops", not hid2, f"hidden={hid2}")
    pg.screenshot(path=f"{OUT}/F6_fabs_revealed_after_stop.png")

    # F10 (Task 20): brand unification to the browser tab — circular favicon
    # set + boot-splash icon live, splash markup present in the HTML.
    for asset, name in [("favicon-32x32.png", "F10a favicon-32x32 live"),
                        ("favicon-16x16.png", "F10b favicon-16x16 live"),
                        ("apple-touch-icon.png", "F10c apple-touch-icon live"),
                        ("favicon.ico", "F10d favicon.ico live"),
                        ("logo-splash.png", "F10e boot-splash icon live")]:
        r = pg.request.get(f"{PROD}/{asset}", timeout=15000)
        ct = r.headers.get("content-type", "")
        check(name, r.status == 200 and ct.startswith("image/"), f"status={r.status} ct={ct}")
    html = pg.request.get(PROD + "/", timeout=15000).text()
    check("F10f boot splash present in HTML", "boot-splash" in html)
    check("F10g favicon links = circular set (no broken svg)",
          "favicon-32x32.png" in html and "mask-icon" not in html)

    # ---------- M3: admin login on mobile ----------
    open_page(pg, "/login")
    pg.locator("form input").nth(0).fill("admin")
    pg.locator("form input[type=password]").first.fill(ADMIN_PW)
    pg.locator("form button[type=submit]").first.click()
    pg.wait_for_timeout(6000)
    me = fetch(pg, """async () => {
        try { const r = await fetch('/api/trpc/auth.me', {credentials:'include'});
              return {status: r.status, body: await r.text()}; }
        catch (e) { return {status: 0, body: String(e)}; }
    }""")
    check("M3a admin login (auth.me 200)", me.get("status") == 200, f"status={me.get('status')}")
    check("M3b role=admin", re.search(r'"role"\s*:\s*"admin"', str(me.get("body", ""))) is not None)

    open_page(pg, "/admin")
    pg.wait_for_timeout(2500)
    # Diagnostic: cold-load /admin sometimes races the auth guard — retry with logs
    for attempt in range(4):
        if pg.locator("aside.admin-sidebar").count() >= 1:
            break
        me2 = fetch(pg, """async () => {
            try { const r = await fetch('/api/trpc/auth.me', {credentials:'include'});
                  return {status: r.status, body: (await r.text()).slice(0, 120)}; }
            catch (e) { return {status: 0, body: String(e)}; }
        }""")
        body_snip = pg.inner_text("body")[:120].replace("\n", " ")
        print(f"DIAG{attempt}: url={pg.url} | auth.me={me2} | body={body_snip}")
        pg.goto(PROD + "/admin", wait_until="domcontentloaded", timeout=45000)
        pg.wait_for_timeout(4000)
        dismiss_cookie(pg)
    pg.wait_for_timeout(1500)
    top_burger = pg.locator('[data-testid="admin-mobile-menu"]')
    check("M3c mobile top bar hamburger visible", top_burger.count() == 1 and top_burger.is_visible(),
          f"count={top_burger.count()}")
    sb = pg.locator("aside.admin-sidebar")
    check("M3d admin sidebar element exists", sb.count() == 1, f"count={sb.count()}")
    sb_bb = sb.bounding_box() if sb.count() == 1 else None
    check("M3e sidebar OFF-canvas initially", sb_bb is not None and sb_bb["x"] < -200, f"x={sb_bb and sb_bb['x']}")
    main_ml = pg.evaluate("""() => { const m = document.querySelector('main'); return m ? getComputedStyle(m).marginLeft : null; }""")
    check("M3f main content full-width on mobile", main_ml in ("0px", "0"), f"marginLeft={main_ml}")
    pg.screenshot(path=f"{OUT}/M3_admin_mobile.png")

    # ---------- M4: drawer slide-in + articles tab ----------
    dismiss_cookie(pg)
    top_burger.click()
    pg.wait_for_timeout(1100)
    sb_bb2 = sb.bounding_box()
    check("M4a drawer slides in (x≈0, not fullscreen)",
          sb_bb2 and abs(sb_bb2["x"]) < 4 and sb_bb2["width"] < 300,
          f"box={sb_bb2}")
    pg.screenshot(path=f"{OUT}/M4_admin_drawer_open.png")
    item = sb.locator("button", has_text="المقالات")
    check("M4b articles item in drawer", item.count() >= 1, f"count={item.count()}")
    if item.count() >= 1:
        item.first.click()
        pg.wait_for_timeout(1800)
        sb_bb3 = sb.bounding_box()
        check("M4c drawer closes after selecting tab", sb_bb3 is not None and sb_bb3["x"] < -200, f"x={sb_bb3 and sb_bb3['x']}")
        content = pg.inner_text("body")
        check("M4d articles tab shows ETAP row", "برنامج الإيتاب" in content, content[:100].replace("\n", " "))
        check("M4e row badge = منشور", "منشور" in content)
        pg.screenshot(path=f"{OUT}/M4_admin_articles_tab.png")

    # ---------- M5: backdrop closes drawer ----------
    dismiss_cookie(pg)
    top_burger.click()
    pg.wait_for_timeout(1100)
    sb_bb4 = sb.bounding_box()
    if sb_bb4 and abs(sb_bb4["x"]) < 4:
        pg.mouse.click(VP["width"] - 30, 400)  # tap backdrop area (right edge)
        pg.wait_for_timeout(1100)
        sb_bb5 = sb.bounding_box()
        check("M5 backdrop tap closes drawer", sb_bb5 is not None and sb_bb5["x"] < -200, f"x={sb_bb5 and sb_bb5['x']}")
    else:
        check("M5 backdrop tap closes drawer", False, f"drawer did not open: {sb_bb4}")

    # ---------- M6: admin drawer drag-to-close ----------
    dismiss_cookie(pg)
    top_burger.click()
    pg.wait_for_timeout(1100)
    sb_bb6 = sb.bounding_box()
    if sb_bb6 and abs(sb_bb6["x"]) < 4:
        cx, cy = sb_bb6["width"] / 2, 420
        pg.mouse.move(cx, cy)
        pg.mouse.down()
        pg.mouse.move(cx - 150, cy, steps=10)
        pg.mouse.up()
        pg.wait_for_timeout(1200)
        sb_bb7 = sb.bounding_box()
        check("M6 admin drawer SWIPE-to-close works", sb_bb7 is not None and sb_bb7["x"] < -200, f"x={sb_bb7 and sb_bb7['x']}")
    else:
        check("M6 admin drawer SWIPE-to-close works", False, f"drawer did not open: {sb_bb6}")

    # ---------- F7: chat opens for AUTHENTICATED user (admin, regular page) ----------
    open_page(pg, "/articles")
    pg.locator("button.chatbot-fab").first.click()
    pg.wait_for_timeout(1600)
    win = pg.locator(".chatbot-window")
    win_open = win.count() == 1 and win.is_visible()
    check("F7a chat window opens (authenticated)", win_open, f"count={win.count()}")
    if win_open:
        pg.screenshot(path=f"{OUT}/F3_chat_open.png")
        pg.locator('.chatbot-window [title="تصغير"]').first.click()
        pg.wait_for_timeout(900)
        mini = pg.locator(".chatbot-window.chatbot-min")
        mini_ok = mini.count() == 1
        if mini_ok:
            mb = mini.bounding_box()
            mini_ok = bool(mb) and abs(mb["width"] - 40) <= 2 and wa and abs(mb["x"] - wa["x"]) <= 2
        check("F7b minimize lands in chatbot slot (40px, same column)", mini_ok,
              f"box={mini.bounding_box() if mini.count() else None}")
        if mini.count():
            mini.first.click()
            pg.wait_for_timeout(1200)
        close_btn = pg.locator('.chatbot-window [title="إغلاق"]')
        if close_btn.count():
            close_btn.first.click()
            pg.wait_for_timeout(900)
        check("F7c chat closes -> FAB returns", pg.locator("button.chatbot-fab").count() == 1)

    # ---------- D: desktop logo proportions (Task 19) ----------
    dctx = browser.new_context(viewport={"width": 1366, "height": 900}, service_workers="block")
    dctx.add_init_script("try{localStorage.setItem('language','ar');}catch(e){}")
    dp = dctx.new_page()
    dp.goto(PROD + "/", wait_until="domcontentloaded", timeout=45000)
    dp.wait_for_timeout(3000)
    try:
        cb = dp.locator('[data-testid="cookie-accept-all"]')
        if cb.is_visible(timeout=1500):
            cb.click(timeout=3000); dp.wait_for_timeout(400)
    except Exception:
        pass
    d_nav = logo_state('nav[aria-label="التنقل الرئيسي"] img[alt="Eng. Ahmed Elbaz Logo"]')
    check("D1a desktop navbar logo circular+square", round_ok(d_nav), f"{d_nav}")
    dp.screenshot(path=f"{OUT}/D1_desktop_navbar_logo.png")
    dp.evaluate("() => document.querySelector('footer')?.scrollIntoView({behavior:'instant'})")
    dp.wait_for_timeout(900)
    d_foot = logo_state('footer img[alt="Eng. Ahmed Elbaz Logo"]')
    check("D2a desktop footer logo circular+square", round_ok(d_foot), f"{d_foot}")
    dp.screenshot(path=f"{OUT}/D2_desktop_footer_logo.png")
    dctx.close()

    browser.close()

print("-" * 50)
if fails:
    print(f"RESULT: {len(fails)} FAILURES"); [print(" -", f) for f in fails]; sys.exit(1)
print("RESULT: ALL MOBILE CHECKS PASSED")
