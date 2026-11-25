/**
 * USER AI PROVIDER ROUTER — BYOK (bring-your-own-key) management for the
 * chatbot's key menu.
 *
 * Product contract (owner, 2026-11): the platform runs on owner-managed
 * models by default. A LOGGED-IN user may optionally register ONE custom
 * OpenAI-compatible provider (baseUrl + API key + model id); when enabled,
 * the chatbot tries their endpoint first and falls back to the platform
 * cascade on any failure (api/lib/chatbot-byok.ts).
 *
 * Endpoints (all require auth — anonymous users get 401):
 *   GET  /api/user-ai-provider        — masked config + provider catalog
 *   PUT  /api/user-ai-provider        — create/update (key write-only)
 *   DELETE /api/user-ai-provider      — remove the stored config
 *   POST /api/user-ai-provider/test   — connectivity test (saved or unsaved)
 *
 * SECURITY:
 *   - The API key is write-only: AES-256-GCM at rest (byok-crypto.ts), only
 *     a ••••last4 preview is ever returned, never logged, never echoed back.
 *   - baseUrl is user-writable → validated with zod AND the shared
 *     isPublicProviderUrl SSRF guard at save time; the chat lane re-checks
 *     fail-closed on every use.
 *   - Mutation endpoints are rate-limited per user (in-memory bucket, same
 *     pattern as the chatbot router's limiter).
 */

import { userAiProviders } from "@db/schema";
import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { resolveOptionalUser } from "./context.js";
import { isPublicProviderUrl, maskApiKey } from "./lib/ai-router.js";
import { decryptByokKey, encryptByokKey } from "./lib/byok-crypto.js";
import { getUserByokConfig, isKnownUserProvider, testByokProvider, USER_PROVIDER_CATALOG } from "./lib/chatbot-byok.js";
import { logger } from "./lib/logger.js";
import { getDb } from "./queries/connection";

const userAiProviderRouter = new Hono();

// ── Per-user rate limit for config mutations + tests (in-memory, same
//    bounded-map pattern as chatbot-router.ts) ──
const byokMutations = new Map<number, { count: number; resetAt: number }>();
const BYOK_MUTATION_LIMIT = 20; // saves + tests per 5 minutes — generous for a human menu
const BYOK_WINDOW_MS = 5 * 60_000;
const BYOK_MAP_MAX_SIZE = 10_000;

function checkByokRateLimit(userId: number): boolean {
  const now = Date.now();
  if (byokMutations.size >= BYOK_MAP_MAX_SIZE) {
    for (const [k, e] of byokMutations) if (now > e.resetAt) byokMutations.delete(k);
  }
  const entry = byokMutations.get(userId);
  if (!entry || now > entry.resetAt) {
    byokMutations.set(userId, { count: 1, resetAt: now + BYOK_WINDOW_MS });
    return true;
  }
  if (entry.count >= BYOK_MUTATION_LIMIT) return false;
  entry.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, e] of byokMutations) if (now > e.resetAt) byokMutations.delete(k);
}, 5 * 60_000).unref();

