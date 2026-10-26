# دليل النشر والاسترجاع والطوارئ — DEPLOYMENT & ROLLBACK

> هذا الملف هو المرجع التشغيلي للمنصة: ما يحدث عند كل دفع، كيف تتحقق من صحة النشر، وكيف ترجع خطوة واحدة للخلف بأمان عند الحوادث. آخر تحديث: أكتوبر 2026 بعد جولة production-audit.

## 1) ما يحدث عند كل `git push origin main`

الدفع إلى `main` يشغّل أربعة مسارات CI تلقائيًا (كلها يجب أن تكون خضراء قبل اعتبار النشر سليمًا):

| Workflow | الوظيفة | ما الذي يفشل لو فشل؟ |
|---|---|---|
| `deploy-hf.yml` | اختبارات → فحص أنواع → بناء إنتاجي → دفع التاريخ الكامل + LFS إلى Hugging Face Space (`--force`) | **هذا هو النشر نفسه** — Space يعيد بناء صورة Docker |
| `deploy-cf-worker.yml` | نشر/تحديث إعدادات Cloudflare Worker | طبقة الحافة (Edge) تبقى على النسخة السابقة |
| `sonarcloud.yml` | تحليل SonarCloud + بوابة الجودة | تحذير فقط — لا يمنع النشر |
| `sync-hf-secrets.yml` | مزامنة أسرار الـ Space | متغيرات البيئة قد تتقادم |

قاعدة ذهبية: **لا تعتبر النشر مكتملاً إلا بعد تحقق حي** (قسم 3)، لأن نجاح CI لا يعني بالضرورة أن Space أعاد بناء صورته بنجاح.

## 2) خريطة البيئة الإنتاجية (مقاسة حيًا — أكتوبر 2026)

```
المستخدم
  → DNS خارجي (qzz.io): CNAME ahmedelbaz.qzz.io → ahmdelbaz28-ahmdrtap.hf.space
    → حافة Hugging Face (Cloudflare الخاصة بـ HF — ليست حسابنا)
      → Hugging Face Space: ahmdelbaz28/AHMDRTAP (خاص)
        → حاوية Docker: node:22-alpine + tini، مستخدم غير جذر (appuser)، منفذ 7860
          → Hono server (api/boot.ts) يخدم dist/public + /api/*
            → shieldMiddleware: بوابة EDGE_HOST_ENFORCE + rate limit + payload guard
              → MySQL مُدار (Aiven — عبر TLS) — المخطط يُطبَّق تدريجيًا عند الإقلاع (db-init + GET_LOCK)
              → R2/تخزين S3 متوافق لملفات الفيديو المحمية
```

- بناء الواجهة يُدمج مع حقن nonce لـ CSP ومتغيرات البيئة العامة وbuild-id (كسر الكاش).
- PWA: `sw.js` يُحدث الـ precache عند تغيّر build-id — لا حاجة لتدخل يدوي.
- ⚠️ تصحيح قياسي (أكّده قياس حي 2026-10-26): الدومين **ليس** zone على حساب Cloudflare الخاص بنا ولا يمر عبر `worker-v7-hardened.js` — الـ worker مصدر مرجعي فقط (نشره CI لا يمس الإنتاج). انظر القسم 9.

## 3) التحقق الصحي بعد كل نشر

```bash
# 1. فحص الصحة (يتضمن ping لقاعدة البيانات + زمن الاستجابة)
curl -s https://ahmedelbaz.qzz.io/api/health | python3 -m json.tool

# 2. صفحات حرجة (مع ترويسة المتصفح — المُعالج يشترط Accept: text/html)
for p in / /courses /articles /verify /login; do
  curl -s -o /dev/null -w "$p -> %{http_code}\n" \
    -A "Mozilla/5.0" -H "Accept: text/html,application/xhtml+xml" \
    "https://ahmedelbaz.qzz.io$p"
done

# 3. خريطة الموقع تعكس الكورسات والمقالات المنشورة
curl -s https://ahmedelbaz.qzz.io/sitemap.xml | grep -c "<loc>"
```

