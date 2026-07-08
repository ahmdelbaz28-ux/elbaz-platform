/**
 * ADMIN COURSES — Course management endpoints
 *
 * Procedures: listCourses (paginated), updateCourse
 */

import { z } from "zod";
import { desc, eq, count } from "drizzle-orm";
import { adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { courses } from "@db/schema";

export const adminCoursesProcedures = {
  listCourses: adminQuery
    .input(z.object({ page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const page = input?.page ?? 1;
      const limit = input?.limit ?? 20;
      const offset = (page - 1) * limit;

      const [[{ total }], items] = await Promise.all([
        db.select({ total: count() }).from(courses),
        db.select({
          id: courses.id,
          slug: courses.slug,
          titleEn: courses.titleEn,
          titleAr: courses.titleAr,
          descriptionEn: courses.descriptionEn,
          descriptionAr: courses.descriptionAr,
          thumbnailUrl: courses.thumbnail,
          price: courses.price,
          isFeatured: courses.isFeatured,
          isPublished: courses.isPublished,
          level: courses.level,
          category: courses.categoryId,
          studentCount: courses.studentCount,
          createdAt: courses.createdAt,
          updatedAt: courses.updatedAt,
        })
          .from(courses)
          .orderBy(desc(courses.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      return { items, total: total ?? 0 };
    }),

  updateCourse: adminQuery
    .input(z.object({
      id: z.number().int().positive(),
      titleEn: z.string().max(500).optional(),
      titleAr: z.string().max(500).optional(),
      descriptionEn: z.string().optional(),
      descriptionAr: z.string().optional(),
      thumbnailUrl: z.string().max(1000).optional(),
      price: z.number().optional(),
      isFeatured: z.boolean().optional(),
      isPublished: z.boolean().optional(),
      level: z.enum(["beginner", "intermediate", "advanced"]).optional(),
      categoryId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...updates } = input;
      const cleanUpdates = Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined));
      if (Object.keys(cleanUpdates).length === 0) return { success: true };
      await db.update(courses).set({ ...cleanUpdates, updatedAt: new Date() }).where(eq(courses.id, id));
      return { success: true };
    }),
};
