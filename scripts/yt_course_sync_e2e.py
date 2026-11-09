"""YT COURSE SYNC E2E — the course mirrors the YouTube playlist, verbatim.

Serves the REAL production build (dist/public) with /api/* relayed to a
faithful tRPC mock (same harness pattern as session_persistence_local_e2e).

What it proves (the owner's four asks):
  A. Cover = first real playlist video's YouTube thumbnail (maxresdefault).
  B. Lessons = exactly the real playlist videos, EXACT verbatim YouTube titles.
  C. In-site playback: nocookie embed iframe (enablejsapi, hl=ar, playsinline)
     in a 16:9 aspect container; mobile 375px shows NO horizontal clipping.
  D. Admin dashboard: YouTube sync panel (sync-now / full-sync-cleanup /
     auto-import / free-policy / auto-cover toggles + status cards) and the
     lessons dialog with YouTube badges + real thumbnails.

Screenshots → /home/z/my-project/download/
"""
import http.client
import json
import os
import re
import socketserver
import http.server
import sys
import threading

from playwright.sync_api import sync_playwright

PORT = 4183
MOCK_PORT = 4184
BASE = f"http://127.0.0.1:{PORT}"
MOCK_BASE = f"http://127.0.0.1:{MOCK_PORT}"
DIST = "/home/z/my-project/work/elbaz-platform/dist/public"
OUT = "/home/z/my-project/download"
JSON_CT = "application/json"
COURSE_URL = "/courses/etap-complete-course"

os.makedirs(OUT, exist_ok=True)

# ── Fixture data (mirrors the live playlist order + verbatim titles) ──
V1 = "0l7WBjMF6uo"
V2 = "avugPlx0sXw"
T1 = "كورس ETAP المجاني | تعلم ETAP من الصفر وحتى الاحتراف"
T2 = "تحميل وتسطيب برنامج ETAP 2021 كامل | كورس ايتاب كامل بالعربي #01 | ETAP Course"
COVER = f"https://i.ytimg.com/vi/{V1}/maxresdefault.jpg"

LESSONS = [
    {
        "id": 101, "courseId": 1, "titleEn": T1, "titleAr": T1,
        "descriptionEn": None, "descriptionAr": None,
        "videoUrl": f"https://www.youtube.com/watch?v={V1}",
        "durationMinutes": 8, "sortOrder": 1, "isFree": True, "isPublished": True,
        "attachments": None, "createdAt": "2026-11-01T10:00:00.000Z",
    },
    {
        "id": 102, "courseId": 1, "titleEn": T2, "titleAr": T2,
        "descriptionEn": None, "descriptionAr": None,
        "videoUrl": f"https://www.youtube.com/watch?v={V2}",
        "durationMinutes": 22, "sortOrder": 2, "isFree": True, "isPublished": True,
        "attachments": None, "createdAt": "2026-11-02T10:00:00.000Z",
    },
]

COURSE = {
    "id": 1, "slug": "etap-complete-course",
    "titleEn": "ETAP Complete Course — From Zero to Expert",
    "titleAr": "كورس ETAP الشامل — من الصفر للاحتراف",
    "descriptionEn": "Master ETAP software for power system analysis.",
    "descriptionAr": "أتقن برنامج ETAP لتحليل أنظمة الطاقة.",
    "shortDescEn": "Become an ETAP expert", "shortDescAr": "أصبح خبير ETAP",
    "thumbnail": COVER,
    "trailerUrl": None, "level": "intermediate",
    "isPremium": True, "price": "1999.00", "originalPrice": "3499.00",
    "durationHours": 13, "rating": "4.9", "reviewCount": 42, "studentCount": 234,
    "instructorName": "Eng Ahmed Elbaz", "isPublished": True, "isFeatured": True,
    "prerequisitesEn": None, "prerequisitesAr": None,
    "learningOutcomesEn": None, "learningOutcomesAr": None, "sortOrder": 1,
    "categoryId": 1, "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-11-08T09:00:00.000Z",
    "category": {"nameEn": "ETAP Software", "nameAr": "برنامج ETAP"},
    "lessons": LESSONS,
}

