"""Diag: FAB click → what state is the widget in? Screenshots + DOM dump."""
import json, os, tempfile

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3999"
OUT_DIR = tempfile.mkdtemp(prefix="chat_diag_")  # S5443 — private dir instead of /tmp
USER_JSON = {"id": 54, "username": "usertest", "name": "User Test", "role": "user", "email": None}
ME_OK = {"result": {"data": {"json": USER_JSON}}}


def setup_auth_mock(pg):
    def handler(route):
        if route.request.url.split("/api/trpc/")[-1].split("?")[0] == "auth.me":
            route.fulfill(status=200, content_type="application/json", body=json.dumps(ME_OK))
            return
        return route.continue_()
    pg.route("**/api/trpc/**", handler)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 860})
    pg.context.add_cookies([{"name": "elbaz_auth_flag", "value": "1", "url": BASE}])
    setup_auth_mock(pg)
    auth_calls = []
    pg.on("request", lambda r: auth_calls.append(r.url[:110]) if "auth.me" in r.url else None)
    pg.goto(BASE, wait_until="domcontentloaded")
    pg.wait_for_timeout(3000)
    pg.screenshot(path=os.path.join(OUT_DIR, "diag_1_loaded.png"))
    print("URL:", pg.url)
    print("auth.me calls:", auth_calls)
    fab = pg.locator("button.chatbot-fab")
    print("FAB count:", fab.count())
    pg.evaluate("() => document.querySelector('button.chatbot-fab')?.click()")
    pg.wait_for_timeout(2000)
    pg.screenshot(path=os.path.join(OUT_DIR, "diag_2_after_fab.png"))
    print("URL after FAB:", pg.url)
    labels = pg.eval_on_selector_all("button", "els => els.map(e => (e.getAttribute('aria-label')||e.innerText||'').slice(0,40))")
    print("BUTTONS:", [l for l in labels if l][:25])
    ta = pg.locator('textarea[aria-label="اكتب رسالتك"]')
    print("textarea count:", ta.count())
    b.close()