معايير النجاح: `status: ok` في الصحة، كل المسارات الحرجة `200`، وsitemap يحوي روابط الكورسات والمقالات المنشورة.

## 4) الاسترجاع (Rollback) — ثلاث طرق بالترتيب المفضل

### الطريقة (أ): `git revert` — الأكثر أمانًا (المفضلة)
```bash
git revert <BAD_SHA>          # يبني كوميتًا معاكسًا فوق main
git push origin main          # CI ينشر النسخة المعكوسة تلقائيًا
```
- لا تعيد كتابة التاريخ، آمنة مع Push Protection وقاعدة الحماية، وتصلح لأي تغيير كود.
- لو كان الضرر في عدة كوميتات: `git revert <sha1> <sha2> ...` بنفس الترتيب.

### الطريقة (ب): إعادة تشغيل run قديم ناجح
GitHub → Actions → `Deploy to HuggingFace Spaces` → اختر آخر run أخضر قبل العطب → **Re-run all jobs**.
- يعيد البناء والنشر من نفس الـ SHA القديم دون أي تعديل git.
- ملاحظة: أعد أيضًا تشغيل `deploy-cf-worker.yml` للفترة نفسها إن كان العطب في طبقة الحافة.

### الطريقة (ج): النشر من فرق إصلاح ساخن (`hotfix/*` → main)
عندما يحتاج الإصلاح وقتًا وتريد رفع تعطيل جزئي: عطّل الميزة المعطوبة عبر متغير بيئة (feature flag) من أسرار الـ Space بدل استرجاع كامل.

### متى لا تستخدم force-push للاسترجاع؟
**دائمًا تقريبًا.** إعادة كتابة التاريخ على main تُبطل الحمايات (Secret scanning/Push protection تسجّل التنبيهات على التاريخ القديم)، وتكسر فروع الآخرين، وتفقد المراجع. لا تُستخدم إلا لإزالة أسرار مُسرّبة (راجع سجل الجولات السابقة: إزالة PAT كان لها سبب موثق).

## 5) سياسة قاعدة البيانات والاسترجاع منها

- المخطط يُدار **تدريجيًا عند الإقلاع** (`api/lib/db-init.ts`): إنشاء 22 جدولًا إذا لم توجد + ترقيات incremental داخل `GET_LOCK` لمنع تزامن النسختين.
- السياسة **forward-only**: لا توجد تراجعات SQL هابطة. أي تغيير هدام (DROP/RENAME/truncate) يتطلب:
  1. نسخة احتياطية كاملة قبل النشر (من لوحة Aiven أو `mysqldump`)،
  2. خطوة استرجاع مكتوبة في وصف الـ PR،
  3. نشرًا في نافذة منخفضة الحركة.
- استرجاع البيانات بعد كارثة: أعد الاستيراد من نسخة Aiven ثم أعد نشر آخر SHA أخضر — db-init لن يمس جداولًا موجودة صحيحة.

## 6) الأسرار ومواضعها (لا شيء في المستودع — محمي بـ Push Protection)

| السر | يعيش في | يُستخدم لـ |
|---|---|---|
| `HF_TOKEN` | GitHub Secrets → يزامنها `sync-hf-secrets.yml` | دفع deploy-hf إلى الـ Space |
| `ADMIN_PASSWORD` | أسرار الـ Space | بذر كلمة مرور الأدمن **أول مرة فقط** (seed-only) — الدوران من الواجهة |
| مفاتيح OpenRouter/Resend/Google | أسرار الـ Space | مزودات AI/بريد/OAuth |
| `DATABASE_URL` | أسرار الـ Space | اتصال MySQL (TLS) |

قاعدة: أي قيمة تبدأ بـ `github_pat_` / `hf_` / `sk-` / `AKIA` **لا تُكتب في الكود أبدًا** — Secret scanning + Push protection مفعّلان وسيمنعا الدفع.

## 7) مالك الحادثة وقناة التصعيد

- **المالك المسؤول:** م. أحمد الباز (ahmedelbaz28) — قرارات النشر/الاسترجاع النهائية.
- **قناة المستخدمين عند العطب:** صفحة `/support` داخل المنصة.
- **التصعيد الفني:** سجلات الـ Space (Hugging Face → Container logs) + سجلات CI في GitHub Actions + تحليلات Clarity للجوانب الواجهية.