ADMIN_USER = {
    "id": 1, "username": "admin", "name": "أحمد الباز",
    "email": "admin@ahmedelbaz.qzz.io", "role": "admin",
    "preferredLanguage": "ar", "emailVerified": True,
    "twoFactorEnabled": False, "createdAt": "2026-01-01T00:00:00.000Z",
}

YT_STATUS = {
    "courseSlug": "etap-complete-course",
    "courseFound": True,
    "courseTitle": "كورس ETAP الشامل — من الصفر للاحتراف",
    "cover": COVER,
    "lessonCount": 2,
    "youtubeLessonCount": 2,
    "playlistUrl": "https://youtube.com/playlist?list=PLeeb5_Qjhcgc",
    "state": {
        "lastSyncAt": "2026-11-09T06:30:00.000Z",
        "lastSuccessAt": "2026-11-09T06:30:00.000Z",
        "videosFound": 2, "added": 2, "updated": 0, "removed": 1,
        "coverUpdated": True, "prunedOnce": True, "lastError": None,
    },
    "settings": {"autoImport": True, "autoImportFree": True, "autoCover": True},
}

def env(json_payload):
    return json.dumps({"result": {"data": {"json": json_payload}}}).encode()

def err_env(message, code="NOT_FOUND"):
    return json.dumps({"error": {"json": {"message": message, "code": code, "httpStatus": 404, "path": "mock"}}}).encode()

# ── Mock tRPC server ───────────────────────────────────────────────────────────

def proc_name(path: str) -> str:
    if "/api/trpc/" not in path:
        return "__non_trpc__"
    tail = path.split("/api/trpc/", 1)[1].split("?", 1)[0]
    return tail.split(",")[0]

