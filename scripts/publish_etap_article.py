"""PRODUCTION — publish the ETAP article through the admin dashboard API.
https://ahmedelbaz.qzz.io

Steps:
  A  login admin (cookie session)
  B  verify articles procedures live (v7 migration applied) — articles.list 200
  C  if slug already exists → update, else create (isPublished=true)
  D  verify public side: articles.getBySlug returns full content, list includes it
Shots: scripts/shots_articles/
"""
import json, os, re, subprocess, sys
from playwright.sync_api import sync_playwright

PROD = "https://ahmedelbaz.qzz.io"
OUT = "/home/z/my-project/work/elbaz-platform/scripts/shots_articles"
subprocess.run(["mkdir", "-p", OUT], check=True)
ADMIN_PW = open("/home/z/my-project/.admin_pw").read().strip()
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

SLUG = "etap-power-system-analysis-guide"

TITLE_AR = "برنامج الإيتاب ETAP: الدليل الشامل لتحليل وتصميم أنظمة القدرة الكهربائية"
TITLE_EN = "ETAP: The Complete Guide to Power System Analysis and Design"
EXCERPT_AR = ("تعرف على برنامج الإيتاب ETAP — المعيار العالمي لتحليل أنظمة القدرة الكهربائية. "
              "دليل عملي شامل يغطي وحدات البرنامج (تدفق القدرة، القصر، الوميض القوسي، الاستقرار)، "
              "سير العمل الهندسي، مقارنة مع البدائل، وخطة تعلم متدرجة من الصفر إلى الاحتراف.")
EXCERPT_EN = ("Master ETAP — the world standard for power system analysis. A practical guide "
              "covering load flow, short-circuit, arc flash, transient stability, engineering "
              "workflow, software comparison, and a step-by-step learning roadmap.")

