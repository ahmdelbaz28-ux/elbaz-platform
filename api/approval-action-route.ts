/**
 * APPROVAL ACTION ROUTE — the owner's email convenience (optional feature).
 *
 * GET /api/approval/action?token=<signed>
 *
 * The registration alert email (api/lib/email-templates.ts) carries two
 * buttons — Approve / Reject — each linking here with an HMAC-signed,
 * single-purpose token (api/lib/approval.ts). The owner can decide WITHOUT
 * opening the platform; the signed link IS the authority (same trust model
 * as the password-reset magic link: the server secret signs it, 7-day TTL,
 * timing-safe compare).
 *
 * Responses are styled bilingual HTML pages — the owner taps a button on a
 * phone, so the result must read well without any app shell.
 *
 * SECURITY:
 *   - Garbage/tampered/expired tokens → an inert "invalid link" page (400),
 *     never a stack trace or an oracle about which userIds exist.
 *   - The decision state machine (decideApproval) makes a replayed link
 *     "already decided" — approving twice cannot resurrect a rejected
 *     account and vice versa; admins are unrejectable.
 *   - Per-IP rate limit (in-memory bucket) — the token check is cheap but
 *     the endpoint still never becomes an HMAC oracle amplifer.
 *   - No-cache headers: the decision page must never be cached by a proxy
 *     and re-served to a different visitor.
 */

import { Hono } from "hono";
import { verifyApprovalActionToken, decideApproval } from "./lib/approval.js";
import { logger } from "./lib/logger.js";
import { getClientIpFromHeaders } from "./lib/client-ip.js";

export const approvalActionRoute = new Hono();

// ── Per-IP rate limit (in-memory bounded bucket, same pattern as byok) ──
const buckets = new Map<string, { count: number; resetAt: number }>();
const LIMIT = 30;
const WINDOW_MS = 5 * 60_000;
const MAP_MAX = 10_000;

function allow(ip: string): boolean {
  const now = Date.now();
  if (buckets.size >= MAP_MAX) {
    for (const [k, e] of buckets) if (now > e.resetAt) buckets.delete(k);
  }
  const entry = buckets.get(ip);
  if (!entry || now > entry.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= LIMIT) return false;
  entry.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, e] of buckets) if (now > e.resetAt) buckets.delete(k);
}, 5 * 60_000).unref();

// ── Styled bilingual result pages ────────────────────────────────────────────

function page(title: string, bodyAr: string, bodyEn: string, tone: "ok" | "bad" | "neutral"): string {
  const color = tone === "ok" ? "#10b981" : tone === "bad" ? "#ef4444" : "#f59e0b";
  const icon = tone === "ok" ? "✓" : tone === "bad" ? "✕" : "⏳";
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${title}</title>
</head>
<body style="margin:0; background:#0a0e17; font-family: Arial, sans-serif; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;">
  <div style="max-width:460px; width:100%; background:#0d1520; border:1px solid #1f2d44; border-radius:16px; padding:32px; text-align:center;">
    <div style="width:64px; height:64px; margin:0 auto 18px; border-radius:50%; background:${color}1a; color:${color}; font-size:30px; line-height:64px;">${icon}</div>
    <h1 style="color:#e2e8f0; font-size:19px; margin:0 0 10px;">${title}</h1>
    <p style="color:#94a3b8; font-size:14px; line-height:1.9; margin:0 0 8px;">${bodyAr}</p>
    <p dir="ltr" style="color:#64748b; font-size:12px; line-height:1.8; margin:0;">${bodyEn}</p>
    <p style="color:#475569; font-size:11px; margin-top:22px;">منصة أحمد الباز — Ahmed Elbaz Platform</p>
  </div>
</body>
</html>`;
}

approvalActionRoute.get("/action", async (c) => {
  const ip = getClientIpFromHeaders(c.req.raw.headers) || "unknown";
  if (!allow(ip)) {
    return c.html(page("محاولات كثيرة", "عدد كبير من المحاولات — انتظر قليلاً ثم أعد فتح الرابط من البريد.", "Too many attempts — wait a moment and reopen the link from the email.", "bad"), 429);
  }

  const token = (c.req.query("token") || "").slice(0, 400);
  const verdict = verifyApprovalActionToken(token);
  if (!verdict.valid) {
    logger.warn("[ApprovalRoute] rejected action link", { reason: verdict.reason, ip });
    return c.html(
      page("الرابط غير صالح", "هذا الرابط غير صالح أو منتهي الصلاحية أو مستخدم بالفعل — استخدم زر الإجراء من أحدث رسالة انضمام، أو قرر من لوحة التحكم.", "This link is invalid, expired, or already used — use the buttons from the latest registration email, or decide from the dashboard.", "bad"),
      400,
    );
  }

  const { userId, action } = verdict.payload;
  const result = await decideApproval({ userId, action, adminUserId: null, source: "email" });

  if (!result.ok) {
    if (result.reason === "not_found") {
      return c.html(page("الحساب غير موجود", "الحساب المرتبط بهذا الرابط لم يعد موجودًا.", "The account linked to this action no longer exists.", "bad"), 404);
    }
    // not_pending — a consumed or superseded link: inert page, no oracle.
    return c.html(page("تم البت في هذا الطلب مسبقاً", "هذا الطلب حُسم بالفعل — لا حاجة لإعادة الإجراء. يمكنك مراجعة حالته من لوحة التحكم.", "This request was already decided — no further action needed. You can review its status from the dashboard.", "neutral"));
  }

  c.header("Cache-Control", "no-store, max-age=0");
  if (action === "approve") {
    logger.info("[ApprovalRoute] approved via email", { userId, ip });
    return c.html(page("تم قبول الحساب ✓", "تم تفعيل الحساب بنجاح — صاحبه يستطيع الآن تسجيل الدخول واستخدام المنصة.", "The account has been approved — its owner can now sign in and use the platform.", "ok"));
  }
  logger.info("[ApprovalRoute] rejected via email", { userId, ip });
  return c.html(page("تم رفض الطلب", "تم رفض طلب الانضمام وإيقاف دخول هذا الحساب نهائياً.", "The join request was rejected — this account can no longer sign in.", "ok"));
});
