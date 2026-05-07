# 🔍 تقرير مراجعة الكود البرمجي - Elbaz Platform

**تاريخ المراجعة:** 2026-05-07
**نوع المشروع:** Full-stack Web Application (React + Hono/tRPC + MySQL)

---

## 📊 Taste Rating: 🟡 Acceptable — يحتاج تحسينات جوهرية

---

## 🚨 المشاكل الحرجة (CRITICAL) — يجب الإصلاح قبل النشر

### 1. ثغرة CORS الخطيرة

**الملف:** `api/boot.ts` (السطر 17-26)

**المشكلة:**
```typescript
origin: [
  "https://ahmedelbaz.qzz.io",
  "http://localhost:5173",
  "http://localhost:3000",
],
```
- قائمة Origins مسموح بها محددة يدوياً
- لا يمكن إضافة domain جديد بدون نشر كود
- إذا انتقل الموقع ل/domain آخر، الكود يتوقف

**الحل:**
```typescript
// في api/boot.ts
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [];
app.use("*", cors({
  origin: allowedOrigins,
  credentials: true,
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "x-auth-token"],
}));
```
**أضف في .env.example:**
```
ALLOWED_ORIGINS=https://ahmedelbaz.qzz.io,http://localhost:5173,http://localhost:3000
```

---

### 2. طلب Chatbot غير مؤمن (Financial Risk)

**الملف:** `ChatBot.tsx` (السطر 80-95) + `api/boot.ts` (السطر 71-99)

**المشكلة:**
- كل مستخدم يستدعي OpenRouter API مباشرة من المتصفح
- لا يوجد rate limiting
- لا يوجد التحقق من المستخدم
- يمكن استغلال API مالياً

**التأثير:** فاتورة API قد تصل لآلاف الدولارات

**الحل:**
```typescript
// في api/boot.ts - تعديل endpoint /api/chatbot

app.post("/api/chatbot", async (c) => {
  try {
    // 1. التحقق من المستخدم أولاً
    const authHeader = c.req.header("authorization");
    if (!authHeader) {
      return c.json({ success: false, error: "Unauthorized" }, 401);
    }
    
    // 2. التحقق من token
    const user = await verifyToken(authHeader.replace("Bearer ", ""));
    if (!user) {
      return c.json({ success: false, error: "Invalid token" }, 401);
    }
    
    // 3. التحقق من rate limit (10 رسائل/يوم)
    const rateLimitKey = `chatbot:${user.userId}`;
    const currentCount = await redis.get(rateLimitKey);
    if (currentCount && parseInt(currentCount) >= 10) {
      return c.json({ success: false, error: "Rate limit exceeded" }, 429);
    }
    
    // 4. إرسال الطلب إلى OpenRouter
    const k = process.env.OPENROUTER_API_KEY;
    if (!k) return c.json({ success: false, error: "Not configured" }, 503);
    
    var body = await c.req.json();
    var messages = body.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return c.json({ success: false, error: "Messages array is required" }, 400);
    }
    
    var r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + k, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemma-2-9b-it:free",
        messages: [
          { role: "system", content: "You are an expert electrical engineer..." },
          ...messages.map(function(m) { return { role: m.role, content: m.content }; }),
        ],
        temperature: 0.3,
        max_tokens: 256,
      }),
    });
    
    var d = await r.json();
    var reply = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    
    // 5. زيادة counter
    await redis.incr(rateLimitKey);
    await redis.expire(rateLimitKey, 86400); // 24 hours
    
    return c.json({ success: true, reply: reply || "No response." });
  } catch (e) {
    return c.json({ success: false, error: "Service unavailable" }, 500);
  }
});
```

---

### 3. ثغرة Paymob Webhook

**الملف:** `api/boot.ts` (السطر 102-161)

**المشكلة:**
- ❌ لا يوجد التحقق من HMAC signature
- ❌ لا يوجد التحقق من IP (allowlist)
- ❌ لا يوجد التحقق من المبالغ
- ❌ Race condition محتمل

