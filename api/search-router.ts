/**
 * Search Router — global search across courses, references, FAQ
 */
import { z } from "zod";
import { eq, like, or, and } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { courses, referenceFiles, faqEntries } from "@db/schema";

export const searchRouter = createRouter({
  global: publicQuery
    .input(z.object({
      query: z.string().min(1).max(200),
      limit: z.number().int().min(1).max(20).default(5),
    }))
    .query(async ({ input }) => {
      const db = getDb();
      const term = `%${input.query}%`;
      const limit = input.limit;

      // Search courses
      const courseResults = await db
        .select({
          id: courses.id,
          slug: courses.slug,
          titleEn: courses.titleEn,
          titleAr: courses.titleAr,
          thumbnail: courses.thumbnail,
          level: courses.level,
          isPremium: courses.isPremium,
          price: courses.price,
        })
        .from(courses)
        .where(and(
          eq(courses.isPublished, true),
          or(
            like(courses.titleEn, term),
            like(courses.titleAr, term),
            like(courses.shortDescEn, term),
            like(courses.shortDescAr, term),
          )!,
        ))
        .limit(limit);

      // Search reference files
      const referenceResults = await db
        .select({
          id: referenceFiles.id,
          title: referenceFiles.title,
          description: referenceFiles.description,
          fileName: referenceFiles.fileName,
          fileType: referenceFiles.fileType,
          category: referenceFiles.category,
        })
        .from(referenceFiles)
        .where(and(
          eq(referenceFiles.isPublished, true),
          or(
            like(referenceFiles.title, term),
            like(referenceFiles.description, term),
            like(referenceFiles.fileName, term),
          )!,
        ))
        .limit(limit);

      // Search FAQ
      const faqResults = await db
        .select({
          id: faqEntries.id,
          questionEn: faqEntries.questionEn,
          questionAr: faqEntries.questionAr,
          answerEn: faqEntries.answerEn,
          answerAr: faqEntries.answerAr,
          category: faqEntries.category,
        })
        .from(faqEntries)
        .where(and(
          eq(faqEntries.isPublished, true),
          or(
            like(faqEntries.questionEn, term),
            like(faqEntries.questionAr, term),
            like(faqEntries.answerEn, term),
            like(faqEntries.answerAr, term),
          )!,
        ))
        .limit(limit);

      return {
        courses: courseResults,
        references: referenceResults,
        faqs: faqResults,
        total: courseResults.length + referenceResults.length + faqResults.length,
      };
    }),
});
