import { Hono } from "hono";
import { z } from "zod";
import { db } from "./queries/connection.js";
import { resolveOptionalUser } from "./context.js";
import { eq, and, sql, lte, gte, isNull, or, count } from "drizzle-orm";
import { rateLimit } from "./lib/rate-limiter.js";
import { env } from "./lib/env.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { promoCodes, promoCodeUsage, payments } from "@db/schema";

interface PromoSession { userId: number; }
const promoRouter = new Hono<{ Variables: { session: PromoSession | null } }>();

promoRouter.use("*", async (c, next) => {
  // ✅ SECURITY FIX (audit run-1, promo-routes-skip-tokenversion): resolve the
  // session through the SAME pipeline as tRPC (cache -> DB load -> tokenVersion
  // revocation check) instead of a bare verifyToken, so a revoked/hijacked JWT
  // is rejected here exactly like on every authed tRPC procedure.
  const user = await resolveOptionalUser(c.req.raw);
  c.set("session", user ? { userId: user.id } : null);
  await next();
});

const ApplyCodeSchema = z.object({
  code: z.string().min(3).max(50),
  courseId: z.number().positive(),
});

const INTERNAL_APPLY_SCHEMA = z.object({
  code: z.string().min(3).max(50),
  courseId: z.number().positive(),
  userId: z.number().positive(),
  paymentId: z.number().positive().optional(),
});

function verifyPromoHmac(payload: string, signature: string): boolean {
  if (!env.PAYMOB_HMAC_SECRET) return false;
  try {
    const expected = createHmac("sha512", env.PAYMOB_HMAC_SECRET)
      .update(payload)
      .digest("hex");
    return timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    return false;
  }
}

async function applyPromoCodeInternal(params: {
  code: string;
  courseId: number;
  userId: number;
  paymentId?: number;
}, recordUsage = false): Promise<{ success: boolean; discount?: number; message: string }> {
  const now = new Date();

  const [promo] = await db
    .select()
    .from(promoCodes)
    .where(
      and(
        eq(promoCodes.code, params.code),
        eq(promoCodes.isActive, true),
        lte(promoCodes.validFrom, now),
        or(isNull(promoCodes.validUntil), gte(promoCodes.validUntil, now))
      )
    )
    .limit(1);

  if (!promo) {
    return { success: false, message: "كود الخصم غير صالح أو منتهي الصلاحية" };
  }

  if (promo.maxUses && promo.usedCount >= promo.maxUses) {
    return { success: false, message: "تم استخدام هذا الكود بالحد الأقصى المسموح" };
  }

  const [{ userUsage }] = await db
    .select({ userUsage: count() })
    .from(promoCodeUsage)
    .where(
      and(
        eq(promoCodeUsage.promoCodeId, promo.id),
        eq(promoCodeUsage.userId, params.userId)
      )
    );

  if (userUsage >= (promo.maxUsesPerUser ?? 1)) {
    return { success: false, message: "لقد استخدمت هذا الكود من قبل" };
  }

  if (promo.courseIds && !promo.isValidForAllCourses) {
    const allowedIds = promo.courseIds as number[];
    if (!allowedIds.includes(params.courseId)) {
      return { success: false, message: "هذا الكود غير متاح لهذه الدورة" };
    }
  }

  const discountValue = Number.parseFloat(promo.discountValue);

  if (params.paymentId) {
    await db
      .update(payments)
      .set({ promoCodeId: promo.id })
      .where(eq(payments.id, params.paymentId));
  }

  // ✅ SECURITY FIX (audit run-1, payments.promo-quota-burn): usage is a shared
  // budget that must correspond to settled value. The /apply and /apply/internal
  // surfaces ran with recordUsage=false by default now — they compute the
  // discount WITHOUT burning quota; the payment flow records usage at intent
  // and RELEASES it on rejection/refund (see releasePromoUsageForPayment).
  if (recordUsage) {
    await db.insert(promoCodeUsage).values({
      promoCodeId: promo.id,
      userId: params.userId,
      paymentId: params.paymentId ?? null,
    });

    await db
      .update(promoCodes)
      .set({ usedCount: sql`${promoCodes.usedCount} + 1` })
      .where(eq(promoCodes.id, promo.id));
  }

  return {
    success: true,
    discount: discountValue,
    message: `تم تطبيق الخصم بنجاح (${discountValue}%)`,
  };
}

