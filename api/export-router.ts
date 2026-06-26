import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { createRouter, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users, payments, enrollments, courses } from "@db/schema";

// ✅ FIX: Maximum rows per export request to prevent OOM (Out of Memory) crashes.
// If an admin needs to export more than 10,000 rows, they should use pagination
// or a background job. Loading 100K+ rows into memory will crash the server.
const MAX_EXPORT_ROWS = 10_000;

function escapeCsv(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const lines = [headers.map(escapeCsv).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsv).join(","));
  }
  return lines.join("\n");
}

export const exportRouter = createRouter({
  users: adminQuery
    .input(z.object({
      format: z.enum(["csv", "json"]).default("csv"),
      limit: z.number().int().min(1).max(MAX_EXPORT_ROWS).default(1000),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const limit = input?.limit ?? 1000;
      const offset = input?.offset ?? 0;

      const allUsers = await db.select({
        id: users.id,
        username: users.username,
        name: users.name,
        email: users.email,
        role: users.role,
        preferredLanguage: users.preferredLanguage,
        createdAt: users.createdAt,
        lastSignInAt: users.lastSignInAt,
      }).from(users).orderBy(desc(users.createdAt)).limit(limit).offset(offset);

      return {
        csv: toCsv(
          ["ID", "Username", "Name", "Email", "Role", "Language", "Created", "Last Sign In"],
          allUsers.map((u) => [u.id, u.username, u.name, u.email, u.role, u.preferredLanguage, u.createdAt?.toISOString(), u.lastSignInAt?.toISOString()])
        ),
        json: allUsers,
        count: allUsers.length,
        truncated: allUsers.length === limit,
        pagination: { limit, offset, hasMore: allUsers.length === limit },
      };
    }),

  payments: adminQuery
    .input(z.object({
      format: z.enum(["csv", "json"]).default("csv"),
      limit: z.number().int().min(1).max(MAX_EXPORT_ROWS).default(1000),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const limit = input?.limit ?? 1000;
      const offset = input?.offset ?? 0;

      const allPayments = await db.select({
        id: payments.id,
        userId: payments.userId,
        courseId: payments.courseId,
        amount: payments.amount,
        currency: payments.currency,
        paymentMethod: payments.paymentMethod,
        status: payments.status,
        createdAt: payments.createdAt,
      }).from(payments).orderBy(desc(payments.createdAt)).limit(limit).offset(offset);

      return {
        csv: toCsv(
          ["ID", "User ID", "Course ID", "Amount", "Currency", "Method", "Status", "Created"],
          allPayments.map((p) => [p.id, p.userId, p.courseId, p.amount, p.currency, p.paymentMethod, p.status, p.createdAt?.toISOString()])
        ),
        json: allPayments,
        count: allPayments.length,
        truncated: allPayments.length === limit,
        pagination: { limit, offset, hasMore: allPayments.length === limit },
      };
    }),

  enrollments: adminQuery
    .input(z.object({
      format: z.enum(["csv", "json"]).default("csv"),
      limit: z.number().int().min(1).max(MAX_EXPORT_ROWS).default(1000),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const limit = input?.limit ?? 1000;
      const offset = input?.offset ?? 0;

      const allEnrollments = await db
        .select({
          id: enrollments.id,
          userId: enrollments.userId,
          courseId: enrollments.courseId,
          status: enrollments.status,
          progress: enrollments.progress,
          enrolledAt: enrollments.enrolledAt,
          completedAt: enrollments.completedAt,
          userName: users.name,
          userUsername: users.username,
          courseTitle: courses.titleEn,
          courseSlug: courses.slug,
        })
        .from(enrollments)
        .leftJoin(users, eq(enrollments.userId, users.id))
        .leftJoin(courses, eq(enrollments.courseId, courses.id))
        .orderBy(desc(enrollments.enrolledAt))
        .limit(limit)
        .offset(offset);

      return {
        csv: toCsv(
          ["ID", "User", "Username", "Course", "Slug", "Status", "Progress", "Created", "Completed"],
          allEnrollments.map((e) => [e.id, e.userName, e.userUsername, e.courseTitle, e.courseSlug, e.status, e.progress, e.enrolledAt?.toISOString(), e.completedAt?.toISOString()])
        ),
        json: allEnrollments,
        count: allEnrollments.length,
        truncated: allEnrollments.length === limit,
        pagination: { limit, offset, hasMore: allEnrollments.length === limit },
      };
    }),

  courses: adminQuery
    .input(z.object({
      format: z.enum(["csv", "json"]).default("csv"),
      limit: z.number().int().min(1).max(MAX_EXPORT_ROWS).default(1000),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const limit = input?.limit ?? 1000;
      const offset = input?.offset ?? 0;

      const allCourses = await db.select({
        id: courses.id,
        slug: courses.slug,
        titleEn: courses.titleEn,
        titleAr: courses.titleAr,
        price: courses.price,
        isFeatured: courses.isFeatured,
        isPublished: courses.isPublished,
        level: courses.level,
        studentCount: courses.studentCount,
        createdAt: courses.createdAt,
      }).from(courses).orderBy(desc(courses.createdAt)).limit(limit).offset(offset);

      return {
        csv: toCsv(
          ["ID", "Slug", "Title EN", "Title AR", "Price", "Currency", "Featured", "Published", "Level", "Students", "Created"],
          allCourses.map((c) => [c.id, c.slug, c.titleEn, c.titleAr, c.price, "EGP", c.isFeatured, c.isPublished, c.level, c.studentCount, c.createdAt?.toISOString()])
        ),
        json: allCourses,
        count: allCourses.length,
        truncated: allCourses.length === limit,
        pagination: { limit, offset, hasMore: allCourses.length === limit },
      };
    }),
});
