# 🚀 دليل التطبيقات النهائي — Elbaz Platform

## 📋 ترتيب التطبيق

| # | الباتش | الوقت |
|---|-------|-------|
| 1 | PATCH-5 (فهرسات القاعدة) | 5 min |
| 2 | PATCH-3 (Connection Pool) | 3 min |
| 3 | PATCH-1 (CORS) | 5 min |
| 4 | PATCH-4 (Chatbot History) | 2 min |
| 5 | PATCH-2 (Logout) | 5 min |
| 6 | PATCH-6 (أمان Paymob) | 10 min |
| 7 | PATCH-7 (أمان Chatbot) | 5 min |

---

## 1️⃣ PATCH-5 — فهرسات قاعدة البيانات

```sql
-- أنشئ ملف: infra/patches/add-performance-indexes.sql
-- ثم نفذه في Aiven SQL Editor

CREATE INDEX idx_enrollments_userId ON enrollments(userId);
CREATE INDEX idx_enrollments_courseId ON enrollments(courseId);
CREATE INDEX idx_payments_userId ON payments(userId);
CREATE INDEX idx_payments_courseId ON payments(courseId);
CREATE INDEX idx_lessonProgress_userId ON lessonProgress(userId);
CREATE INDEX idx_lessonProgress_lessonId ON lessonProgress(lessonId);
CREATE INDEX idx_supportTickets_userId ON supportTickets(userId);
CREATE INDEX idx_supportTickets_status ON supportTickets(status);
CREATE INDEX idx_quizQuestions_lessonId ON quizQuestions(lessonId);
```

---

## 2️⃣ PATCH-3 — Connection Pool

**الملف:** `api/queries/connection.ts`

```typescript
// استبدل:
connectionLimit: 25,
// بـ:
connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 50,
queueLimit: Number(process.env.DB_QUEUE_LIMIT) || 100,
```

**Secrets:**
- DB_CONNECTION_LIMIT = 50
- DB_QUEUE_LIMIT = 100

---

## 3️⃣ PATCH-1 — إصلاح CORS

**الملف:** `api/boot.ts`

```typescript
// استبدل CORS الحالي بـ:
const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").filter(Boolean);

app.use("*", cors({
  origin: allowedOrigins,
  credentials: true,
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "x-auth-token"],
}));
```

**Secrets:**
- CORS_ORIGINS = https://ahmdelbaz28-ahmdrtap.hf.space

---

## 4️⃣ PATCH-4 — حد تاريخ الشات بوت

**الملف:** `src/components/ChatBot.tsx`

```typescript
// استبدل:
const MAX_HISTORY = 50;
// بـ:
const MAX_HISTORY = Number(import.meta.env.VITE_CHATBOT_MAX_HISTORY) || 100;
```

**Secrets:**
- VITE_CHATBOT_MAX_HISTORY = 100

---

## 5️⃣ PATCH-2 — إصلاح تسجيل الخروج

**الملف:** `src/hooks/useAuth.ts`

```typescript
// أضف الاستيراد:
import { useNavigate } from "react-router-dom";

// أضف داخل الدالة:
const navigate = useNavigate();

// استبدل logout:
const logout = async () => {
  localStorage.removeItem("auth_token");
  utils.invalidate();
  navigate("/login", { replace: true });
};
```

---

## 6️⃣ PATCH-6 — أمان Paymob Webhook (حرج!)

**الملف:** `api/boot.ts`

