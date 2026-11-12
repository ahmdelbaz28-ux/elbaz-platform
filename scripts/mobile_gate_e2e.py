"""LOCAL E2E — mobile video fit + subscribe gate + desktop regression.

Runs the real vite frontend (tRPC intercepted) and verifies, at PHONE size:
  M1  page never overflows horizontally (no cut edges)
  M2  the embedded YouTube iframe FILLS its 16:9 screen slot exactly
      (the IFrame-API-replaces-the-mount-div bug used to leave it 640×360)
  M3  the subscribe gate appears before playback on a fresh device,
      unlocks via «أنا مشترك بالفعل», and STAYS unlocked after reload
  D1  desktop (1280×900) still plays with a perfectly fitted iframe
Shots: /home/z/my-project/download/mobile_e2e/

Run:  vite dev on 127.0.0.1:5173, then
      EXPECT_GATE=1 python3 scripts/mobile_gate_e2e.py
EXPECT_GATE=1 makes the gate checks mandatory (new build); without it the
gate is reported informationally (old build, used for the before/proof).
"""
import json
import os
import re
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

import os as _os
import sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from _gate_unlock import gate_visible as _gate_shown, unlock_subscribe_gate

BASE = "http://127.0.0.1:5173"
COURSE_PATH = "/courses/etap-complete-course"
OUT = "/home/z/my-project/download/mobile_e2e"
subprocess.run(["mkdir", "-p", OUT], check=True)
YT_ID = "dQw4w9WgXcQ"
EXPECT_GATE = os.environ.get("EXPECT_GATE", "0") == "1"
USER_JSON = {"id": 54, "username": "mobe2e01", "name": "Mobile E2E", "role": "user", "email": None}

COURSE_JSON = {
    "id": 1, "slug": "etap-complete-course",
    "titleAr": "كورس ETAP الشامل", "titleEn": "ETAP Complete Course",
    "descriptionAr": "وصف", "descriptionEn": "desc",
    "learningOutcomesAr": [], "learningOutcomesEn": [],
    "thumbnail": None, "price": "1999", "originalPrice": "2500",
    "isPremium": False, "isPublished": True, "rating": "4.8",
    "studentCount": 120, "durationHours": 40,
    "category": {"nameEn": "Power", "nameAr": "قوى كهربية"},
    "lessons": [
        {"id": 101, "courseId": 1, "titleAr": "درس يوتيوب", "titleEn": "YouTube lesson",
         "descriptionAr": "", "descriptionEn": "", "isFree": True, "durationMinutes": 15,
         "sortOrder": 1, "isPublished": True},
    ],
}
ME_OK = {"result": {"data": {"json": USER_JSON}}}
CHECK_ENROLL = {"result": {"data": {"json": {"enrolled": True, "isCompleted": False, "progress": 0}}}}
LESSON_VIDEO = {"result": {"data": {"json": {
    "videoUrl": f"https://www.youtube-nocookie.com/embed/{YT_ID}?enablejsapi=1",
    "hlsUrl": None, "expiresAt": "2030-01-01T00:00:00.000Z",
    "watermarkToken": "tok", "kind": "youtube", "youtubeId": YT_ID,
}}}}
SAVED_POS = {"result": {"data": {"json": {"lastPosition": 0, "watchedSeconds": 0, "isCompleted": False}}}}
SUB_GATE_OK = {"result": {"data": {"json": {
    "enabled": "true", "channelUrl": "https://www.youtube.com/@AhmedElbazEng", "days": "30",
}}}}

MY_REVIEW_NULL = {"result": {"data": {"json": None}}}
PAYMOB_OFF = {"result": {"data": {"json": {
    "configured": False, "missing": ["all"], "mode": "unset",
    "methods": {"card": False, "wallet": False},
}}}}

def envelope_for_get(name: str, url: str):
    if name == "auth.me": return 200, ME_OK
    if name.startswith("review.myReview"): return 200, MY_REVIEW_NULL
    if name.startswith("course.previewVideo"): return 200, LESSON_VIDEO
    if name.startswith("payment.isConfigured"): return 200, PAYMOB_OFF
    if name == "course.checkEnrollment": return 200, CHECK_ENROLL
    if name.startswith("course.lessonVideo"): return 200, LESSON_VIDEO
    if name.startswith("course.getSavedPosition"): return 200, SAVED_POS
    if name.startswith("course.bySlug"): return 200, {"result": {"data": {"json": COURSE_JSON}}}
    if name.startswith("settings.getSection"):
        # ONLY mock the subscribeGate section — other sections (contact, hero…)
        # pass through untouched so their consumers keep their real behavior.
        if "subscribeGate" in url:
            return 200, SUB_GATE_OK
        return None
    return None

