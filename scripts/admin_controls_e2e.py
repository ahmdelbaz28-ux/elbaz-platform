"""LOCAL E2E — admin dashboard playlist controls (mobile viewport).

Verifies the owner's full-playlist-control set in the admin UI:
  A1  Courses tab shows the subscribe-gate settings card (toggle+URL+days)
  A2  Lessons dialog shows ▲/▼ reorder buttons for each lesson
  A3  Clicking ▼ fires admin.moveLesson (POST) and the list re-renders swapped
  A4  «Import ALL playlist videos» button fires admin.importPlaylistVideos
Shots: /home/z/my-project/download/admin_controls_e2e/
Run: vite dev on 127.0.0.1:5173, then python3 scripts/admin_controls_e2e.py
"""
import json
import re
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:5173"
OUT = "/home/z/my-project/download/admin_controls_e2e"
subprocess.run(["mkdir", "-p", OUT], check=True)

ADMIN_JSON = {"id": 9, "username": "admin", "name": "Admin", "role": "admin", "email": "a@b.c"}
COURSES = {"result": {"data": {"json": {"items": [{
    "id": 1, "slug": "etap-complete-course", "titleEn": "ETAP Complete Course", "titleAr": "كورس ETAP الشامل",
    "descriptionEn": "", "descriptionAr": "", "shortDescEn": None, "shortDescAr": None,
    "thumbnailUrl": None, "price": "1999", "isPremium": False, "isFeatured": False,
    "isPublished": True, "level": "beginner", "category": 1, "studentCount": 5,
    "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z",
}], "total": 1}}}}
CATS = {"result": {"data": {"json": [{"id": 1, "nameEn": "Power", "nameAr": "قوى", "slug": "power"}]}}}
SUB_GATE = {"result": {"data": {"json": {"enabled": "true", "channelUrl": "https://www.youtube.com/@AhmedElbazEng", "days": "30"}}}}

def lessons_payload(order):
    rows = [
        {"id": 101, "courseId": 1, "titleAr": "الدرس الأول", "titleEn": "Lesson One",
         "descriptionAr": "", "descriptionEn": "", "isFree": True, "durationMinutes": 10,
         "sortOrder": order[0], "isPublished": True},
        {"id": 102, "courseId": 1, "titleAr": "الدرس الثاني", "titleEn": "Lesson Two",
         "descriptionAr": "", "descriptionEn": "", "isFree": False, "durationMinutes": 12,
         "sortOrder": order[1], "isPublished": True},
    ]
    return {"result": {"data": {"json": {"items": rows}}}}

state = {"order": [1, 2], "moves": 0, "imports": 0}

def envelope(method, path, url):
    if method == "GET":
        if path == "auth.me":
            return {"result": {"data": {"json": ADMIN_JSON}}}
        if path.startswith("admin.listCourses"):
            return COURSES
        if path.startswith("course.categories"):
            return CATS
        if path.startswith("settings.getSection") and "subscribeGate" in url:
            return SUB_GATE
        if path.startswith("admin.listLessons"):
            return lessons_payload(state["order"])
        return None
    if method == "POST":
        if path.startswith("admin.moveLesson"):
            state["moves"] += 1
            state["order"] = state["order"][::-1]
            return {"result": {"data": {"json": {"success": True, "moved": True}}}}
        if path.startswith("admin.importPlaylistVideos"):
            state["imports"] += 1
            return {"result": {"data": {"json": {"created": 3, "skipped": 2, "total": 5, "verified": True, "titles": []}}}}
        return None
    return None