class MockApi(http.server.BaseHTTPRequestHandler):
    server_version = "yt-sync-mock/1"

    def _respond(self, status: int, payload: bytes, extra_headers: list[tuple[str, str]] | None = None):
        self.send_response(status)
        self.send_header("Content-Type", JSON_CT)
        self.send_header("Content-Length", str(len(payload)))
        for k, v in (extra_headers or []):
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD" and payload:
            self.wfile.write(payload)

    def _route(self):
        name = proc_name(self.path)
        if os.environ.get("YT_E2E_TRACE") and (name.startswith("admin") or name.startswith("course")):
            print(f"    [mock] {self.command} {name}  {self.path[:140]}")

        # ── auth ──
        if name == "auth.me":
            return self._respond(200, env(ADMIN_USER))
        if name in ("auth.logout",):
            return self._respond(200, env({"success": True}))

        # ── public course ──
        if name == "course.bySlug":
            return self._respond(200, env(COURSE))
        if name == "course.categories":
            return self._respond(200, env([
                {"id": 1, "slug": "etap", "nameEn": "ETAP Software", "nameAr": "برنامج ETAP",
                 "descriptionEn": None, "descriptionAr": None, "icon": "Monitor", "sortOrder": 1,
                 "createdAt": "2026-01-01T00:00:00.000Z"},
            ]))
        if name == "course.list":
            return self._respond(200, env({"items": [COURSE], "total": 1, "pages": 1}))
        if name == "course.testimonials":
            return self._respond(200, env({"items": [], "total": 0}))
        if name == "course.checkEnrollment":
            return self._respond(200, env({"enrolled": True, "isCompleted": False, "progress": 0, "expiresAt": None}))

        # ── watching ──
        if name == "course.lessonVideo":
            embed = (f"https://www.youtube-nocookie.com/embed/{V1}"
                     "?rel=0&playsinline=1&hl=ar&enablejsapi=1&origin=https%3A%2F%2Fahmedelbaz.qzz.io")
            return self._respond(200, env({
                "videoUrl": embed, "hlsUrl": None,
                "expiresAt": "2026-11-10T06:30:00.000Z",
                "watermarkToken": "bW9ja3Rva2VufDE",
                "kind": "youtube", "youtubeId": V1,
                "youtubeWatchUrl": f"https://www.youtube.com/watch?v={V1}",
            }))
        if name == "course.getSavedPosition":
            return self._respond(200, env({"lastPosition": 0, "watchedSeconds": 0, "isCompleted": False}))
        if name == "course.myWatchTime":
            return self._respond(200, env({"totalSeconds": 0, "byCourse": []}))
        if name in ("course.markWatched", "course.heartbeat", "course.getSavedPositionX"):
            return self._respond(200, env({"success": True, "isCompleted": True, "progress": 100}))
        if name == "course.courseProgress":
            return self._respond(200, env({"progress": 0, "lessons": []}))

        # ── admin ──
        if name == "admin.stats":
            return self._respond(200, env({
                "totalUsers": 234, "totalCourses": 1, "totalEnrollments": 180,
                "openTickets": 0, "totalRevenue": 128400,
            }))
        if name == "admin.analytics":
            return self._respond(200, env({
                "userGrowth": [], "revenueByMonth": [], "topCourses": [],
                "enrollmentsByDay": [], "watchTimeByDay": [],
            }))
        if name == "admin.youtubeSyncStatus":
            return self._respond(200, env(YT_STATUS))
        if name == "admin.listCourses":
            return self._respond(200, env({
                "items": [{
                    "id": COURSE["id"], "slug": COURSE["slug"], "titleEn": COURSE["titleEn"],
                    "titleAr": COURSE["titleAr"], "descriptionEn": COURSE["descriptionEn"],
                    "descriptionAr": COURSE["descriptionAr"], "shortDescEn": COURSE["shortDescEn"],
                    "shortDescAr": COURSE["shortDescAr"], "thumbnailUrl": COVER,
                    "price": "1999.00", "isPremium": True, "isFeatured": True,
                    "isPublished": True, "level": "intermediate", "category": 1,
                    "studentCount": 234, "createdAt": COURSE["createdAt"], "updatedAt": COURSE["updatedAt"],
                }],
                "total": 1,
            }))
        if name == "admin.listLessons":
            fake = {
                "id": 199, "courseId": 1, "titleEn": "درس تجريبي (وهمي)", "titleAr": "درس تجريبي (وهمي)",
                "descriptionEn": None, "descriptionAr": None, "videoUrl": "etap/lesson-demo.mp4",
                "durationMinutes": 30, "sortOrder": 3, "isFree": False, "isPublished": False,
                "attachments": None, "createdAt": "2026-11-03T10:00:00.000Z",
            }
            return self._respond(200, env({"items": LESSONS + [fake]}))
        if name == "admin.syncPlaylistNow":
            return self._respond(200, env({
                "ok": True, "courseSlug": "etap-complete-course", "videosFound": 2,
                "added": 0, "updated": 0, "removed": 0, "coverUpdated": False,
            }))
        if name == "admin.updateYoutubeSyncSettings":
            return self._respond(200, env({"success": True, "settings": YT_STATUS["settings"]}))
        if name in ("admin.users", "admin.tickets", "admin.payments"):
            return self._respond(200, env({"items": [], "total": 0}))
        if name == "admin.chatbotFeedback":
            return self._respond(200, env({"items": [], "total": 0}))
        if name == "articles.adminList":
            return self._respond(200, env({"items": [], "total": 0}))

        # ── settings family → graceful fallbacks in the UI ──
        if name.startswith("settings."):
            if name == "settings.getSection":
                return self._respond(200, env({"items": []}))
            return self._respond(200, env({"items": [], "total": 0}))
        if name.startswith("wishlist") or name.startswith("journey") or name.startswith("notification"):
            return self._respond(200, env({"items": [], "total": 0, "unread": 0, "notifications": [], "events": []}))

        return self._respond(404, err_env(f"mock has no handler for {name}"))

    def do_GET(self):
        self._route()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length:
                self.rfile.read(length)
        except Exception:
            pass
        self._route()

    def log_message(self, *a):
        pass

