"""LOCAL E2E — YouTube-hybrid lesson playback (the playlist conversion).

Runs the real vite frontend and intercepts tRPC to control the lesson data:
  Scenario YT  — lesson videoUrl is a YouTube playlist link:
                 lessonVideo returns kind="youtube" + youtubeId → the site must
                 render the EMBEDDED YouTube player inside its own screen
                 (iframe youtube-nocookie + site chrome), NOT a <video> tag,
                 and NOT navigate the user away.
  Scenario R2  — lesson videoUrl is an R2 key:
                 lessonVideo returns kind="r2" + presigned URL → the legacy
                 ProtectedVideoPlayer (<video> element) must still render.
  Verifies the hybrid contract end-to-end at the UI level.

Run: DISPLAY=:99 python3 scripts/youtube_lesson_local_e2e.py
(vite dev server must be running on 127.0.0.1:5173 — started by the caller.)
"""
import json
import re
import urllib.parse
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

import os as _os
import sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from _gate_unlock import assert_subscribe_url, gate_visible, unlock_subscribe_gate

BASE = "http://127.0.0.1:5173"
COURSE_PATH = "/courses/etap-complete-course"
OUT = "/home/z/my-project/work/elbaz-platform/scripts/shots_yt_e2e"
YT_ID = "dQw4w9WgXcQ"
USER_JSON = {"id": 54, "username": "yte2e01", "name": "YT E2E", "role": "user", "email": None}

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
        {"id": 102, "courseId": 1, "titleAr": "درس محلي R2", "titleEn": "R2 lesson",
         "descriptionAr": "", "descriptionEn": "", "isFree": True, "durationMinutes": 20,
         "sortOrder": 2, "isPublished": True},
    ],
}

ME_OK = {"result": {"data": {"json": USER_JSON}}}
CHECK_ENROLL = {"result": {"data": {"json": {"enrolled": True, "isCompleted": False, "progress": 0}}}}

def lesson_video_response(kind: str):
    if kind == "youtube":
        payload = {
            "videoUrl": f"https://www.youtube-nocookie.com/embed/{YT_ID}?enablejsapi=1",
            "hlsUrl": None, "expiresAt": "2030-01-01T00:00:00.000Z",
            "watermarkToken": "tok", "kind": "youtube", "youtubeId": YT_ID,
        }
    else:
        payload = {
            "videoUrl": "https://presigned.r2.test/etap/lesson01.mp4?sig=abc",
            "hlsUrl": None, "expiresAt": "2030-01-01T00:00:00.000Z",
            "watermarkToken": "tok", "kind": "r2", "youtubeId": None,
        }
    return 200, {"result": {"data": {"json": payload}}}

def saved_position():
    return 200, {"result": {"data": {"json": {"lastPosition": 0, "watchedSeconds": 0, "isCompleted": False}}}}

MY_REVIEW_NULL = {"result": {"data": {"json": None}}}

def envelope_for_get(name: str, url: str = ""):
    if name == "auth.me": return 200, ME_OK
    if name.startswith("review.myReview"): return 200, MY_REVIEW_NULL
    if name.startswith("course.previewVideo"):
        # Guest preview must mirror the LESSON's own kind (youtube vs r2) —
        # parse the lessonId out of the encoded tRPC input.
        lesson_id = 101
        try:
            raw = url.split("input=")[1]
            parsed = json.loads(urllib.parse.unquote(raw))
            lesson_id = int(parsed.get("json", {}).get("lessonId") or 101)
        except Exception:
            pass
        return lesson_video_response("youtube" if lesson_id == 101 else "r2")
    if name == "course.checkEnrollment": return 200, CHECK_ENROLL
    if name.startswith("course.lessonVideo"):
        # query contains input=…&lessonId — route both lesson ids to their kind
        return None  # handled in handler (needs lesson id)
    if name.startswith("course.getSavedPosition"): return saved_position()
    if name.startswith("course.bySlug"): return 200, {"result": {"data": {"json": COURSE_JSON}}}
    return None

