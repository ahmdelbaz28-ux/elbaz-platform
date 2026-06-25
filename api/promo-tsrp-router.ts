import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { createRouter, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { promoCodes } from "@db/schema";
import { TRPCError } from "@trpc/server";

export const promoRouter = createRouter({
  // ═══════════════════════════════════════════════
  // ADMIN: List all promo codes with computed status
  // ═══════════════════════════════════════════════
  list: adminQuery.query(async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(promoCodes)
      .orderBy(desc(promoCodes.createdAt));

    const now = new Date();

    return rows.map((r) => {
      let status: "scheduled" | "active" | "expired" | "used_up" = "active";

      if (!r.isActive) {
        status = "expired";
      } else if (r.validFrom && r.validFrom > now) {
        status = "scheduled";
      } else if (r.validUntil && r.validUntil < now) {
        status = "expired";
      } else if (r.maxUses !== null && r.usedCount >= r.maxUses) {
        status = "used_up";
      }

      return {
        id: String(r.id),
        code: r.code,
        discount: Number(r.discountValue),
        type: r.discountType as "percentage" | "fixed",
        maxUses: r.maxUses ?? 0,
        usedCount: r.usedCount ?? 0,
        status,
        validFrom: r.validFrom instanceof Date ? r.validFrom.toISOString() : String(r.validFrom ?? ""),
        validUntil: r.validUntil instanceof Date ? r.validUntil.toISOString() : (r.validUntil ? String(r.validUntil) : ""),
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      };
    });
  }),

  // ═══════════════════════════════════════════════
  // ADMIN: Create a promo code
  // ═══════════════════════════════════════════════
  create: adminQuery
    .input(
      z.object({
        code: z.string().min(2).max(50),
        discount: z.number().positive(),
        type: z.enum(["percentage", "fixed"]),
        maxUses: z.number().int().positive(),
        expiresAt: z.string().optional(),
        validFrom: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user?.id) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      const db = getDb();

      // Check for duplicate code
      const existing = await db
        .select({ id: promoCodes.id })
        .from(promoCodes)
        .where(eq(promoCodes.code, input.code))
        .limit(1);

      if (existing.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Promo code already exists" });
      }

      const validFrom = input.validFrom ? new Date(input.validFrom) : new Date();
      const validUntil = input.expiresAt ? new Date(input.expiresAt) : null;

      await db.insert(promoCodes).values({
        code: input.code.toUpperCase(),
        discountType: input.type,
        discountValue: String(input.discount),
        maxUses: input.maxUses,
        validFrom,
        validUntil,
        createdBy: ctx.user.id,
        isActive: true,
      });

      return { success: true };
    }),

  // ═══════════════════════════════════════════════
  // ADMIN: Update a promo code
  // ═══════════════════════════════════════════════
  update: adminQuery
    .input(
      z.object({
        id: z.number(),
        code: z.string().min(2).max(50).optional(),
        discount: z.number().positive().optional(),
        type: z.enum(["percentage", "fixed"]).optional(),
        maxUses: z.number().int().positive().optional(),
        expiresAt: z.string().optional(),
        validFrom: z.string().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      // Build dynamic update object
      const updateData: Record<string, unknown> = {};

      if (input.code !== undefined) updateData.code = input.code.toUpperCase();
      if (input.type !== undefined) updateData.discountType = input.type;
      if (input.discount !== undefined) updateData.discountValue = String(input.discount);
      if (input.maxUses !== undefined) updateData.maxUses = input.maxUses;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;
      if (input.validFrom !== undefined) updateData.validFrom = new Date(input.validFrom);
      if (input.expiresAt !== undefined) {
        updateData.validUntil = input.expiresAt ? new Date(input.expiresAt) : null;
      }

      if (Object.keys(updateData).length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No fields to update" });
      }

      await db
        .update(promoCodes)
        .set(updateData)
        .where(eq(promoCodes.id, input.id));

      return { success: true };
    }),

  // ═══════════════════════════════════════════════
  // ADMIN: Soft-delete a promo code (set isActive=false)
  // ═══════════════════════════════════════════════
  delete: adminQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(promoCodes)
        .set({ isActive: false })
        .where(eq(promoCodes.id, input.id));

      return { success: true };
    }),
});