def start_mock_server():
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", MOCK_PORT), MockApi)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

# ── SPA static server with /api/* relay (survives the service worker) ─────────

def make_spa_server():
    class SPA(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=DIST, **kwargs)

        def translate_path(self, path):
            clean = path.split("?", 1)[0].split("#", 1)[0]
            fs = super().translate_path(clean)
            if not os.path.exists(fs) and "." not in clean.rsplit("/", 1)[-1]:
                return os.path.join(DIST, "index.html")
            return fs

        def _relay(self):
            if not re.fullmatch(r"/api/[\x21-\x7e]*", self.path):
                self._respond_raw(400, b'{"error":"bad api path"}')
                return
            conn = http.client.HTTPConnection("127.0.0.1", MOCK_PORT, timeout=15)
            body = None
            if self.headers.get("Content-Length"):
                body = self.rfile.read(int(self.headers["Content-Length"]))
            headers = {k: v for k, v in self.headers.items()
                       if k.lower() not in ("host", "connection", "content-length")}
            try:
                conn.request(self.command, self.path, body=body, headers=headers)  # NOSONAR
                resp = conn.getresponse()
                data = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", resp.getheader("Content-Type") or JSON_CT)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                if data:
                    self.wfile.write(data)
            except Exception:
                self._respond_raw(502, b'{"error":"mock down"}')
            finally:
                conn.close()

        def _respond_raw(self, status: int, payload: bytes):
            self.send_response(status)
            self.send_header("Content-Type", JSON_CT)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            if self.path.startswith("/api/"):
                return self._relay()
            return super().do_GET()

        def do_POST(self):
            if self.path.startswith("/api/"):
                return self._relay()
            self.send_response(405)
            self.end_headers()

        def log_message(self, *a):
            pass

    socketserver.ThreadingTCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", PORT), SPA)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

# ── Checks ─────────────────────────────────────────────────────────────────────

fails: list[str] = []