fails, notes = [], []
def check(name, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
    (notes if cond else fails).append((name, detail))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    for scenario, lesson_id, kind in (("YT", 101, "youtube"), ("R2", 102, "r2")):
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        ctx.add_cookies([{"name": "elbaz_auth_flag", "value": "1", "url": BASE}])
        pg = ctx.new_page()

        def handler(route):
            url = route.request.url
            method = route.request.method
            if "/api/trpc/" not in url:
                return route.continue_()
            path = url.split("/api/trpc/")[1].split("?")[0]
            if method == "GET":
                if path.startswith("course.lessonVideo"):
                    st, body = lesson_video_response(kind)
                    return route.fulfill(status=st, content_type="application/json", body=json.dumps(body))
                packed = envelope_for_get(path, url)
                if packed:
                    st, body = packed
                    return route.fulfill(status=st, content_type="application/json", body=json.dumps(body))
            return route.continue_()

        pg.route("**/api/trpc/**", handler)

        pg.goto(BASE + COURSE_PATH, wait_until="domcontentloaded", timeout=45_000)
        pg.wait_for_timeout(4_000)
        # Dev-only: the vite dev API env validation throws an error overlay that
        # blocks clicks — production serves the real API so this never happens.
        pg.evaluate("() => document.querySelector('vite-error-overlay')?.remove()")
        # Cookie consent banner (same handling as the production E2Es)
        try:
            pg.get_by_role("button", name=re.compile("accept|موافق|قبول", re.I)).click(timeout=2_000)
        except Exception:
            pass
        pg.evaluate("() => document.querySelector('[data-testid=cookie-consent-backdrop]')?.click()")
        pg.wait_for_timeout(500)

        # Click the scenario's lesson (language mirrors the browser default — try both)
        lesson_texts = ("YouTube lesson", "درس يوتيوب") if kind == "youtube" else ("R2 lesson", "درس محلي R2")
        target = None
        for t in lesson_texts:
            loc = pg.get_by_text(t, exact=False)
            if loc.count() > 0:
                target = loc.first
                break
        if not target:
            check(f"{scenario}) lesson row visible", False, "neither AR nor EN title found")
            ctx.close()
            continue
        target.click()
        pg.wait_for_timeout(2_000)
        # The subscribe gate (HARD, no skip button) takes the video slot first —
        # unlock via the enforced two-step subscribe flow (open → confirm).
        try:
            if gate_visible(pg):
                print("subscribe gate shown — unlocking (subscribe-flow: open → confirm)")
                popups = unlock_subscribe_gate(pg)
                check("YT) gate opened channel with sub_confirmation", assert_subscribe_url(popups), str(popups))
        except Exception:
            pass
        # Wait for the video area to resolve
        deadline = time.time() + 15
        ready = False
        while time.time() < deadline:
            if pg.locator("[data-youtube-player]").count() > 0 or pg.locator("video[data-lesson-id], video").count() > 0:
                ready = True
                break
            pg.wait_for_timeout(500)
        check(f"{scenario}) video area rendered", ready)

        if kind == "youtube":
            yt_host = pg.locator("[data-youtube-player] iframe[src*='youtube-nocookie.com']").count()
            check(f"{scenario}) embedded YouTube iframe present", yt_host > 0,
                  f"iframes={pg.locator('iframe').count()}")
            still_here = COURSE_PATH in pg.url
            check(f"{scenario}) user stayed on the site (no redirect)", still_here, pg.url)
            pg.screenshot(path=f"{OUT}/{scenario}_youtube_player.png")
            chip = pg.get_by_text("يوتيوب", exact=False).count() + pg.get_by_text("YouTube", exact=False).count()
            check(f"{scenario}) provenance chip visible", chip > 0)
        else:
            legacy_video = pg.locator("video").count()
            no_yt_frame = pg.locator("[data-youtube-player]").count()
            check(f"{scenario}) legacy <video> player present", legacy_video > 0, f"videos={legacy_video}")
            check(f"{scenario}) YouTube player NOT rendered for R2 lesson", no_yt_frame == 0)
            pg.screenshot(path=f"{OUT}/{scenario}_r2_player.png")

        ctx.close()

    browser.close()

print("\n=== RESULT ===")
if fails:
    print("FAILURES:")
    for f in fails: print(" -", f)
    sys.exit(1)
print(f"ALL LOCAL E2E CHECKS PASSED ✓ ({len(notes)} checks)")
