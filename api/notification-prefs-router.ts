/**
 * Notification Preferences Router — user notification settings
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import { createRouter, authedQuery, authMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { notificationPreferences } from "@db/schema";

const DEFAULT_PREFS = {
  emailNewCourses: true,
  emailPromotions: true,
  emailLessonReplies: true,
  emailCertificates: true,
  pushNewCourses: true,
  pushPromotions: false,
  pushLessonReplies: true,
  pushCertificates: true,
};

export const notificationPrefsRouter = createRouter({
  get: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const [prefs] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, ctx.user.id))
      .limit(1);

    if (!prefs) {
      return DEFAULT_PREFS;
    }
    return prefs;
  }),

  update: authMutation
    .input(z.object({
      emailNewCourses: z.boolean().optional(),
      emailPromotions: z.boolean().optional(),
      emailLessonReplies: z.boolean().optional(),
      emailCertificates: z.boolean().optional(),
      pushNewCourses: z.boolean().optional(),
      pushPromotions: z.boolean().optional(),
      pushLessonReplies: z.boolean().optional(),
      pushCertificates: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [existing] = await db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, ctx.user.id))
        .limit(1);

      const cleanInput = Object.fromEntries(
        Object.entries(input).filter(([, v]) => v !== undefined),
      );

      if (existing) {
        await db.update(notificationPreferences)
          .set(cleanInput)
          .where(eq(notificationPreferences.userId, ctx.user.id));
      } else {
        await db.insert(notificationPreferences).values({
          userId: ctx.user.id,
          ...DEFAULT_PREFS,
          ...cleanInput,
        });
      }
      return { success: true };
    }),
});
