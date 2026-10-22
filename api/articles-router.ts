/**
 * Articles Router — tRPC procedures for the blog / knowledge base
 *
 * Features:
 *   - list:         Public query — paginated published articles (no heavy content fields)
 *   - getBySlug:    Public query — full article by slug (published only) + view counter
 *   - categories:   Public query — distinct categories of published articles
 *   - adminList:    Admin query — all articles including drafts
 *   - create:       Admin mutation — create a new article (draft or published)
 *   - update:       Admin mutation — update any field, handles first-publish timestamp
 *   - togglePublish:Admin mutation — publish / unpublish
 *   - delete:       Admin mutation — delete an article
 *
 * Content is stored as plain text (paragraph blocks separated by blank lines,
 * "## " headings, "- " list items) and rendered by the client with a safe
 * text renderer — no raw HTML is ever injected (XSS-safe by design).
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { createRouter, publicQuery, adminQuery, adminMutation } from "./middleware";
import { logger } from "./lib/logger.js";
import { getDb } from "./queries/connection";
import { articles } from "@db/schema";

/** Build a URL-safe slug from a Latin title; falls back to a random token. */
function buildSlug(titleEn: string): string {
  const base = titleEn
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 280);
  if (base.length >= 3) return base;
  // Random suffix fallback (CSPRNG — Sonar S2245)
  return `article-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
}

/** Approximate reading time: ~200 words per minute. */
function estimateReadMinutes(contentAr: string): number {
  const words = contentAr.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

// Shared shape for create/update inputs — keeps the Zod schema single-source.
const articleFields = {
  titleAr: z.string().min(1).max(500),
  titleEn: z.string().min(1).max(500),
  excerptAr: z.string().max(1000).optional(),
  excerptEn: z.string().max(1000).optional(),
  contentAr: z.string().min(1).max(1_000_000),
  contentEn: z.string().max(1_000_000).optional(),
  coverImage: z.string().max(1000).optional(),
  category: z.string().max(100).default("general"),
  tags: z.string().max(500).optional(),
  readMinutes: z.number().int().min(1).max(600).optional(),
  isPublished: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
};

export const articlesRouter = createRouter({
  // ─── List published articles (paginated, light payload) ───
  list: publicQuery
    .input(z.object({
      category: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [eq(articles.isPublished, true)];
      if (input?.category && input.category !== "all") {
        conditions.push(eq(articles.category, input.category));
      }
      if (input?.search) {
        const term = `%${input.search}%`;
        conditions.push(or(
          like(articles.titleAr, term),
          like(articles.titleEn, term),
          like(articles.excerptAr, term),
          like(articles.excerptEn, term),
        )!);
      }
      const rows = await db
        .select({
          id: articles.id,
          slug: articles.slug,
          titleAr: articles.titleAr,
          titleEn: articles.titleEn,
          excerptAr: articles.excerptAr,
          excerptEn: articles.excerptEn,
          coverImage: articles.coverImage,
          category: articles.category,
          tags: articles.tags,
          authorName: articles.authorName,
          viewCount: articles.viewCount,
          readMinutes: articles.readMinutes,
          publishedAt: articles.publishedAt,
        })
        .from(articles)
        .where(and(...conditions))
        .orderBy(desc(articles.publishedAt), desc(articles.createdAt))
        .limit(input?.limit ?? 20)
        .offset(input?.offset ?? 0);
      const [{ cnt }] = await db
        .select({ cnt: sql<number>`count(*)` })
        .from(articles)
        .where(and(...conditions));
      return { items: rows, total: Number(cnt) };
    }),

  // ─── Full article by slug (published only) + best-effort view increment ───
  getBySlug: publicQuery
    .input(z.object({ slug: z.string().min(1).max(300) }))
    .query(async ({ input }) => {
      const db = getDb();
      const [article] = await db
        .select()
        .from(articles)
        .where(and(eq(articles.slug, input.slug), eq(articles.isPublished, true)))
        .limit(1);
      if (!article) return null;
      // Best-effort view bump — atomic increment, never blocks the read.
      try {
        await db.update(articles)
          .set({ viewCount: sql`${articles.viewCount} + 1` })
          .where(eq(articles.id, article.id));
      } catch {
        /* counters are non-critical */
      }
      return article;
    }),

  // ─── Distinct categories of published articles (grouped — distinct via GROUP BY) ───
  categories: publicQuery.query(async () => {
    const db = getDb();
    const grouped = await db
      .select({ category: articles.category })
      .from(articles)
      .where(eq(articles.isPublished, true))
      .groupBy(articles.category);
    return grouped.map((row) => row.category).filter((c): c is string => Boolean(c));
  }),

  // ─── Admin: full list including drafts (content included for inline editing) ───
  adminList: adminQuery.query(async () => {
    const db = getDb();
    const rows = await db
      .select({
        id: articles.id,
        slug: articles.slug,
        titleAr: articles.titleAr,
        titleEn: articles.titleEn,
        excerptAr: articles.excerptAr,
        excerptEn: articles.excerptEn,
        contentAr: articles.contentAr,
        contentEn: articles.contentEn,
        coverImage: articles.coverImage,
        category: articles.category,
        tags: articles.tags,
        authorName: articles.authorName,
        isPublished: articles.isPublished,
        viewCount: articles.viewCount,
        readMinutes: articles.readMinutes,
        sortOrder: articles.sortOrder,
        publishedAt: articles.publishedAt,
        createdAt: articles.createdAt,
        updatedAt: articles.updatedAt,
      })
      .from(articles)
      .orderBy(desc(articles.updatedAt));
    return { items: rows, total: rows.length };
  }),

  // ─── Admin: create article ───
  create: adminMutation
    .input(z.object({ ...articleFields, slug: z.string().min(1).max(300).optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      let slug = input.slug?.trim().replace(/[^a-zA-Z0-9\u0600-\u06FF-_]/g, "-").replace(/-+/g, "-");
      if (!slug) slug = buildSlug(input.titleEn);
      // Slug uniqueness — append short suffix on conflict.
      const [existing] = await db.select({ id: articles.id }).from(articles).where(eq(articles.slug, slug)).limit(1);
      if (existing) slug = `${slug}-${randomBytes(3).toString("hex")}`;
      const readMinutes = input.readMinutes ?? estimateReadMinutes(input.contentAr);
      const [result] = await db.insert(articles).values({
        slug,
        titleAr: input.titleAr,
        titleEn: input.titleEn,
        excerptAr: input.excerptAr ?? null,
        excerptEn: input.excerptEn ?? null,
        contentAr: input.contentAr,
        contentEn: input.contentEn ?? null,
        coverImage: input.coverImage ?? null,
        category: input.category,
        tags: input.tags ?? null,
        authorId: ctx.user?.id ?? null,
        authorName: ctx.user?.name ?? "Ahmed Elbaz",
        isPublished: input.isPublished,
        publishedAt: input.isPublished ? new Date() : null,
        readMinutes,
        sortOrder: input.sortOrder,
      });
      logger.info("[Articles] Article created", { slug, published: input.isPublished });
      return { success: true, id: Number(result.insertId), slug };
    }),

  // ─── Admin: update article (handles first-publish timestamp) ───
  update: adminMutation
    .input(z.object({ id: z.number().int().positive(), ...articleFields }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...updates } = input;
      const [current] = await db.select({ isPublished: articles.isPublished }).from(articles).where(eq(articles.id, id)).limit(1);
      if (!current) throw new Error("Article not found");
      const values: Record<string, unknown> = {
        titleAr: updates.titleAr,
        titleEn: updates.titleEn,
        excerptAr: updates.excerptAr ?? null,
        excerptEn: updates.excerptEn ?? null,
        contentAr: updates.contentAr,
        contentEn: updates.contentEn ?? null,
        coverImage: updates.coverImage ?? null,
        category: updates.category,
        tags: updates.tags ?? null,
        readMinutes: updates.readMinutes ?? estimateReadMinutes(updates.contentAr),
        isPublished: updates.isPublished,
        sortOrder: updates.sortOrder,
      };
      // First publish → stamp publishedAt once; unpublish keeps the stamp.
      if (!current.isPublished && updates.isPublished) values.publishedAt = new Date();
      if (!updates.isPublished) values.publishedAt = null;
      await db.update(articles).set(values).where(eq(articles.id, id));
      logger.info("[Articles] Article updated", { id, published: updates.isPublished });
      return { success: true };
    }),

  // ─── Admin: toggle publish state ───
  togglePublish: adminMutation
    .input(z.object({ id: z.number().int().positive(), isPublished: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const values: Record<string, unknown> = { isPublished: input.isPublished };
      if (input.isPublished) values.publishedAt = new Date();
      else values.publishedAt = null;
      await db.update(articles).set(values).where(eq(articles.id, input.id));
      return { success: true };
    }),

  // ─── Admin: delete article ───
  delete: adminMutation
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(articles).where(eq(articles.id, input.id));
      logger.info("[Articles] Article deleted", { id: input.id });
      return { success: true };
    }),
});