CONTENT_AR = """في عالم الهندسة الكهربائية الحديث، أصبح امتلاك مهارة التعامل مع برامج المحاكاة الهندسية شرطاً أساسياً لا غنى عنه لأي مهندس قوى كهربائية. وفي مقدمة هذه البرامج يقف برنامج الإيتاب ETAP (Electrical Transient and Analysis Program) الذي رسّخ مكانته خلال أكثر من ثلاثة عقود بوصفه الحل المتكامل والأكثر موثوقية لتصميم وتحليل وتشغيل أنظمة القدرة الكهربائية في الصناعة والمباني والمنشآت البترولية ومحطات التوليد. في هذا المقال نأخذك في جولة شاملة نتعرف فيها على قدرات البرنامج، ووحداته التحليلية، وكيف تبدأ رحلتك معه خطوة بخطوة.

## ما هو برنامج الإيتاب ETAP ولماذا يُعد المعيار العالمي؟

الإيتاب ETAP هو منصة برمجية متكاملة مطوّرة من شركة Operation Technology Inc. (OTI) الأمريكية، تُستخدم لنمذجة ومحاكاة وتحليل وتصميم أنظمة التوزيع والنقل الكهربائية. ما يميز الإيتاب ليس مجرد دقة نتائجه، بل أنه نظام مؤسسي متكامل يجمع بين التصميم والتحليل والمراقبة التشغيلية في بيئة واحدة، مدعوماً بمكتبة أجهزة ضخمة تضم أكثر من مئتي ألف طراز من المكونات الحقيقية من الشركات المصنعة العالمية، مع التزام كامل بمعايير IEEE وIEC وANSI المعتمدة عالمياً.

تعتمد كبرى الشركات العالمية والمحلية على ETAP في مشاريعها — من منشآت الغاز والنفط، إلى محطات الطاقة، إلى مصافي التكرير، ومراكز البيانات، وشبكات المياه والصناعات الثقيلة. وهذا الانتشار الواسع يجعل إتقان البرنامج استثماراً مباشراً في مستقبلك المهني، فالطلب على مهندسي القوى المتمكنين من الإيتاب يفوق العرض بكثير في سوق العمل المصري والخليجي والعالمي.

## وحدات ETAP التحليلية الأساسية — قوة البرنامج الحقيقية

يتكون الإيتاب من عشرات الوحدات المتكاملة، كل منها مصمم لمهمة تحليلية محددة، وأهمها:

- تحليل تدفق القدرة Load Flow: الوحدة الأكثر استخداماً؛ تحسب قدرة وفولتية التيار في كل نقطة من الشبكة في الحالات العادية، مع محركات حل متعددة (Newton-Raphson وFast-Decoupled وAdaptive) لضمان التقارب حتى في الشبكات المعقدة.
- تحليل القصر الكهربائي Short-Circuit: حساب تيارات القصر وفق معياري IEC 60909 وIEEE 141 (Red Book) لتحديد قدرة قطع الأجهزة وقيم الأعطال في كل بريكر.
- تحليل الوميض القوسي Arc Flash: حسب معايير IEEE 1584 وNFPA 70E لتحديد حدود الأمان وطاقة الإصابة ووسائل الوقاية الشخصية المطلوبة لفنيي الصيانة.
- دراسة التنسيق والحماية Star Protection & Coordination: منحنيات الزمن-التيار لكل الأجهزة الواقية، ومطابقة تسلسل الفصل بحيث يُعزل العطل بالقرب منه فقط دون تعميم الانقطاع.
- الاستقرار اللحظي Transient Stability: محاكاة سلوك المولدات والمحركات أثناء الاضطرابات الكبيرة واختبار قدرة النظام على استعادة التوازن.
- تشغيل المحركات Motor Acceleration: دراسة إقلاع المحركات الكبيرة وأثرها على الجهد، واختيار طريقة الإقلاع المناسبة (DOL، Star-Delta، Soft Starter، VFD).
- تصميم شبكة التأريض Ground Grid: وفق معيار IEEE 80 لضمان مستويات أمان خطوة ولمس مقبولة في محطات المحولات.
- سحب الكابلات والتحليل الحراري Cable Pulling وCable Sizing: اختيار المقطع الاقتصادي للتوصيلات والتحقق من هبوط الجهد وفقد القدرة.
- التوافقيات Harmonics: تحليل تشوه الموجات الناتج عن الأحمال غير الخطية وتقييم مطابقة معيار IEEE 519.
- تحليل الموثوقية Reliability: مؤشرات SAIFI وSAIDI وتقييم موثوقية التصميم عبر أشجار الأعطال.

## سير العمل الهندسي داخل ETAP — من المخطط الأحادي إلى التقرير النهائي

الرحلة العملية في أي مشروع إيتاب تتبع مساراً واضحاً يتعلمه المهندس بالتكرار المنظم. تبدأ برسم المخطط الأحادي الخطي Single Line Diagram بأدوات السحب والإفلات الذكية، ثم إدخال بيانات الأجهزة من ألواح الخصائص — المحولات بالقدرة والممانعة، الكابلات بالنوع والمقطع والطول، الأحمال بالقدرة ومعامل القدرة. بعدها تُدار مكتبة الأجهزة Library لضمان استخدام طرازات حقيقية مطابقة للمصنعين، ثم تُشغل الوحدات التحليلية تباعاً: تدفق قدرة أولاً لضبط الظروف الاعتيادية، ثم قصر لتحديد العُدد الحرجة، ثم تنسيق حماية يضبط الأجهزة الواقية، وأخيراً تقارير Output Reports الاحترافية القابلة للتصدير والتي تحوز ثقة المراجعين والعملاء.

- نصيحة عملية: لا تدرس الوحدات بمعزل عن بعضها؛ مشروع متكامل صغير أفضل من عشرة تدريبات مجزأة.
- نصيحة عملية: وثّق افتراضاتك في كل دراسة — مصدر البيانات، معاملات الأمان، معايير التصميم.
- نصيحة عملية: تحقق دائماً من معقولية النتائج هندسياً قبل اعتمادها — البرنامج أداة والقرار يبقى للمهندس.

## ETAP في موازنة البرامج المنافسة

يسأل كثير من المهندسين: لماذا الإيتاب تحديداً وليس DIgSILENT PowerFactory أو SKM PowerTools أو EasyPower؟ الإجابة تكمن في التوازن بين الشمولية والانتشار الصناعي. فبينما يتميز PowerFactory بعمقه البحثي في تحليل شبكات النقل الفائق الجهد وديناميكيتها، يبرز ETAP كأقوى خيار لشبكات التوزيع والمنشآت الصناعية، وخصوصاً في المنطقة العربية حيث تُبنى مناهج الشركات وأجهزتها المتطلبة غالباً حول مخرجات الإيتاب، فضلاً عن أن قواعد البيانات الهندسية الجاهزة ومكتبة الأجهزة الضخمة تختصر ساعات من العمل اليدوي. أما SKM فيظل شائعاً في دراسات المباني التجارية الأبسط. لذلك فإن التركيز على ETAP كبرنامج أساسي مع فهم مفاهيمي عام للبدائل يمنحك أفضل عائد تعليمي ومهني.

## خطة تعلم الإيتاب من الصفر إلى الاحتراف

- المرحلة الأولى — الأساس النظري: مراجعة حسابات تدفق القدرة والقصر بالطرق اليدوية؛ فمن يفهم المعادلة يتعامل مع البرنامج بثقة لا بتلقائية.
- المرحلة الثانية — رسم النمذجة: إتقان المخطط الأحادي وإدخال بيانات الأجهزة وإدارة المكتبات ومفاهيم الأنماط Scenario Manager.
- المرحلة الثالثة — الدراسات الأساسية: تدفق قدرة ثم قصر ثم بدء تشغيل المحركات، على مشاريع تدريبية واقعية متدرجة.
- المرحلة الرابعة — الدراسات المتقدمة: تنسيق الحماية على Star، الوميض القوسي، الاستقرار، والتوافقيات.
- المرحلة الخامسة — المشاريع الحقيقية: دراسة كاملة لمنشأة صناعية من المخطط حتى التقرير النهائي الجاهز للتسليم.

## ابدأ اليوم — كورس ETAP التطبيقي مجاناً على المنصة

إذا كنت تبحث عن مسار تعلم منظم يوفر عليك سنوات من التشتت، فكورس برنامج الإيتاب ETAP على منصة أحمد الباز يأخذك من أول رسم مخطط أحادي حتى إخراج دراسات احترافية كاملة — بمحتوى تطبيقي مبني على خبرة هندسية ميدانية حقيقية، وبشكل مجاني تماماً لكل متعلم. سجّل الآن من صفحة الكورسات، وابدأ رحلتك نحو الاحتراف مع دعم مباشر ومتابعة للتقدم. وهذه فرصة مثالية أيضاً لمهندسي التخرج الحديث الباحثين عن مهارة تميز سيرتهم الذاتية، وللمهندسين العاملين الراغبين في الانتقال إلى أقسام القوى والدراسات داخل شركاتهم.

الخلاصة: إن mastered للإيتاب ليس ترفاً برمجياً بل ضربة قوى مهنية حقيقية؛ فهو لغة التواصل المشتركة بين مهندسي القوى في مشاريع العالم العربي والعالم، والاستثمار في تعلمه يرد عليك أضعافاً في سوق العمل. ابدأ بالأساس، تمارَن على مشاريع حقيقية، ولا تتوقف عن بناء دراساتك — فكل دراسة تقوم بها اليوم هي صفحة في ملفك الهندسي غداً."""

