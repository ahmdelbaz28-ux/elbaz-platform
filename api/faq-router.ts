/**
 * FAQ Router — tRPC procedures for FAQ entries
 */
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { createRouter, publicQuery, publicMutation, adminMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { faqEntries } from "@db/schema";

export const faqRouter = createRouter({
  list: publicQuery
    .input(z.object({
      category: z.string().optional(),
      search: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      let query = db
        .select()
        .from(faqEntries)
        .where(eq(faqEntries.isPublished, true))
        .orderBy(faqEntries.sortOrder, desc(faqEntries.createdAt));

      const items = await query;
      let filtered = items;

      if (input?.category && input.category !== "all") {
        filtered = filtered.filter((i) => i.category === input.category);
      }

      if (input?.search) {
        const term = input.search.toLowerCase();
        filtered = filtered.filter((i) =>
          i.questionEn.toLowerCase().includes(term) ||
          i.questionAr.toLowerCase().includes(term) ||
          i.answerEn.toLowerCase().includes(term) ||
          i.answerAr.toLowerCase().includes(term)
        );
      }

      return { items: filtered, total: filtered.length };
    }),

  categories: publicQuery.query(async () => {
    const db = getDb();
    const rows = await db
      .selectDistinct({ category: faqEntries.category })
      .from(faqEntries)
      .where(eq(faqEntries.isPublished, true));
    return rows.map((r) => r.category).filter(Boolean) as string[];
  }),

  incrementView: publicMutation
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(faqEntries)
        .set({ viewCount: sql`${faqEntries.viewCount} + 1` })
        .where(eq(faqEntries.id, input.id));
      return { success: true };
    }),

  create: adminMutation
    .input(z.object({
      questionEn: z.string().min(1).max(500),
      questionAr: z.string().min(1).max(500),
      answerEn: z.string().min(1),
      answerAr: z.string().min(1),
      category: z.string().max(100).default("general"),
      sortOrder: z.number().int().default(0),
      isPublished: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [result] = await db.insert(faqEntries).values(input);
      return { success: true, id: Number(result.insertId) };
    }),

  update: adminMutation
    .input(z.object({
      id: z.number().int().positive(),
      questionEn: z.string().max(500).optional(),
      questionAr: z.string().max(500).optional(),
      answerEn: z.string().optional(),
      answerAr: z.string().optional(),
      category: z.string().max(100).optional(),
      sortOrder: z.number().int().optional(),
      isPublished: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...updates } = input;
      const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length === 0) return { success: true };
      await db.update(faqEntries).set(clean).where(eq(faqEntries.id, id));
      return { success: true };
    }),

  delete: adminMutation
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(faqEntries).where(eq(faqEntries.id, input.id));
      return { success: true };
    }),
});
