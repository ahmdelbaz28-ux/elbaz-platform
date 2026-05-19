import { Hono } from "hono";
import { z } from "zod";
import { db } from "./queries/connection.js";
import { eq, and, sql, lt, lte, gte, isNull, or, count, gt } from "drizzle-orm";
import { rateLimit } from "./lib/rate-limiter.js";
import { env } from "./lib/env.js";
import { createHmac, timingSafeEqual } from "crypto";
import { promoCodes, promoCodeUsage, payments } from "@db/schema";
import * as cookie from "cookie";
import { AUTH_COOKIE_NAME } from "./lib/cookies.js";
import { verifyToken } from "./lib/jwt.js";

interface PromoSession { userId: number; }
const promoRouter = new Hono<{ Variables: { session: PromoSession | null } }>();

promoRouter.use("*", async (c, next) => {
  const cookieHeader = c.req.header("cookie");
  const cookies = cookieHeader ? cookie.parse(cookieHeader) : {};
  const token = cookies[AUTH_COOKIE_NAME];
  if (token) {
    const payload = await verifyToken(token);
    if (payload) {
      c.set("session", { userId: payload.userId });
      await next();
      return;
    }
  }
  c.set("session", null);
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
}): Promise<{ success: boolean; discount?: number; message: string }> {
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

  const [[{ userUsage }]] = await db
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

  const discountValue = parseFloat(promo.discountValue);

  if (params.paymentId) {
    await db
      .update(payments)
      .set({ promoCodeId: promo.id })
      .where(eq(payments.id, params.paymentId));
  }

  await db.insert(promoCodeUsage).values({
    promoCodeId: promo.id,
    userId: params.userId,
    paymentId: params.paymentId ?? null,
  });

  await db
    .update(promoCodes)
    .set({ usedCount: sql`${promoCodes.usedCount} + 1` })
    .where(eq(promoCodes.id, promo.id));

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

  const remainingUses = promo.maxUses ? Math.max(0, promo.maxUses - promo.usedCount) : null;

  return c.json({
    valid: true,
    discount: parseFloat(promo.discountValue),
    remainingUses,
    expiresAt: promo.validUntil,
  });
});

export { promoRouter, applyPromoCodeInternal, verifyPromoHmac };
