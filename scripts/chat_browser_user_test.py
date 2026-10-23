"""BROWSER USER-TEST — drive the chatbot exactly like the owner would:
open the widget, send an instant-mode question, and while the answer streams
verify (a) the text appears PROGRESSIVELY (never one dead block), (b) the
blinking caret is visible during typing, (c) the log auto-sticks to bottom,
(d) the final markdown bubble renders. Then flip to thinking mode and repeat.
Runs against the LOCAL server (real kilocode gateway as first provider).
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3999"
fails: list[str] = []

# auth.me network mock — logged-in user (same pattern as chatbot_gate_e2e C)
USER_JSON = {"id": 54, "username": "usertest", "name": "User Test", "role": "user", "email": None}
ME_OK = {"result": {"data": {"json": USER_JSON}}}


def setup_auth_mock(pg):
    def handler(route):
        if route.request.url.split("/api/trpc/")[-1].split("?")[0] == "auth.me":
            route.fulfill(status=200, content_type="application/json", body=json.dumps(ME_OK))
            return
        return route.continue_()
    pg.route("**/api/trpc/**", handler)

# auth.me network mock — logged-in user (same pattern as chatbot_gate_e2e C)
USER_JSON = {"id": 54, "username": "usertest", "name": "User Test", "role": "user", "email": None}
ME_OK = {"result": {"data": {"json": USER_JSON}}}


def setup_auth_mock(pg):
    def handler(route):
        if route.request.url.split("/api/trpc/")[-1].split("?")[0] == "auth.me":
            route.fulfill(status=200, content_type="application/json", body=json.dumps(ME_OK))
            return
        return route.continue_()
    pg.route("**/api/trpc/**", handler)


def check(name, cond, detail=""):
    print(f"{'✓' if cond else '✗'} {name}" + (f" — {detail}" if detail else ""))
    if not cond:
        fails.append(name)


def ensure_widget_open(page):
    """Handle the widget states: open / minimized / greeting bubble / FAB."""
    if page.locator("textarea").count() > 0:
        return  # already open
    # JS click on the FAB — immune to overlays (greeting/cookie edge cases)
    page.evaluate("() => document.querySelector('button.chatbot-fab')?.click()")
    page.wait_for_timeout(700)
    if page.locator("textarea").count() > 0:
        return
    page.evaluate("() => document.querySelectorAll('button.chatbot-fab, button[aria-label=\"فتح الشات\"]')[0]?.click()")
    page.wait_for_timeout(700)


def run_mode(page, mode: str, question: str, expect_min_chars: int):
    # open the widget (FAB / minimized bubble / greeting dismiss)
    ensure_widget_open(page)
    page.wait_for_selector("textarea", timeout=15_000)
    ta = page.locator("textarea").first
    # pick the mode explicitly (aria-pressed reflects thinking state)
    toggle = page.locator('button[aria-pressed]')
    is_thinking = toggle.get_attribute("aria-pressed") == "true"
    if (mode == "thinking") != is_thinking:
        toggle.click()
        page.wait_for_timeout(300)
    check(f"{mode}: mode toggled correctly", toggle.get_attribute("aria-pressed") == ("true" if mode == "thinking" else "false"))

    # send the question
    ta.fill(question)
    page.locator('button[aria-label="إرسال"], button[aria-label="Send"]').first.click()

    # observe the STREAM: sample the streaming bubble text + caret 8 times
    samples = []
    caret_seen = False
    deadline = time.time() + 75
    while time.time() < deadline:
        state = page.evaluate("""() => {
          const caret = document.querySelector('.animate-typing-cursor');
          const log = document.querySelector('[role="log"]');
          // streaming bubble = last .chatbot-bubble inside the streaming row
          const bubbles = document.querySelectorAll('.chatbot-bubble');
          const last = bubbles.length ? bubbles[bubbles.length - 1] : null;
          return {
            caretVisible: !!caret && caret.offsetParent !== null,
            textLen: last ? last.innerText.length : 0,
            stick: log ? (log.scrollTop + log.clientHeight >= log.scrollHeight - 60) : false,
          };
        }""")
        samples.append((time.time(), state))
        if state["caretVisible"]:
            caret_seen = True
        # finished when a committed assistant bubble exists and caret is gone
        done = page.evaluate("""() => {
          const bubbles = document.querySelectorAll('[role="log"] > div');
          return bubbles.length;
        }""")
        time.sleep(0.7)
        # stop when streaming is over (caret removed) after having text
        if state["textLen"] > expect_min_chars and not page.evaluate("""() => !!document.querySelector('.animate-typing-cursor')"""):
            break
        if time.time() > deadline:
            break

    texts = [s[1]["textLen"] for s in samples]
    grew = sum(1 for i in range(1, len(texts)) if texts[i] > texts[i - 1])
    stick_violations = sum(1 for s in samples if s[1]["textLen"] > 40 and not s[1]["stick"])
    print(f"  [{mode}] samples textLen: {texts[:14]}{'…' if len(texts) > 14 else ''}")
    check(f"{mode}: text appeared PROGRESSIVELY (≥3 growth steps)", grew >= 3, f"growth_samples={grew}/{max(0, len(texts)-1)}")
    check(f"{mode}: caret visible during typing", caret_seen)
    check(f"{mode}: log sticks to bottom while streaming", stick_violations == 0, f"violations={stick_violations}")
    final_len = page.evaluate("""() => {
      const bubbles = document.querySelectorAll('.chatbot-bubble');
      return bubbles.length ? bubbles[bubbles.length - 1].innerText.length : 0;
    }""")
    check(f"{mode}: final answer rendered (≥ {expect_min_chars} chars)", final_len >= expect_min_chars, f"len={final_len}")
    page.screenshot(path=f"/tmp/shot_chat_{mode}.png")
    # reset for the next mode: minimize
    page.evaluate("""() => { window.dispatchEvent(new Event('resize')); }""")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 860})
    # stored-auth flag — without it the client never asks auth.me and the FAB
    # click is gated to /login (chatbot_gate_e2e scenario A behavior)
    page.context.add_cookies([{"name": "elbaz_auth_flag", "value": "1", "url": BASE}])
    setup_auth_mock(page)
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    # the site may boot in English — the owner's experience is the Arabic UI
    try:
        page.get_by_role("button", name="Switch to Arabic").click(timeout=3000)
        page.wait_for_timeout(1200)
    except Exception:
        pass
    # accept cookies / dismiss overlays (they intercept real clicks)
    try:
        page.get_by_role("button", name="Accept all").click(timeout=3000)
        page.wait_for_timeout(400)
    except Exception:
        page.evaluate("() => document.querySelector('[data-testid=\"cookie-consent-backdrop\"]')?.click()")
    page.wait_for_timeout(800)
    # consent-ish overlays may exist — close any obvious one
    try:
        page.keyboard.press("Escape")
    except Exception:
        pass

    run_mode(page, "instant", "ما وظيفة قاطع التسريب في لوحة الكهرباء؟ اجب بإيجاز.", 120)
    page.wait_for_timeout(1200)
    run_mode(page, "thinking", "اشرح خطوات تحليل أحمال لوحة توزيع كهربائية في ETAP.", 150)

    browser.close()

print()
if fails:
    print(f"BROWSER USER-TEST FAILED: {len(fails)} — {fails}")
    sys.exit(1)
print("BROWSER USER-TEST: ALL CHECKS PASSED")