promoRouter.post("/apply", async (c) => {
  const clientIp = c.req.header("x-forwarded-for")?.split(",")[0] ?? "unknown";
  try {
    await rateLimit(`promo:apply:${clientIp}`, 5);
  } catch {
    return c.json({ error: "طلبات كثيرة جداً، حاول لاحقاً" }, 429);
  }

  const body = await c.req.json();
  const parsed = ApplyCodeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "بيانات غير صالحة" }, 400);
  }

  const session = c.get("session");
  if (!session?.userId) {
    return c.json({ error: "يجب تسجيل الدخول أولاً" }, 401);
  }

  const result = await applyPromoCodeInternal({
    code: parsed.data.code,
    courseId: parsed.data.courseId,
    userId: session.userId,
  });

  return c.json(result, result.success ? 200 : 400);
});

promoRouter.post("/apply/internal", async (c) => {
  const hmacSignature = c.req.header("x-promo-hmac") ?? "";
  let rawBody: string;
  try {
    rawBody = await c.req.text();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  const parsed = INTERNAL_APPLY_SCHEMA.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: "Invalid payload" }, 400);
  }

  const hmacPayload = `${parsed.data.code}:${parsed.data.userId}:${parsed.data.courseId}`;
  if (!verifyPromoHmac(hmacPayload, hmacSignature)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const clientIp = c.req.header("x-forwarded-for")?.split(",")[0] ?? "internal";
  try {
    await rateLimit(`promo:internal:${clientIp}`, 20);
  } catch {
    return c.json({ error: "Rate limited" }, 429);
  }

  const result = await applyPromoCodeInternal(parsed.data);
  return c.json(result, result.success ? 200 : 400);
});

promoRouter.get("/validate/:code", async (c) => {
  const code = c.req.param("code");
  if (!code || code.length < 3) {
    return c.json({ valid: false }, 400);
  }

  const session = c.get("session");
  if (!session?.userId) {
    return c.json({ error: "يجب تسجيل الدخول" }, 401);
  }

  // ✅ SECURITY FIX (audit run-1, promo-validate-validity-oracle): throttle
  // code probing per account+IP — this endpoint was the unthrottled
  // enumeration primitive for the merchant's promo inventory.
  const probeIp = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  try {
    await rateLimit(`promo:validate:${session.userId}:${probeIp}`, 1);
  } catch {
    return c.json({ error: "طلبات كثيرة جداً، حاول لاحقاً" }, 429);
  }

  const now = new Date();

  const [promo] = await db
    .select({
      id: promoCodes.id,
      discountValue: promoCodes.discountValue,
      validUntil: promoCodes.validUntil,
      maxUses: promoCodes.maxUses,
      usedCount: promoCodes.usedCount,
    })
    .from(promoCodes)
    .where(
      and(
        eq(promoCodes.code, code),
        eq(promoCodes.isActive, true),
        lte(promoCodes.validFrom, now),
        or(isNull(promoCodes.validUntil), gte(promoCodes.validUntil, now))
      )
    )
    .limit(1);

  if (!promo) {
    return c.json({ valid: false }, 404);
  }

  // ✅ SECURITY FIX (audit run-1, promo-validate-validity-oracle): the checkout
  // UI consumes only valid/discount — drop the operational inventory data
  // (remainingUses/expiresAt) from the public response.
  return c.json({
    valid: true,
    promoId: promo.id,
    discount: Number.parseFloat(promo.discountValue),
  });
});

export { promoRouter, applyPromoCodeInternal, verifyPromoHmac };


/**
 * ✅ SECURITY FIX (audit run-1, payments.promo-quota-burn): release the promo
 * quota a pending payment consumed, for use on admin rejection and webhook
 * refund/void. Idempotent: the usage row is deleted and the counter clamped
 * at zero, so repeated calls are safe.
 */
export async function releasePromoUsageForPayment(paymentId: number, userId: number): Promise<void> {
  const rows = await db
    .select({ id: promoCodeUsage.id, promoCodeId: promoCodeUsage.promoCodeId })
    .from(promoCodeUsage)
    .where(and(eq(promoCodeUsage.paymentId, paymentId), eq(promoCodeUsage.userId, userId)));
  if (rows.length === 0) return;
  await db.delete(promoCodeUsage).where(and(eq(promoCodeUsage.paymentId, paymentId), eq(promoCodeUsage.userId, userId)));
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.promoCodeId, (counts.get(r.promoCodeId) ?? 0) + 1);
  for (const [promoCodeId, n] of counts) {
    await db
      .update(promoCodes)
      .set({ usedCount: sql`GREATEST(${promoCodes.usedCount} - ${n}, 0)` })
      .where(eq(promoCodes.id, promoCodeId));
  }
}
