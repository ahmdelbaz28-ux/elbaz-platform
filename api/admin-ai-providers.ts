/**
 * ADMIN AI PROVIDERS — dashboard management for the dynamic AI router
 *
 * Procedures (all admin-guarded):
 *   aiProviders        — list providers + discovered models (apiKey MASKED)
 *   aiProviderSave     — create/update any OpenAI-compatible provider; a
 *                        provided key triggers automatic model discovery
 *   aiProviderDelete   — remove provider (models cascade via FK)
 *   aiProviderToggle   — enable/disable without deleting
 *   aiProviderDiscover — re-run GET {baseUrl}/models classification
 *   aiProviderTest     — probe the best chat model with a tiny completion
 *   aiModelUpdate      — per-model toggles (enabled / vision / chat / tier)
 *   aiRouterHealth     — router snapshot (breaker cooldowns + recent events)
 *
 * SECURITY: apiKey is write-only. aiProviders.maskKey mirrors it; the raw
 * key is never sent back to the client. When the client omits apiKey on
 * update, the stored key is preserved.
 */

import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { adminQuery, adminMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { aiModels, aiProviders } from "@db/schema";
import {
  discoverProviderModels,
  discoverAllProviders,
  getRouterHealthSnapshot,
  maskApiKey,
  PROVIDER_CATALOG,
  testProvider,
  invalidateAiRouterCache,
} from "./lib/ai-router.js";
import { logger } from "./lib/logger.js";

function slugify(input: string): string {
  const base = input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return base || "provider";
}

async function uniqueSlug(db: ReturnType<typeof getDb>, desired: string, excludeId?: number): Promise<string> {
  let candidate = desired;
  let n = 2;
  for (;;) {
    const rows = await db.select({ id: aiProviders.id }).from(aiProviders).where(eq(aiProviders.slug, candidate));
    const clash = rows.find((r) => r.id !== excludeId);
    if (!clash) return candidate;
    candidate = `${desired}-${n++}`;
    if (n > 50) return `${desired}-${Date.now()}`;
  }
}

const baseUrlSchema = z.string().trim().min(1).max(255).refine(
  (v) => /^https?:\/\//i.test(v),
  { message: "baseUrl must start with http(s)://" },
);

export const adminAiProcedures = {
  aiProviders: adminQuery.query(async () => {
    const db = getDb();
    const providers = await db.select().from(aiProviders).orderBy(asc(aiProviders.priority), asc(aiProviders.id));
    const models = await db.select().from(aiModels).orderBy(asc(aiModels.tier), asc(aiModels.modelId));
    return {
      catalog: PROVIDER_CATALOG,
      providers: providers.map((p) => ({
        id: p.id,
        slug: p.slug,
        displayName: p.displayName,
        baseUrl: p.baseUrl,
        apiKeyMasked: maskApiKey(p.apiKey),
        hasKey: !!p.apiKey,
        priority: p.priority,
        enabled: p.enabled,
        status: p.status,
        lastError: p.lastError,
        lastCheckedAt: p.lastCheckedAt,
        models: models
          .filter((m) => m.providerId === p.id)
          .map((m) => ({
            id: m.id,
            modelId: m.modelId,
            supportsChat: m.supportsChat,
            supportsVision: m.supportsVision,
            isFree: m.isFree,
            enabled: m.enabled,
            tier: m.tier,
            status: m.status,
            failCount: m.failCount,
            latencyMs: m.latencyMs,
            lastSuccessAt: m.lastSuccessAt,
          })),
      })),
    };
  }),

  aiProviderSave: adminMutation
    .input(
      z.object({
        id: z.number().int().positive().optional(),
        slug: z.string().trim().min(1).max(64).optional(),
        displayName: z.string().trim().min(1).max(100),
        baseUrl: baseUrlSchema,
        /** Omit / empty → keep the stored key (updates). Required for creates. */
        apiKey: z.string().trim().max(512).optional(),
        priority: z.number().int().min(1).max(999).default(100),
        enabled: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      if (input.id) {
        const [existing] = await db.select().from(aiProviders).where(eq(aiProviders.id, input.id));
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });

        const nextKey = input.apiKey ? input.apiKey : existing.apiKey;
        await db
          .update(aiProviders)
          .set({
            displayName: input.displayName,
            baseUrl: input.baseUrl,
            apiKey: nextKey,
            priority: input.priority,
            enabled: input.enabled,
            status: "unknown",
            lastError: null,
            lastCheckedAt: new Date(),
          })
          .where(eq(aiProviders.id, input.id));
        invalidateAiRouterCache();

        // A new/changed key (or explicit re-save) re-runs discovery so the
        // router immediately knows the models this key can use.
        const discovery = nextKey && input.enabled
          ? await discoverProviderModels({ id: input.id, baseUrl: input.baseUrl, apiKey: nextKey, slug: existing.slug })
          : { ok: false, found: 0, chat: 0, vision: 0, free: 0, error: "المزود معطّل أو بلا مفتاح — لن يتم فحص النماذج" };

        logger.info("[Admin/AiProviders] updated", { id: input.id, slug: existing.slug, discoveryOk: discovery.ok });
        return { id: input.id, slug: existing.slug, discovery };
      }

      // ── Create ──
      if (!input.apiKey) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "API key مطلوب عند إضافة مزود جديد" });
      }
      const slug = await uniqueSlug(db, input.slug ? slugify(input.slug) : slugify(input.displayName));
      const [created] = await db
        .insert(aiProviders)
        .values({
          slug,
          displayName: input.displayName,
          baseUrl: input.baseUrl,
          apiKey: input.apiKey,
          priority: input.priority,
          enabled: input.enabled,
          status: "unknown",
        });
      const newId = Number(created.insertId);
      invalidateAiRouterCache();

      const discovery = input.enabled
        ? await discoverProviderModels({ id: newId, baseUrl: input.baseUrl, apiKey: input.apiKey, slug })
        : { ok: false, found: 0, chat: 0, vision: 0, free: 0, error: "المزود مضاف لكنه معطّل — فعّله ثم شغّل فحص النماذج" };

      logger.info("[Admin/AiProviders] created", { id: newId, slug, discoveryOk: discovery.ok });
      return { id: newId, slug, discovery };
    }),

  aiProviderDelete: adminMutation
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [existing] = await db.select({ slug: aiProviders.slug }).from(aiProviders).where(eq(aiProviders.id, input.id));
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
      await db.delete(aiProviders).where(eq(aiProviders.id, input.id)); // models cascade (FK)
      invalidateAiRouterCache();
      logger.info("[Admin/AiProviders] deleted", { id: input.id, slug: existing.slug });
      return { ok: true };
    }),

  aiProviderToggle: adminMutation
    .input(z.object({ id: z.number().int().positive(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(aiProviders).set({ enabled: input.enabled, status: "unknown", lastError: null }).where(eq(aiProviders.id, input.id));
      invalidateAiRouterCache();
      return { ok: true };
    }),

  aiProviderDiscover: adminMutation
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [provider] = await db.select().from(aiProviders).where(eq(aiProviders.id, input.id));
      if (!provider) throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
      if (!provider.apiKey) {
        return { ok: false, found: 0, chat: 0, vision: 0, free: 0, error: "لا يوجد API key محفوظ لهذا المزود" };
      }
      const discovery = await discoverProviderModels(provider);
      return discovery;
    }),

  aiProviderDiscoverAll: adminMutation.mutation(async () => {
    await discoverAllProviders();
    return { ok: true };
  }),

  aiProviderTest: adminMutation
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [provider] = await db.select().from(aiProviders).where(eq(aiProviders.id, input.id));
      if (!provider) throw new TRPCError({ code: "NOT_FOUND", message: "Provider not found" });
      if (!provider.apiKey) return { ok: false, latencyMs: 0, error: "لا يوجد API key محفوظ" };
      return await testProvider(provider);
    }),

  aiModelUpdate: adminMutation
    .input(
      z.object({
        id: z.number().int().positive(),
        enabled: z.boolean().optional(),
        supportsVision: z.boolean().optional(),
        supportsChat: z.boolean().optional(),
        tier: z.number().int().min(1).max(3).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...patch } = input;
      if (Object.keys(patch).length === 0) return { ok: true };
      await db.update(aiModels).set(patch).where(eq(aiModels.id, id));
      invalidateAiRouterCache();
      return { ok: true };
    }),

  aiRouterHealth: adminQuery.query(async () => {
    const snapshot = await getRouterHealthSnapshot();
    return snapshot;
  }),
};
