import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { createRouter, publicQuery, adminMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { softwareDownloads } from "@db/schema";

export const softwareRouter = createRouter({
  list: publicQuery.query(async () => {
    const db = getDb();
    return db
      .select()
      .from(softwareDownloads)
      .where(eq(softwareDownloads.isActive, true))
      .orderBy(desc(softwareDownloads.sortOrder), desc(softwareDownloads.createdAt));
  }),

  create: adminMutation
    .input(z.object({
      titleEn: z.string().min(1).max(500),
      titleAr: z.string().min(1).max(500),
      descriptionEn: z.string().optional(),
      descriptionAr: z.string().optional(),
      url: z.string().max(1000),
      iconUrl: z.string().max(500).optional(),
      isExternal: z.boolean().default(true),
      sortOrder: z.number().int().default(0),
      isActive: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [item] = await db.insert(softwareDownloads).values(input);
      return { success: true, id: Number(item.insertId) };
    }),

  update: adminMutation
    .input(z.object({
      id: z.number().int().positive(),
      titleEn: z.string().max(500).optional(),
      titleAr: z.string().max(500).optional(),
      descriptionEn: z.string().optional(),
      descriptionAr: z.string().optional(),
      url: z.string().max(1000).optional(),
      iconUrl: z.string().max(500).optional(),
      isExternal: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...updates } = input;
      const cleanUpdates = Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined));
      if (Object.keys(cleanUpdates).length === 0) return { success: true };
      await db.update(softwareDownloads).set(cleanUpdates).where(eq(softwareDownloads.id, id));
      return { success: true };
    }),

  delete: adminMutation
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(softwareDownloads).where(eq(softwareDownloads.id, input.id));
      return { success: true };
    }),
});