## 8) قائمة تحقق سريعة قبل أي إطلاق/حملة

- [ ] CI أخضر 8/8 على SHA الإنتاج (Actions → آخر run على main)
- [ ] `/api/health` يرجع `ok` والـ DB latency معقولة (<500ms)
- [ ] المسارات الحرجة 200 (القسم 3) — خاصة أي صفحة جديدة أُضيفت
- [ ] sitemap يعرض الروابط الجديدة، وrobots.txt سليم
- [ ] لا أخطاء في سجلات الـ Space خلال 10 دقائق بعد النشر
- [ ] نسخة احتياطية لقاعدة البيانات حديثة (لو تضمن النشر ترقية مخطط)

## 9) وضعية طبقة الحافة — حسم نتائج التدقيق الثلاث (edge)

نتائج التدقيق الأمني run-1 القديمة عن الحافة، وحسمها النهائي بعد قياس حي (2026-10-26):

| النتيجة | الحسم | الدليل |
|---|---|---|
| `#6 worker.v7.direct-to-origin-no-origin-auth` (medium) | **مغلق ومُفعّل في الإنتاج** | بوابة `EDGE_HOST_ENFORCE=1` في `api/middleware/shield.ts` تعمل حيًا: فضاء مباشر بلا مضيف مسموح → `404 {"error":"Not Found"}`؛ بنفس الطلب مع `x-forwarded-host: ahmedelbaz.qzz.io` → `200`؛ استثناء الـ iframe (`sec-fetch-dest: iframe`) → `200`. سبب اختيار البوابة بدل HMAC للـ worker: قياس حي أثبت أن الدومين لا يمر عبر الـ worker أصلًا (لا موقّع في المسار)، والتوقيع أوقف الدومين الحقيقي فتراجع (موثق داخل shield.ts). الاستثناءات الموثقة: صحة الحاوية الداخلية (localhost) وويبهوك Paymob (يُتحقق منه HMAC fail-closed في `paymob-webhook.ts`). مقايضة موثقة: `sec-fetch-dest` ترويسة يتحكم بها المتصفح ويمكن لعميل مخطط انتحالها — الضوابط الجوهرية (مصادقة/حدود/تحقق) لا تتأثر |
| `#9 worker.v7.cache-precedes-security-stages` (low) | **مُصلح في المصدر + غير مؤثر إنتاجيًا** | إصلاحات المصدر في `infra/security-audit/worker-v7-hardened.js` (commit 87ead2c): الكاش مقصور على `/assets/` المُعمّاة فقط (لا امتداد مسار فحسب)، والردود غير الناجحة (`!ok`) لا تُثبّت سنة في الـ PoP، والمخزَّأ يُطبَّع عبر addSecurityHeaders/addCORSHeaders. ولأن الـ worker خارج مسار الإنتاج (القسم 2) فالحافة الفعلية هي حافة HF بلا منطق كاش لنا |
| `#10 worker.v7.dead-webhook-skiplist-and-unapplied-zone-configs` (low) | **مُصلح في المصدر + موثّق** | الـ skiplist الميتة (`/api/webhooks/`) لم يعد لها أثر في المصدر — `API_PATHS` يحوي المسارات الحقيقية فقط (`/api/paymob` + الاسم القديم المسجل فعليًا في boot.ts:104 وهو `/api/webhooks/paymob`). أما `cloudflare-zone-config.json` و `access-policies.json` فهما **مرجعان بلا مُطبّق** — يُفعّلان يدويًا في لوحة Cloudflare فقط لو نُقل الدومين خلف حسابنا، ومطلوب لذلك توكن CF صالح (المحاولات السابقة بتوكينات مرفوضة — Invalid API Token) |

الخلاصة التشغيلية: لا تعتمد على `deploy-cf-worker.yml` كطبقة أمان إنتاجية — طبقة الحافة الفعلية هي (حافة HF + بوابة shield على الأصل)، وأي تحسين WAF مستقبلي يبدأ بنقل الدومين خلف حساب CF أولًا.
