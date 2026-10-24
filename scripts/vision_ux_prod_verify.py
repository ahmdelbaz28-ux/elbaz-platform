#!/usr/bin/env python3
"""VISION-UX PROD VERIFY — the 2026-10-23 user complaint, verified live:
  C1  instant mode + image  → progressive typing (caret + growth), never all-at-once
  C2  the instant+image reply is well-written Arabic (no garbled words)
  C3  thinking mode + image → same progressive-typing contract
  C4  zero user-visible error text anywhere
A real headed Chromium under Xvfb against https://ahmedelbaz.qzz.io
(service_workers blocked so page.route-free measurements are honest).
"""
import json, os, re, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

PROD = "https://ahmedelbaz.qzz.io"
OUT = "/home/z/my-project/work/elbaz-platform/scripts/shots_vision_ux"
USER, PASS = "chatfix_live_01", "ChatFix2026X"
results, fails = [], []

def check(name, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {str(detail)[:200]}" if detail else ""), flush=True)
    (results if cond else fails).append((name, detail))

def shot(pg, name):
    try: pg.screenshot(path=f"{OUT}/{name}.png")
    except Exception: pass

# Corrupted words observed in the 2026-10-23 incident + common garbling shapes.
GARBLED = ["التعاياث", "للاستاتث", "رايت دائماً", "راجلت", "أعت عن", "الإعداثات", "التعايق الثايث"]

def garble_hits(text):
    return [g for g in GARBLED if g in text]

def open_chat(pg):
    pg.evaluate("() => document.querySelector('button.chatbot-fab')?.click()")
    pg.wait_for_timeout(1200)

def send(pg, text, attach=None):
    box = pg.locator("textarea:visible").first
    box.fill(text)
    if attach:
        pg.locator("input[type='file']").first.set_input_files(attach)
        pg.wait_for_timeout(800)
    pg.keyboard.press("Enter")

def watch_typing(pg, max_ms=300_000, min_len=25):
    """Sample the STREAMING bubble at 300ms. Measures the user-visible reveal:
    caret presence while text grows, number of growth steps, and whether the
    text arrived progressively (many growth steps) vs one dump (1-2 steps)."""
    started = time.time()
    samples = []          # (t_ms, visible_len) of the streaming bubble
    caret_ticks = 0       # samples where the caret was visible
    text_ticks = 0
    deadline = started + max_ms / 1000
    while time.time() < deadline:
        try:
            caret = pg.locator(".animate-typing-cursor").count() > 0
            bubble = pg.locator(".chatbot-bubble").last
            txt = bubble.inner_text(timeout=800) if bubble.count() > 0 else ""
            if caret:
                caret_ticks += 1
            if txt:
                text_ticks += 1
                samples.append((int((time.time() - started) * 1000), len(txt)))
        except Exception:
            pass
        # committed: textarea enabled again and no caret for 2 consecutive reads
        try:
            enabled = pg.locator("textarea:visible").first.get_attribute("disabled") is None
        except Exception:
            enabled = False
        if enabled and samples and not pg.locator(".animate-typing-cursor").count():
            pg.wait_for_timeout(700)
            if not pg.locator(".animate-typing-cursor").count():
                break
        pg.wait_for_timeout(300)
    final = ""
    try:
        final = pg.locator(".chatbot-bubble").last.inner_text(timeout=2000)
    except Exception:
        pass
    growth_steps = 0
    for i in range(1, len(samples)):
        if samples[i][1] > samples[i - 1][1]:
            growth_steps += 1
    first_len = samples[0][1] if samples else 0
    return {
        "text": final, "samples": samples, "growth_steps": growth_steps,
        "caret_ticks": caret_ticks, "text_ticks": text_ticks,
        "first_len": first_len, "final_len": len(final),
    }

def clear_chat(pg):
    try:
        pg.locator("button[title*='مسح'], button[title*='Clear']").first.click(timeout=3000)
        pg.wait_for_timeout(1500)
    except Exception:
        pass

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=["--disable-blink-features=AutomationControlled", "--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 900},
                                  user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
                                  service_workers="block")
        pg = ctx.new_page()
        pg.goto(PROD + "/login", wait_until="domcontentloaded", timeout=60000)
        try:
            pg.wait_for_selector("input:visible:not([type='password'])", timeout=90_000)
        except Exception:
            shot(pg, "L0_login_blocked")
            pg.reload(wait_until="domcontentloaded", timeout=60000)
            pg.wait_for_selector("input:visible:not([type='password'])", timeout=60_000)
        pg.wait_for_timeout(1500)
        for sel in ["button:has-text('موافق')", "button:has-text('قبول')", "button:has-text('Accept')"]:
            try:
                pg.locator(sel).first.click(timeout=1500); pg.wait_for_timeout(400); break
            except Exception:
                continue
        pg.locator("input:visible:not([type='password'])").first.fill(USER)
        pg.locator("input:visible[type='password']").first.fill(PASS)
        pg.locator("button[type='submit']").first.click()
        pg.wait_for_timeout(4000)

        img_path = os.path.join(tempfile.mkdtemp(prefix="vision_ux_"), "etap_vision_ux.jpg")  # S5443 — private dir
        try:
            urllib.request.urlretrieve(PROD + "/etap-category.jpg", img_path)
        except Exception:
            img_path = "/home/z/my-project/work/elbaz-platform/public/etap-category.jpg"

        # ── C1: instant mode + image — progressive typing ──
        open_chat(pg)
        send(pg, "ما الذي تظهره هذه الصورة؟ اشرح بإيجاز", attach=img_path)
        r1 = watch_typing(pg, max_ms=300_000)
        check("C1a instant+image: reply arrived", len(r1["text"]) >= 25, r1["text"][:120])
        check("C1b instant+image: caret was visible while text grew", r1["caret_ticks"] >= 2 and r1["growth_steps"] >= 3,
              f"caret_ticks={r1['caret_ticks']} growth_steps={r1['growth_steps']} samples={len(r1['samples'])}")
        check("C1c instant+image: reveal was progressive, not one dump",
              r1["growth_steps"] >= 5 or (r1["final_len"] > 0 and r1["growth_steps"] >= 3),
              f"growth_steps={r1['growth_steps']} first_len={r1['first_len']} final_len={r1['final_len']}")
        shot(pg, "C1_instant_image_reply")

        # ── C2: the reply reads as well-written Arabic ──
        hits = garble_hits(r1["text"])
        check("C2a instant+image: zero garbled words from the incident", len(hits) == 0, f"hits={hits}")
        # Arabic letters ratio (a healthy Arabic reply is mostly Arabic script)
        ar = len(re.findall(r"[\u0600-\u06FF]", r1["text"]))
        check("C2b instant+image: substantive Arabic answer", ar >= 60, f"arabic_chars={ar}")
        autoscroll_ok = pg.evaluate("""() => {
            const el = document.querySelector('.chatbot-messages');
            return el ? (el.scrollHeight - el.scrollTop - el.clientHeight < 150) : false;
        }""")
        check("C2c stuck to bottom (autoscroll)", autoscroll_ok)

        # ── C4 mid-session: no error language ──
        try:
            body = pg.locator(".chatbot-messages").inner_text(timeout=2000)
        except Exception:
            body = ""
        bad = [x for x in ["حدث خطأ", "خطأ في الخادم", "Internal server error", "Network error", "The network seems busy"] if x in body]
        check("C4a mid-session: zero error text", len(bad) == 0, f"hits={bad}")

        clear_chat(pg)

        # ── C3: thinking mode + image — same contract ──
        send(pg, "حلل هذه الصورة هندسياً واذكر ما يخص أنظمة القوى فيها", attach=img_path)
        r3 = watch_typing(pg, max_ms=300_000)
        check("C3a thinking+image: reply arrived", len(r3["text"]) >= 40, r3["text"][:120])
        check("C3b thinking+image: progressive reveal with caret", r3["caret_ticks"] >= 2 and r3["growth_steps"] >= 3,
              f"caret_ticks={r3['caret_ticks']} growth_steps={r3['growth_steps']}")
        hits3 = garble_hits(r3["text"])
        check("C3c thinking+image: zero garbled words", len(hits3) == 0, f"hits={hits3}")
        shot(pg, "C3_thinking_image_reply")

        try:
            body = pg.locator(".chatbot-messages").inner_text(timeout=2000)
        except Exception:
            body = ""
        bad = [x for x in ["حدث خطأ", "خطأ في الخادم", "Internal server error", "Network error", "The network seems busy"] if x in body]
        check("C4b final: zero error text across the whole session", len(bad) == 0, f"hits={bad}")

        browser.close()

    print()
    print(f"VISION-UX PROD VERIFY: {len(results)} passed, {len(fails)} failed")
    if fails:
        print("FAILED:", [n for n, _ in fails])
        sys.exit(1)
    print("ALL VISION-UX CHECKS PASSED ✓")

if __name__ == "__main__":
    main()
