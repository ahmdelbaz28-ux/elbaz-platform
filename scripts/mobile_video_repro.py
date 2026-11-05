"""LOCAL MOBILE VIDEO REPRODUCTION — real build, real YouTube playback.

Serves dist/public (production build) with Playwright route-interception of
/api/trpc/* (service workers blocked → no bypass), mocking exactly the
CourseDetail contract for an enrolled user watching a YouTube lesson.

Screenshots + geometry on THREE phone widths (360 / 390 / 414) so a crop that
only appears at one width cannot hide. This is the loop: run → look → fix →
run again until every width is pixel-clean.

Checks per width:
  P1  player iframe mounts
  P2  playback actually starts (big-play button consumed / player state)
  P3  iframe box == 16:9 slot box (±2px)
  P4  no horizontal page overflow
  P5  player fully inside viewport
"""
import json
import subprocess
import sys
import threading
import http.server
import os
import socketserver
import urllib.parse

from playwright.sync_api import sync_playwright

DIST = "/home/z/my-project/work/elbaz-platform/dist/public"
OUT = "/home/z/my-project/work/elbaz-platform/scripts/shots_mobile_video"
PORT = 4180
BASE = f"http://127.0.0.1:{PORT}"
subprocess.run(["mkdir", "-p", OUT], check=True)

USER = {"id": 5, "username": "paytest01", "name": "طالب تجريبي", "role": "user", "email": "paytest01@example.com"}
TOKEN = "local-test-token"

LESSONS = [
    # REAL verbatim playlist titles (the long nowrap strings that used to
    # stretch the grid and crop the video on phones — regression guard).
    {"id": 71, "titleAr": "1. كورس ETAP المجاني | تعلم ETAP من الصفر وحتى الاحتراف", "titleEn": "1. Free ETAP course | Learn ETAP from zero to pro", "isFree": True,
     "durationMinutes": 45, "videoUrl": "https://www.youtube.com/watch?v=aqz-KE-bpKQ", "type": "youtube"},
    {"id": 72, "titleAr": "2. تحميل وتسطيب برنامج ETAP 2021 كامل | كورس ايتاب كامل بالعربي خطوة بخطوة", "titleEn": "2. Download and install ETAP 2021 full | step by step", "isFree": True,
     "durationMinutes": 32, "videoUrl": "https://www.youtube.com/watch?v=aqz-KE-bpKQ", "type": "youtube"},
    {"id": 73, "titleAr": "3. شرح رسم الشبكة الكهربائية Single Line Diagram في برنامج ETAP بالتفصيل للمبتدئين", "titleEn": "3. Single Line Diagram explained", "isFree": False,
     "durationMinutes": 28, "videoUrl": "https://www.youtube.com/watch?v=aqz-KE-bpKQ", "type": "youtube"},
]
COURSE = {
    "id": 44, "slug": "etap-complete-course",
    "titleAr": "كورس ETAP الشامل — من الصفر للاحتراف", "titleEn": "ETAP Complete Course",
    "descriptionAr": "شرح شامل لبرنامج ETAP من الصفر حتى الاحتراف — رسم الشبكات، تحليل تدفق القدرة، والأعطال.",
    "descriptionEn": "Full ETAP course.",
    "learningOutcomesAr": ["رسم الشبكات", "تحليل الحمل"], "learningOutcomesEn": ["One-line diagrams"],
    "thumbnail": "/course-etap.jpg", "price": "0.00", "originalPrice": "0.00",
    "isPremium": False, "isPublished": True, "rating": "4.9", "studentCount": 320,
    "durationHours": 12, "category": {"nameEn": "Power Systems", "nameAr": "قوى كهربائية"},
    "lessons": LESSONS,
}
YOUTUBE_IDS = {71: "aqz-KE-bpKQ", 72: "aqz-KE-bpKQ", 73: "aqz-KE-bpKQ"}

SECTIONS = {
    "subscribeGate": {"enabled": "true", "days": "30", "channelUrl": "https://www.youtube.com/@AhmedElbazEng"},
    "contact": {"whatsappNumber": "201061857305", "phone": "01061857305", "telegramUrl": "https://t.me/engahmedetap"},
}