**الحل:**
```typescript
// في api/boot.ts - أضف في الجزء العلوي
import crypto from "crypto";

// ثم استبدل دالة /api/webhooks/paymob

app.post("/api/webhooks/paymob", async (c) => {
  try {
    const clientIp = c.req.header("cf-connecting-ip") || c.req.header("x-real-ip") || "";
    
    // 1. التحقق من IP
    const paymobIps = (process.env.PAYMOB_WEBHOOK_IPS || "").split(",");
    if (paymobIps.length > 0 && !paymobIps.includes(clientIp)) {
      console.log("[Paymob] Blocked IP: " + clientIp);
      return c.json({ received: false, error: "Unauthorized" }, 403);
    }
    
    var contentType = c.req.header("content-type") || "";
    var params;
    if (contentType.indexOf("application/json") !== -1) {
      var body = await c.req.json();
      var hmacReceived = body.hmac || "";
      var obj = body.obj || body;
      
      // 2. التحقق من HMAC
      const paramsToHash = { ...obj };
      delete paramsToHash.hmac;
      const hmacSecret = process.env.PAYMOB_HMAC_SECRET;
      if (hmacSecret) {
        const computedHmac = crypto
          .createHmac("sha256", hmacSecret)
          .update(JSON.stringify(paramsToHash))
          .digest("hex");
        if (hmacReceived !== computedHmac) {
          console.log("[Paymob] Invalid HMAC");
          return c.json({ received: false, error: "Invalid HMAC" }, 403);
        }
      }
      
      params = {
        hmac: hmacReceived,
        amount_cents: String(obj.amount_cents || ""),
        created_at: String(obj.created_at || ""),
        currency: String(obj.currency || ""),
        error_occured: String(obj.error_occured || ""),
        has_parent_transaction: String(obj.has_parent_transaction || ""),
        id: String(obj.id || ""),
        integration_id: String(obj.integration_id || ""),
        is_3d_secure: String(obj.is_3d_secure || ""),
        is_auth: String(obj.is_auth || ""),
        is_capture: String(obj.is_capture || ""),
        is_refunded: String(obj.is_refunded || ""),
        is_standalone_payment: String(obj.is_standalone_payment || ""),
        is_voided: String(obj.is_voided || ""),
        order: String(obj.order ? (obj.order.id || obj.order) : ""),
        owner: String(obj.owner || ""),
        pending: String(obj.pending || ""),
        source_data_pan: String(obj.source_data ? obj.source_data.pan : ""),
        source_data_sub_type: String(obj.source_data ? obj.source_data.sub_type : ""),
        source_data_type: String(obj.source_data ? obj.source_data.type : ""),
        success: String(obj.success || ""),
      };
    } else {
      params = Object.fromEntries(new URL(c.req.url).searchParams);
    }
    
    console.log("[Paymob] webhook received, success=" + params.success + ", order=" + params.order);
    var isSuccess = params.success === "true";
    var isPending = params.pending === "true";
    var merchantOrderId = params.order;
    
    if (isSuccess && !isPending && merchantOrderId) {
      try {
        var db = getDb();
        var results = await db.select().from(payments).where(eq(payments.transactionId, merchantOrderId)).limit(1);
        
        if (results.length > 0 && results[0].status === "pending") {
          // 3. التحقق من المبلغ
          const expectedAmount = results[0].amount;
          const paidAmount = parseInt(params.amount_cents) / 100;
          if (Math.abs(paidAmount - expectedAmount) > 0.01) {
            console.log("[Paymob] Amount mismatch: expected=" + expectedAmount + ", received=" + paidAmount);
            return c.json({ received: true, error: "Amount mismatch" });
          }
          
          await db.update(payments).set({ status: "paid", paymobTransactionId: params.id }).where(eq(payments.transactionId, merchantOrderId));
          console.log("[Paymob] Payment confirmed: " + merchantOrderId);
        }
      } catch (e) {
        console.error("[Paymob] DB error: " + String(e));
      }
    } else if (!isSuccess && merchantOrderId) {
      try {
        var db2 = getDb();
        await db2.update(payments).set({ status: "failed" }).where(eq(payments.transactionId, merchantOrderId));
      } catch (e) { /* ignore */ }
    }
    
    return c.json({ received: true });
  } catch (e) {
    console.error("[Paymob] Error: " + String(e));
    return c.json({ received: true, error: "Processing failed" });
  }
});
```

