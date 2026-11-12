"""LOCAL E2E — the HARD subscribe gate + comment nudge, full user journey.

Owner contract (2026) verified HERE at the UI level, on the real vite app
(tRPC intercepted, one YouTube lesson):
  G1  clicking ANY lesson shows the subscribe gate INSTEAD of the player
      (no <video>, no [data-youtube-player], no YouTube iframe)
  G2  the gate has NO skip button («أنا مشترك بالفعل» must not exist)
  G3  the unlock button does NOT exist before the subscribe press
  G4  pressing «اشترك الآن» opens the channel with ?sub_confirmation=1
      (window.open stubbed — we never actually leave the page)
  G5  only THEN «اشتركت — افتح الفيديوهات» appears and unlocks the player
  G6  the unlock record is marked via="subscribe-flow" (honest analytics)
  G7  reload → still unlocked (device window), gate never re-asks
  G8  clearing the unlock re-arms the gate (enforcement is real, not one-shot)
  C1  after unlock, the comment nudge appears ONCE (quiet 15 s delay),
      inline under the player — never blocking playback
  C2  «علّق على اليوتيوب» opens the video's YouTube watch page and retires
      the nudge for that video
  C3  the nudge state persists across reload (opened → never again)
  C4  the dismiss (X) path also persists

Run:  vite dev on 127.0.0.1:5173, then
      python3 scripts/subscribe_gate_hard_e2e.py
Shots: /home/z/my-project/download/gate_hard_e2e/
"""
import json
import os
import re
import subprocess
import time

from playwright.sync_api import sync_playwright

import os as _os
import sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from _gate_unlock import GATE, GATE_CONFIRM, GATE_OPEN, unlock_subscribe_gate

BASE = "http://127.0.0.1:5173"
COURSE_PATH = "/courses/etap-complete-course"
OUT = "/home/z/my-project/download/gate_hard_e2e"
subprocess.run(["mkdir", "-p", OUT], check=True)
YT_ID = "dQw4w9WgXcQ"
USER_JSON = {"id": 54, "username": "gate2e01", "name": "Gate E2E", "role": "user", "email": None}

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
# review.myReview is an AUTHED procedure — unmocked it hits the real dev API
# and returns 401 UNAUTHORIZED, which parks auth.me in an error state and
# flips the whole app to logged-out (the global auth-failure safety net).
MY_REVIEW_NULL = {"result": {"data": {"json": None}}}
PAYMOB_OFF = {"result": {"data": {"json": {
    "configured": False, "missing": ["all"], "mode": "unset",
    "methods": {"card": False, "wallet": False},
}}}}

def envelope_for_get(name: str, url: str):
    if name == "auth.me": return 200, ME_OK
    if name == "course.checkEnrollment": return 200, CHECK_ENROLL
    if name.startswith("course.lessonVideo"): return 200, LESSON_VIDEO
    # The guest preview path must ALSO resolve to the lesson video — the gate
    # blocks playback for guests and members alike (same slot, same contract).
    if name.startswith("course.previewVideo"): return 200, LESSON_VIDEO
    if name.startswith("course.getSavedPosition"): return 200, SAVED_POS
    if name.startswith("course.bySlug"): return 200, {"result": {"data": {"json": COURSE_JSON}}}
    if name.startswith("review.myReview"): return 200, MY_REVIEW_NULL
    if name.startswith("payment.isConfigured"): return 200, PAYMOB_OFF
    if name.startswith("settings.getSection") and "subscribeGate" in url:
        return 200, SUB_GATE_OK
    return None

def make_handler():
    def handler(route):
        url = route.request.url
        if "/api/trpc/" not in url:
            return route.continue_()
        path = url.split("/api/trpc/")[1].split("?")[0]
        if route.request.method == "GET":
            packed = envelope_for_get(path, url)
            if packed:
                st, body = packed
                return route.fulfill(status=st, content_type="application/json", body=json.dumps(body))
        return route.continue_()
    return handler

