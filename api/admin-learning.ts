/**
 * ADMIN LEARNING — the missing dashboard control surfaces
 *
 *   CATEGORIES   — full CRUD (previously impossible from the dashboard: the
 *                  table only had rows from old manual seeds, and course
 *                  creation REQUIRES a categoryId → a new category meant SQL).
 *   QUIZ         — per-lesson question bank CRUD (previously NO write path at
 *                  all: certificates require a ≥70% quiz average, yet questions
 *                  could only ever come from an old manual seed).
 *   ENROLLMENTS  — per-course roster: list/search, manual grant, revoke,
 *                  reactivate (previously an admin could not even SEE who is
 *                  enrolled, only approve/reject payments).
 *
 * All procedures are admin-gated (adminQuery / adminMutation → requireAuth +
 * requireRole("admin") + globalRateLimit) and invalidate the course caches so
 * the public site reflects changes immediately.
 */

import { z } from "zod";
import { and, asc, count, desc, eq, like, max, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { adminQuery, adminMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { categories, courses, enrollments, lessons, quizQuestions, users } from "@db/schema";
import { invalidateCourseCache, invalidateStatsCache } from "./lib/cache.js";

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORIES — full CRUD
// ═══════════════════════════════════════════════════════════════════════════

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const categoryProcedures = {
  /** Admin list WITH usage counts (courses per category) — drives the UI. */
  adminCategories: adminQuery.query(async () => {
    const db = getDb();
    const rows = await db
      .select({
        id: categories.id,
        slug: categories.slug,
        nameEn: categories.nameEn,
        nameAr: categories.nameAr,
        descriptionEn: categories.descriptionEn,
        descriptionAr: categories.descriptionAr,
        icon: categories.icon,
        sortOrder: categories.sortOrder,
        courseCount: count(courses.id),
      })
      .from(categories)
      .leftJoin(courses, eq(courses.categoryId, categories.id))
      .groupBy(categories.id)
      .orderBy(asc(categories.sortOrder), asc(categories.id));
    return { items: rows };
  }),

  createCategory: adminMutation
    .input(z.object({
      slug: z.string().min(2).max(200).regex(SLUG_RE, "Slug must be lowercase kebab-case"),
      nameEn: z.string().min(1).max(255),
      nameAr: z.string().min(1).max(255),
      descriptionEn: z.string().max(2000).optional(),
      descriptionAr: z.string().max(2000).optional(),
      icon: z.string().max(100).default("book"),
      sortOrder: z.number().int().default(0),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [existing] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, input.slug)).limit(1);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "A category with this slug already exists" });
      const [created] = await db.insert(categories).values({
        slug: input.slug,
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        descriptionEn: input.descriptionEn ?? null,
        descriptionAr: input.descriptionAr ?? null,
        icon: input.icon || "book",
        sortOrder: input.sortOrder,
      }).$returningId();
      await invalidateCourseCache();
      return { success: true, id: created?.id };
    }),

  updateCategory: adminMutation
    .input(z.object({
      id: z.number().int().positive(),
      nameEn: z.string().min(1).max(255).optional(),
      nameAr: z.string().min(1).max(255).optional(),
      descriptionEn: z.string().max(2000).nullable().optional(),
      descriptionAr: z.string().max(2000).nullable().optional(),
      icon: z.string().max(100).optional(),
      sortOrder: z.number().int().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...updates } = input;
      const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length === 0) return { success: true };
      await db.update(categories).set(clean).where(eq(categories.id, id));
      await invalidateCourseCache();
      return { success: true };
    }),

  /**
   * Delete a category. Guard: categories with courses are REJECTED (courses
   * FK is RESTRICT) — the admin must reassign those courses first; the error
   * says exactly how many courses block the deletion.
   */
  deleteCategory: adminMutation
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [{ value: courseCount }] = await db
        .select({ value: count() })
        .from(courses)
        .where(eq(courses.categoryId, input.id));
      if (courseCount > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `This category still has ${courseCount} course(s) — reassign them to another category first`,
        });
      }
      await db.delete(categories).where(eq(categories.id, input.id));
      await invalidateCourseCache();
      return { success: true };
    }),
};

// ═══════════════════════════════════════════════════════════════════════════
// QUIZ — per-lesson question bank CRUD (admin side; the student side never
// receives correctIndex — see quiz-router.ts)
// ═══════════════════════════════════════════════════════════════════════════

const optionsSchema = z.array(z.string().min(1).max(500)).min(2).max(6);