**أضف في .env.example:**
```
PAYMOB_WEBHOOK_IPS=141.136.77.10,141.136.77.11
PAYMOB_HMAC_SECRET=your_hmac_secret_here
```

---

### 4. استخدام window.location.reload()

**الملف:** `useAuth.ts` (السطر 17-21)

**المشكلة:**
```typescript
const logout = useCallback(() => {
  localStorage.removeItem("auth_token");
  utils.invalidate();
  window.location.reload(); // ❌ إعادة تحميل كاملة
}, [utils]);
```

**الحل:**
```typescript
import { useNavigate } from "react-router";

export function useAuth() {
  const navigate = useNavigate();
  // ...
  
  const logout = useCallback(() => {
    localStorage.removeItem("auth_token");
    utils.invalidate();
    navigate("/login", { replace: true }); // بدلاً من reload
  }, [utils, navigate]);
  
  // ...
}
```

---

## 📌 المشاكل المهمة (IMPORTANT)

### 5. Connection Pool غير مضبوط

**الملف:** `api/queries/connection.ts` (السطر 22-23)

**المشكلة:**
```typescript
connectionLimit: env.isProduction ? 25 : 5,   // 25 غير كافي
queueLimit: 0,                          // queue غير محدود
```

**الحل:**
```typescript
connectionLimit: env.isProduction ? 50 : 5,
queueLimit: 100, // لمنع memory issues
```

---

### 6. HTTP Server handshake

**الملف:** `api/boot.ts` (السطر 188-227)

**المشكلة:** استخدام manual HTTP server بدلاً من @hono/node-server

**الحل:**
```typescript
// في api/boot.ts - استبدل السطور 188-236 بـ:

import { serve } from "@hono/node-server";

console.log("===== Application Startup =====");
console.log("Server running on port " + PORT);
console.log("Static files: " + DIST_PUBLIC);
console.log("DB: " + (process.env.DATABASE_URL ? "OK" : "not set"));
console.log("Chat: " + (process.env.OPENROUTER_API_KEY ? "OK" : "not set"));
console.log("tRPC: /api/trpc/*");

serve({
  fetch: app.fetch,
  port: PORT,
});
```

---

### 7. تحسين Chatbot history

**الملف:** `ChatBot.tsx` (السطر 43)

**المشكلة:** MAX_HISTORY = 50 ثابت

**الحل:**
```typescript
const MAX_HISTORY = parseInt(import.meta.env.VITE_CHATBOT_MAX_HISTORY || "100");
```

---

## 🟢 تحسينات أدائية (Performance)

### 8. إضافة indexes للقاعدة

**الملف:** `db/schema.ts`

**أضف:**
```typescript
// في جدول enrollments
index("idx_enrollments_user").on(table.userId),
index("idx_enrollments_course").on(table.courseId),

// في جدول payments
index("idx_payments_user").on(table.userId),
index("idx_payments_course").on(table.courseId),
```

---

## 📋 Priority Checklist

| الأولوية | المشكلة | الحل |
|----------|---------|--------|
| 🔴 Critical #1 | CORS | استخدام متغير البيئة |
| 🔴 Critical #2 | ChatBot API | التحقق + rate limiting |
| 🔴 Critical #3 | Paymob webhook | HMAC + IP validation |
| 🔴 Critical #4 | logout() | استخدام navigate |
| 🟡 Important #5 | Connection pool | 50 connections |
| 🟡 Important #6 | HTTP server | use @hono/node-server |
| 🟡 Important #7 | MAX_HISTORY | متغير البيئة |
| 🟢 Improvement | Indexes | أضف indexes |

---

## 📊 Risk Assessment

**المخاطر الإجمالية:** 🔴 HIGH

**السبب:**
1. ثغرة CORS — Cross-site attacks
2. ChatBot API غير مؤمن — Financial loss
3. Paymob webhook بدون validation — عمليات دفع مزورة
4. لا توجد اختبارات

---

## ✅ Verdict

**النتيجة:** ❌ يجب إصلاح المشاكل الحرجة قبل الدمج

**الملاحظة الرئيسية:**
المشروع يحتاج مراجعة أمنية شاملة قبل النشر. الثغرات المكتشفة يمكن أن تسبب Financial losses أو بيانات مسروقة.