CONTENT_EN = """ETAP (Electrical Transient Analyzer Program) is the industry-standard platform for modeling, simulating, analyzing and designing electrical power systems — from oil and gas facilities to generation stations, data centers and heavy industry. This companion article summarizes the Arabic deep-dive: core modules (Load Flow, Short-Circuit per IEC 60909/IEEE 141, Arc Flash per IEEE 1584, Star protection coordination, Transient Stability, Motor Acceleration, Ground Grid per IEEE 80, Harmonics per IEEE 519, Reliability), the engineering workflow from single-line diagram to final report, a comparison with DIgSILENT PowerFactory and SKM, and a five-stage learning roadmap — from theory refresh to a full industrial study. The free ETAP course on the platform walks you through the same path with hands-on, field-driven projects."""

fails = []

def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'} {name}" + (f" — {detail}" if detail else ""))
    if not cond:
        fails.append(f"{name}: {detail}")

def open_page(pg, path="/"):
    pg.goto(PROD + path, wait_until="domcontentloaded", timeout=45000)
    pg.wait_for_timeout(3500)
    try:
        pg.get_by_role("button", name=re.compile("accept|موافق|قبول", re.I)).click(timeout=4000)
        pg.wait_for_timeout(400)
    except Exception:
        pass

def fetch(pg, js, arg=None):
    return pg.evaluate(js, arg)

