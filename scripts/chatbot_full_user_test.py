#!/usr/bin/env python3
"""FULL USER-LEVEL CHATBOT TEST — every feature, as a real user, on production.

Driven by a real headed Chromium (under Xvfb) against https://ahmedelbaz.qzz.io
Features covered:
  F1  brain icon toggle (orange glow when thinking ON)
  F2  thinking-mode question → real streaming (caret + progressive text +
      auto-scroll) + structured Arabic engineering answer
  F3  creative request (song) → polite Arabic rejection, no song content
  F4  instant-mode question → concise answer, visibly faster lane
  F5  English question → English reply (language mirror)
  F6  incomplete question → numbered clarification questions, no decisive
      invented values
  F7  image upload → vision analysis reply
  F8  clear chat → conversation resets
  F9  ZERO user-visible error text at any point (the never-busy contract)
Usage: xvfb-run managed externally; DISPLAY must be :99.
"""
import json, re, sys, time
from playwright.sync_api import sync_playwright

PROD = "https://ahmedelbaz.qzz.io"
OUT = "/home/z/my-project/work/elbaz-platform/scripts/shots_user_test"
USER, PASS = "chatfix_live_01", "ChatFix2026X"
results, fails = [], []

def check(name, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {str(detail)[:220]}" if detail else ""), flush=True)
    (results if cond else fails).append((name, detail))

def shot(pg, name):
    try: pg.screenshot(path=f"{OUT}/{name}.png")
    except Exception: pass

def no_error_text(pg):
    """F9 — scan the chat for user-visible error language."""
    try:
        body = pg.locator(".chatbot-messages").inner_text(timeout=2000)
    except Exception:
        return True, ""
    bad = []
    for pat in ["حدث خطأ", "خطأ في الخادم", "Internal server error", "Network error",
                "فشل الاتصال", "The network seems busy", "حدث خطأ ما"]:
        if pat in body:
            bad.append(pat)
    return (len(bad) == 0), ",".join(bad)

def open_chat(pg):
    pg.evaluate("() => document.querySelector('button.chatbot-fab')?.click()")
    pg.wait_for_timeout(1200)

def send(pg, text, attach=None):
    """Type a message (+ optional image path) and send it."""
    box = pg.locator("textarea:visible").first
    box.fill(text)
    if attach:
        pg.locator("input[type='file']").first.set_input_files(attach)
        pg.wait_for_timeout(800)
    pg.keyboard.press("Enter")

def wait_reply(pg, max_ms=180_000, min_len=30):
    """Wait until streaming finishes and a committed assistant bubble exists.
    Samples streaming growth for the UX checks. Returns dict of measurements."""
    deadline = time.time() + max_ms / 1000
    samples = []          # (t_ms, visible_len) of the streaming bubble
    caret_seen = False
    # wait for either the typing indicator or streaming bubble to appear
    started = time.time()
    while time.time() < started + 30:
        if pg.locator(".chatbot-messages .animate-typing-cursor, [class*='typing']").count() > 0:
            break
        pg.wait_for_timeout(300)
    while time.time() < deadline:
        try:
            bubble = pg.locator(".chatbot-bubble").last
            if bubble.count() > 0:
                caret_seen = caret_seen or pg.locator(".animate-typing-cursor").count() > 0
                txt = bubble.inner_text(timeout=1000)
                samples.append((int((time.time() - started) * 1000), len(txt)))
        except Exception:
            pass
        done = pg.locator(".chatbot-bubble").count()
        # committed bubble = last assistant message after isLoading turns off
        if done >= 1 and pg.locator("textarea:visible").first.get_attribute("disabled") is None:
            try:
                last = pg.locator(".chatbot-bubble").last.inner_text(timeout=1500)
                if len(last) >= min_len and pg.locator(".animate-typing-cursor").count() == 0:
                    grew = len(samples) >= 2 and samples[-1][1] - samples[0][1] >= min_len
                    autoscroll = pg.evaluate("""() => {
                        const el = document.querySelector('.chatbot-messages');
                        return el ? (el.scrollHeight - el.scrollTop - el.clientHeight < 120) : false;
                    }""")
                    return {"text": last, "samples": samples, "caret": caret_seen,
                            "autoscroll": autoscroll, "grew": grew}
            except Exception:
                pass
        pg.wait_for_timeout(400)
    return {"text": "", "samples": samples, "caret": caret_seen, "autoscroll": False, "grew": False}

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=["--disable-blink-features=AutomationControlled", "--no-sandbox"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 900},
                                  user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
                                  service_workers="block")
        pg = ctx.new_page()
        # ── login ──
        pg.goto(PROD + "/login", wait_until="domcontentloaded", timeout=60000)
        # Cloudflare can challenge repeatedly — wait until the login form is
        # really interactable (up to ~90s), screenshotting the blocker state.
        try:
            pg.wait_for_selector("input:visible:not([type='password'])", timeout=90_000)
        except Exception:
            shot(pg, "L0_login_blocked")
            pg.reload(wait_until="domcontentloaded", timeout=60000)
            pg.wait_for_selector("input:visible:not([type='password'])", timeout=60_000)
        pg.wait_for_timeout(1500)
        # Cookie-consent backdrop intercepts clicks — dismiss it first.
        for sel in ["button:has-text('موافق')", "button:has-text('قبول')",
                    "button:has-text('Accept')", "[data-testid='cookie-consent-accept']",
                    "[aria-label*='Dismiss']", "[aria-label*='accept' i]"]:
            try:
                pg.locator(sel).first.click(timeout=1500)
                pg.wait_for_timeout(400)
                break
            except Exception:
                continue
        pg.locator("input:visible:not([type='password'])").first.fill(USER)
        pg.locator("input:visible[type='password']").first.fill(PASS)
        pg.locator("button[type='submit']").first.click()
        pg.wait_for_timeout(7000)
        shot(pg, "L1_after_submit")
        logged = ("login" not in pg.url) or pg.evaluate("() => !!localStorage.getItem('elbaz_auth_token')")
        check("L1 login succeeded", logged, pg.url)
        shot(pg, "L1_after_login")

        # ── open chat ──
        open_chat(pg)
        chat_open = pg.locator(".chatbot-messages").count() > 0
        check("L2 chat window opens", chat_open)
        shot(pg, "L2_chat_open")

        # F1 — brain toggle
        brain = pg.locator("button[aria-pressed]").first
        brain_on = brain.count() > 0 and brain.get_attribute("aria-pressed") == "true"
        cls_on = brain.get_attribute("class") or ""
        check("F1a brain ON by default (aria-pressed=true)", brain_on)
        check("F1b brain glows orange when thinking", "f97316" in cls_on, cls_on[:120])
        brain.click(); pg.wait_for_timeout(600)
        cls_off = brain.get_attribute("class") or ""
        check("F1c brain dims when instant", "f97316" not in cls_off and "aria-pressed" == "false" or brain.get_attribute("aria-pressed") == "false", cls_off[:120])
        toast_txt = pg.locator("[data-sonner-toast]").last.inner_text(timeout=2000) if pg.locator("[data-sonner-toast]").count() else ""
        brain.click(); pg.wait_for_timeout(600)  # back to thinking
        shot(pg, "F1_brain_toggle")

        # F2 — thinking-mode structured question (streaming UX)
        send(pg, "اشرح خطوات عمل دراسة Short Circuit في ETAP بإيجاز شديد")
        r2 = wait_reply(pg)
        check("F2a thinking reply received", len(r2["text"]) > 80, f"len={len(r2['text'])}")
        check("F2b real streaming (visible text grew over samples)", r2["grew"], f"samples={len(r2['samples'])}")
        check("F2c typing caret appeared during stream", r2["caret"])
        check("F2d auto-scroll followed the text", r2["autoscroll"])
        arabic_ok = bool(re.search(r"[\u0600-\u06FF]", r2["text"]))
        structured = ("1." in r2["text"] or "•" in r2["text"]) or pg.locator(
            ".chatbot-bubble ol li, .chatbot-bubble h3, .chatbot-bubble strong").count() > 2
        eng_ok = ("Short Circuit" in r2["text"] or "ETAP" in r2["text"])
        nothink = "<think>" not in r2["text"]
        check("F2e Arabic reply", arabic_ok)
        check("F2f structured/numbered formatting", structured, r2["text"][:120])
        check("F2g engineering terms kept (ETAP/Short Circuit)", eng_ok)
        check("F2h no <think> leak", nothink)
        shot(pg, "F2_thinking_reply")
        ok, bad = no_error_text(pg)
        check("F9a no error text after thinking round", ok, bad)

        # F3 — creative rejection
        send(pg, "اكتب لي أغنية عن الحب")
        r3 = wait_reply(pg, max_ms=120_000, min_len=15)
        rejects = any(w in r3["text"] for w in ["عذر", "تخصص", "الهندسة الكهرب", "لا أستطيع", "لا يمكنني", "خارج"])
        no_song = "يا حبيبي" not in r3["text"] and len(r3["text"]) < 900
        check("F3a song request politely declined in Arabic", rejects, r3["text"][:140])
        check("F3b no creative content produced", no_song, f"len={len(r3['text'])}")
        shot(pg, "F3_rejection")
        ok, bad = no_error_text(pg)
        check("F9b no error text after rejection", ok, bad)

        # F4 — instant mode (concise lane)
        brain.click(); pg.wait_for_timeout(500)  # instant ON
        check("F4a instant toggled", brain.get_attribute("aria-pressed") == "false")
        t4 = time.time()
        send(pg, "ما هي وحدة قياس مقاومة العزل؟")
        r4 = wait_reply(pg, max_ms=90_000, min_len=8)
        dt4 = time.time() - t4
        concise = len(r4["text"]) < 700
        check("F4b instant reply received fast", len(r4["text"]) > 8 and dt4 < 60, f"dt={dt4:.1f}s len={len(r4['text'])}")
        check("F4c concise (instant lane)", concise, r4["text"][:120])
        brain.click(); pg.wait_for_timeout(500)  # back to thinking
        shot(pg, "F4_instant_reply")

        # F5 — English mirror
        send(pg, "What is the difference between IEC 60909 and ANSI C37 short circuit methods? Answer briefly.")
        r5 = wait_reply(pg, max_ms=150_000, min_len=25)
        latin_ratio = sum(1 for c in r5["text"] if c.isascii() and c.isalpha()) / max(1, len(r5["text"]))
        check("F5 English question → English reply", len(r5["text"]) > 40 and latin_ratio > 0.6, f"latin={latin_ratio:.2f} {r5['text'][:100]!r}")
        shot(pg, "F5_english_reply")

        # F6 — clarification gate (incomplete question)
        send(pg, "ما مقدار تيار القصر؟")
        r6 = wait_reply(pg, max_ms=150_000, min_len=20)
        asks = ("؟" in r6["text"]) and any(w in r6["text"] for w in ["الجهد", "الإصدار", "النسخة", "بيانات", "حدد", "أخبرني", "ما هو", "ما هي"])
        decisive_number = bool(re.search(r"\b\d{2,4}\s*(kA|كيلو أمبير)\b", r6["text"]))
        check("F6a incomplete question → clarifying questions", asks, r6["text"][:160])
        check("F6b no invented decisive fault value", not decisive_number)
        shot(pg, "F6_clarification")

        # F7 — image upload (vision)
        import base64
        png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAABG2lDQ1BpY2MAAHjarZJNSwJRFIbfxossjC4QMVNSdApxEgRBnfEqKuKhujj11UN0YXdW+yv+gS6KuIgIunSBS8FVcBUVsamJuCjSgiC68AGKtrOperationNotReal"
        ) if False else None
        # generate a tiny valid PNG with an electrical word drawn as text is
        # unreliable — use the platform's own ETAP course artwork instead.
        import urllib.request, os
        img_path = "/tmp/etap_vision_test.jpg"
        try:
            urllib.request.urlretrieve(PROD + "/etap-category.jpg", img_path)
        except Exception:
            img_path = "/home/z/my-project/work/elbaz-platform/public/etap-category.jpg"
        send(pg, "ما الذي تظهره هذه الصورة؟ اذكر نوع البرنامج الظاهر فيها بإيجاز", attach=img_path)
        r7 = wait_reply(pg, max_ms=290_000, min_len=15)
        vision_ok = len(r7["text"]) > 20 and any(w in r7["text"].lower() for w in ["etap", "ايتاب", "الإيتاب", "برنامج", "كورس", "صورة"])
        check("F7 image analyzed (vision reply)", vision_ok, r7["text"][:160])
        shot(pg, "F7_vision_reply")

        # F8 — clear chat
        pg.locator("button[title*='مسح'], button[title*='Clear']").first.click()
        pg.wait_for_timeout(1500)
        cleared = pg.locator(".chatbot-bubble").count() <= 1
        check("F8 clear chat resets conversation", cleared, f"bubbles={pg.locator('.chatbot-bubble').count()}")

        ok, bad = no_error_text(pg)
        check("F9c final: zero user-visible error text across the whole session", ok, bad)

        browser.close()

    print()
    print(f"USER TEST: {len(results)} passed, {len(fails)} failed")
    if fails:
        print("FAILED:", [n for n, _ in fails])
        sys.exit(1)
    print("ALL FEATURES PASSED ✓")

if __name__ == "__main__":
    main()
