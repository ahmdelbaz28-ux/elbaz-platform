# 🔧 دليل إصلاح مشاكل Google Sign-In واستعادة كلمة المرور

## المشاكل المحددة

### 1. مشكلة Google Sign-In
**السبب الجذري:** 
- متغير `GOOGLE_CLIENT_SECRET` غير موجود في المتغيرات البيئية
- أو رابط Redirect URI في Google Cloud Console غير صحيح

### 2. مشكلة إرسال الكود عند نسيان كلمة المرور
**السبب الجذري:**
- Resend API قد يكون في وضع Sandbox
- النطاق قد يكون غير موثّق
- **الحل موجود:** النظام يعرض رابط الاسترداد مباشرة عندما يفشل البريد

---

## خطوات الإصلاح

### الخطوة 1: إضافة GOOGLE_CLIENT_SECRET

1. افتح Google Cloud Console
2. اذهب إلى **APIs & Services > Credentials**
3. اختر **OAuth 2.0 Client IDs**
4. انسخ **Client Secret** من الحقل "Client secret"
5. أضف المتغير البيئي في منصتك (HuggingFace Spaces أو الخادم):

```
GOOGLE_CLIENT_SECRET=<YOUR_CLIENT_SECRET_HERE>
```

**للحصول على Client Secret:**
- من Google Cloud Console > APIs & Services > Credentials
- انقر على OAuth 2.0 Client IDs
- ستجد Client secret في قسم "Client secrets"

### الخطوة 2: التحقق من Redirect URI في Google Cloud Console

1. في صفحة Credentials، انقر على اسم الـ OAuth Client
2. تأكد من وجود Redirect URI التالي:
   ```
   https://ahmedelbaz.qzz.io/api/google-auth/callback
   ```
3. إذا كان يعمل محلياً:
   ```
   http://localhost:7860/api/google-auth/callback
   ```

### الخطوة 3: التحقق من متغيرات البريد الإلكتروني

تأكد من وجود هذه المتغيرات:

```bash
RESEND_API_KEY=<YOUR_RESEND_API_KEY>
RESEND_FROM_EMAIL=<YOUR_VERIFIED_EMAIL>@resend.dev
EMAIL_PROVIDER=resend
```

**ملاحظة:** عندما يفشل إرسال البريد، يعرض النظام رابط الاسترداد مباشرة على الصفحة!

---

## قائمة المتغيرات البيئية المطلوبة

```bash
# Google OAuth (مطلوب لتسجيل الدخول بجوجل)
GOOGLE_CLIENT_ID=<FROM_GOOGLE_CLOUD_CONSOLE>
GOOGLE_CLIENT_SECRET=<FROM_GOOGLE_CLOUD_CONSOLE>

# Database
DATABASE_URL=<YOUR_DATABASE_URL>

# Resend Email (لإرسال رموز استعادة كلمة المرور)
RESEND_API_KEY=<FROM_RESEND_DASHBOARD>
RESEND_FROM_EMAIL=<VERIFIED_DOMAIN_EMAIL>

# Frontend URL
FRONTEND_URL=https://ahmedelbaz.qzz.io

# App Secret
APP_SECRET=<YOUR_APP_SECRET>
```

---

## التحقق من الإصلاح

### اختبار Google Sign-In:
1. اذهب إلى صفحة تسجيل الدخول
2. اضغط على "تسجيل الدخول بجوجل"
3. يجب أن يتم توجيهك إلى Google
4. بعد الموافقة، يجب أن تعود للصفحة الرئيسية مسجلاً

### اختبار استعادة كلمة المرور:
1. اضغط على "نسيت كلمة المرور"
2. أدخل بريدك الإلكتروني
3. **إذا فشل البريد:** سيظهر رابط الاسترداد مباشرة على الصفحة
4. اضغط على الرابط لاستعادة كلمة المرور

---

## حل مشكلة Resend Sandbox (اختياري)

لإرسال البريد بشكل صحيح، وثّق نطاقك في Resend:

1. سجّل في [resend.com](https://resend.com)
2. أضف نطاقك: `ahmedelbaz.qzz.io`
3. أضف سجلات DNS المطلوبة
4. بعد التحقق، غيّر:
   ```
   RESEND_FROM_EMAIL=noreply@ahmedelbaz.qzz.io
   ```

---

## أوامر إعادة النشر

```bash
cd /home/z/my-project/elbaz-platform
git pull origin main
npm run build
pm2 restart all
```

أو إذا تستخدم Docker:
```bash
docker-compose down
docker-compose up -d --build
```