JS_LIST = """async () => {
    try {
        const r = await fetch('/api/trpc/articles.list', {credentials: 'include'});
        return {status: r.status, body: await r.text()};
    } catch (e) { return {status: 0, body: String(e)}; }
}"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False,
        args=["--disable-blink-features=AutomationControlled", "--no-sandbox"])

    # ---------- A: admin login ----------
    ctx = browser.new_context(viewport={"width": 1440, "height": 900},
                              user_agent=UA, service_workers="block")
    # Force Arabic UI — the article is Arabic-first and E2/E3/F1 checks target Arabic text
    ctx.add_init_script("try{localStorage.setItem('language','ar');}catch(e){}")
    pg = ctx.new_page()
    open_page(pg, "/login")
    pg.locator("form input").nth(0).fill("admin")
    pg.locator("form input[type=password]").first.fill(ADMIN_PW)
    pg.locator("form button[type=submit]").first.click()
    pg.wait_for_timeout(6000)
    me = fetch(pg, """async () => {
        try {
            const r = await fetch('/api/trpc/auth.me', {credentials: 'include'});
            return {status: r.status, body: await r.text()};
        } catch (e) { return {status: 0, body: String(e)}; }
    }""")
    me_txt = str(me.get("body", ""))
    check("A1 login auth.me 200", me.get("status") == 200, f"status={me.get('status')}")
    check("A2 role=admin", re.search(r'"role"\s*:\s*"admin"', me_txt) is not None, me_txt[:120])

    # ---------- B: articles procedures live (migration v7) ----------
    lst = fetch(pg, JS_LIST)
    body_txt = str(lst.get("body", ""))
    check("B1 articles.list reachable", lst.get("status") == 200, f"status={lst.get('status')} body={body_txt[:120]}")
    if lst.get("status") != 200:
        print("ARTICLES API NOT LIVE — aborting"); browser.close(); sys.exit(1)

    # ---------- C: check existing slug → update else create ----------
    admin_list = fetch(pg, """async () => {
        try {
            const r = await fetch('/api/trpc/articles.adminList', {credentials: 'include'});
            return {status: r.status, body: await r.json()};
        } catch (e) { return {status: 0, body: String(e)}; }
    }""")
    existing_id = None
    try:
        body = admin_list.get("body", {})
        if isinstance(body, str):
            body = json.loads(body)
        items = (body.get("result", {}) or {}).get("data", {}).get("json", {}).get("items", [])
        for it in items:
            if it.get("slug") == SLUG:
                existing_id = it.get("id")
    except Exception as e:
        print(f"  adminList parse note: {e}")
    print(f"  existing article id: {existing_id}")

    payload = json.dumps({
        "json": {
            **({"id": existing_id} if existing_id else {}),
            **({} if existing_id else {"slug": SLUG}),
            "titleAr": TITLE_AR, "titleEn": TITLE_EN,
            "excerptAr": EXCERPT_AR, "excerptEn": EXCERPT_EN,
            "contentAr": CONTENT_AR, "contentEn": CONTENT_EN,
            "coverImage": "/course-etap.jpg",
            "category": "تحليل أنظمة القدرة",
            "tags": "ETAP,الإيتاب,تحليل أنظمة القدرة,تدفق القدرة,القصر الكهربائي,Arc Flash",
            "isPublished": True, "sortOrder": 0,
        }
    }, ensure_ascii=False)

    action = "articles.update" if existing_id else "articles.create"
    res = fetch(pg, """async (args) => {
        try {
            const r = await fetch('/api/trpc/' + args.proc, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                credentials: 'include',
                body: args.body
            });
            return {status: r.status, body: await r.text()};
        } catch (e) { return {status: 0, body: String(e)}; }
    }""", {"proc": action, "body": payload})
    res_txt = str(res.get("body", ""))[:200]
    check("C1 " + action + " 200", res.get("status") == 200, f"status={res.get('status')} body={res_txt}")
    check("C2 success envelope", '"success":true' in res_txt or '"success": true' in res_txt, res_txt)

    # ---------- D: public verification ----------
    pub = fetch(pg, """async (slug) => {
        try {
            const u = '/api/trpc/articles.getBySlug?input=' + encodeURIComponent(JSON.stringify({json: {slug}}));
            const r = await fetch(u, {credentials: 'include'});
            return {status: r.status, body: await r.text()};
        } catch (e) { return {status: 0, body: String(e)}; }
    }""", SLUG)
    pub_txt = str(pub.get("body", ""))
    check("D1 getBySlug 200", pub.get("status") == 200, f"status={pub.get('status')}")
    check("D2 title present", ("الإيتاب" in pub_txt), "")
    check("D3 content long", len(pub_txt) > 5000, f"len={len(pub_txt)}")

    # ---------- E: visual verification — public pages ----------
    open_page(pg, "/articles")
    pg.wait_for_timeout(2500)
    pg.screenshot(path=f"{OUT}/E1_articles_list.png", full_page=False)
    check("E1 /articles shows title", pg.locator("text=الإيتاب").count() > 0 or pg.locator("text=ETAP").count() > 0, f"matches={pg.locator('text=ETAP').count()}")

    open_page(pg, f"/articles/{SLUG}")
    pg.wait_for_timeout(2500)
    pg.screenshot(path=f"{OUT}/E2_article_detail.png", full_page=False)
    h1 = pg.locator("h1").first.inner_text() if pg.locator("h1").count() > 0 else ""
    check("E2 detail page h1", "الإيتاب" in h1, f"h1={h1[:80]}")
    words = len(pg.locator("article").inner_text()) if pg.locator("article").count() > 0 else 0
    check("E3 detail content rendered", words > 3000, f"chars={words}")

    # ---------- F: admin dashboard — articles tab ----------
    open_page(pg, "/admin")
    pg.wait_for_timeout(3000)
    btn = pg.locator("button", has_text=re.compile("المقالات|Articles"))
    if btn.count() > 0:
        btn.first.click()
        pg.wait_for_timeout(3000)
        pg.screenshot(path=f"{OUT}/F1_admin_articles_tab.png", full_page=False)
        check("F1 admin tab lists article", pg.locator("text=الإيتاب").count() > 0, f"matches={pg.locator('text=الإيتاب').count()}")
    else:
        check("F1 admin tab found", False, "Articles sidebar button not found")

    browser.close()

print()
if fails:
    print(f"RESULT: {len(fails)} FAILURES"); [print(" -", f) for f in fails]; sys.exit(1)
print("RESULT: ALL PASSED — ETAP article published & verified end-to-end")
