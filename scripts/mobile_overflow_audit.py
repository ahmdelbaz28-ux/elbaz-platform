"""PRODUCTION mobile-overflow audit — find every element that gets cut on phones.

Drives the live site at 390x844 (Pixel-8-like, touch, Arabic) and, for every
public page, measures:
  - document scrollWidth vs viewport (horizontal page overflow = "edges cut")
  - the concrete elements whose boxes cross the viewport edge (offenders)
  - for the course page: the YouTube iframe rect vs its 16:9 container rect
    (the IFrame API replaces the mount div with a fixed 640x360 iframe — on
    phones that overflows and the site crops it).

Shots: /home/z/my-project/download/mobile_audit_prod/  (before/after proof)
"""
import json
import subprocess
import sys

from playwright.sync_api import sync_playwright

PROD = "https://ahmedelbaz.qzz.io"
OUT = "/home/z/my-project/download/mobile_audit_prod"
subprocess.run(["mkdir", "-p", OUT], check=True)
UA = ("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36")
VP = {"width": 390, "height": 844}

PAGES = [
    ("home", "/"),
    ("courses", "/courses"),
    ("course_detail", "/courses/etap-complete-course"),
    ("articles", "/articles"),
    ("faq", "/faq"),
    ("support", "/support"),
]

MEASURE = """
() => {
  const vw = document.documentElement.clientWidth;
  const doc = document.documentElement;
  const offenders = [];
  const seen = new Set();
  document.querySelectorAll('body *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 8) return;
    const beyond = r.right > vw + 2 || r.left < -2;
    if (!beyond) return;
    // keep only the OUTERMOST offenders (skip children of an already-listed one)
    for (const p of el.querySelectorAll(' *')) { /* noop guard */ }
    let inside = false;
    for (const k of seen) {
      if (k.contains(el)) { inside = true; break; }
    }
    if (inside) return;
    seen.add(el);
    offenders.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 110),
      left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
    });
  });
  return {
    vw,
    scrollW: doc.scrollWidth,
    bodyScrollW: document.body ? document.body.scrollWidth : 0,
    overflow: Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0) - vw,
    offenders: offenders.slice(0, 10),
  };
}
"""

IFRAME_FIT = """
() => {
  const host = document.querySelector('[data-youtube-player]');
  if (!host) return null;
  const screen = host.querySelector('.aspect-video') || host.firstElementChild;
  const iframe = host.querySelector('iframe');
  const s = screen ? screen.getBoundingClientRect() : null;
  const f = iframe ? iframe.getBoundingClientRect() : null;
  return {
    screen: s ? {w: Math.round(s.width), h: Math.round(s.height)} : null,
    iframe: f ? {w: Math.round(f.width), h: Math.round(f.height)} : null,
    cropped: !!(s && f && (f.width > s.width + 2 || f.height > s.height + 2)),
  };
}
"""


def pass_cloudflare(pg):
    for _ in range(8):
        try:
            title = pg.title()
        except Exception:
            title = ""
        if "لحظة" not in title and "moment" not in title.lower():
            return True
        try:
            bb = pg.locator("iframe[src*='challenges.cloudflare.com']").first.bounding_box(timeout=3000)
            if bb:
                pg.mouse.click(bb["x"] + 32, bb["y"] + bb["height"] / 2)
        except Exception:
            pass
        pg.wait_for_timeout(6000)
    return True


def dismiss_cookie(pg):
    for sel in ['[data-testid="cookie-accept-all"]', '[data-testid="cookie-accept-essential"]']:
        try:
            loc = pg.locator(sel).first
            if loc.is_visible(timeout=1200):
                loc.click()
                pg.wait_for_timeout(400)
                return
        except Exception:
            pass


report = {}
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
    ctx = browser.new_context(viewport=VP, user_agent=UA, locale="ar-EG",
                              is_mobile=True, has_touch=True, service_workers="block")
    pg = ctx.new_page()

    for name, path in PAGES:
        try:
            pg.goto(PROD + path, wait_until="domcontentloaded", timeout=60_000)
            pass_cloudflare(pg)
            pg.wait_for_timeout(3500)
            dismiss_cookie(pg)
            pg.wait_for_timeout(800)
            data = pg.evaluate(MEASURE)
            if name == "course_detail":
                data["iframe_fit"] = pg.evaluate(IFRAME_FIT)
                pg.screenshot(path=f"{OUT}/course_detail_top.png")
                pg.evaluate("() => window.scrollTo(0, document.body.scrollHeight * 0.35)")
                pg.wait_for_timeout(900)
                pg.screenshot(path=f"{OUT}/course_detail_mid.png")
            else:
                pg.screenshot(path=f"{OUT}/{name}.png")
            report[name] = data
            flag = "OVERFLOW" if (data["overflow"] or 0) > 2 else "ok"
            print(f"[{flag:8s}] {name:15s} overflow={data['overflow']}px offenders={len(data['offenders'])}")
            for o in data["offenders"][:5]:
                print(f"           · <{o['tag']}> {o['cls'][:70]} | left={o['left']} right={o['right']} w={o['w']}")
        except Exception as e:
            report[name] = {"error": str(e)[:200]}
            print(f"[ERROR    ] {name}: {str(e)[:120]}")

    iframes = report.get("course_detail", {}).get("iframe_fit")
    print("\ncourse page iframe fit:", json.dumps(iframes))
    browser.close()

with open(f"{OUT}/audit_report.json", "w") as fh:
    json.dump(report, fh, ensure_ascii=False, indent=2)
print(f"\nreport + shots → {OUT}")
bad = [k for k, v in report.items() if (v.get("overflow") or 0) > 2 or v.get("error")]
print("pages with issues:", ", ".join(bad) if bad else "none")
sys.exit(0)
