/**
 * Wishlist Router — bookmark courses for later
 */
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { createRouter, authedQuery, authMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { wishlists, courses } from "@db/schema";

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
      .innerJoin(courses, eq(wishlists.courseId, courses.id))
      .where(eq(wishlists.userId, ctx.user.id))
      .orderBy(desc(wishlists.createdAt));
    return { items };
  }),

  add: authMutation
    .input(z.object({ courseId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      await db.insert(wishlists).values({
        userId: ctx.user.id,
        courseId: input.courseId,
      }).catch(() => { /* unique constraint — already in wishlist */ });
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