fails, notes = [], []
def check(name, cond, detail=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
    (notes if cond else fails).append((name, detail))

def stub_window_open(pg):
    pg.evaluate(
        "() => { globalThis.__e2ePopups = []; "
        "globalThis.open = (u) => { globalThis.__e2ePopups.push(String(u)); return null; }; }"
    )

def popups(pg):
    return pg.evaluate("() => globalThis.__e2ePopups || []")

def open_course_and_click_lesson(pg):
    pg.goto(BASE + COURSE_PATH, wait_until="domcontentloaded", timeout=45_000)
    pg.wait_for_timeout(3_500)
    pg.evaluate("() => document.querySelector('vite-error-overlay')?.remove()")
    # Cookie consent: use the real buttons, then WAIT until the backdrop is
    # detached — a lingering backdrop swallows the lesson click (the flake).
    for tid in ("cookie-accept-all", "cookie-accept-essential"):
        loc = pg.locator(f"[data-testid={tid}]")
        if loc.count() > 0:
            try:
                loc.first.click(timeout=2_500)
                break
            except Exception:
                pass
    else:
        try:
            pg.get_by_role("button", name=re.compile("accept|موافق|قبول", re.I)).click(timeout=2_000)
        except Exception:
            pass
    deadline = time.time() + 8
    while time.time() < deadline:
        if pg.locator("[data-testid=cookie-consent-backdrop]").count() == 0:
            break
        pg.wait_for_timeout(300)
    pg.wait_for_timeout(300)
    # Lesson row is a <button> whose text starts with "1. «title»".
    target = None
    for t in ("YouTube lesson", "درس يوتيوب"):
        loc = pg.get_by_role("button", name=re.compile(re.escape(t), re.I))
        if loc.count() > 0:
            target = loc.first
            break
    if not target:
        return False
    target.click()
    pg.wait_for_timeout(2_000)
    return True

def wait_player(pg, seconds=15):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if pg.locator("[data-youtube-player] iframe").count() > 0:
            return True
        pg.wait_for_timeout(500)
    return False

STATE_NONE = "none"

def wait_video_slot(pg, seconds=25):
    """Wait until the video slot resolves to the gate or the player.

    Dev-mode first compile can leave the slot blank for a while — judging
    too early would flake. Returns "gate" | "player" | "none".
    """
    deadline = time.time() + seconds
    while time.time() < deadline:
        if pg.locator(GATE).count() > 0 and pg.locator(GATE).first.is_visible():
            return "gate"
        if pg.locator("[data-youtube-player]").count() > 0:
            return "player"
        pg.wait_for_timeout(500)
    return "none"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, locale="ar-EG",
                              service_workers="block")
    ctx.add_cookies([{"name": "elbaz_auth_flag", "value": "1", "url": BASE}])
    pg = ctx.new_page()
    pg.route("**/api/trpc/**", make_handler())

    # ── G1: fresh device → the gate takes the video slot ──
    if not open_course_and_click_lesson(pg):
        check("G1) lesson row visible + clickable", False, "neither AR nor EN title found")
    else:
        slot = wait_video_slot(pg)
        check("G1) gate blocks the video slot on a fresh device", slot == "gate", f"slot={slot}")
        check("G1) NO player mounted while gated (no youtube container)",
              pg.locator("[data-youtube-player]").count() == 0)
        check("G1) NO youtube iframe while gated",
              pg.locator("iframe[src*='youtube']").count() == 0)
        check("G1) NO <video> element while gated", pg.locator("video").count() == 0)
        pg.screenshot(path=f"{OUT}/g1_gate_blocks.png")

        # ── G2/G3: no skip path exists ──
        check("G2) skip button («أنا مشترك بالفعل») does NOT exist",
              pg.locator("[data-testid=subscribe-gate-already]").count() == 0)
        check("G3) unlock button hidden before the subscribe press",
              pg.locator(GATE_CONFIRM).count() == 0)

        # ── G4: subscribe press opens the native confirm-subscribe URL ──
        stub_window_open(pg)
        pg.locator(GATE_OPEN).first.click(timeout=15_000)
        pg.wait_for_timeout(800)
        urls = popups(pg)
        check("G4) subscribe press opened the channel confirm dialog",
              any("sub_confirmation=1" in u for u in urls), str(urls))
        confirm_visible = pg.locator(GATE_CONFIRM).count() > 0 and pg.locator(GATE_CONFIRM).first.is_visible()
        check("G4) unlock button appears ONLY after the subscribe press", confirm_visible)
        pg.screenshot(path=f"{OUT}/g4_after_subscribe_press.png")

        # ── G5: confirm → the player mounts ──
        pg.locator(GATE_CONFIRM).first.click()
        pg.wait_for_timeout(1_500)
        check("G5) gate gone after confirm", pg.locator(GATE).count() == 0)
        player_mounted = wait_player(pg)
        check("G5) YouTube player mounts after the enforced subscribe flow", player_mounted)
        pg.screenshot(path=f"{OUT}/g5_player_mounted.png")

        # ── G6: honest via marker in the unlock record ──
        record = pg.evaluate("() => { try { return JSON.parse(localStorage.getItem('elbaz-sub-gate-unlock') || 'null'); } catch { return null; } }")
        check("G6) unlock record marked via=subscribe-flow",
              bool(record) and record.get("via") == "subscribe-flow", str(record))

        # ── C1: the comment nudge appears once (15 s quiet delay) ──
        pg.wait_for_timeout(16_500)
        nudge = pg.locator("[data-testid=comment-nudge]")
        nudge_visible = nudge.count() > 0 and nudge.first.is_visible()
        check("C1) comment nudge appears under the player after the quiet delay", nudge_visible)
        pg.screenshot(path=f"{OUT}/c1_nudge_visible.png")

        if nudge_visible:
            # ── C2: «علّق» opens the video's YouTube watch page and retires the nudge ──
            stub_window_open(pg)
            pg.locator("[data-testid=comment-nudge-open]").first.click()
            pg.wait_for_timeout(800)
            curls = popups(pg)
            check("C2) comment button opened the watch page (watch?v=…)",
                  any(f"watch?v={YT_ID}" in u for u in curls), str(curls))
            check("C2) nudge retired after opening",
                  pg.locator("[data-testid=comment-nudge]").count() == 0)

        # ── G7+C3: reload → still unlocked, nudge never returns (opened) ──
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
        check("G7) lesson row visible after reload", target is not None)
        if target:
            target.click()
            slot = wait_video_slot(pg)
            check("G7) gate does NOT re-ask after reload (device window)", slot == "player", f"slot={slot}")
            check("G7) player mounts directly (no gate)", wait_player(pg))
            pg.wait_for_timeout(16_500)
            check("C3) opened nudge never returns after reload",
                  pg.locator("[data-testid=comment-nudge]").count() == 0)
            pg.screenshot(path=f"{OUT}/g7_reload_unlocked.png")

        # ── C4: the dismiss (X) path also persists ──
        pg.evaluate("() => localStorage.removeItem('elbaz-comment-nudge')")
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
            slot = wait_video_slot(pg)
            check("C4-prep) still unlocked (no gate) for the dismiss leg", slot == "player", f"slot={slot}")
            pg.wait_for_timeout(16_500)
            nudge2 = pg.locator("[data-testid=comment-nudge]")
            if nudge2.count() > 0 and nudge2.first.is_visible():
                pg.locator("[data-testid=comment-nudge-dismiss]").first.click()
                pg.wait_for_timeout(600)
                check("C4) dismiss (X) retires the nudge immediately",
                      pg.locator("[data-testid=comment-nudge]").count() == 0)
                pg.reload(wait_until="domcontentloaded", timeout=45_000)
                pg.wait_for_timeout(3_500)
                pg.evaluate("() => document.querySelector('vite-error-overlay')?.remove()")
                pg.wait_for_timeout(1_200)
                tgt = None
                for t in ("YouTube lesson", "درس يوتيوب"):
                    loc = pg.get_by_text(t, exact=False)
                    if loc.count() > 0:
                        tgt = loc.first
                        break
                if tgt:
                    tgt.click()
                    pg.wait_for_timeout(2_000)
                    pg.wait_for_timeout(16_500)
                    check("C4) dismissed nudge never returns after reload",
                          pg.locator("[data-testid=comment-nudge]").count() == 0)
                    pg.screenshot(path=f"{OUT}/c4_dismissed.png")
            else:
                check("C4) nudge re-appeared for the dismiss leg", False, "nudge absent — storage not cleared?")

        # ── G8: clearing the unlock re-arms the gate (enforcement is real) ──
        pg.evaluate("() => localStorage.removeItem('elbaz-sub-gate-unlock')")
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
            slot = wait_video_slot(pg)
            re_gated = slot == "gate"
            check("G8) gate re-arms after the unlock is cleared", re_gated, f"slot={slot}")
            if re_gated:
                popups2 = unlock_subscribe_gate(pg)
                check("G8) re-unlock works through the enforced flow",
                      any("sub_confirmation=1" in u for u in popups2), str(popups2))
                check("G8) player mounts after re-unlock", wait_player(pg))
                pg.screenshot(path=f"{OUT}/g8_reunlocked.png")

    ctx.close()
    browser.close()

print("\n=== RESULT ===")
if fails:
    print("FAILURES:")
    for f in fails: print(" -", f)
    raise SystemExit(1)
print(f"ALL HARD-GATE + COMMENT-NUDGE E2E CHECKS PASSED ✓ ({len(notes)} checks)")