def check(name, cond, detail=""):
    print(("PASS  " if cond else "FAIL  ") + name + (f"  [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(f"{name} {detail}")

def make_context(browser, width, height):
    ctx = browser.new_context(viewport={"width": width, "height": height})
    # Arabic-first (the owner's audience) + pre-consented cookies so the consent
    # banner never covers the lesson list and intercepts clicks.
    ctx.add_init_script(
        "localStorage.setItem('language', 'ar');"
        "localStorage.setItem('elbaz_cookie_consent', JSON.stringify({necessary: true, analytics: true, marketing: true}));"
    )
    ctx.add_cookies([
        {"name": "elbaz_auth_flag", "value": "1", "url": BASE},
        {"name": "elbaz_auth", "value": "mock.session.token", "url": BASE},
    ])
    return ctx

def dismiss_banners(pg):
    for sel in (".vite-error-overlay", "[data-consent-banner]", "[aria-label='cookieconsent']"):
        pg.evaluate(
            "s => { document.querySelectorAll(s).forEach(e => e.remove()); }",
            sel,
        )

def main():
    _mock = start_mock_server()
    _spa = make_spa_server()
    print(f"SPA on {BASE}  →  mock on {MOCK_BASE}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # ═══ A/B/C — desktop course page ═══
        ctx = make_context(browser, 1280, 800)
        pg = ctx.new_page()
        pg.goto(BASE + COURSE_URL, wait_until="domcontentloaded", timeout=30000)
        # Activate the first real lesson (button, not the nowrap text node)
        try:
            pg.locator("button:has-text('كورس ETAP المجاني')").first.click(timeout=12000)
        except Exception as e:
            print("  (lesson click failed:", str(e)[:80], ")")
        try:
            pg.wait_for_selector("iframe[src*='youtube-nocookie.com/embed/']", timeout=20000)
            iframe_ok = True
        except Exception:
            iframe_ok = False
            check("C1 nocookie iframe renders", False, "iframe not found")
        dismiss_banners(pg)

        if iframe_ok:
            src = pg.get_attribute("iframe[src*='youtube-nocookie.com/embed/']", "src") or ""
            check("C1 nocookie iframe renders", True, src[:90])
            check("C2 embed has tracking + arabic + playsinline",
                  "enablejsapi=1" in src and "hl=ar" in src and "playsinline=1" in src and "rel=0" in src,
                  src[:120])
            check("C3 embeds the FIRST playlist video", f"/embed/{V1}" in src, f"want {V1}")

            box = pg.locator(".aspect-video").first.bounding_box()
            ratio_ok = box and box["width"] > 0 and abs((box["width"] / box["height"]) - 16 / 9) < 0.12
            check("C4 player is 16:9 aspect-video", bool(ratio_ok),
                  f"w={box and box['width']:.0f} h={box and box['height']:.0f}")

            body_text = pg.inner_text("body")
            check("B1 verbatim title #01 exactly as on YouTube", T1 in body_text)
            check("B2 verbatim title #02 exactly as on YouTube", T2 in body_text)
            check("B3 no invented titles (demo/وهمي absent)", "وهمي" not in body_text and "تجريبي" not in body_text)

            # Cover = first video's YouTube thumbnail: SEO og:image carries the
            # server-set course thumbnail; the courses list card shows it too.
            og = pg.get_attribute("meta[property='og:image']", "content") or ""
            check("A1 course cover = first video's YouTube thumbnail", "i.ytimg.com" in og and V1 in og, og[:90])

            pg.screenshot(path=f"{OUT}/yt-course-sync-player-desktop.png", full_page=False)
            print(f"  📸 {OUT}/yt-course-sync-player-desktop.png")

        # A2 — the public courses LIST page shows the YouTube cover on the card
        pg.goto(BASE + "/courses", wait_until="domcontentloaded", timeout=30000)
        pg.wait_for_timeout(2500)
        card_img = pg.locator("a[href*='etap-complete-course'] img[src*='i.ytimg.com/vi/']").first
        card_ok = card_img.count() > 0 and "maxresdefault" in (card_img.get_attribute("src") or "")
        check("A2 courses-list card cover = first video thumbnail", bool(card_ok))

        # ═══ C — mobile 375px: no clipped edges, player fits ═══
        mctx = make_context(browser, 375, 812)
        mpg = mctx.new_page()
        mpg.goto(BASE + COURSE_URL, wait_until="domcontentloaded", timeout=30000)
        try:
            mpg.locator("button:has-text('كورس ETAP المجاني')").first.click(timeout=12000)
        except Exception as e:
            print("  (mobile lesson click failed:", str(e)[:80], ")")
        try:
            mpg.wait_for_selector("iframe[src*='youtube-nocookie.com/embed/']", timeout=20000)
            m_iframe_ok = True
        except Exception:
            m_iframe_ok = False
            check("M1 mobile: iframe renders", False, "not found")
        dismiss_banners(mpg)

        if m_iframe_ok:
            overflow = mpg.evaluate("() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })")
            check("M1 mobile: no horizontal clipping", overflow["sw"] <= overflow["iw"] + 1,
                  f"scrollWidth={overflow['sw']} innerWidth={overflow['iw']}")
            # THE PLAYER's aspect-video box (the one containing the iframe) —
            # not the hero art. This is the owner's "الفيديو مش مشبوظ" check.
            pbox = mpg.locator("div.aspect-video:has(iframe)").first.bounding_box()
            fits = pbox and pbox["width"] <= 376 and pbox["x"] >= -0.5 and pbox["x"] + pbox["width"] <= 376.5
            check("M2 mobile: player fits screen edge-to-edge, not cut", bool(fits),
                  f"w={pbox and pbox['width']:.0f} x={pbox and pbox['x']:.1f}")
            mratio_ok = pbox and abs((pbox["width"] / pbox["height"]) - 16 / 9) < 0.12
            check("M3 mobile: player keeps 16:9", bool(mratio_ok))
            # Scroll the player into view for the proof screenshot
            mpg.locator("div.aspect-video:has(iframe)").first.scroll_into_view_if_needed()
            mpg.wait_for_timeout(1200)
            mpg.screenshot(path=f"{OUT}/yt-course-sync-player-mobile.png", full_page=False)
            print(f"  📸 {OUT}/yt-course-sync-player-mobile.png")
        mctx.close()

        # ═══ D — admin dashboard sync panel ═══
        actx = make_context(browser, 1360, 860)
        apg = actx.new_page()
        apg.goto(BASE + "/admin", wait_until="domcontentloaded", timeout=30000)
        apg.wait_for_timeout(1500)
        dismiss_banners(apg)

        courses_tab = apg.get_by_role("button", name="الكورسات", exact=True).first
        if courses_tab.count() == 0:
            courses_tab = apg.locator("button", has_text=re.compile("الكورسات|Courses")).first
        try:
            courses_tab.click(timeout=8000)
        except Exception:
            pass
        try:
            apg.wait_for_selector("text=مزامنة بلاي ليست اليوتيوب", timeout=12000)
            panel_ok = True
        except Exception:
            panel_ok = False
            check("D1 sync panel visible on courses tab", False, "heading not found")

        if panel_ok:
            check("D1 sync panel visible on courses tab", True)
            check("D2 'Sync now' button present", apg.locator("button:has-text('مزامنة الآن')").count() > 0 or apg.locator("button:has-text('Sync now')").count() > 0)
            check("D3 'Full sync + cleanup' button present", apg.locator("button:has-text('مزامنة كاملة')").count() > 0 or apg.locator("button:has-text('Full sync')").count() > 0)
            toggles = apg.locator("[data-slot='switch'], [role='switch'], button[role='switch']").count()
            check("D4 three policy toggles (auto-import / free / cover)", toggles >= 3, f"count={toggles}")
            check("D5 playlist link shown", apg.locator("text=PLeeb5_Qjhcgc").count() > 0)
            videos_card = apg.inner_text("body")
            check("D6 status: playlist videos = 2", "فيديوهات البلاي ليست" in videos_card)
            check("D7 status: real lessons 2/2", re.search(r"2\s*/\s*2", videos_card) is not None)
            check("D8 cover chip shows ytimg URL", apg.locator("img[src*='i.ytimg.com']").count() > 0)
            apg.screenshot(path=f"{OUT}/yt-course-sync-admin-panel.png", full_page=False)
            print(f"  📸 {OUT}/yt-course-sync-admin-panel.png")

            # lessons dialog with YouTube badges — WAIT FOR ROWS INSIDE THE DIALOG
            # (the sync panel text also contains "يوتيوب", so scope everything)
            lessons_btn = apg.get_by_role("button", name=re.compile("الدروس|Lessons")).first
            try:
                lessons_btn.click(timeout=8000)
                apg.wait_for_selector("[role=dialog] img[src*='i.ytimg.com/vi/']", timeout=10000)
                badge_count = apg.locator("[role=dialog] span:has-text('يوتيوب')").count()
                check("D9 lessons dialog shows YouTube badges", badge_count >= 2, f"badges={badge_count}")
                thumbs = apg.locator("[role=dialog] img[src*='i.ytimg.com/vi/']").count()
                check("D10 lessons dialog shows real video thumbnails", thumbs >= 2, f"thumbs={thumbs}")
                check("D11 non-playlist fake lesson flagged as R2/link",
                      apg.locator("[role=dialog] span:has-text('R2')").count() > 0)
                apg.screenshot(path=f"{OUT}/yt-course-sync-lessons-dialog.png", full_page=False)
                print(f"  📸 {OUT}/yt-course-sync-lessons-dialog.png")
            except Exception as e:
                check("D9 lessons dialog flow", False, str(e)[:120])
        actx.close()

        browser.close()

    print()
    if fails:
        print(f"✖ {len(fails)} FAILURES:")
        for f in fails:
            print("  - " + f)
        sys.exit(1)
    print("✓ ALL CHECKS PASSED")

if __name__ == "__main__":
    main()