// ── Validation ──
const baseUrlSchema = z.string().trim().min(1).max(255)
  .refine((v) => /^https:\/\//i.test(v), { message: "عنوان المزود يجب أن يبدأ بـ https://" })
  .refine((v) => isPublicProviderUrl(`${v.replace(/\/+$/, "")}/chat/completions`), { message: "عنوان المزود غير مسموح — يجب أن يشير إلى نقطة نهاية عامة" });

const saveSchema = z.object({
  provider: z.string().trim().max(48).refine((v) => isKnownUserProvider(v), { message: "مزود غير معروف" }).default("custom"),
  baseUrl: baseUrlSchema,
  modelId: z.string().trim().min(1, "اسم النموذج مطلوب").max(190),
  /**
   * Omit / empty → keep the stored key on update; required for creates.
   * ✅ SECURITY HARDENING (isolation review 2026-11): the ≥8 length floor is
   * enforced SERVER-SIDE too (the panel checked it only client-side, so a
   * direct API caller could store a 1-char key). An empty/whitespace value
   * normalizes to undefined — identical to omission (write-only contract).
   */
  apiKey: z.string().trim().max(512)
    .transform((v) => (v.length === 0 ? undefined : v))
    .refine((v) => v === undefined || v.length >= 8, { message: "مفتاح API قصير جداً — 8 أحرف على الأقل" })
    .optional(),
  enabled: z.boolean().default(true),
});

const toggleSchema = z.object({
  enabled: z.boolean(),
});

const testUnsavedSchema = z.object({
  baseUrl: baseUrlSchema,
  modelId: z.string().trim().min(1).max(190),
  apiKey: z.string().trim().min(8).max(512),
});

function unauthorized(c: Context): Response {
  return c.json({ success: false, error: "سجّل الدخول أولاً لاستخدام إعدادات النموذج الخاص", code: "unauthorized" }, 401);
}

async function requireUser(c: Context): Promise<{ id: number } | null> {
  const user = await resolveOptionalUser(c.req.raw);
  return user ? { id: user.id } : null;
}

/** Row → client-safe shape (decrypts in-memory ONLY to build the last-4 mask). */
function toClientShape(row: typeof userAiProviders.$inferSelect): Record<string, unknown> {
  const plaintext = decryptByokKey(row.apiKeyEnc);
  return {
    configured: true,
    provider: row.provider,
    baseUrl: row.baseUrl,
    modelId: row.modelId,
    keyPreview: plaintext ? maskApiKey(plaintext) : null,
    enabled: row.enabled,
    lastTestOk: row.lastTestOk,
    lastTestError: row.lastTestError,
    lastTestedAt: row.lastTestedAt,
    updatedAt: row.updatedAt,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// GET — masked config + catalog (no rate limit: read-only, cheap)
// ═════════════════════════════════════════════════════════════════════════
userAiProviderRouter.get("/", async (c) => {
  const user = await requireUser(c);
  if (!user) return unauthorized(c);
  try {
    const db = getDb();
    const [row] = await db.select().from(userAiProviders).where(eq(userAiProviders.userId, user.id)).limit(1);
    return c.json({
      success: true,
      config: row ? toClientShape(row) : null,
      catalog: USER_PROVIDER_CATALOG,
    });
  } catch (err) {
    logger.warn("[ByokRoute] get failed", { error: err instanceof Error ? err.message : String(err) });
    return c.json({ success: false, error: "تعذر تحميل الإعدادات — أعد المحاولة" }, 500);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// PUT — create/update the stored config (full save)
// ═════════════════════════════════════════════════════════════════════════
userAiProviderRouter.put("/", async (c) => {
  const user = await requireUser(c);
  if (!user) return unauthorized(c);
  if (!checkByokRateLimit(user.id)) {
    return c.json({ success: false, error: "عدد كبير من المحاولات — انتظر قليلاً ثم أعد المحاولة", code: "rate_limited" }, 429);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "جسم الطلب غير صالح" }, 400);
  }
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message ?? "مدخلات غير صالحة" }, 400);
  }
  const input = parsed.data;
  try {
    const db = getDb();
    const [existing] = await db.select().from(userAiProviders).where(eq(userAiProviders.userId, user.id)).limit(1);
    if (!input.apiKey && !existing) {
      return c.json({ success: false, error: "مفتاح API مطلوب عند إضافة نموذج جديد" }, 400);
    }
    // Write-only contract: an omitted key keeps the stored ciphertext; a
    // provided key re-encrypts. The plaintext never rests and never returns.
    const apiKeyEnc = input.apiKey
      ? encryptByokKey(input.apiKey)
      : existing?.apiKeyEnc ?? "";
    await db
      .insert(userAiProviders)
      .values({
        userId: user.id,
        provider: input.provider,
        baseUrl: input.baseUrl.replace(/\/+$/, ""),
        modelId: input.modelId,
        apiKeyEnc,
        enabled: input.enabled,
      })
      .onDuplicateKeyUpdate({
        set: {
          provider: input.provider,
          baseUrl: input.baseUrl.replace(/\/+$/, ""),
          modelId: input.modelId,
          ...(input.apiKey ? { apiKeyEnc } : {}),
          enabled: input.enabled,
        },
      });
    logger.info("[ByokRoute] config saved", { userId: user.id, provider: input.provider });
    const [row] = await db.select().from(userAiProviders).where(eq(userAiProviders.userId, user.id)).limit(1);
    return c.json({ success: true, config: row ? toClientShape(row) : null });
  } catch (err) {
    logger.warn("[ByokRoute] save failed", { error: err instanceof Error ? err.message : String(err) });
    return c.json({ success: false, error: "تعذر حفظ الإعدادات — أعد المحاولة" }, 500);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// PATCH — toggle the kill switch without touching the stored key
// ═════════════════════════════════════════════════════════════════════════
userAiProviderRouter.patch("/", async (c) => {
  const user = await requireUser(c);
  if (!user) return unauthorized(c);
  if (!checkByokRateLimit(user.id)) {
    return c.json({ success: false, error: "عدد كبير من المحاولات — انتظر قليلاً ثم أعد المحاولة", code: "rate_limited" }, 429);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "جسم الطلب غير صالح" }, 400);
  }
  const parsed = toggleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: "قيمة التفعيل غير صالحة" }, 400);
  }
  try {
    const db = getDb();
    const result = await db
      .update(userAiProviders)
      .set({ enabled: parsed.data.enabled })
      .where(eq(userAiProviders.userId, user.id));
    const affected = Array.isArray(result) ? (result[0]?.affectedRows ?? 0) : 0;
    if (!affected) {
      return c.json({ success: false, error: "لا يوجد إعداد محفوظ لتفعيله — أضف النموذج أولاً" }, 404);
    }
    const [row] = await db.select().from(userAiProviders).where(eq(userAiProviders.userId, user.id)).limit(1);
    return c.json({ success: true, config: row ? toClientShape(row) : null });
  } catch (err) {
    logger.warn("[ByokRoute] toggle failed", { error: err instanceof Error ? err.message : String(err) });
    return c.json({ success: false, error: "تعذر تحديث الإعدادات — أعد المحاولة" }, 500);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// DELETE — remove the stored config entirely
// ═════════════════════════════════════════════════════════════════════════
userAiProviderRouter.delete("/", async (c) => {
  const user = await requireUser(c);
  if (!user) return unauthorized(c);
  if (!checkByokRateLimit(user.id)) {
    return c.json({ success: false, error: "عدد كبير من المحاولات — انتظر قليلاً ثم أعد المحاولة", code: "rate_limited" }, 429);
  }
  try {
    const db = getDb();
    await db.delete(userAiProviders).where(eq(userAiProviders.userId, user.id));
    logger.info("[ByokRoute] config deleted", { userId: user.id });
    return c.json({ success: true, config: null });
  } catch (err) {
    logger.warn("[ByokRoute] delete failed", { error: err instanceof Error ? err.message : String(err) });
    return c.json({ success: false, error: "تعذر حذف الإعدادات — أعد المحاولة" }, 500);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// POST /test — connectivity test. Two modes:
//   • no body        → test the SAVED config (decrypts the stored key,
//                      records lastTest* on the row)
//   • inline config  → test BEFORE save (never persists anything)
// ═════════════════════════════════════════════════════════════════════════
userAiProviderRouter.post("/test", async (c) => {
  const user = await requireUser(c);
  if (!user) return unauthorized(c);
  if (!checkByokRateLimit(user.id)) {
    return c.json({ success: false, error: "عدد كبير من المحاولات — انتظر قليلاً ثم أعد المحاولة", code: "rate_limited" }, 429);
  }

  const raw = await c.req.text();
  let target: { baseUrl: string; apiKey: string; modelId: string } | null = null;
  let isSavedTest = false;

  if (raw && raw.trim().length > 0) {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return c.json({ success: false, error: "جسم الطلب غير صالح" }, 400);
    }
    const parsed = testUnsavedSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.issues[0]?.message ?? "مدخلات غير صالحة" }, 400);
    }
    target = { baseUrl: parsed.data.baseUrl.replace(/\/+$/, ""), apiKey: parsed.data.apiKey, modelId: parsed.data.modelId };
  } else {
    const config = await getUserByokConfig(user.id);
    if (!config) {
      return c.json({ success: false, error: "لا يوجد إعداد محفوظ لاختباره — أدخل النموذج والمفتاح أولاً" }, 404);
    }
    target = { baseUrl: config.baseUrl, apiKey: config.apiKey, modelId: config.modelId };
    isSavedTest = true;
  }

  const result = await testByokProvider(target);
  if (isSavedTest) {
    try {
      const db = getDb();
      await db
        .update(userAiProviders)
        .set({
          lastTestOk: result.ok,
          lastTestError: result.ok ? null : (result.error ?? "فشل الاختبار").slice(0, 400),
          lastTestedAt: new Date(),
        })
        .where(eq(userAiProviders.userId, user.id));
    } catch (err) {
      logger.warn("[ByokRoute] test-state persist failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }
  return c.json({ success: true, test: result });
});

export { userAiProviderRouter };
