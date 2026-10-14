"""Visual + geometric verification of the mobile FAB declutter fix.

Serves dist/public via the real boot.ts server (sandbox DB), then:
- Mobile 390x844: measure chatbot FAB, WhatsApp FAB, scroll-top FAB, bottom nav
  → assert: whatsapp directly above chatbot (right column, ~12px gap),
    scroll-top alone on the left at the same baseline, no overlaps with nav.
- Desktop 1440x900: whatsapp back at bottom-left, chatbot bottom-right.
- Screenshots at footer scroll position for eyeball review.
"""
import subprocess, time, sys, json
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3999"
OUT = "/home/z/my-project/work/elbaz-platform/scripts/shots_fab"
subprocess.run(["mkdir", "-p", OUT], check=True)

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
                          stdout=open("/tmp/boot_fab.log", "w"),
                          stderr=subprocess.STDOUT)
time.sleep(12)

results = {"fail": []}
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ---------- MOBILE ----------
        ctx = browser.new_context(viewport={"width": 390, "height": 844},
                                  device_scale_factor=2, is_mobile=True,
                                  has_touch=True,
                                  user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
        pg = ctx.new_page()
        pg.goto(BASE + "/", wait_until="domcontentloaded", timeout=30000)
        pg.wait_for_timeout(2500)
        # accept cookie consent so it doesn't cover screenshots / intercept taps
        try:
            pg.get_by_role("button", name="Accept all").click(timeout=4000)
            pg.wait_for_timeout(500)
        except Exception:
            pass
        pg.wait_for_timeout(3500)  # WhatsApp appears after 2s delay + app boot

        def box(sel):
            el = pg.locator(sel).first
            el.scroll_into_view_if_needed()
            return el.bounding_box()

        chat = pg.evaluate("""() => {
            const el = document.querySelector('.chatbot-fab');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {x: r.x, y: r.y, w: r.width, h: r.height};
        }""")
        wa = pg.evaluate("""() => {
            const el = document.querySelector('.whatsapp-fab-wrap');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {x: r.x, y: r.y, w: r.width, h: r.height};
        }""")
        st = pg.evaluate("""() => {
            const el = document.querySelector('.scroll-top-fab');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {x: r.x, y: r.y, w: r.width, h: r.height};
        }""")
        nav = pg.evaluate("""() => {
            const el = document.querySelector('.mobile-bottom-nav');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {x: r.x, y: r.y, w: r.width, h: r.height};
        }""")
        print("MOBILE chatbot FAB:", chat)
        print("MOBILE whatsapp  :", wa)
        print("MOBILE scroll-top:", st)
        print("MOBILE bottom nav:", nav)

        vw = 390
        # 1) WhatsApp on the right, same right edge as chatbot
        chat_right = chat["x"] + chat["w"]; wa_right = wa["x"] + wa["w"]
        if abs(chat_right - wa_right) > 2: results["fail"].append(f"right edges differ: {chat_right} vs {wa_right}")
        # 2) WhatsApp directly above chatbot with ~12px gap
        gap = chat["y"] - (wa["y"] + wa["h"])
        if not (8 <= gap <= 16): results["fail"].append(f"stack gap={gap}px (want ~12)")
        # 3) Scroll-top alone on the LEFT, ~same visual baseline as chatbot (centers ±6px)
        if st["x"] > vw / 2: results["fail"].append(f"scroll-top not on left: x={st['x']}")
        st_center = st["y"] + st["h"] / 2; chat_center = chat["y"] + chat["h"] / 2
        if abs(st_center - chat_center) > 6: results["fail"].append(f"scroll-top center {st_center} != chatbot {chat_center}")
        # 4) No overlap with bottom nav (button BOTTOM must stay above nav TOP)
        if chat["y"] + chat["h"] > nav["y"]: results["fail"].append("chatbot overlaps nav")
        if wa["y"] + wa["h"] > nav["y"]: results["fail"].append("whatsapp overlaps nav zone")
        # 5) Buttons inside viewport
        for name, b in [("chat", chat), ("wa", wa)]:
            if b["x"] < 0 or b["x"] + b["w"] > vw: results["fail"].append(f"{name} outside viewport")

        # scroll to footer + scroll-top visible, screenshot
        pg.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        pg.wait_for_timeout(1500)
        st2 = pg.evaluate("""() => {
            const el = document.querySelector('.scroll-top-fab span span');
            const r = document.querySelector('.scroll-top-fab').getBoundingClientRect();
            return {x: r.x, y: r.y, visible: getComputedStyle(document.querySelector('.scroll-top-fab span')).opacity};
        }""")
        print("MOBILE scroll-top at footer:", st2)
        pg.screenshot(path=f"{OUT}/mobile_footer.png")
        # tooltip open check — a sandbox promo modal (z-100, blocks everything
        # until dismissed) intercepts taps; use a JS click to bypass hit-testing
        pg.evaluate("window.scrollTo(0, 0)")
        pg.wait_for_timeout(800)
        pg.evaluate("document.querySelector('.whatsapp-fab-wrap button').click()")
        pg.wait_for_timeout(600)
        pg.wait_for_timeout(600)
        tt = pg.evaluate("""() => {
            const el = document.getElementById('whatsapp-tooltip');
            const r = el.getBoundingClientRect();
            return {x: r.x, y: r.y, w: r.width, visible: getComputedStyle(el).opacity};
        }""")
        print("MOBILE tooltip:", tt)
        if tt["x"] < 0: results["fail"].append(f"tooltip overflows left: x={tt['x']}")
        pg.screenshot(path=f"{OUT}/mobile_tooltip.png")
        ctx.close()

        # ---------- DESKTOP (must be unchanged) ----------
        ctx2 = browser.new_context(viewport={"width": 1440, "height": 900})
        pg2 = ctx2.new_page()
        pg2.goto(BASE + "/", wait_until="domcontentloaded", timeout=30000)
        pg2.wait_for_timeout(2500)
        try:
            pg2.get_by_role("button", name="Accept all").click(timeout=4000)
            pg2.wait_for_timeout(500)
        except Exception:
            pass
        pg2.wait_for_timeout(3500)
        d = pg2.evaluate("""() => {
            const g = s => { const el = document.querySelector(s); if (!el) return null;
                const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; };
            return {chat: g('.chatbot-fab'), wa: g('.whatsapp-fab-wrap'), st: g('.scroll-top-fab')};
        }""")
        print("DESKTOP:", json.dumps(d))
        # whatsapp bottom-LEFT (x small), chatbot bottom-RIGHT
        if d["wa"]["x"] > 200: results["fail"].append(f"desktop whatsapp not bottom-left: x={d['wa']['x']}")
        if d["chat"]["x"] < 1000: results["fail"].append(f"desktop chatbot not bottom-right: x={d['chat']['x']}")
        if abs((d["wa"]["y"] + d["wa"]["h"]) - (d["chat"]["y"] + d["chat"]["h"])) > 4:
            results["fail"].append("desktop baselines differ")
        pg2.screenshot(path=f"{OUT}/desktop_home.png")
        ctx2.close()
        browser.close()
finally:
    server.terminate()

print("\n=== RESULT ===")
if results["fail"]:
    print("FAILURES:"); [print(" -", f) for f in results["fail"]]; sys.exit(1)
print("ALL GEOMETRY CHECKS PASSED ✓")
