/**
 * Wishlist Router — bookmark courses for later
 */

import { courses, wishlists } from "@db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { authedQuery, authMutation, createRouter } from "./middleware";
import { getDb } from "./queries/connection";

export const wishlistRouter = createRouter({
  list: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const items = await db
      .select({
        wishlist: wishlists,
        courseId: courses.id,
        slug: courses.slug,
        titleEn: courses.titleEn,
        titleAr: courses.titleAr,
        thumbnail: courses.thumbnail,
        level: courses.level,
        isPremium: courses.isPremium,
        price: courses.price,
      })
      .from(wishlists)
      // ✅ SECURITY FIX (audit run-3, wishlist-list-unpublished-course-oracle):
      // the join previously had no isPublished predicate, so draft/withdrawn
      // course rows leaked their metadata (titles, price, thumbnail) to any
      // user who had an old wishlist row. Mirror the catalog visibility policy.
      .innerJoin(courses, and(eq(wishlists.courseId, courses.id), eq(courses.isPublished, true)))
      .where(eq(wishlists.userId, ctx.user.id))
      .orderBy(desc(wishlists.createdAt));
    return { items };
  }),

  add: authMutation
    .input(z.object({ courseId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      // ✅ SECURITY FIX (audit run-3, wishlist-add-unpublished-course-oracle):
      // bind user-authored rows only to published courses (same policy as
      // review.create) — arbitrary/sequential ids no longer become an
      // existence oracle for draft courses.
      const [course] = await db
        .select({ id: courses.id })
        .from(courses)
        .where(and(eq(courses.id, input.courseId), eq(courses.isPublished, true)))
        .limit(1);
      if (!course) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
      }
      // ✅ FIX (pre-launch audit): `.catch(() => {})` swallowed EVERY error —
      // a DB outage answered { success: true } while nothing was stored.
      // Only the duplicate-key case (already wishlisted) may fail soft.
      try {
        await db.insert(wishlists).values({
          userId: ctx.user.id,
          courseId: input.courseId,
        });
      } catch (err) {
        const code = (err as { code?: string }).code ?? "";
        if (code === "ER_DUP_ENTRY" || code === "23505" || /duplicate|unique/i.test(String(err))) {
          // Already wishlisted — idempotent no-op.
          return { success: true };
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not add to wishlist. Please try again." });
      }
      return { success: true };
    }),

  remove: authMutation
    .input(z.object({ courseId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      await db.delete(wishlists).where(
        sql`${wishlists.userId} = ${ctx.user.id} AND ${wishlists.courseId} = ${input.courseId}`
      );
      return { success: true };
    }),

  toggle: authMutation
    .input(z.object({ courseId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [existing] = await db
        .select()
        .from(wishlists)
        .where(
          sql`${wishlists.userId} = ${ctx.user.id} AND ${wishlists.courseId} = ${input.courseId}`
        )
        .limit(1);

      if (existing) {
        await db.delete(wishlists).where(eq(wishlists.id, existing.id));
        return { success: true, inWishlist: false };
      }
      // ✅ SECURITY FIX (audit run-3): same published-course binding as add().
      const [course] = await db
        .select({ id: courses.id })
        .from(courses)
        .where(and(eq(courses.id, input.courseId), eq(courses.isPublished, true)))
        .limit(1);
      if (!course) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
      }
      await db.insert(wishlists).values({
        userId: ctx.user.id,
        courseId: input.courseId,
      });
      return { success: true, inWishlist: true };
    }),

  check: authedQuery
    .input(z.object({ courseId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const [existing] = await db
        .select()
        .from(wishlists)
        .where(
          sql`${wishlists.userId} = ${ctx.user.id} AND ${wishlists.courseId} = ${input.courseId}`
        )
        .limit(1);
      return { inWishlist: !!existing };
    }),
});