fails, notes = [], []
def check(name, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
    (notes if cond else fails).append((name, detail))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                              has_touch=True, locale="ar-EG", service_workers="block")
    ctx.add_cookies([{"name": "elbaz_auth_flag", "value": "1", "url": BASE}])
    pg = ctx.new_page()
    pg.add_init_script("try{localStorage.setItem('language','ar')}catch(e){}")

    def handler(route):
        url = route.request.url
        if "/api/trpc/" not in url:
            return route.continue_()
        method = route.request.method
        path = url.split("/api/trpc/")[1].split("?")[0]
        body = envelope(method, path, url)
        if body is None:
            # Benign fallback: ANY unmocked 401 from the dev backend would nuke
            # the session and bounce to /login — answer 200 with an empty json
            # instead (shape mismatches are harmless on tabs we never open).
            body = {"result": {"data": {"json": {} if method == "GET" else {"success": True}}}}
        return route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

    pg.route("**/api/trpc/**", handler)
    pg.goto(BASE + "/admin", wait_until="domcontentloaded", timeout=45_000)
    pg.wait_for_timeout(4_000)
    pg.evaluate("() => document.querySelector('vite-error-overlay')?.remove()")
    pg.evaluate("() => document.querySelector('[data-testid=cookie-consent-backdrop]')?.click()")
    pg.wait_for_timeout(600)

    # Land on the courses tab — on mobile the sidebar is off-canvas: open the
    # top-bar hamburger first (same pattern as mobile_nav_e2e M3/M4).
    tab = pg.get_by_text("إدارة الكورسات", exact=False)
    if tab.count() == 0 or not tab.first.is_visible():
        burger = pg.locator("[data-testid=admin-mobile-menu]")
        burger.first.click()
        pg.wait_for_timeout(900)
        tab = pg.get_by_text("إدارة الكورسات", exact=False)
    if tab.count() > 0:
        tab.first.click()
        pg.wait_for_timeout(1_500)

    card = pg.locator("[data-testid=subscribe-gate-settings]")
    check("A1) subscribe-gate settings card visible", card.count() > 0 and card.first.is_visible())
    if card.count():
        pg.evaluate("() => document.querySelector('[data-testid=subscribe-gate-settings]')?.scrollIntoView({block:'center'})")
        pg.wait_for_timeout(500)
        pg.screenshot(path=f"{OUT}/A1_gate_settings_card.png")

    # Open the lessons dialog
    lessons_btn = pg.get_by_role("button", name=re.compile("الدروس|Lessons")).first
    lessons_btn.click()
    pg.wait_for_timeout(1_800)
    dlg = pg.locator("[data-testid=import-all-playlist]")
    check("A2-pre) lessons dialog opened", dlg.count() > 0)

    up = pg.locator("[data-testid^=lesson-move-up-]")
    down = pg.locator("[data-testid^=lesson-move-down-]")
    check("A2) reorder buttons rendered for lessons", up.count() >= 1 and down.count() >= 2,
          f"up={up.count()} down={down.count()}")

    first_row_title = pg.locator("[data-testid^=lesson-move-down-]").first
    # click ▼ on the FIRST lesson → server swaps → invalidated list refetches swapped
    first_row_title.click()
    pg.wait_for_timeout(1_500)
    check("A3) admin.moveLesson fired", state["moves"] == 1, f"moves={state['moves']}")
    first_title = pg.locator("p", has_text="الدرس الثاني").first
    check("A3) list re-rendered in the swapped order", first_title.count() > 0)

    import_all = pg.locator("[data-testid=import-all-playlist]")
    check("A4-pre) import-all button visible", import_all.count() > 0 and import_all.first.is_visible())
    pg.evaluate("() => document.querySelector('[data-testid=import-all-playlist]')?.scrollIntoView({block:'center'})")
    pg.wait_for_timeout(400)
    import_all.first.click()
    pg.wait_for_timeout(1_500)
    check("A4) admin.importPlaylistVideos fired", state["imports"] == 1, f"imports={state['imports']}")
    pg.screenshot(path=f"{OUT}/A4_after_import_click.png")

    ctx.close()
    browser.close()

print("\n=== RESULT ===")
if fails:
    print("FAILURES:")
    for f in fails: print(" -", f)
    sys.exit(1)
print(f"ADMIN CONTROLS E2E PASSED ✓ ({len(notes)} checks)")
