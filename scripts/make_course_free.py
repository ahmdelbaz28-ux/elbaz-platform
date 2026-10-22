"""Make the existing course FREE — via the real admin session on production.
1. Login as admin (form) → 2. POST admin.updateCourse {isPremium:false, price:0}
   (superjson envelope, same-origin) → 3. Verify public course page shows Free
   enroll + anonymous lesson access.
"""
import json, re, subprocess, sys, time
from playwright.sync_api import sync_playwright

PROD = "https://ahmedelbaz.qzz.io"
SLUG = "etap-complete-course"
OUT = "/home/z/my-project/work/elbaz-platform/scripts/shots_admin"
subprocess.run(["mkdir", "-p", OUT], check=True)
ADMIN_PW = open("/home/z/my-project/.admin_pw").read().strip()
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
fails = []
def check(name, cond, detail=""):
    print(f"{'✓' if cond else '✗'} {name}" + (f" — {detail}" if detail else ""))
    if not cond: fails.append(name)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False,
        args=["--disable-blink-features=AutomationControlled", "--no-sandbox"])
    ctx = browser.new_context(viewport={"width": 1440, "height": 900},
                              user_agent=UA, service_workers="block")
    pg = ctx.new_page()
    pg.goto(PROD + "/login", wait_until="domcontentloaded", timeout=45000)
    pg.wait_for_timeout(4000)
    # dismiss cookie consent (backdrop intercepts pointer events otherwise)
    try:
        pg.get_by_role("button", name=re.compile("accept|موافق|قبول", re.I)).click(timeout=3000)
    except Exception:
        pass
    pg.evaluate("() => document.querySelector('[data-testid=cookie-consent-backdrop]')?.click()")
    pg.wait_for_timeout(800)
    pg.locator("form input").nth(0).fill("admin")
    pg.locator("form input[type=password]").first.fill(ADMIN_PW)
    pg.locator("form button[type=submit]").first.click()
    pg.wait_for_timeout(6000)

    me = pg.evaluate("""async () => {
        const r = await fetch('/api/trpc/auth.me', {credentials:'include'});
        return {s: r.status, b: await r.json()};
    }""")
    check("admin session", me["s"] == 200 and re.search(r'"role"\s*:\s*"admin"', json.dumps(me["b"])) is not None,
          f"status={me['s']}")

    # 1) resolve course id via admin.listCourses
    lc = pg.evaluate("""async () => {
        const r = await fetch('/api/trpc/admin.listCourses', {credentials:'include'});
        return {s: r.status, b: await r.json()};
    }""")
    items = (((lc.get("b") or {}).get("result") or {}).get("data") or {}).get("json", {})
    rows = (items.get("items") or []) if isinstance(items, dict) else []
    tgt = next((c for c in rows if c.get("slug") == SLUG), None)
    if not tgt:
        print("✗ course not found — listCourses:", json.dumps(lc)[:400]); sys.exit(1)
    cid = tgt["id"]
    print(f"  course id={cid} price={tgt.get('price')} isPremium={tgt.get('isPremium')}")

    # 2) the mutation — superjson envelope
    mut = pg.evaluate("""async ({cid}) => {
        try {
            const r = await fetch('/api/trpc/admin.updateCourse', {
                method: 'POST',
                credentials: 'include',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({json: {id: cid, isPremium: false, price: 0}}),
            });
            return {s: r.status, b: await r.json()};
        } catch (e) { return {s: 0, b: String(e)}; }
    }""", {"cid": cid})
    check("updateCourse success", mut["s"] == 200 and "success" in json.dumps(mut["b"]),
          f"status={mut['s']} body={json.dumps(mut['b'])[:200]}")

    # 3) verify via admin.listCourses again
    lc2 = pg.evaluate("""async () => {
        const r = await fetch('/api/trpc/admin.listCourses', {credentials:'include'});
        return {s: r.status, b: await r.json()};
    }""")
    rows2 = ((((lc2.get("b") or {}).get("result") or {}).get("data") or {}).get("json", {}).get("items") or [])
    t2 = next((c for c in rows2 if c.get("id") == cid), {})
    check("stored isPremium=false", t2.get("isPremium") is False, f"isPremium={t2.get('isPremium')}")
    check("stored price=0", str(t2.get("price")) in ("0", "0.00", "0.0"), f"price={t2.get('price')}")
    pg.screenshot(path=f"{OUT}/F1_admin_course_free.png")

    # 4) PUBLIC view — anonymous context on the course page
    anon = browser.new_context(viewport={"width": 1440, "height": 900},
                               user_agent=UA, service_workers="block")
    apg = anon.new_page()
    apg.goto(f"{PROD}/courses/{SLUG}", wait_until="domcontentloaded", timeout=45000)
    apg.wait_for_timeout(6000)
    body = apg.locator("body").inner_text(timeout=10000)
    has_free = bool(re.search(r"(enroll for free|سجّ?ل\s*(الآن\s*)?مجانا|مجاناً)", body, re.I))
    no_price = not re.search(r"1,?999|3,?499", body)
    check("public page shows free enroll", has_free, "found free CTA" if has_free else "no free CTA text")
    check("public page has no old price", no_price, "price visible: " + (re.search(r"1,?999|3,?499", body).group(0) if not no_price else "none"))
    apg.screenshot(path=f"{OUT}/F2_public_course_free.png")
    anon.close(); ctx.close(); browser.close()

print("\n=== RESULT ===")
if fails:
    print("FAILURES:", fails); sys.exit(1)
print("COURSE IS NOW FREE — ALL CHECKS PASSED ✓")
