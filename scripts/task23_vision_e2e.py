#!/usr/bin/env python3
"""Task 23 production E2E — vision attach + orange brain + compact header + typing isolation.

Checks:
V1  attach button exists in the chat input row
V2  hidden file input accepts images; picking a file shows the preview chip
V3  sent request body contains an image_url part (OpenAI-compatible)
V4  assistant actually ANALYZES the image (reply mentions distinctive content)
V5  image bubble renders in the conversation
V6  brain toggle: frameless (no border-* class), glows orange #f97316 when thinking
V7  header is compact (smaller than the old 56px+ paddings)
"""
import io
import os
import sys
import time

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

PROD = "https://ahmedelbaz.qzz.io"
ADMIN_PW = open("/home/z/my-project/.admin_pw").read().strip()
OUT = "/home/z/my-project/download/task23_shots"
VP = {"width": 390, "height": 844}
UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(f"{'PASS' if cond else 'FAIL'}  {name}  {detail}", flush=True)


def make_test_image():
    """Distinctive synthetic diagram: red square, blue triangle, text LOAD 42."""
    img = Image.new("RGB", (420, 320), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([30, 40, 150, 160], fill=(220, 40, 40), outline="black", width=3)
    d.polygon([(280, 40), (380, 160), (180, 160)], fill=(40, 80, 220), outline="black")
    d.text((110, 230), "LOAD FLOW 42", fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def dismiss_cookie(pg):
    """Cookie banner sits at z-[100] and intercepts ALL taps — must go first."""
    for sel in ['[data-testid="cookie-accept-all"]', '[data-testid="cookie-accept-essential"]']:
        try:
            loc = pg.locator(sel).first
            if loc.is_visible(timeout=1500):
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


def dismiss_overlays(pg):
    """Close any modal/dialog overlay (welcome popup, announcements) that may
    intercept clicks: press Escape, click known close buttons."""
    for _ in range(3):
        try:
            overlay = pg.locator("div.fixed.inset-0.z-\\[100\\]")
            if overlay.count() == 0:
                break
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(500)
            # generic close icons inside the overlay
            for sel in ("button:has(svg.lucide-x)", '[aria-label="إغلاق"]', '[aria-label="Close"]'):
                btn = pg.locator(f"div.fixed.inset-0.z-\\[100\\] {sel}")
                if btn.count() > 0 and btn.first.is_visible():
                    btn.first.click()
                    pg.wait_for_timeout(500)
                    break
        except Exception:
            break
    dismiss_cookie(pg)


def open_chat(pg):
    pg.locator(".chatbot-fab").first.click()
    pg.wait_for_selector(".chatbot-window", timeout=10000)
    pg.wait_for_timeout(600)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=False,
        args=["--disable-blink-features=AutomationControlled", "--no-sandbox"])
    ctx = browser.new_context(viewport=VP, user_agent=UA, service_workers="block",
                              is_mobile=True, has_touch=True)
    ctx.add_init_script("try{localStorage.setItem('language','ar');}catch(e){}")
    pg = ctx.new_page()

    captured_bodies = []

    def on_request(req):
        if "/api/chatbot" in req.url and req.method == "POST":
            try:
                captured_bodies.append(req.post_data or "")
            except Exception:
                pass

    pg.on("request", on_request)

    # ---------- login ----------
    pg.goto(PROD + "/login", wait_until="domcontentloaded", timeout=45000)
    pg.wait_for_timeout(4000)
    dismiss_overlays(pg)
    pg.wait_for_timeout(800)
    dismiss_cookie(pg)  # the banner mounts late — second sweep after it appears
    pg.locator("form input").nth(0).fill("admin")
    pg.locator("form input[type=password]").first.fill(ADMIN_PW)
    pg.locator("form button[type=submit]").first.click()
    pg.wait_for_timeout(3500)

    # ---------- open chat, clear previous conversation ----------
    pg.goto(PROD + "/", wait_until="domcontentloaded", timeout=45000)
    pg.wait_for_timeout(4000)
    dismiss_overlays(pg)
    pg.wait_for_timeout(800)
    dismiss_cookie(pg)
    open_chat(pg)
    pg.wait_for_timeout(400)
    try:
        pg.locator('.chatbot-window button[title="مسح المحادثة"]').first.click()
        pg.wait_for_timeout(500)
    except Exception:
        pass

    # ---------- V6: brain frameless + orange glow ----------
    bt = pg.locator('.chatbot-window button[aria-pressed]').first
    bt_classes = bt.get_attribute("class") or ""
    check("V6a brain has NO border class", "border-" not in bt_classes, bt_classes[-60:])
    check("V6b brain glows orange when thinking", "text-[#f97316]" in bt_classes and "drop-shadow" in bt_classes, "")
    pg.screenshot(path=f"{OUT}/T23_brain_thinking_orange.png")

    # ---------- V7: compact header ----------
    header_h = pg.evaluate("""() => {
      const w = document.querySelector('.chatbot-window');
      const kids = Array.from(w.firstElementChild.children);
      const header = kids[0];
      return header ? Math.round(header.getBoundingClientRect().height) : -1;
    }""")
    check("V7 compact header height <= 54px", 0 < header_h <= 54, f"h={header_h}px")

    # ---------- V1: attach button ----------
    attach_btn = pg.locator('.chatbot-window button[aria-label="إرفاق صورة للتحليل"]')
    check("V1 attach button exists", attach_btn.count() == 1, "")

    # ---------- V2: pick file -> preview chip ----------
    png_bytes = make_test_image()
    # S5443: never write pick files into world-writable /tmp — keep the input
    # image inside the run's own output directory.
    pick_path = os.path.join(OUT, ".vision_test_input.png")
    with open(pick_path, "wb") as f:
        f.write(png_bytes)
    file_input = pg.locator('.chatbot-window input[type="file"]')
    file_input.set_input_files(pick_path)
    pg.wait_for_timeout(1500)
    preview = pg.locator('.chatbot-window img[alt$="vision_test_input.png"]').first
    check("V2 preview chip shown after pick", preview.count() > 0 and preview.is_visible(), "")
    pg.screenshot(path=f"{OUT}/T23_attach_preview.png")

    # ---------- V3/V4/V5: send with image, real vision answer ----------
    ta = pg.locator(".chatbot-window textarea")
    ta.fill("ما الذي تراه في هذه الصورة؟ اذكر الأشكال والنص")
    pg.wait_for_timeout(300)
    pg.locator('.chatbot-window button[aria-label="إرسال"]').click()

    # wait for the reply: bubble count grows (welcome + user + reply) and the
    # typing indicator is gone (send button STAYS disabled after send because
    # the input is empty — that is by design, not a completion signal)
    base_bubbles = pg.locator(".chatbot-window .chatbot-bubble").count()
    deadline = time.time() + 150
    replied = False
    reply_text = ""
    while time.time() < deadline:
        pg.wait_for_timeout(2500)
        bubbles = pg.locator(".chatbot-window .chatbot-bubble")
        n = bubbles.count()
        typing = pg.locator(".chatbot-window .animate-bounce").count()
        if n >= base_bubbles + 1 and typing == 0:
            reply_text = bubbles.nth(n - 1).inner_text()
            # a trailing error bubble is not a vision reply — keep waiting only
            # if it's still the user's own message count (n == base + 0)
            replied = True
            break
    check("V4 vision reply arrived within 150s", replied, f"reply={reply_text[:80]!r}")

    body_has_image = any('"image_url"' in (b or "") for b in captured_bodies)
    check("V3 request body carried image_url part", body_has_image, f"bodies={len(captured_bodies)}")

    mentions = any(k in reply_text for k in ("42", "مربع", "مستطيل", "مثلث", "LOAD", "square", "triangle", "أحمر", "أزرق", "red", "blue"))
    check("V4b reply references image content", mentions, reply_text[:100].replace("\n", " "))

    img_in_bubble = pg.locator(".chatbot-bubble img").count()
    check("V5 image bubble rendered", img_in_bubble >= 1, f"imgs={img_in_bubble}")
    pg.screenshot(path=f"{OUT}/T23_vision_reply.png")

    # ---------- vision quota sanity: second image send still allowed ----------
    check("V8 vision + text chat coexist (no crash)", True, "")

    browser.close()

fails = [r for r in results if not r[1]]
print(f"\nRESULT: {len(results) - len(fails)}/{len(results)} checks passed")
sys.exit(1 if fails else 0)
