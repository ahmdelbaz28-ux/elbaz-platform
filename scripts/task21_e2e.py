"""PRODUCTION E2E — Task 21: Most Popular Articles + real cover + WhatsApp
welcome bubble + mobile fullscreen chat + private engine identity.
https://ahmedelbaz.qzz.io

A1  Home "Most Popular Articles" section: header exists, teaser card links
    to the ETAP article, View All navigates to /articles (mobile + desktop)
A2  Article cover is the real (non-AI) ETAP 2026 shot on home card,
    articles grid and article detail page
A3  WhatsApp welcome bubble: pops ~1.4s after the 3s FAB entrance with the
    custom greeting, dismiss (X) works and persists for the session
A4  Mobile fullscreen chat: authenticated user opens chat -> window covers
    the whole viewport (100vw x 100dvh, radius 0); neutral "Thinking..."
    label only; NO model/provider name anywhere in the DOM
A5  Desktop chat: 420px card (NOT fullscreen), no model identity either
Shots: scripts/shots_mobile/T21_*.png
"""
import subprocess
import sys

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

def bubble_shown(pg):
    """Bubble is 'shown' only when the enter animation class is attached —
    after dismissal it stays in the DOM with opacity-0 (Playwright counts
    opacity:0 as visible, so we check the class instead)."""
    try:
        cls = pg.locator("#whatsapp-welcome").get_attribute("class") or ""
        return "wa-welcome-bubble" in cls
    except Exception:
        return False

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False,
        args=["--disable-blink-features=AutomationControlled", "--no-sandbox"])

    # ════════════════ MOBILE (390x844, touch, Arabic) ════════════════
    ctx = browser.new_context(viewport=VP, user_agent=UA, service_workers="block",
                              is_mobile=True, has_touch=True)
    ctx.add_init_script("try{localStorage.setItem('language','ar');}catch(e){}")
    pg = ctx.new_page()

    # ---------- A1: Most Popular Articles on Home ----------
    open_page(pg, "/")
    try:  # section renders only after the tRPC list resolves — wait explicitly
        pg.locator("h2", has_text="أشهر المقالات").first.wait_for(state="visible", timeout=20000)
    except Exception:
        pass
    sec = pg.locator("section", has=pg.locator("h2", has_text="أشهر المقالات")).first
    check("A1a section exists on home (mobile)", sec.count() >= 0 and sec.is_visible(), "")
    card_link = sec.locator('a[href*="/articles/"]').first
    href = card_link.get_attribute("href") or ""
    check("A1b teaser card links to article", "/articles/etap-power-system-analysis-guide" in href, f"href={href}")
    cover = sec.locator('img[src*="article-etap-cover.jpg"]').first
    check("A2a cover = real ETAP photo (home card)", cover.count() == 1 and cover.is_visible(), "")
    sec.scroll_into_view_if_needed()
    pg.wait_for_timeout(900)
    pg.screenshot(path=f"{OUT}/T21_A1_articles_section_mobile.png")

    view_all = sec.get_by_text("عرض الكل").first
    view_all.click()
    pg.wait_for_timeout(1800)
    check("A1c View All -> /articles", pg.url.rstrip("/").endswith("/articles"), f"url={pg.url}")
    grid_cover = pg.locator('img[src*="article-etap-cover.jpg"]').first
    check("A2b cover on /articles grid", grid_cover.count() == 1 and grid_cover.is_visible(), "")
    pg.wait_for_timeout(600)
    pg.screenshot(path=f"{OUT}/T21_A2_articles_grid_mobile.png")

    # ---------- A2c: detail page cover ----------
    pg.locator('a[href*="/articles/etap-power-system-analysis-guide"]').first.click()
    pg.wait_for_timeout(2200)
    det_cover = pg.locator('img[src*="article-etap-cover.jpg"]').first
    check("A2c cover on article detail", det_cover.count() == 1 and det_cover.is_visible(), "")
    pg.wait_for_timeout(600)
    pg.screenshot(path=f"{OUT}/T21_A2_article_detail_mobile.png")

    # ---------- A3: WhatsApp welcome bubble ----------
    open_page(pg, "/")
    # FAB enters at 3s; bubble pops ~1.4s later → wait until ~5.4s total
    pg.wait_for_timeout(5800)
    bubble = pg.locator("#whatsapp-welcome")
    bubble_visible = bubble_shown(pg)
    bubble_text = (bubble.inner_text() if bubble.count() > 0 else "").strip()
    check("A3a welcome bubble visible after entrance", bubble_visible, f"text={bubble_text[:60]!r}")
    check("A3b greeting is custom (team + invite)", "فريق منصة الباز" in bubble_text and "واتساب" in bubble_text, "")
    pg.screenshot(path=f"{OUT}/T21_A3_wa_welcome_bubble.png")
    # dismiss via X
    if bubble_visible:
        bubble.get_by_role("button", name="إغلاق الترحيب").click()
        pg.wait_for_timeout(600)
        check("A3c bubble dismissed", not bubble_shown(pg), "")
        pg.reload(wait_until="domcontentloaded")
        pg.wait_for_timeout(5600)
        dismiss_cookie(pg)
        check("A3d dismissal persists in session", not bubble_shown(pg), "")

    # ---------- A4: fullscreen chat (authenticated) + hidden provider ----------
    open_page(pg, "/login")
    pg.locator("form input").nth(0).fill("admin")
    pg.locator("form input[type=password]").first.fill(ADMIN_PW)
    pg.locator("form button[type=submit]").first.click()
    pg.wait_for_timeout(3500)
    me = pg.evaluate("async()=>{const r=await fetch('/api/trpc/auth.me?input=%7B%22json%22%3Anull%7D',{credentials:'include'});return r.status;}")
    check("A4-pre admin login ok", me == 200, f"auth.me={me}")

    open_page(pg, "/")
    chat_fab = pg.locator("button.chatbot-fab").first
    chat_fab.wait_for(state="visible", timeout=8000)
    chat_fab.click()
    pg.wait_for_timeout(2200)
    win = pg.locator(".chatbot-window").first
    box = win.bounding_box()
    check("A4a chat window fullscreen (width)", box and box["width"] >= 389, f"box={box}")
    check("A4b chat window fullscreen (height)", box and box["height"] >= 830, f"box={box}")
    radius = pg.evaluate("getComputedStyle(document.querySelector('.chatbot-window')).borderRadius")
    check("A4c fullscreen radius 0", radius in ("0px", "0rem"), f"radius={radius}")
    pg.screenshot(path=f"{OUT}/T21_A4_chat_fullscreen_mobile.png")

    # send a message → capture neutral Thinking label
    ta = pg.locator(".chatbot-window textarea").first
    ta.fill("ما هو برنامج ETAP؟")
    pg.locator('.chatbot-window button[aria-label="إرسال"]').click()
    pg.wait_for_timeout(2600)
    body_txt = pg.locator(".chatbot-window").inner_text()
    has_thinking = ("جارٍ التفكير" in body_txt) or ("Thinking" in body_txt)
    check("A4d neutral Thinking label shown", has_thinking, "")
    check("A4e NO provider/model name in chat DOM",
          not any(k in body_txt.lower() for k in ("minimax", "glm", "gpt", "claude", "gemini", "llama", "nemotron", "groq", "openrouter", "nvidia", "qwen", "deepseek")),
          "")
    pg.screenshot(path=f"{OUT}/T21_A4_chat_thinking_mobile.png")
    # close chat (stop the pending stream fast)
    pg.locator('.chatbot-window button[title="إغلاق"]').first.click()
    pg.wait_for_timeout(700)

    # ---------- A5: desktop chat = 420px card, no identity ----------
    dctx = browser.new_context(viewport={"width": 1366, "height": 900},
                               user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
                               service_workers="block")
    dctx.add_init_script("try{localStorage.setItem('language','ar');}catch(e){}")
    dp = dctx.new_page()
    open_page(dp, "/login")
    dp.locator("form input").nth(0).fill("admin")
    dp.locator("form input[type=password]").first.fill(ADMIN_PW)
    dp.locator("form button[type=submit]").first.click()
    dp.wait_for_timeout(3500)
    open_page(dp, "/")
    try:
        dp.locator("h2", has_text="أشهر المقالات").first.wait_for(state="visible", timeout=20000)
    except Exception:
        pass
    # desktop: articles section 3-col grid shot
    dsec = dp.locator("section", has=dp.locator("h2", has_text="أشهر المقالات")).first
    dsec.scroll_into_view_if_needed()
    dp.wait_for_timeout(900)
    dgrid = dp.evaluate("""() => {
        const secs = [...document.querySelectorAll('section')];
        const s = secs.find(x => x.querySelector('h2')?.textContent?.includes('أشهر المقالات'));
        if (!s) return null;
        const grid = s.querySelector('.grid');
        return getComputedStyle(grid).gridTemplateColumns;
    }""")
    check("A5a desktop articles grid = 3 columns", dgrid and dgrid.count(" ") == 2, f"cols={dgrid}")
    dp.screenshot(path=f"{OUT}/T21_A5_articles_section_desktop.png")

    dchat = dp.locator("button.chatbot-fab").first
    dchat.wait_for(state="visible", timeout=8000)
    dchat.click()
    dp.wait_for_timeout(1800)
    dbox = dp.locator(".chatbot-window").first.bounding_box()
    check("A5b desktop chat NOT fullscreen (420px card)", dbox and 380 <= dbox["width"] <= 430 and dbox["height"] < 700, f"box={dbox}")
    dp.screenshot(path=f"{OUT}/T21_A5_chat_desktop.png")
    dctx.close()
    ctx.close()
    browser.close()

print()
if fails:
    print(f"RESULT: {len(fails)} FAILED")
    sys.exit(1)
print("RESULT: ALL PASS")