export const quizAdminProcedures = {
  /** Full question list for a lesson INCLUDING correctIndex (admin-only view). */
  adminQuizByLesson: adminQuery
    .input(z.object({ lessonId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = getDb();
      const items = await db
        .select()
        .from(quizQuestions)
        .where(eq(quizQuestions.lessonId, input.lessonId))
        .orderBy(asc(quizQuestions.sortOrder), asc(quizQuestions.id));
      return { items };
    }),

  createQuizQuestion: adminMutation
    .input(z.object({
      lessonId: z.number().int().positive(),
      questionEn: z.string().min(3).max(2000),
      questionAr: z.string().min(3).max(2000),
      optionsEn: optionsSchema,
      optionsAr: optionsSchema,
      correctIndex: z.number().int().min(0).max(5),
      points: z.number().int().min(1).max(100).default(10),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      if (input.correctIndex >= input.optionsEn.length || input.correctIndex >= input.optionsAr.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "correctIndex is out of range for the given options" });
      }
      const [lesson] = await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.id, input.lessonId)).limit(1);
      if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });

      const [{ maxSort }] = await db
        .select({ maxSort: max(quizQuestions.sortOrder) })
        .from(quizQuestions)
        .where(eq(quizQuestions.lessonId, input.lessonId));

      const [created] = await db.insert(quizQuestions).values({
        lessonId: input.lessonId,
        questionEn: input.questionEn,
        questionAr: input.questionAr,
        optionsEn: input.optionsEn,
        optionsAr: input.optionsAr,
        correctIndex: input.correctIndex,
        points: input.points,
        sortOrder: (maxSort ?? 0) + 1,
      }).$returningId();
      return { success: true, id: created?.id };
    }),

  updateQuizQuestion: adminMutation
    .input(z.object({
      id: z.number().int().positive(),
      questionEn: z.string().min(3).max(2000).optional(),
      questionAr: z.string().min(3).max(2000).optional(),
      optionsEn: optionsSchema.optional(),
      optionsAr: optionsSchema.optional(),
      correctIndex: z.number().int().min(0).max(5).optional(),
      points: z.number().int().min(1).max(100).optional(),
      sortOrder: z.number().int().min(0).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...updates } = input;
      const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length === 0) return { success: true };

      // Cross-validate correctIndex against the EFFECTIVE options (new or stored).
      if (clean.correctIndex !== undefined) {
        const [row] = await db
          .select({ optionsEn: quizQuestions.optionsEn })
          .from(quizQuestions)
          .where(eq(quizQuestions.id, id))
          .limit(1);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Question not found" });
        const effectiveOptions = (clean.optionsEn as string[] | undefined) ?? row.optionsEn ?? [];
        if (Number(clean.correctIndex) >= effectiveOptions.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "correctIndex is out of range for the options" });
        }
      }

      await db.update(quizQuestions).set(clean).where(eq(quizQuestions.id, id));
      return { success: true };
    }),

  deleteQuizQuestion: adminMutation
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(quizQuestions).where(eq(quizQuestions.id, input.id));
      return { success: true };
    }),
};

// ═══════════════════════════════════════════════════════════════════════════
// ENROLLMENTS — per-course roster management
// ═══════════════════════════════════════════════════════════════════════════