fails, notes = [], []
def check(name, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
    (notes if cond else fails).append((name, detail))

def note(name, detail):
    print(f"[INFO] {name} — {detail}")

MEASURE = """
() => {
  const vw = document.documentElement.clientWidth;
  const doc = document.documentElement;
  const bodyW = document.body ? document.body.scrollWidth : 0;
  const host = document.querySelector('[data-youtube-player]');
  let fit = null;
  if (host) {
    const screen = host.querySelector('.aspect-video') || host.firstElementChild;
    const iframe = host.querySelector('iframe');
    const s = screen ? screen.getBoundingClientRect() : null;
    const f = iframe ? iframe.getBoundingClientRect() : null;
    fit = {
      screenW: s ? Math.round(s.width) : 0, screenH: s ? Math.round(s.height) : 0,
      iframeW: f ? Math.round(f.width) : 0, iframeH: f ? Math.round(f.height) : 0,
    };
  }
  return { vw, scrollW: Math.max(doc.scrollWidth, bodyW), overflow: Math.max(doc.scrollWidth, bodyW) - vw, fit };
}
"""

def open_course(pg):
    pg.goto(BASE + COURSE_PATH, wait_until="domcontentloaded", timeout=45_000)
    pg.wait_for_timeout(3_500)
    pg.evaluate("() => document.querySelector('vite-error-overlay')?.remove()")
    try:
        pg.get_by_role("button", name=re.compile("accept|موافق|قبول", re.I)).click(timeout=2_000)
    except Exception:
        pass
    pg.evaluate("() => document.querySelector('[data-testid=cookie-consent-backdrop]')?.click()")
    pg.wait_for_timeout(400)
    target = None
    for t in ("YouTube lesson", "درس يوتيوب"):
        loc = pg.get_by_text(t, exact=False)
        if loc.count() > 0:
            target = loc.first
            break
    if not target:
        return False
    target.click()
    pg.wait_for_timeout(2_000)
    return True

def wait_player(pg, timeout_s=15):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if pg.locator("[data-youtube-player] iframe[src*='youtube-nocookie.com']").count() > 0:
            return True
        pg.wait_for_timeout(500)
    return False

def make_handler():
    def handler(route):
        url = route.request.url
        if "/api/trpc/" not in url:
            return route.continue_()
        path = url.split("/api/trpc/")[1].split("?")[0]
        if route.request.method == "GET":
            if path.startswith("course.lessonVideo"):
                return route.fulfill(status=200, content_type="application/json", body=json.dumps(LESSON_VIDEO))
            packed = envelope_for_get(path, url)
            if packed:
                st, body = packed
                return route.fulfill(status=st, content_type="application/json", body=json.dumps(body))
        return route.continue_()
    return handler

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox"])

    # ─────────────────────── MOBILE 390×844 ───────────────────────
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                              is_mobile=True, has_touch=True,
                              user_agent="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
                              locale="ar-EG", service_workers="block")
    ctx.add_cookies([{"name": "elbaz_auth_flag", "value": "1", "url": BASE}])
    pg = ctx.new_page()
    pg.route("**/api/trpc/**", make_handler())
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)[:120]))

    if not open_course(pg):
        check("mobile) lesson row visible + clickable", False)
    else:
        m = pg.evaluate(MEASURE)
        check("mobile) page has NO horizontal overflow (before unlock)", m["overflow"] <= 2, f"overflow={m['overflow']}px vw={m['vw']}")

        # ── Subscribe gate on a fresh device (HARD: no skip button) ──
        gate = pg.locator("[data-testid=subscribe-gate]")
        shown = gate.count() > 0 and gate.first.is_visible()
        gate_visible = shown
        if EXPECT_GATE:
            check("mobile) subscribe gate blocks playback on fresh device", gate_visible)
            check("mobile) no skip button exists (hard gate)", pg.locator("[data-testid=subscribe-gate-already]").count() == 0)
        else:
            note("mobile) subscribe gate visible (old build: informational)", str(gate_visible))
        pg.screenshot(path=f"{OUT}/mobile_gate.png")

        if gate_visible:
            # Unlock via the enforced two-step subscribe flow (open → confirm)
            unlock_subscribe_gate(pg)

        mounted = wait_player(pg)
        check("mobile) embedded YouTube player mounts after unlock", mounted)

        if mounted:
            pg.wait_for_timeout(2_500)  # let the widget settle its iframe attrs
            m2 = pg.evaluate(MEASURE)
            fit = m2["fit"] or {}
            iw, sw = fit.get("iframeW", 0), fit.get("screenW", 0)
            ih, sh = fit.get("iframeH", 0), fit.get("screenH", 0)
            fills = sw > 0 and abs(iw - sw) <= 2 and abs(ih - sh) <= 4
            check("mobile) iframe FILLS the 16:9 slot exactly (no crop)", fills,
                  f"iframe={iw}x{ih} screen={sw}x{sh}")
            check("mobile) page STILL has no horizontal overflow (playing)", m2["overflow"] <= 2,
                  f"overflow={m2['overflow']}px")
            note("mobile) numbers", json.dumps(m2["fit"]))
            pg.screenshot(path=f"{OUT}/mobile_playing_390.png")
            # provenance chip + no accidental page navigation
            check("mobile) stayed on the course page", COURSE_PATH in pg.url, pg.url)

            # ── Persistence: reload → still unlocked, no gate again ──
            pg.reload(wait_until="domcontentloaded", timeout=45_000)
            pg.wait_for_timeout(3_500)
            pg.evaluate("() => document.querySelector('vite-error-overlay')?.remove()")
            pg.wait_for_timeout(1_200)
            target = None
            for t in ("YouTube lesson", "درس يوتيوب"):
                loc = pg.get_by_text(t, exact=False)
                if loc.count() > 0:
                    target = loc.first
                    break
            if target:
                target.click()
                pg.wait_for_timeout(2_000)
                gate_again = pg.locator("[data-testid=subscribe-gate]").count()
                if EXPECT_GATE:
                    check("mobile) gate does NOT re-ask after reload (persisted)", gate_again == 0)
                else:
                    note("mobile) gate re-asked after reload (old build: expected)", str(gate_again))
                check("mobile) player re-mounts directly after reload", wait_player(pg))
    if errors:
        note("mobile) page errors", " | ".join(errors[:3]))
    ctx.close()

    # ─────────────────────── DESKTOP 1280×900 (regression) ───────────────────────
    ctxd = browser.new_context(viewport={"width": 1280, "height": 900}, locale="ar-EG",
                               service_workers="block")
    ctxd.add_cookies([{"name": "elbaz_auth_flag", "value": "1", "url": BASE}])
    pgd = ctxd.new_page()
    pgd.route("**/api/trpc/**", make_handler())
    if not open_course(pgd):
        check("desktop) lesson row visible + clickable", False)
    else:
        gd = pgd.locator("[data-testid=subscribe-gate]")
        gate_d = gd.count() > 0 and gd.first.is_visible()
        if EXPECT_GATE:
            check("desktop) subscribe gate blocks playback on fresh device", gate_d)
            check("desktop) no skip button exists (hard gate)", pgd.locator("[data-testid=subscribe-gate-already]").count() == 0)
        else:
            note("desktop) subscribe gate visible (informational)", str(gate_d))
        if gate_d:
            unlock_subscribe_gate(pgd)
        if wait_player(pgd):
            pgd.wait_for_timeout(2_500)
            md = pgd.evaluate(MEASURE)
            fit = md["fit"] or {}
            fills = abs(fit.get("iframeW", 0) - fit.get("screenW", 0)) <= 2 and abs(fit.get("iframeH", 0) - fit.get("screenH", 0)) <= 4
            check("desktop) iframe fills the 16:9 slot exactly", fills, json.dumps(fit))
            check("desktop) no horizontal overflow", md["overflow"] <= 2, f"overflow={md['overflow']}px")
            pgd.screenshot(path=f"{OUT}/desktop_playing_1280.png")
        else:
            check("desktop) player mounts", False)
    ctxd.close()
    browser.close()

print("\n=== RESULT ===")
if fails:
    print("FAILURES:")
    for f in fails: print(" -", f)
    sys.exit(1)
print(f"ALL MOBILE/GATE E2E CHECKS PASSED ✓ ({len(notes)} checks)")
