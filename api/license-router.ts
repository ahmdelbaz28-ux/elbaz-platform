import { z } from "zod";
import { desc, eq, and, count } from "drizzle-orm";
import { createRouter, authQuery, adminMutation, publicMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { licenses, users, courses } from "@db/schema";
import { randomBytes } from "crypto";

function generateLicenseKey(): string {
  const segments = [];
  for (let i = 0; i < 4; i++) {
    segments.push(randomBytes(4).toString("hex").toUpperCase());
  }
  return segments.join("-");
}

export const licenseRouter = createRouter({
  myLicenses: authQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db
      .select({
        id: licenses.id,
        licenseKey: licenses.licenseKey,
        type: licenses.type,
        status: licenses.status,
        validFrom: licenses.validFrom,
        validUntil: licenses.validUntil,
        maxDevices: licenses.maxDevices,
        activatedAt: licenses.activatedAt,
        createdAt: licenses.createdAt,
        courseTitle: courses.titleEn,
        courseSlug: courses.slug,
      })
      .from(licenses)
      .leftJoin(courses, eq(licenses.courseId, courses.id))
      .where(eq(licenses.userId, ctx.user.id))
      .orderBy(desc(licenses.createdAt));
  }),

  validate: publicMutation
    .input(z.object({ licenseKey: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [license] = await db
        .select({
          id: licenses.id,
          userId: licenses.userId,
          courseId: licenses.courseId,
          type: licenses.type,
          status: licenses.status,
          validFrom: licenses.validFrom,
          validUntil: licenses.validUntil,
          maxDevices: licenses.maxDevices,
          activatedAt: licenses.activatedAt,
          userName: users.name,
          userUsername: users.username,
          courseTitle: courses.titleEn,
        })
        .from(licenses)
        .leftJoin(users, eq(licenses.userId, users.id))
        .leftJoin(courses, eq(licenses.courseId, courses.id))
        .where(eq(licenses.licenseKey, input.licenseKey))
        .limit(1);

      if (!license) return { valid: false, reason: "Invalid license key" };
      if (license.status !== "active") return { valid: false, reason: `License is ${license.status}` };

      const now = new Date();
      if (license.validUntil && now > license.validUntil) return { valid: false, reason: "License expired" };
      if (now < license.validFrom) return { valid: false, reason: "License not yet valid" };

      return {
        valid: true,
        license: {
          type: license.type,
          courseTitle: license.courseTitle,
          userName: license.userName,
          maxDevices: license.maxDevices,
          validUntil: license.validUntil,
        },
      };
    }),

  adminList: adminMutation
    .input(z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
      status: z.enum(["active", "revoked", "expired"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const page = input?.page ?? 1;
      const limit = input?.limit ?? 20;
      const offset = (page - 1) * limit;
      const conditions = [];
      if (input?.status) conditions.push(eq(licenses.status, input.status));

      const [[{ total }], items] = await Promise.all([
        db.select({ total: count() }).from(licenses).where(conditions.length > 0 ? and(...conditions) : undefined),
        db.select({
          id: licenses.id,
          licenseKey: licenses.licenseKey,
          type: licenses.type,
          status: licenses.status,
          validFrom: licenses.validFrom,
          validUntil: licenses.validUntil,
          maxDevices: licenses.maxDevices,
          activatedAt: licenses.activatedAt,
          createdAt: licenses.createdAt,
          userName: users.name,
          userUsername: users.username,
          courseTitle: courses.titleEn,
        })
          .from(licenses)
          .leftJoin(users, eq(licenses.userId, users.id))
          .leftJoin(courses, eq(licenses.courseId, courses.id))
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(licenses.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      return { items, total: total ?? 0 };
    }),

  create: adminMutation
    .input(z.object({
      userId: z.number(),
      courseId: z.number().optional(),
      type: z.string().default("course"),
      validUntil: z.string().optional(),
      maxDevices: z.number().int().default(3),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const licenseKey = generateLicenseKey();
      const [license] = await db.insert(licenses).values({
        userId: input.userId,
        courseId: input.courseId || null,
        licenseKey,
        type: input.type,
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
        maxDevices: input.maxDevices,
      });
      return { success: true, id: Number(license.insertId), licenseKey };
    }),

  revoke: adminMutation
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(licenses).set({ status: "revoked" }).where(eq(licenses.id, input.id));
      return { success: true };
    }),
});