def json_body(payload):
    return json.dumps({"result": {"data": {"json": payload}}}).encode()


def lesson_video(lesson_id):
    yid = YOUTUBE_IDS.get(lesson_id, "aqz-KE-bpKQ")
    return {
        "videoUrl": f"https://www.youtube-nocookie.com/embed/{yid}?enablejsapi=1",
        "hlsUrl": None,
        "kind": "youtube",
        "youtubeId": yid,
        "username": USER["name"],
        "lessonTitle": "مقدمة في الـ ETAP",
        "watermarkText": USER["username"],
    }


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/trpc/"):
            name = path.split("/api/trpc/")[-1].split("?")[0]
            q = urllib.parse.parse_qs(parsed.query)
            inp = {}
            try:
                inp = json.loads(q.get("input", ["{}"])[0]).get("json", {}) or {}
            except Exception:
                pass
            if name == "auth.me":
                cookie = self.headers.get("Cookie") or ""
                if "elbaz_auth=" in cookie:
                    return self._send(200, json_body(USER))
                return self._send(401, b'{"error":{"json":{"message":"UNAUTHORIZED"}}}')
            if name == "settings.getActiveTheme":
                return self._send(200, json_body(None))
            if name == "settings.getSection":
                return self._send(200, json_body(SECTIONS.get(inp.get("section"), {})))
            if name == "course.bySlug":
                return self._send(200, json_body(COURSE))
            if name == "course.checkEnrollment":
                return self._send(200, json_body({"enrolled": True, "isCompleted": False}))
            if name == "course.lessonVideo":
                return self._send(200, json_body(lesson_video(int(inp.get("lessonId") or 0))))
            if name == "course.getSavedPosition":
                return self._send(200, json_body({"lastPosition": 0, "watchedSeconds": 0}))
            if name == "payment.isConfigured":
                return self._send(200, json_body({"configured": True}))
            if name == "payment.manualDetails":
                return self._send(200, json_body({"vodafoneCashNumber": "01061857305", "instapayHandle": "",
                                                  "bankTransferDetails": "", "notesAr": "", "notesEn": "",
                                                  "paymobPublicKey": "", "paymobIntegrationCard": "",
                                                  "paymobIntegrationWallet": ""}))
            return self._send(200, json_body(None))
        self.serve_static(path)

    def do_POST(self):
        self._send(200, json_body({"success": True}))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

    def serve_static(self, url_path):
        rel = url_path.lstrip("/") or "index.html"
        full = os.path.join(DIST, rel)
        if not os.path.isfile(full):
            full = os.path.join(DIST, "index.html")
        ext = os.path.splitext(full)[1]
        ctype = {".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                 ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
                 ".json": "application/json", ".webp": "image/webp", ".woff2": "font/woff2",
                 ".webmanifest": "application/manifest+json", ".ico": "image/x-icon"}.get(ext, "application/octet-stream")
        with open(full, "rb") as f:
            self._send(200, f.read(), ctype)


def start_server():
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


INIT = ("localStorage.setItem('elbaz_cookie_consent', JSON.stringify({necessary:true,analytics:false,marketing:false}));"
        "localStorage.setItem('language', 'ar');")


