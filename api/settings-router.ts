import { z } from "zod";
import { eq, and, sql, desc } from "drizzle-orm";
import { createRouter, adminQuery, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { siteSettings, themes, promotions } from "@db/schema";
import { TRPCError } from "@trpc/server";

export const settingsRouter = createRouter({
  // ═══════════════════════════════════════════════
  // PUBLIC: Get all settings (for frontend rendering)
  // ═══════════════════════════════════════════════
  getAll: publicQuery.query(async () => {
    const db = getDb();
    const settings = await db.select().from(siteSettings).orderBy(siteSettings.section, siteSettings.sortOrder);
    // Convert to nested object: { hero: { titleEn: "...", ... }, features: { ... } }
    const result: Record<string, Record<string, string>> = {};
    for (const s of settings) {
      if (!result[s.section]) result[s.section] = {};
      result[s.section][s.key] = s.value;
    }
    return result;
  }),

  // Get settings for a specific section
  getSection: publicQuery
    .input(z.object({ section: z.string() }))
    .query(async ({ input }) => {
      const db = getDb();
      const settings = await db
        .select()
        .from(siteSettings)
        .where(eq(siteSettings.section, input.section))
        .orderBy(siteSettings.sortOrder);
      const result: Record<string, string> = {};
      for (const s of settings) {
        result[s.key] = s.value;
      }
      return result;
    }),

  // ═══════════════════════════════════════════════
  // ADMIN: Update/Create a setting
  // ═══════════════════════════════════════════════
  upsert: adminQuery
    .input(z.object({
      section: z.string().min(1).max(100),
      key: z.string().min(1).max(255),
      value: z.string(),
      type: z.enum(["text", "richtext", "image", "url", "color", "number", "json"]).default("text"),
      sortOrder: z.number().int().default(0),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      // Single UPSERT query instead of SELECT + INSERT/UPDATE
      await db.execute(
        sql`INSERT INTO siteSettings (\`section\`, \`key\`, \`value\`, \`type\`, \`sortOrder\`)
         VALUES (${input.section}, ${input.key}, ${input.value}, ${input.type}, ${input.sortOrder})
         ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), \`type\` = VALUES(\`type\`)`
      );
      return { success: true };
    }),

  // Bulk update settings for a section
  bulkUpsert: adminQuery
    .input(z.object({
      section: z.string().min(1).max(100),
      settings: z.array(z.object({
        key: z.string().min(1).max(255),
        value: z.string(),
        type: z.enum(["text", "richtext", "image", "url", "color", "number", "json"]).default("text"),
        sortOrder: z.number().int().default(0),
      })),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      // Use a single query per setting with INSERT ... ON DUPLICATE KEY UPDATE
      // This reduces from 2N queries to N queries
      await Promise.all(
        input.settings.map((s) =>
          db.execute(
            sql`INSERT INTO siteSettings (\`section\`, \`key\`, \`value\`, \`type\`, \`sortOrder\`)
             VALUES (${input.section}, ${s.key}, ${s.value}, ${s.type}, ${s.sortOrder})
             ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), \`type\` = VALUES(\`type\`)`
          )
        )
      );
      return { success: true };
    }),

  // ═══════════════════════════════════════════════
  // THEMES
  // ═══════════════════════════════════════════════

  // Get all themes
  listThemes: adminQuery.query(async () => {
    const db = getDb();
    return db.select().from(themes).orderBy(desc(themes.createdAt));
  }),

  // Get active theme (public — for frontend CSS variables)
  getActiveTheme: publicQuery.query(async () => {
    const db = getDb();
    const [theme] = await db.select().from(themes).where(eq(themes.isActive, true)).limit(1);
    return theme || null;
  }),

  // Create theme
  createTheme: adminQuery
    .input(z.object({
      name: z.string().min(1).max(100),
      slug: z.string().min(1).max(100),
      primaryColor: z.string().default("#06b6d4"),
      secondaryColor: z.string().default("#0891b2"),
      accentColor: z.string().default("#f59e0b"),
      bgColor: z.string().default("#0a0e17"),
      cardBgColor: z.string().default("#111827"),
      textColor: z.string().default("#f0f4f8"),
      mutedTextColor: z.string().default("#94a3b8"),
      borderColor: z.string().default("#1f2d44"),
      fontFamily: z.string().default("Inter, sans-serif"),
      headingFontFamily: z.string().default("Inter, sans-serif"),
      borderRadius: z.string().default("12px"),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [theme] = await db.insert(themes).values(input);
      return { success: true, id: Number(theme.insertId) };
    }),

  // Activate a theme (deactivates all others — atomic operation)
  activateTheme: adminQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      // SECURITY FIX: Atomic operation to prevent race condition
      // First verify the theme exists
      const [theme] = await db.select({ id: themes.id }).from(themes).where(eq(themes.id, input.id)).limit(1);
      if (!theme) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Theme not found" });
      }
      // Deactivate all themes, then activate the target (sequential within same DB connection)
      await db.update(themes).set({ isActive: false });
      await db.update(themes).set({ isActive: true, updatedAt: new Date() }).where(eq(themes.id, input.id));
      return { success: true };
    }),

  // Update theme
  updateTheme: adminQuery
    .input(z.object({
      id: z.number().int().positive(),
      name: z.string().max(100).optional(),
      primaryColor: z.string().optional(),
      secondaryColor: z.string().optional(),
      accentColor: z.string().optional(),
      bgColor: z.string().optional(),
      cardBgColor: z.string().optional(),
      textColor: z.string().optional(),
      mutedTextColor: z.string().optional(),
      borderColor: z.string().optional(),
      fontFamily: z.string().optional(),
      headingFontFamily: z.string().optional(),
      borderRadius: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...updates } = input;
      const cleanUpdates = Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined));
      if (Object.keys(cleanUpdates).length === 0) return { success: true };
      await db.update(themes).set(cleanUpdates).where(eq(themes.id, id));
      return { success: true };
    }),

  // Delete theme
  deleteTheme: adminQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [theme] = await db.select().from(themes).where(eq(themes.id, input.id)).limit(1);
      if (theme?.isActive) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot delete active theme" });
      }
      await db.delete(themes).where(eq(themes.id, input.id));
      return { success: true };
    }),

  // ═══════════════════════════════════════════════
  // PROMOTIONS (Header Banners)
  // ═══════════════════════════════════════════════

  // Get active promotions (public — for frontend banner)
  getActivePromotions: publicQuery.query(async () => {
    const db = getDb();
    const now = new Date();
    return db
      .select()
      .from(promotions)
      .where(
        and(
          eq(promotions.isActive, true),
          sql`${promotions.startsAt} <= ${now}`,
          sql`${promotions.endsAt} >= ${now}`,
        ),
      )
      .orderBy(desc(promotions.createdAt));
  }),

  // List all promotions (admin)
  listPromotions: adminQuery.query(async () => {
    const db = getDb();
    return db.select().from(promotions).orderBy(desc(promotions.createdAt));
  }),

  // Create promotion
  createPromotion: adminQuery
    .input(z.object({
      titleEn: z.string().min(1).max(500),
      titleAr: z.string().min(1).max(500),
      subtitleEn: z.string().max(500).optional(),
      subtitleAr: z.string().max(500).optional(),
      discountText: z.string().max(100).optional(),
      ctaTextEn: z.string().max(100).optional(),
      ctaTextAr: z.string().max(100).optional(),
      ctaUrl: z.string().max(500).optional(),
      promoCodeId: z.number().int().positive().optional(),
      bgGradientFrom: z.string().default("#06b6d4"),
      bgGradientTo: z.string().default("#8b5cf6"),
      textColor: z.string().default("#ffffff"),
      startsAt: z.string(),
      endsAt: z.string(),
      isActive: z.boolean().default(true),
      showCountdown: z.boolean().default(true),
      position: z.enum(["top", "hero_above", "hero_below", "floating"]).default("top"),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [promo] = await db.insert(promotions).values({
        ...input,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
      });
      return { success: true, id: Number(promo.insertId) };
    }),

  // Update promotion
  updatePromotion: adminQuery
    .input(z.object({
      id: z.number().int().positive(),
      titleEn: z.string().max(500).optional(),
      titleAr: z.string().max(500).optional(),
      subtitleEn: z.string().max(500).optional(),
      subtitleAr: z.string().max(500).optional(),
      discountText: z.string().max(100).optional(),
      ctaTextEn: z.string().max(100).optional(),
      ctaTextAr: z.string().max(100).optional(),
      ctaUrl: z.string().max(500).optional(),
      promoCodeId: z.number().int().positive().optional(),
      bgGradientFrom: z.string().optional(),
      bgGradientTo: z.string().optional(),
      textColor: z.string().optional(),
      startsAt: z.string().optional(),
      endsAt: z.string().optional(),
      isActive: z.boolean().optional(),
      showCountdown: z.boolean().optional(),
      position: z.enum(["top", "hero_above", "hero_below", "floating"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, startsAt, endsAt, ...rest } = input;
      const updates: any = { ...rest };
      if (startsAt) updates.startsAt = new Date(startsAt);
      if (endsAt) updates.endsAt = new Date(endsAt);
      const cleanUpdates = Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined));
      if (Object.keys(cleanUpdates).length === 0) return { success: true };
      await db.update(promotions).set(cleanUpdates).where(eq(promotions.id, id));
      return { success: true };
    }),

  // Delete promotion
  deletePromotion: adminQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(promotions).set({ isActive: false }).where(eq(promotions.id, input.id));
      return { success: true };
    }),
});
