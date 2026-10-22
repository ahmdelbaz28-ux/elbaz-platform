#!/usr/bin/env python3
"""Task 24 production E2E — dynamic multi-provider AI router (admin dashboard).

Checks:
A1  admin AI tab renders (النماذج الذكية / AI Router panel)
A2  seeded providers (NVIDIA/OpenRouter/Groq) visible with masked keys only
A3  auto-discovery on Groq fills the models table (radar button)
A4  classification badges: Chat/Free present, Vision badge on a llama-4 model
A5  connectivity test button returns a working model + latency
B1  adding a provider with a FAKE key saves but discovery fails with a clear error
B2  fake provider card shows dead/degraded status — router stays healthy
B3  fake provider deletion works (confirm dialog accepted)
C1  chatbot still answers end-to-end after the router change
D1  no raw API key ever appears in DOM or in the tRPC responses
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright

PROD = "https://ahmedelbaz.qzz.io"
ADMIN_PW = open("/home/z/my-project/.admin_pw").read().strip()
OUT = "/home/z/my-project/download/task24_shots"
FAKE_KEY = "gsk_FAKE_KEY_FOR_ROUTER_E2E_0000000000000000"
VP = {"width": 1280, "height": 900}

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(f"{'PASS' if cond else 'FAIL'}  {name}  {detail}", flush=True)


def dismiss_cookie(pg):
    for sel in ['[data-testid="cookie-accept-all"]', '[data-testid="cookie-accept-essential"]']:
        try:
            loc = pg.locator(sel).first
            if loc.is_visible(timeout=1500):
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


def dismiss_overlays(pg):
    for _ in range(3):
        try:
            if pg.locator("div.fixed.inset-0.z-\\[100\\]").count() == 0:
                break
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(500)
            for sel in ("button:has(svg.lucide-x)", '[aria-label="إغلاق"]', '[aria-label="Close"]'):
                btn = pg.locator(f"div.fixed.inset-0.z-\\[100\\] {sel}")
                if btn.count() > 0 and btn.first.is_visible():
                    btn.first.click()
                    pg.wait_for_timeout(500)
                    break
        except Exception:
            break
    dismiss_cookie(pg)


def toasts(pg):
    try:
        return pg.locator("[data-sonner-toast]").all_inner_texts()
    except Exception:
        return []


def wait_for_toast(pg, needle, timeout_s=40):
    """Poll sonner toasts for a substring (Arabic or English)."""
    end = time.time() + timeout_s
    seen = []
    while time.time() < end:
        seen = toasts(pg)
        joined = " | ".join(seen)
        if needle.lower() in joined.lower():
            return joined
        pg.wait_for_timeout(700)
    return " | ".join(seen)


def provider_card(pg, name):
    """Locate a provider card root: the rounded card containing its bold name span."""
    return pg.locator(f"div.rounded-xl.border:has(span.font-bold:text-is('{name}'))").last


def card_has_model_rows(pg, name):
    card = provider_card(pg, name)
    return card.locator("tbody tr").count()


trpc_provider_bodies = []


def main() -> int:
    import os
    os.makedirs(OUT, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"])
        ctx = browser.new_context(viewport=VP, service_workers="block")
        ctx.add_init_script("try{localStorage.setItem('language','ar');}catch(e){}")
        pg = ctx.new_page()

        pg.on("dialog", lambda d: d.accept())
        fake_key_responses = []
        save_api_bodies = []

        def on_response(resp):
            try:
                if "/api/trpc/" in resp.url and ("aiProviders" in resp.url or "aiRouterHealth" in resp.url):
                    fake_key_responses.append(resp.text())
                if "/api/trpc/admin.aiProviderSave" in resp.url and resp.request.method == "POST":
                    try:
                        save_api_bodies.append(f"{resp.status}: {resp.text()[:300]}")
                    except Exception:
                        pass
            except Exception:
                pass

        pg.on("response", on_response)

        # ---------- login ----------
        pg.goto(PROD + "/login", wait_until="domcontentloaded", timeout=45000)
        pg.wait_for_timeout(4000)
        dismiss_overlays(pg)
        pg.wait_for_timeout(800)
        dismiss_cookie(pg)
        pg.locator("form input").nth(0).fill("admin")
        pg.locator("form input[type=password]").first.fill(ADMIN_PW)
        pg.locator("form button[type=submit]").first.click()
        pg.wait_for_timeout(4000)

        # ---------- A1: open admin AI tab ----------
        pg.goto(PROD + "/admin", wait_until="domcontentloaded", timeout=45000)
        pg.wait_for_timeout(4000)
        dismiss_overlays(pg)
        pg.wait_for_timeout(800)
        dismiss_cookie(pg)
        ai_btn = pg.locator("button:has-text('النماذج الذكية'), a:has-text('النماذج الذكية')").first
        ai_btn.click(timeout=8000)
        pg.wait_for_timeout(3000)
        panel_title = pg.locator("h1:has-text('AI Router')").first
        check("A1 AI tab panel renders", panel_title.is_visible(), panel_title.inner_text()[:50] if panel_title.is_visible() else "not visible")
        pg.screenshot(path=f"{OUT}/T24_A1_panel.png")

        # ---------- A2: seeded providers ----------
        body_text = pg.locator("body").inner_text()
        for name in ("NVIDIA NIM", "OpenRouter", "Groq"):
            check(f"A2 provider '{name}' listed", name in body_text)
        masked_keys = pg.locator("span.font-mono").all_inner_texts()
        masked_ok = any("…" in m for m in masked_keys)
        check("A2 keys masked (contain …)", masked_ok, f"{len(masked_keys)} mono spans")
        pg.screenshot(path=f"{OUT}/T24_A2_providers.png")

        # ---------- A3: discovery on Groq ----------
        groq_card = provider_card(pg, "Groq")
        radar = groq_card.locator("button[title='فحص النماذج']").first
        radar.click(timeout=8000)
        t = wait_for_toast(pg, "اكتُشف", 45)
        check("A3 discovery toast", "اكتُشف" in t, t[:120])
        pg.wait_for_timeout(2000)
        rows = card_has_model_rows(pg, "Groq")
        check("A3 groq models table filled", rows > 0, f"{rows} model rows")
        pg.screenshot(path=f"{OUT}/T24_A3_discovery.png")

        # ---------- A4: classification badges ----------
        groq_models_text = groq_card.locator("tbody").first.inner_text() if rows else ""
        check("A4a Chat badge present", "شات" in groq_models_text or rows == 0)
        check("A4b Free badge present", "مجاني" in groq_models_text or rows == 0)
        vision_badge = groq_card.locator("tbody tr:has-text('scout') td:has-text('صور')").count()
        scout_row = groq_models_text.find("scout") >= 0
        check("A4c vision badge on llama-4 scout", (not scout_row) or vision_badge > 0, f"scout listed={scout_row}, vision_badges={vision_badge}")
        pg.screenshot(path=f"{OUT}/T24_A4_badges.png")

        # ---------- A5: connectivity test (retry — free tiers rate-limit) ----------
        t = ""
        for attempt in range(3):
            groq_card.locator("button[title='اختبار الاتصال']").first.click(timeout=8000)
            t = wait_for_toast(pg, "يعمل", 45)
            if "يعمل" in t:
                break
            pg.wait_for_timeout(3000)
        check("A5 test toast OK", "يعمل" in t, t[:140])

        # ---------- B1: fake provider add ----------
        add_btn = pg.locator("button:has-text('إضافة مزود')").first
        add_btn.click()
        pg.wait_for_timeout(800)
        dlg = pg.locator("[role=dialog]")
        # NOTE: re-picking the default catalog option does NOT fire Radix
        # onValueChange, so we set the baseUrl explicitly.
        base_input = dlg.locator("input[placeholder='https://api.groq.com/openai/v1']").first
        base_input.fill("https://api.groq.com/openai/v1")
        name_input = dlg.locator("input[placeholder*='Groq'], input[placeholder*='مثال']").first
        name_input.fill("E2E Fake Provider")
        key_input = dlg.locator("input[type=password]").first
        key_input.fill(FAKE_KEY)
        pg.screenshot(path=f"{OUT}/T24_B1_fake_dialog.png")
        save_btn = dlg.locator("button:has-text('إضافة وفحص')").first
        save_btn.click()
        appeared = False
        t_seen = []
        end = time.time() + 35
        while time.time() < end:
            t_seen = toasts(pg)
            if "E2E Fake Provider" in pg.locator("body").inner_text():
                appeared = True
                break
            pg.wait_for_timeout(800)
        print(f"[diag] save toasts: {t_seen}", flush=True)
        print(f"[diag] save api bodies: {json.dumps(save_api_bodies)[:400]}", flush=True)
        check("B1 fake provider card appears", appeared, f"toasts={t_seen}")
        pg.screenshot(path=f"{OUT}/T24_B1_after_save.png")
        err_text = provider_card(pg, "E2E Fake Provider").inner_text()
        check("B1b discovery error surfaced", ("401" in err_text or "مرفوض" in err_text or "degraded" in err_text or "dead" in err_text), err_text[:100].replace("\n", " / "))
        pg.screenshot(path=f"{OUT}/T24_B1_fake_card.png")

        # ---------- B2: router not broken by the dead provider ----------
        groq_txt = provider_card(pg, "Groq").inner_text()
        groq_status_ok = ("healthy" in groq_txt) and (card_has_model_rows(pg, "Groq") > 0)
        check("B2 real providers unaffected", groq_status_ok, groq_txt[:80].replace("\n", " / "))

        # ---------- B3: delete fake provider ----------
        fake_card = provider_card(pg, "E2E Fake Provider")
        del_btn = fake_card.locator("button[title='حذف']").first
        del_btn.click()
        deleted = False
        end = time.time() + 20
        while time.time() < end:
            pg.wait_for_timeout(800)
            if "E2E Fake Provider" not in pg.locator("body").inner_text():
                deleted = True
                break
        check("B3 fake provider deleted", deleted)
        pg.screenshot(path=f"{OUT}/T24_B3_deleted.png")

        # Hard safety net: remove any leftover E2E fake providers via tRPC
        leftovers = pg.evaluate("""
            async () => {
              const url = "/api/trpc/admin.aiProviders?batch=1&input=" +
                encodeURIComponent(JSON.stringify({"0":{"json":null,"meta":{"values":["undefined"]}}}));
              const r = await fetch(url, { credentials: "include" });
              const j = await r.json();
              const d = j[0]?.result?.data?.json ?? j[0]?.result?.data;
              return (d?.providers || []).filter(p => p.displayName.includes("E2E Fake")).map(p => p.id);
            }
        """)
        for lid in leftovers:
            pg.evaluate("""
                async (id) => {
                  await fetch("/api/trpc/admin.aiProviderDelete?batch=1", {
                    method: "POST", credentials: "include",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({"0":{"json":{"id": id}}}),
                  });
                }
            """, lid)
        if leftovers:
            print(f"[cleanup] removed leftovers: {leftovers}", flush=True)

        # ---------- A6: re-scan all → vision models discovered (OpenRouter VL) ----------
        pg.locator("button:has-text('فحص الكل')").first.click(timeout=8000)
        wait_for_toast(pg, "فحص جميع المزودين", 90)
        pg.wait_for_timeout(2500)
        vision_stat = pg.locator("div.rounded-xl:has-text('نماذج الرؤية') div.text-2xl").first.inner_text()
        check("A6 vision models > 0 after re-scan", vision_stat.strip() not in ("0", ""), f"vision stat = {vision_stat}")
        pg.screenshot(path=f"{OUT}/T24_A6_rescan.png")

        # ---------- D1: no raw key leak ----------
        dom_all = pg.locator("body").inner_text()
        check("D1 fake key not in DOM", FAKE_KEY not in dom_all)
        leaked = [b for b in fake_key_responses if FAKE_KEY in b]
        check("D1b fake key not in tRPC payloads", len(leaked) == 0, f"{len(fake_key_responses)} responses scanned")
        raw_field = [b for b in fake_key_responses if '"apiKey":"' in b and '"apiKey":""' not in b]
        check("D1c no raw apiKey field returned", len(raw_field) == 0)

        # ---------- C1: chat still answers ----------
        pg.goto(PROD + "/", wait_until="domcontentloaded", timeout=45000)
        pg.wait_for_timeout(4000)
        dismiss_overlays(pg)
        pg.wait_for_timeout(800)
        dismiss_cookie(pg)
        pg.locator(".chatbot-fab").first.click()
        pg.wait_for_selector(".chatbot-window", timeout=10000)
        pg.wait_for_timeout(600)
        try:
            pg.locator('.chatbot-window button[title="مسح المحادثة"]').first.click()
            pg.wait_for_timeout(500)
        except Exception:
            pass
        before = pg.locator(".chatbot-window .chatbot-bubble, .chatbot-window [class*='bubble']").count()
        inp = pg.locator(".chatbot-window textarea, .chatbot-window input[type=text]").last
        inp.fill("ما هي برمجية ETAP ومتى تستخدم؟")
        inp.press("Enter")
        got_reply = False
        deadline = time.time() + 100
        while time.time() < deadline:
            pg.wait_for_timeout(2000)
            now = pg.locator(".chatbot-window .chatbot-bubble, .chatbot-window [class*='bubble']").count()
            text_now = pg.locator(".chatbot-window").inner_text()
            if now > before and ("ETAP" in text_now or "تحليل" in text_now or "برنامج" in text_now or "كهرباء" in text_now):
                got_reply = True
                break
        check("C1 chatbot replies after router integration", got_reply)
        pg.screenshot(path=f"{OUT}/T24_C1_chat_reply.png")

        browser.close()

    failed = [r for r in results if not r[1]]
    print(f"\n===== {len(results) - len(failed)}/{len(results)} PASS =====")
    for name, ok, detail in results:
        print(f"  {'✓' if ok else '✗'} {name}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