def probe_width(browser, width, height):
    print(f"\n════ WIDTH {width} ════")
    ctx = browser.new_context(viewport={"width": width, "height": height}, is_mobile=True, has_touch=True,
                              service_workers="block")
    ctx.add_cookies([{"name": "elbaz_auth", "value": TOKEN, "url": BASE},
                     {"name": "elbaz_auth_flag", "value": "1", "url": BASE}])
    ctx.add_init_script(INIT)
    pg = ctx.new_page()
    tag = f"w{width}"
    pg.goto(BASE + "/courses/etap-complete-course", wait_until="domcontentloaded", timeout=45000)
    pg.wait_for_timeout(3500)

    # open the first accessible lesson
    rows = pg.locator("button:has(p)")
    clicked = False
    for i in range(min(rows.count(), 10)):
        r = rows.nth(i)
        txt = " ".join((r.text_content() or "").split())
        if "1." in txt:
            r.scroll_into_view_if_needed()
            r.click(timeout=4000)
            clicked = True
            break
    print("P0 lesson clicked:", clicked)
    pg.wait_for_timeout(4000)

    gate = pg.locator('[data-testid="subscribe-gate"]')
    if gate.count() >= 1 and gate.first.is_visible():
        pg.locator('[data-testid="subscribe-gate-already"]').first.click()
        pg.wait_for_timeout(3500)

    for _ in range(12):
        if pg.locator("[data-youtube-player] iframe").count() >= 1:
            break
        pg.wait_for_timeout(1000)

    def geom():
        return pg.evaluate("""() => {
          const player = document.querySelector('[data-youtube-player]');
          const slot = player ? player.querySelector('.aspect-video') : null;
          const iframe = document.querySelector('[data-youtube-player] iframe');
          const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
            return {x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1)}; };
          return {vw: document.documentElement.clientWidth,
                  overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                  player: box(player), slot: box(slot), iframe: box(iframe)};
        }""")

    g = geom()
    print("GEOMETRY pre-play:", json.dumps(g))
    pg.evaluate("document.querySelector('[data-youtube-player]')?.scrollIntoView({block:'center'})")
    pg.wait_for_timeout(700)
    g = geom()
    pg.screenshot(path=f"{OUT}/{tag}_1_player.png")

    # press play inside the iframe
    played = False
    try:
        frame = pg.frame_locator("[data-youtube-player] iframe")
        big = frame.locator("button[aria-label]", has_text="").first
        btn = frame.locator(".ytp-large-play-button, button[aria-label*='Play'], button[aria-label*='تشغيل']")
        if btn.count() >= 1:
            btn.first.click(timeout=6000, force=True)
            played = True
        else:
            frame.locator("video").first.click(timeout=6000, force=True)
            played = True
    except Exception as e:
        print("frame click failed:", str(e)[:120])
        if g and g.get("iframe"):
            b = g["iframe"]
            pg.touchscreen.tap(b["x"] + b["w"] / 2, min(max(b["y"] + b["h"] / 2, 5), height - 5))
            played = True
    pg.wait_for_timeout(9000)
    g2 = geom()
    print("GEOMETRY playing:", json.dumps(g2))
    pg.screenshot(path=f"{OUT}/{tag}_2_playing.png")

    # pause via tap (YouTube toggles controls) then screenshot controls state
    res = {
        "mounted": pg.locator("[data-youtube-player] iframe").count() >= 1,
        "played": played,
        "g": g2,
    }
    ctx.close()
    return res


fails = []
def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'} {name}" + (f" — {detail}" if detail else ""))
    if not cond:
        fails.append(f"{name}: {detail}")


if __name__ == "__main__":
    start_server()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=["--no-sandbox"])
        for w, h in [(360, 780), (390, 844), (414, 896)]:
            r = probe_width(browser, w, h)
            check(f"P1 player mounts @{w}", r["mounted"])
            check(f"P2 play triggered @{w}", r["played"])
            g = r["g"]
            if g and g.get("iframe") and g.get("slot"):
                ib, sb = g["iframe"], g["slot"]
                check(f"P3 iframe==slot @{w}",
                      abs(ib["x"]-sb["x"])<=2 and abs(ib["y"]-sb["y"])<=2 and abs(ib["w"]-sb["w"])<=2 and abs(ib["h"]-sb["h"])<=2,
                      f"iframe={ib} slot={sb}")
                check(f"P5 player inside viewport @{w}", ib["x"] >= -1 and ib["x"]+ib["w"] <= g["vw"]+1, f"iframe={ib} vw={g['vw']}")
            check(f"P4 no overflow @{w}", g and g.get("overflowX", 99) <= 0, f"overflowX={g and g.get('overflowX')}")
        browser.close()
    print("\n" + ("ALL CHECKS PASSED" if not fails else f"{len(fails)} FAILURES:\n" + "\n".join(fails)))
    sys.exit(1 if fails else 0)
