#!/usr/bin/env python3
"""FINAL text-lane verify through the REAL user path (site domain, headed Chromium).
Covers the user's quality bar: progressive reveal + caret + clean Arabic + speed."""
import re, sys, time
from playwright.sync_api import sync_playwright

PROD = "https://ahmedelbaz.qzz.io"
USER, PASS = "chatfix_live_01", "ChatFix2026X"
GARBLED = ["التعاياث", "للاستاتث", "رايت دائماً", "راجلت", "أعت عن"]
fails, results = [], []

def check(name, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {str(detail)[:160]}" if detail else ""), flush=True)
    (results if cond else fails).append(name)

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=["--disable-blink-features=AutomationControlled", "--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 900},
                                  user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
                                  service_workers="block")
        pg = ctx.new_page()
        pg.goto(PROD + "/login", wait_until="domcontentloaded", timeout=60000)
        pg.wait_for_selector("input:visible:not([type='password'])", timeout=90_000)
        pg.wait_for_timeout(1200)
        for sel in ["button:has-text('موافق')", "button:has-text('قبول')", "button:has-text('Accept')"]:
            try:
                pg.locator(sel).first.click(timeout=1500); pg.wait_for_timeout(300); break
            except Exception: continue
        pg.locator("input:visible:not([type='password'])").first.fill(USER)
        pg.locator("input:visible[type='password']").first.fill(PASS)
        pg.locator("button[type='submit']").first.click()
        pg.wait_for_timeout(3500)
        pg.evaluate("() => document.querySelector('button.chatbot-fab')?.click()")
        pg.wait_for_timeout(1200)

        for q, mode_note in [("ما الفرق بين ELCB و RCCB؟ جاوب بإيجاز", "instant#1"),
                             ("ما وظيفة القاطع الرئيسي في لوحة التوزيع؟", "instant#2")]:
            box = pg.locator("textarea:visible").first
            box.fill(q)
            pg.keyboard.press("Enter")
            started = time.time()
            samples, caret_ticks = [], 0
            while time.time() - started < 120:
                try:
                    if pg.locator(".animate-typing-cursor").count() > 0: caret_ticks += 1
                    b = pg.locator(".chatbot-bubble").last
                    txt = b.inner_text(timeout=800) if b.count() > 0 else ""
                    samples.append(len(txt))
                except Exception: pass
                try:
                    enabled = pg.locator("textarea:visible").first.get_attribute("disabled") is None
                except Exception:
                    enabled = False
                if enabled and samples and pg.locator(".animate-typing-cursor").count() == 0:
                    pg.wait_for_timeout(600)
                    if pg.locator(".animate-typing-cursor").count() == 0: break
                pg.wait_for_timeout(300)
            final = ""
            try: final = pg.locator(".chatbot-bubble").last.inner_text(timeout=2000)
            except Exception: pass
            growth = sum(1 for i in range(1, len(samples)) if samples[i] > samples[i-1])
            hits = [g for g in GARBLED if g in final]
            ar = len(re.findall(r"[\u0600-\u06FF]", final))
            print(f"--- {mode_note}: q={q[:34]!r} elapsed={int(time.time()-started)}s")
            check(f"{mode_note}: reply arrived", len(final) >= 30, final[:110])
            check(f"{mode_note}: progressive reveal + caret", growth >= 3 and caret_ticks >= 2,
                  f"growth_steps={growth} caret_ticks={caret_ticks} samples={len(samples)}")
            check(f"{mode_note}: clean Arabic (zero garbled)", len(hits) == 0, f"hits={hits}")
            check(f"{mode_note}: substantive", ar >= 50, f"arabic_chars={ar}")
            # clear for the next round
            try:
                pg.locator("button[title*='مسح'], button[title*='Clear']").first.click(timeout=2500)
                pg.wait_for_timeout(1200)
            except Exception: pass
        body = ""
        try: body = pg.locator(".chatbot-messages").inner_text(timeout=1500)
        except Exception: pass
        bad = [x for x in ["حدث خطأ", "Internal server error", "Network error", "The network seems busy"] if x in body]
        check("zero error text in the session", len(bad) == 0, f"hits={bad}")
        pg.screenshot(path="/home/z/my-project/work/elbaz-platform/scripts/shots_vision_ux/final_text.png")
        browser.close()
    print(f"\nFINAL TEXT VERIFY: {len(results)} passed, {len(fails)} failed")
    if fails: print("FAILED:", fails); sys.exit(1)
    print("ALL FINAL CHECKS PASSED ✓")

if __name__ == "__main__":
    main()
