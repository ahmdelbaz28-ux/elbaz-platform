import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { createRouter, adminQuery, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { promoCodes } from "@db/schema";
import { TRPCError } from "@trpc/server";

export const promoRouter = createRouter({
  // ═══ Public: Validate a promo code (used at checkout) ═══
  validate: publicQuery
    .input(z.object({
      code: z.string().min(1).max(50).toUpperCase(),
      courseId: z.number().int().positive().optional(),  // Required if promo is course-specific
      amount: z.number().positive(),                     // Cart/course amount before discount
    }))
    .query(async ({ input }) => {
      const db = getDb();
      const now = new Date();

      const [promo] = await db
        .select()
        .from(promoCodes)
        .where(
          and(
            eq(promoCodes.code, input.code),
            eq(promoCodes.isActive, true),
          ),
        )
        .limit(1);

      if (!promo) {
        return { valid: false, error: "Promo code not found" };
      }

      // Check expiry
      if (now < promo.startsAt || now > promo.expiresAt) {
        return { valid: false, error: "This promo code has expired" };
      }

      // Check max uses
      if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) {
        return { valid: false, error: "This promo code has reached its usage limit" };
      }

      // Check minimum order amount
      if (promo.minOrderAmount && input.amount < parseFloat(String(promo.minOrderAmount))) {
        return { valid: false, error: `Minimum order amount is ${promo.minOrderAmount} EGP` };
      }

      // Check if applies to specific course
      if (promo.appliesTo === "specific" && promo.courseId) {
        if (!input.courseId || input.courseId !== Number(promo.courseId)) {
          return { valid: false, error: "This promo code does not apply to this course" };
        }
      }

      // Calculate discount
      let discountAmount: number;
      if (promo.discountType === "percentage") {
        discountAmount = (input.amount * parseFloat(String(promo.discountValue))) / 100;
      } else {
        discountAmount = parseFloat(String(promo.discountValue));
      }

      // Ensure discount doesn't make price negative
      discountAmount = Math.min(discountAmount, input.amount);
      const finalAmount = Math.max(input.amount - discountAmount, 0);

      return {
        valid: true,
        promoId: promo.id,
        discountType: promo.discountType,
        discountValue: promo.discountValue,
        discountAmount: discountAmount.toFixed(2),
        finalAmount: finalAmount.toFixed(2),
        description: promo.description,
      };
    }),

  // ═══ Admin: CRUD for Promo Codes ═══
  list: adminQuery.query(async () => {
    const db = getDb();
    return db.select().from(promoCodes).orderBy(desc(promoCodes.createdAt));
  }),

  create: adminQuery
    .input(z.object({
      code: z.string().min(1).max(50).toUpperCase(),
      description: z.string().max(255).optional(),
      discountType: z.enum(["percentage", "fixed"]),
      discountValue: z.string(),
      maxUses: z.number().int().positive().optional(),
      minOrderAmount: z.string().default("0.00"),
      appliesTo: z.enum(["all", "specific"]).default("all"),
      courseId: z.number().int().positive().optional(),
      startsAt: z.string(),  // ISO date string
      expiresAt: z.string(),
      isActive: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [promo] = await db.insert(promoCodes).values({
        ...input,
        startsAt: new Date(input.startsAt),
        expiresAt: new Date(input.expiresAt),
      });
      return { success: true, id: Number(promo.insertId) };
    }),

  update: adminQuery
    .input(z.object({
      id: z.number().int().positive(),
      code: z.string().min(1).max(50).toUpperCase().optional(),
      description: z.string().max(255).optional(),
      discountType: z.enum(["percentage", "fixed"]).optional(),
      discountValue: z.string().optional(),
      maxUses: z.number().int().positive().optional(),
      minOrderAmount: z.string().optional(),
      appliesTo: z.enum(["all", "specific"]).optional(),
      courseId: z.number().int().positive().optional(),
      startsAt: z.string().optional(),
      expiresAt: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, startsAt, expiresAt, ...rest } = input;
      const updates: any = { ...rest };
      if (startsAt) updates.startsAt = new Date(startsAt);
      if (expiresAt) updates.expiresAt = new Date(expiresAt);
      const cleanUpdates = Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined));
      if (Object.keys(cleanUpdates).length === 0) return { success: true };
      await db.update(promoCodes).set(cleanUpdates).where(eq(promoCodes.id, id));
      return { success: true };
    }),

  delete: adminQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(promoCodes).set({ isActive: false }).where(eq(promoCodes.id, input.id));
      return { success: true };
    }),
});