```typescript
// أضف في أعلى الملف:
import crypto from "crypto";

// استبدل دالة /api/webhooks/paymob بـ:
app.post("/api/webhooks/paymob", async (c) => {
  try {
    const clientIp = c.req.header("cf-connecting-ip") || c.req.header("x-real-ip") || "";
    const paymobIps = (process.env.PAYMOB_WEBHOOK_IPS || "").split(",").filter(Boolean);
    
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
      
      // تحقق من HMAC
      const hmacSecret = process.env.PAYMOB_HMAC_SECRET;
      if (hmacSecret) {
        const paramsToSign = {
          amount_cents: obj.amount_cents,
          created_at: obj.created_at,
          currency: obj.currency,
          error_occured: obj.error_occured,
          has_parent_transaction: obj.has_parent_transaction,
          id: obj.id,
          integration_id: obj.integration_id,
          is_3d_secure: obj.is_3d_secure,
          is_auth: obj.is_auth,
          is_capture: obj.is_capture,
          is_refunded: obj.is_refunded,
          is_standalone_payment: obj.is_standalone_payment,
          is_voided: obj.is_voided,
          order: obj.order?.id || obj.order,
          owner: obj.owner,
          pending: obj.pending,
          source_data_pan: obj.source_data?.pan,
          source_data_sub_type: obj.source_data?.sub_type,
          source_data_type: obj.source_data?.type,
          success: obj.success,
        };
        
        const computedHmac = crypto
          .createHmac("sha256", hmacSecret)
          .update(JSON.stringify(paramsToSign))
          .digest("hex");
        
        if (hmacReceived !== computedHmac) {
          console.log("[Paymob] Invalid HMAC");
          return c.json({ received: false, error: "Invalid HMAC" }, 403);
        }
      }
      
      params = {
        amount_cents: String(obj.amount_cents || ""),
        id: String(obj.id || ""),
        order: String(obj.order ? (obj.order.id || obj.order) : ""),
        pending: String(obj.pending || ""),
        success: String(obj.success || ""),
      };
    }
    
    var isSuccess = params.success === "true";
    var isPending = params.pending === "true";
    var merchantOrderId = params.order;
    
    if (isSuccess && !isPending && merchantOrderId) {
      var db = getDb();
      var results = await db.select().from(payments).where(eq(payments.transactionId, merchantOrderId)).limit(1);
      
      if (results.length > 0 && results[0].status === "pending") {
        const expectedAmount = parseFloat(results[0].amount);
        const paidAmount = parseInt(params.amount_cents) / 100;
        
        if (Math.abs(paidAmount - expectedAmount) > 0.01) {
          console.log("[Paymob] Amount mismatch");
          return c.json({ received: true, error: "Amount mismatch" });
        }
        
        await db.update(payments).set({ status: "paid", paymobTransactionId: params.id }).where(eq(payments.transactionId, merchantOrderId));
        console.log("[Paymob] Payment confirmed: " + merchantOrderId);
      }
    } else if (!isSuccess && merchantOrderId) {
      var db2 = getDb();
      await db2.update(payments).set({ status: "failed" }).where(eq(payments.transactionId, merchantOrderId));
    }
    
    return c.json({ received: true });
  } catch (e) {
    console.error("[Paymob] Error: " + String(e));
    return c.json({ received: true, error: "Processing failed" });
  }
});
```

**Secrets:**
- PAYMOB_WEBHOOK_IPS = 141.136.77.10,141.136.77.11 ( تحقق من Paymob )
- PAYMOB_HMAC_SECRET = (من Paymob Dashboard)

---

## 7️⃣ PATCH-7 — أمان Chatbot API (حرج!)

**الملف:** `api/boot.ts`

```typescript
// استبدل دالة /api/chatbot بـ:
app.post("/api/chatbot", async (c) => {
  try {
    // 1. تحقق من Authorization
    const authHeader = c.req.header("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ success: false, error: "Authorization required" }, 401);
    }
    
    // 2. تحقق من JWT token
    const token = authHeader.replace("Bearer ", "");
    const { verifyToken } = await import("./lib/jwt.js");
    const user = await verifyToken(token);
    
    if (!user) {
      return c.json({ success: false, error: "Invalid token" }, 401);
    }
    
    // 3. Rate Limiting
    const { getRedis } = await import("./lib/redis.js");
    const redis = getRedis();
    
    if (redis) {
      const rateLimitKey = `chatbot:${user.userId}`;
      const currentCount = await redis.get(rateLimitKey);
      
      if (currentCount && parseInt(currentCount) >= 10) {
        return c.json({ success: false, error: "Rate limit exceeded" }, 429);
      }
    }
    
    // 4. معالجة الطلب
    var k = process.env.OPENROUTER_API_KEY;
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
          ...messages.map(m => ({ role: m.role, content: m.content })),
        ],
        temperature: 0.3,
        max_tokens: 256,
      }),
    });
    
    var d = await r.json();
    var reply = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    
    // 5. زيادة counter
    if (redis) {
      await redis.incr(`chatbot:${user.userId}`);
      await redis.expire(`chatbot:${user.userId}`, 86400);
    }
    
    return c.json({ success: true, reply: reply || "No response." });
  } catch (e) {
    console.error("[Chatbot] Error: " + String(e));
    return c.json({ success: false, error: "Service unavailable" }, 500);
  }
});
```

---

## ✅ Secrets المطلوبة (HuggingFace Spaces)

```
CORS_ORIGINS=https://ahmdelbaz28-ahmdrtap.hf.space
DB_CONNECTION_LIMIT=50
DB_QUEUE_LIMIT=100
VITE_CHATBOT_MAX_HISTORY=100
PAYMOB_WEBHOOK_IPS=<IPs من Paymob>
PAYMOB_HMAC_SECRET=<من Paymob Dashboard>
```

---

## 🧪 اختبار شامل

- [ ] تسجيل دخول
- [ ] تصفح الكورسات
- [ ] تسجيل في كورس
- [ ] مشاهدة درس + حفظ التقدم
- [ ] الشات بوت
- [ ] تسجيل خروج سلس
- [ ] Paymob webhook (استخدم sandbox)
- [ ] CORS بدون أخطاء
