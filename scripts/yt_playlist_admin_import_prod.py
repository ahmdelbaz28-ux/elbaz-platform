"""PRODUCTION admin task — import the linked YouTube playlist into the ETAP
course lessons through the ADMIN UI, with EXACT YouTube titles, then prove
playback inside the site.

Owner rule being enforced on production:
  - the site playlist shows ONLY videos that actually exist on YouTube;
  - each lesson title is the EXACT title written on YouTube (verbatim);
  - proof: screenshots saved to /home/z/my-project/download/.

Flow:
  P1  admin login (one-time recovery lever — password from .admin_pw, never printed)
  P2  discover the ETAP course + lessons (same-origin tRPC, read-only)
  P3  live import pipeline check: server list == YouTube list, titles verbatim
  P4  THE ADMIN UI FLOW, per playlist video: course card → Lessons →
      pencil (edit lesson) → «Import from YouTube playlist» → pick the row →
      the form auto-fills link + verbatim title → Save
  P5  assert the stored lessons carry the exact YouTube titles + links
  P6  playback proof: open the course page, play lesson 1 in the embedded
      youtube-nocookie player, verify currentTime advances, screenshot
"""
import json, os, re, subprocess, sys, urllib.parse

PROD = "https://ahmedelbaz.qzz.io"
OUT = "/home/z/my-project/download"
subprocess.run(["mkdir", "-p", OUT], check=True)

ADMIN_PW = open("/home/z/my-project/.admin_pw").read().strip()
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

# Source of truth — verified live from YouTube oEmbed immediately before.
PLAYLIST = [
    {"videoId": "0l7WBjMF6uo",
     "title": "كورس ETAP المجاني | تعلم ETAP من الصفر وحتى الاحتراف"},
    {"videoId": "avugPlx0sXw",
     "title": "تحميل وتسطيب برنامج ETAP 2021 كامل | كورس ايتاب كامل بالعربي #01 | ETAP Course"},
]

fails = []

def check(name, cond, detail=""):
    print(f"{'✓' if cond else '✗'} {name}" + (f" — {detail}" if detail else ""))
    if not cond:
        fails.append(f"{name}: {detail}")

from playwright.sync_api import sync_playwright

def trpc_query(pg, proc, input_obj=None):
    if input_obj is None:
        url = f"/api/trpc/{proc}"
    else:
        url = (f"/api/trpc/{proc}?batch=1&input=" +
               urllib.parse.quote(json.dumps({"0": {"json": input_obj}})))
    return pg.evaluate("""async (u) => {
        try {
            const r = await fetch(u, {credentials: 'include'});
            let body = null;
            try { body = await r.json(); } catch (e) { body = null; }
            return {status: r.status, body};
        } catch (e) { return {status: 0, body: String(e)}; }
    }""", url)

def unwrap_batched(resp):
    body = resp.get("body") or {}
    try:
        return body["0"]["result"]["data"]["json"]
    except Exception:
        try:
            return body["result"]["data"]["json"]
        except Exception:
            return None

