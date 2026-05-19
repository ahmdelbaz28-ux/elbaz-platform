import { z } from "zod";
import { desc, eq, count } from "drizzle-orm";
import { createRouter, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users, payments, enrollments, courses } from "@db/schema";

function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(escapeCsv).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsv).join(","));
  }
  return lines.join("\n");
}

export const exportRouter = createRouter({
  users: adminQuery
    .input(z.object({ format: z.enum(["csv", "json"]).default("csv") }).optional())
    .query(async () => {
      const db = getDb();
      const allUsers = await db.select({
        id: users.id,
        username: users.username,
        name: users.name,
        email: users.email,
        role: users.role,
        preferredLanguage: users.preferredLanguage,
        createdAt: users.createdAt,
        lastSignInAt: users.lastSignInAt,
      }).from(users).orderBy(desc(users.createdAt));

      return {
        csv: toCsv(
          ["ID", "Username", "Name", "Email", "Role", "Language", "Created", "Last Sign In"],
          allUsers.map((u) => [u.id, u.username, u.name, u.email, u.role, u.preferredLanguage, u.createdAt?.toISOString(), u.lastSignInAt?.toISOString()])
        ),
        json: allUsers,
        count: allUsers.length,
      };
    }),

  payments: adminQuery
    .input(z.object({ format: z.enum(["csv", "json"]).default("csv") }).optional())
    .query(async () => {
      const db = getDb();
      const allPayments = await db.select().from(payments).orderBy(desc(payments.createdAt));

      return {
        csv: toCsv(
          ["ID", "User ID", "Course ID", "Amount", "Currency", "Method", "Status", "Created"],
          allPayments.map((p) => [p.id, p.userId, p.courseId, p.amount, p.currency, p.paymentMethod, p.status, p.createdAt?.toISOString()])
        ),
        json: allPayments,
        count: allPayments.length,
      };
    }),

  enrollments: adminQuery
    .input(z.object({ format: z.enum(["csv", "json"]).default("csv") }).optional())
    .query(async () => {
      const db = getDb();
      const allEnrollments = await db
        .select({
          id: enrollments.id,
          userId: enrollments.userId,
          courseId: enrollments.courseId,
          status: enrollments.status,
          progress: enrollments.progress,
          createdAt: enrollments.createdAt,
          completedAt: enrollments.completedAt,
          userName: users.name,
          userUsername: users.username,
          courseTitle: courses.titleEn,
          courseSlug: courses.slug,
        })
        .from(enrollments)
        .leftJoin(users, eq(enrollments.userId, users.id))
        .leftJoin(courses, eq(enrollments.courseId, courses.id))
        .orderBy(desc(enrollments.createdAt));

      return {
        csv: toCsv(
          ["ID", "User", "Username", "Course", "Slug", "Status", "Progress", "Created", "Completed"],
          allEnrollments.map((e) => [e.id, e.userName, e.userUsername, e.courseTitle, e.courseSlug, e.status, e.progress, e.createdAt?.toISOString(), e.completedAt?.toISOString()])
        ),
        json: allEnrollments,
        count: allEnrollments.length,
      };
    }),

  courses: adminQuery
    .input(z.object({ format: z.enum(["csv", "json"]).default("csv") }).optional())
    .query(async () => {
      const db = getDb();
      const allCourses = await db.select({
        id: courses.id,
        slug: courses.slug,
        titleEn: courses.titleEn,
        titleAr: courses.titleAr,
        price: courses.price,
        currency: courses.currency,
        isFeatured: courses.isFeatured,
        isPublished: courses.isPublished,
        level: courses.level,
        studentCount: courses.studentCount,
        createdAt: courses.createdAt,
      }).from(courses).orderBy(desc(courses.createdAt));

      return {
        csv: toCsv(
          ["ID", "Slug", "Title EN", "Title AR", "Price", "Currency", "Featured", "Published", "Level", "Students", "Created"],
          allCourses.map((c) => [c.id, c.slug, c.titleEn, c.titleAr, c.price, c.currency, c.isFeatured, c.isPublished, c.level, c.studentCount, c.createdAt?.toISOString()])
        ),
        json: allCourses,
        count: allCourses.length,
      };
    }),
});
