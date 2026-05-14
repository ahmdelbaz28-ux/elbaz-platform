import { Hono } from "hono";
import { z } from "zod";
import { db } from "./queries/connection.js";
import { eq, and, sql } from "drizzle-orm";
import { rateLimit } from "./lib/rate-limiter.js";
import { env } from "./lib/env.js";
import { createHmac, timingSafeEqual } from "crypto";

interface PromoSession { userId: number; }
const promoRouter = new Hono<{ Variables: { session: PromoSession } }>();

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
  const promo = await db
    .select()
    .from(sql`promo_codes`)
    .where(
      and(
        eq(sql`code`, params.code),
        eq(sql`is_active`, true),
        sql`valid_from <= NOW()`,
        sql`(valid_until IS NULL OR valid_until >= NOW())`
      )
    )
    .limit(1)
    .then((rows) => rows[0] as {
      id: number; max_uses: number | null; used_count: number;
      max_uses_per_user: number | null; course_ids: string | null;
      discount_value: number; discount_type: string;
    } | undefined);

  if (!promo) {
    return { success: false, message: "كود الخصم غير صالح أو منتهي الصلاحية" };
  }

  if (promo.max_uses && promo.used_count >= promo.max_uses) {
    return { success: false, message: "تم استخدام هذا الكود بالحد الأقصى المسموح" };
  }

  const userUsage = await db
    .select({ count: sql<number>`count(*)` })
    .from(sql`promo_code_usages`)
    .where(
      and(
        eq(sql`promo_code_id`, promo.id),
        eq(sql`user_id`, params.userId)
      )
    )
    .then((r) => Number(r[0]?.count ?? 0));

  if (userUsage >= (promo.max_uses_per_user ?? 1)) {
    return { success: false, message: "لقد استخدمت هذا الكود من قبل" };
  }

  const courseBinding = promo.course_ids
    ? JSON.parse(promo.course_ids as string)
    : null;

  if (courseBinding && !courseBinding.includes(params.courseId)) {
    return { success: false, message: "هذا الكود غير متاح لهذه الدورة" };
  }

  if (params.paymentId) {
    await db.execute(
      sql`UPDATE payments SET discount_amount = ${promo.discount_value} WHERE id = ${params.paymentId}`
    );
  }

  await db.execute(
    sql`INSERT INTO promo_code_usages (promo_code_id, user_id, payment_id, used_at)
        VALUES (${promo.id}, ${params.userId}, ${params.paymentId ?? null}, NOW())`
  );

  await db.execute(
    sql`UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ${promo.id}`
  );

  return {
    success: true,
    discount: promo.discount_value,
    message: `تم تطبيق الخصم بنجاح (${promo.discount_value}%)`,
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
  const rawBody = await c.req.text();

  const payload = JSON.parse(rawBody);
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

  const promo = await db
    .select({
      id: sql`id`,
      discountValue: sql`discount_value`,
      expiresAt: sql`valid_until`,
      remainingUses: sql<number>`GREATEST(0, max_uses - used_count)`,
    })
    .from(sql`promo_codes`)
    .where(
      and(
        eq(sql`code`, code),
        eq(sql`is_active`, true),
        sql`valid_from <= NOW()`,
        sql`(valid_until IS NULL OR valid_until >= NOW())`
      )
    )
    .limit(1)
    .then((rows) => rows[0]);

  if (!promo) {
    return c.json({ valid: false }, 404);
  }

  return c.json({
    valid: true,
    discount: promo.discountValue,
    remainingUses: promo.remainingUses,
    expiresAt: promo.expiresAt,
  });
});

export { promoRouter, applyPromoCodeInternal, verifyPromoHmac };