def dismiss_cookies(pg):
    try:
        pg.evaluate("() => document.querySelector('[data-testid=cookie-consent-backdrop]')?.click()")
        pg.wait_for_timeout(400)
    except Exception:
        pass

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False,
        args=["--disable-blink-features=AutomationControlled", "--no-sandbox",
              "--autoplay-policy=no-user-gesture-required"])
    ctx = browser.new_context(viewport={"width": 1440, "height": 900},
                              user_agent=UA, service_workers="block", locale="ar-EG")
    pg = ctx.new_page()

    # ---------- P1: admin login ----------
    pg.goto(PROD + "/login", wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(3500)
    dismiss_cookies(pg)
    pg.locator("form input").nth(0).fill("admin")
    pg.locator("form input[type=password]").first.fill(ADMIN_PW)
    pg.locator("form button[type=submit]").first.click()
    pg.wait_for_timeout(6000)
    me = trpc_query(pg, "auth.me")
    me_json = json.dumps(me.get("body", {}), ensure_ascii=False)
    check("P1 auth.me 200", me.get("status") == 200, f"status={me.get('status')}")
    check("P1 role=admin", '"role":"admin"' in me_json.replace(" ", ""))
    if any("P1" in f for f in fails):
        print("LOGIN FAILED — aborting")
        sys.exit(1)

    # ---------- P2: discover the ETAP course + lessons ----------
    courses = unwrap_batched(trpc_query(pg, "admin.listCourses", {"page": 1, "limit": 50}))
    items = (courses or {}).get("items", [])
    check("P2 courses listed", len(items) > 0, f"count={len(items)}")
    course = next((c for c in items
                   if "etap" in (c.get("slug") or "").lower()
                   or "ايتاب" in (c.get("titleAr") or "")
                   or "ETAP" in (c.get("titleEn") or "")), items[0] if items else None)
    check("P2 ETAP course found", course is not None,
          f"slug={course.get('slug') if course else '—'}")
    if not course:
        sys.exit(1)
    slug, cid = course["slug"], course["id"]

    lessons0 = unwrap_batched(trpc_query(pg, "admin.listLessons", {"courseId": cid})) or {}
    lesson_items = sorted(lessons0.get("items", []),
                          key=lambda l: (l.get("sortOrder") or 0, l.get("id") or 0))
    print(f"  course: {slug} (id={cid}) | lessons: {len(lesson_items)}")
    for l in lesson_items[:8]:
        print(f"   · [order {l.get('sortOrder')}] id={l['id']} «{(l.get('titleAr') or '')[:55]}» video={(l.get('videoUrl') or '—')[:50]}")

    # ---------- P3: live import pipeline — mirrors YouTube EXACTLY? ----------
    imp = unwrap_batched(trpc_query(pg, "admin.youtubePlaylistVideos", {}))
    live_items = {v["videoId"]: v for v in (imp or {}).get("items", [])}
    check("P3 import pipeline reachable", isinstance(imp, dict) and "items" in imp,
          f"verified={imp.get('verified') if isinstance(imp, dict) else '?'} items={len(live_items)}")
    check("P3 list == YouTube (ids)", sorted(live_items.keys()) == sorted(v["videoId"] for v in PLAYLIST),
          f"site={sorted(live_items.keys())}")
    titles_ok = all(live_items.get(v["videoId"], {}).get("title") == v["title"] for v in PLAYLIST)
    check("P3 titles VERBATIM from YouTube (oEmbed)", titles_ok,
          " | ".join(f"{v['videoId']}: «{live_items.get(v['videoId'], {}).get('title', '—')[:38]}»" for v in PLAYLIST))

    # ---------- P4: THE ADMIN UI IMPORT FLOW ----------
    pg.goto(PROD + "/admin", wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(5500)
    dismiss_cookies(pg)
    pg.get_by_role("button", name=re.compile("^(Courses|الكورسات)$")).first.click()
    pg.wait_for_timeout(2500)

    card = pg.locator("div.rounded-xl", has_text="ETAP").first
    card.get_by_role("button", name=re.compile("Lessons|الدروس")).click()
    pg.wait_for_timeout(2500)
    lessons_dialog = pg.locator("[role=dialog]").filter(has_text=re.compile("Lessons|دروس")).last
    check("P4 lessons dialog open", lessons_dialog.is_visible(), "")

    n_needed = len(PLAYLIST)
    have = max(len(lesson_items), 0)

    for i in range(n_needed):
        pv = PLAYLIST[i]
        print(f"  → importing {pv['videoId']} «{pv['title'][:45]}…»")
        if i < have:
            pencil = lessons_dialog.locator("button:has(svg[class*='lucide-pencil'])").nth(i)
            pencil.click()
        else:
            lessons_dialog.get_by_role("button", name=re.compile("Add Lesson|إضافة درس")).click()
        pg.wait_for_timeout(2000)

        lesson_form = pg.locator("[role=dialog]").filter(
            has_text=re.compile("Edit Lesson|New Lesson|تعديل الدرس|درس جديد")).last
        check(f"P4 lesson form open #{i+1}", lesson_form.is_visible(), "")

        # THE NEW FLOW: import from playlist — fills link + VERBATIM title
        lesson_form.get_by_role("button", name=re.compile(
            "Import from YouTube playlist|استيراد من بلايليست اليوتيوب")).click()
        pg.wait_for_timeout(4000)

        playlist_dialog = pg.locator("[role=dialog]").filter(
            has_text=re.compile("Channel playlist videos|فيديوهات بلايليست القناة")).last
        check(f"P4 playlist dialog open #{i+1}", playlist_dialog.is_visible(), "")
        if i == 0:
            pg.screenshot(path=f"{OUT}/yt_import_dialog_prod.png")
            print("    📸 playlist dialog screenshot saved")

        row = playlist_dialog.locator("button", has_text=pv["videoId"]).first
        row.click()
        pg.wait_for_timeout(2000)

        # title fields must now hold the VERBATIM YouTube title
        en_val = lesson_form.locator("input").nth(0).input_value()
        ar_val = lesson_form.locator("input").nth(1).input_value()
        url_val = lesson_form.locator("input").nth(4).input_value() if lesson_form.locator("input").count() > 4 else ""
        check(f"P4 form auto-filled with verbatim title #{i+1}",
              en_val == pv["title"] and ar_val == pv["title"],
              f"en=«{en_val[:38]}…» ar=«{ar_val[:38]}…»")
        check(f"P4 form auto-filled with watch link #{i+1}", pv["videoId"] in url_val,
              url_val[:60])

        lesson_form.get_by_role("button", name=re.compile("^(Save|حفظ)$")).click()
        pg.wait_for_timeout(3000)

    pg.screenshot(path=f"{OUT}/yt_lessons_titles_prod.png")
    print("    📸 lessons list screenshot saved")

    # ---------- P5: stored lessons carry EXACT YouTube titles + links ----------
    lessons2 = unwrap_batched(trpc_query(pg, "admin.listLessons", {"courseId": cid})) or {}
    lesson_items2 = sorted(lessons2.get("items", []),
                           key=lambda l: (l.get("sortOrder") or 0, l.get("id") or 0))
    for i, pv in enumerate(PLAYLIST):
        if i < len(lesson_items2):
            l = lesson_items2[i]
            ok = (l.get("titleAr") == pv["title"] and l.get("titleEn") == pv["title"]
                  and pv["videoId"] in (l.get("videoUrl") or ""))
            check(f"P5 lesson[{i}] stored title+link EXACT", ok,
                  f"ar=«{(l.get('titleAr') or '')[:42]}…» url={(l.get('videoUrl') or '—')[:55]}")

    # ---------- P6: playback proof inside the site ----------
    pg.goto(PROD + f"/courses/{slug}", wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_timeout(6000)
    dismiss_cookies(pg)
    pg.screenshot(path=f"{OUT}/yt_prod_course_lessons.png")

    clicked = False
    try:
        pg.get_by_text(PLAYLIST[0]["title"]).first.click(timeout=5000)
        clicked = True
    except Exception:
        try:
            pg.locator(re.compile("ابدأ|Start|Watch|شاهد", re.I)).first.click(timeout=4000)
            clicked = True
        except Exception:
            pass
    pg.wait_for_timeout(6000)
    check("P6 lesson player opened", clicked or "youtube" in pg.content().lower(), pg.url)

    yt_frame = None
    for _ in range(20):
        for f in pg.frames:
            fu = f.url or ""
            if "youtube-nocookie" in fu or ("youtube.com/embed" in fu):
                yt_frame = f
                break
        if yt_frame:
            break
        pg.wait_for_timeout(1000)
    check("P6 embedded youtube iframe present (site page)", yt_frame is not None,
          f"page={pg.url}" + (f" frame={(yt_frame.url or '')[:70]}" if yt_frame else ""))
    check("P6 NO redirect to youtube.com", "/courses/" in pg.url, pg.url)

    if yt_frame:
        try:
            yt_frame.locator("button.ytp-large-play-button, button.ytp-play-button").first.click(timeout=8000)
        except Exception:
            try:
                yt_frame.locator("video").first.click(timeout=5000, position={"x": 320, "y": 180})
            except Exception:
                pass
        pg.wait_for_timeout(9000)
        state = yt_frame.evaluate("""() => {
            const v = document.querySelector('video');
            if (!v) return {found: false};
            return {found: true, paused: v.paused, time: v.currentTime,
                    duration: v.duration, w: v.videoWidth, h: v.videoHeight};
        }""")
        playing = state.get("found") and not state.get("paused", True) and state.get("time", 0) > 0.5
        check("P6 video is PLAYING inside the site", playing, json.dumps(state))
        pg.screenshot(path=f"{OUT}/yt_playing_prod.png")
        pg.wait_for_timeout(2000)
        pg.screenshot(path=f"{OUT}/yt_playing_prod_2.png")
        print(f"    📸 playback screenshots saved | state={json.dumps(state)}")

    ctx.close()
    browser.close()

print("\n=== RESULT ===")
if fails:
    print("FAILURES:")
    for f in fails:
        print(" -", f)
    sys.exit(1)
print("ALL PRODUCTION ADMIN CHECKS PASSED ✓")