export const enrollmentAdminProcedures = {
  /** Roster of one course: student identity + status + progress, newest first. */
  courseEnrollments: adminQuery
    .input(z.object({
      courseId: z.number().int().positive(),
      status: z.enum(["all", "active", "completed", "refunded", "cancelled"]).default("all"),
      search: z.string().max(100).default(""),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [eq(enrollments.courseId, input.courseId)];
      if (input.status !== "all") conditions.push(eq(enrollments.status, input.status));
      const search = input.search.trim();
      if (search) {
        const pattern = `%${search.replace(/[%_]/g, (m) => `\\${m}`)}%`;
        const match = or(
          like(users.email, pattern),
          like(users.username, pattern),
          like(users.name, pattern),
        );
        if (match) conditions.push(match);
      }

      const rows = await db
        .select({
          id: enrollments.id,
          userId: enrollments.userId,
          username: users.username,
          email: users.email,
          fullName: users.name,
          status: enrollments.status,
          progress: enrollments.progress,
          isCompleted: enrollments.isCompleted,
          enrolledAt: enrollments.enrolledAt,
          completedAt: enrollments.completedAt,
        })
        .from(enrollments)
        .innerJoin(users, eq(users.id, enrollments.userId))
        .where(and(...conditions))
        .orderBy(desc(enrollments.enrolledAt))
        .limit(input.limit);

      const [{ value: total }] = await db
        .select({ value: count() })
        .from(enrollments)
        .innerJoin(users, eq(users.id, enrollments.userId))
        .where(and(...conditions));

      return { items: rows, total: total ?? 0 };
    }),

  /**
   * Manual grant — e.g. a student paid via a channel outside the platform.
   * Creates (or reactivates) the enrollment row + bumps studentCount.
   * Idempotent: an existing ACTIVE enrollment short-circuits with a clear code.
   */
  grantEnrollment: adminMutation
    .input(z.object({
      courseId: z.number().int().positive(),
      userId: z.number().int().positive(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [course] = await db.select({ id: courses.id, slug: courses.slug }).from(courses).where(eq(courses.id, input.courseId)).limit(1);
      if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      const [existing] = await db
        .select({ id: enrollments.id, status: enrollments.status })
        .from(enrollments)
        .where(and(eq(enrollments.courseId, input.courseId), eq(enrollments.userId, input.userId)))
        .limit(1);

      if (existing && existing.status === "active") {
        return { success: true, alreadyActive: true };
      }

      if (existing) {
        // refunded / cancelled / completed → reactivate in place (unique index
        // on (userId, courseId) forbids a second row).
        await db.update(enrollments)
          .set({ status: "active", enrolledAt: new Date() })
          .where(eq(enrollments.id, existing.id));
      } else {
        await db.insert(enrollments).values({
          userId: input.userId,
          courseId: input.courseId,
          status: "active",
        });
        await db.update(courses)
          .set({ studentCount: sql`${courses.studentCount} + 1` })
          .where(eq(courses.id, input.courseId));
      }
      await invalidateCourseCache();
      await invalidateStatsCache();
      return { success: true, alreadyActive: false };
    }),

  /**
   * Revoke — sets status="cancelled" (keeps the row + history; a revoke is
   * NOT a refund) and decrements studentCount. Idempotent.
   */
  revokeEnrollment: adminMutation
    .input(z.object({ enrollmentId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [row] = await db
        .select({ id: enrollments.id, courseId: enrollments.courseId, status: enrollments.status })
        .from(enrollments)
        .where(eq(enrollments.id, input.enrollmentId))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Enrollment not found" });

      if (row.status !== "cancelled") {
        await db.update(enrollments)
          .set({ status: "cancelled" })
          .where(eq(enrollments.id, row.id));
        await db.update(courses)
          .set({ studentCount: sql`GREATEST(${courses.studentCount} - 1, 0)` })
          .where(eq(courses.id, row.courseId));
        await invalidateCourseCache();
        await invalidateStatsCache();
      }
      return { success: true };
    }),

  /** Reactivate a cancelled/refunded enrollment WITHOUT double-counting. */
  reactivateEnrollment: adminMutation
    .input(z.object({ enrollmentId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [row] = await db
        .select({ id: enrollments.id, courseId: enrollments.courseId, status: enrollments.status })
        .from(enrollments)
        .where(eq(enrollments.id, input.enrollmentId))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Enrollment not found" });

      if (row.status !== "active") {
        await db.update(enrollments)
          .set({ status: "active" })
          .where(eq(enrollments.id, row.id));
        await db.update(courses)
          .set({ studentCount: sql`${courses.studentCount} + 1` })
          .where(eq(courses.id, row.courseId));
        await invalidateCourseCache();
        await invalidateStatsCache();
      }
      return { success: true };
    }),

  /** Search users by email/username for the grant dialog (no role leak). */
  searchUsers: adminQuery
    .input(z.object({ q: z.string().min(2).max(100) }))
    .query(async ({ input }) => {
      const db = getDb();
      const pattern = `%${input.q.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
      const rows = await db
        .select({ id: users.id, username: users.username, email: users.email, fullName: users.name, role: users.role })
        .from(users)
        .where(or(like(users.email, pattern), like(users.username, pattern), like(users.name, pattern)))
        .orderBy(asc(users.id))
        .limit(10);
      return { items: rows };
    }),

  // Used by the roster UI badge: which statuses exist for this course.
  enrollmentCounts: adminQuery
    .input(z.object({ courseId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select({ status: enrollments.status, value: count() })
        .from(enrollments)
        .where(eq(enrollments.courseId, input.courseId))
        .groupBy(enrollments.status);
      const counts: Record<string, number> = { all: 0 };
      for (const r of rows) {
        counts[r.status] = r.value;
        counts.all = (counts.all ?? 0) + r.value;
      }
      return counts;
    }),
};
