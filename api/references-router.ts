/**
 * References Router — tRPC procedures for managing reference files
 *
 * Features:
 *   - list: Public query — list all published reference files
 *   - getUploadUrl: Admin mutation — get presigned URL for direct browser upload to R2
 *   - create: Admin mutation — create a reference file record after upload
 *   - getDownloadUrl: Public query — get presigned download URL
 *   - incrementDownload: Public mutation — increment download counter
 *   - update: Admin mutation — update reference file metadata
 *   - delete: Admin mutation — delete reference file (DB record + R2 object)
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { desc, eq, sql, and, or, like } from "drizzle-orm";
import { createRouter, publicQuery, publicMutation, adminMutation } from "./middleware";
import { logger } from "./lib/logger.js";
import { getDb } from "./queries/connection";
import { referenceFiles } from "@db/schema";
import {
  generateR2UploadUrl,
  generateR2DownloadUrl,
  deleteR2Object,
  REFERENCE_ALLOWED_CONTENT_TYPES,
  REFERENCE_MAX_FILE_SIZE,
} from "./lib/r2";

export const referencesRouter = createRouter({
  // ─── List all published reference files ───
  list: publicQuery
    .input(z.object({
      category: z.string().optional(),
      search: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [eq(referenceFiles.isPublished, true)];

      if (input?.category && input.category !== "all") {
        conditions.push(eq(referenceFiles.category, input.category));
      }

      if (input?.search) {
        const searchTerm = `%${input.search}%`;
        conditions.push(
          or(
            like(referenceFiles.title, searchTerm),
            like(referenceFiles.description, searchTerm),
            like(referenceFiles.fileName, searchTerm),
          )!,
        );
      }

      const items = await db
        .select()
        .from(referenceFiles)
        .where(and(...conditions))
        .orderBy(desc(referenceFiles.sortOrder), desc(referenceFiles.createdAt));

      return { items, total: items.length };
    }),

  // ─── Get distinct categories ───
  categories: publicQuery.query(async () => {
    const db = getDb();
    const rows = await db
      .selectDistinct({ category: referenceFiles.category })
      .from(referenceFiles)
      .where(eq(referenceFiles.isPublished, true));
    return rows.map((r) => r.category).filter(Boolean) as string[];
  }),

  // ─── Get presigned upload URL (admin only) ───
  getUploadUrl: adminMutation
    .input(z.object({
      fileName: z.string().min(1).max(500),
      fileType: z.string().min(1).max(100),
      fileSize: z.number().int().positive(),
    }))
    .mutation(async ({ input }) => {
      // Validate file type
      if (!REFERENCE_ALLOWED_CONTENT_TYPES.has(input.fileType)) {
        throw new Error(`Unsupported file type: ${input.fileType}`);
      }

      // Validate file size
      if (input.fileSize > REFERENCE_MAX_FILE_SIZE) {
        const maxMB = Math.round(REFERENCE_MAX_FILE_SIZE / 1024 / 1024);
        throw new Error(`File too large: ${(input.fileSize / 1024 / 1024).toFixed(1)}MB exceeds ${maxMB}MB limit`);
      }

      // Generate unique object key: references/<timestamp>-<random>.<ext>
      // Use crypto.randomBytes (CSPRNG) instead of Math.random() — S2245.
      const ext = input.fileName.includes(".")
        ? input.fileName.split(".").pop()!.toLowerCase()
        : "bin";
      const timestamp = Date.now();
      const random = randomBytes(6).toString("hex");
      const objectKey = `references/${timestamp}-${random}.${ext}`;

      const uploadUrl = await generateR2UploadUrl(objectKey, input.fileType, 300); // 5 min expiry

      return {
        uploadUrl,
        objectKey,
        expiresIn: 300,
      };
    }),

  // ─── Create reference file record (after successful upload) ───
  create: adminMutation
    .input(z.object({
      title: z.string().min(1).max(500),
      description: z.string().max(5000).optional(),
      fileName: z.string().min(1).max(500),
      fileKey: z.string().min(1).max(1000),
      fileType: z.string().min(1).max(100),
      fileSize: z.number().int().positive(),
      category: z.string().max(100).default("general"),
      isPublic: z.boolean().default(true),
      sortOrder: z.number().int().default(0),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const fileUrl = `r2://${input.fileKey}`; // Stored as R2 reference; actual URL generated on download

      const [result] = await db.insert(referenceFiles).values({
        ...input,
        fileUrl,
        uploadedById: ctx.user?.id,
        isPublished: true,
      });

      return { success: true, id: Number(result.insertId) };
    }),

  // ─── Get presigned download URL ───
  getDownloadUrl: publicMutation
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [file] = await db
        .select()
        .from(referenceFiles)
        .where(and(
          eq(referenceFiles.id, input.id),
          eq(referenceFiles.isPublished, true),
        ))
        .limit(1);

      if (!file) {
        throw new Error("Reference file not found");
      }

      const downloadUrl = await generateR2DownloadUrl(
        file.fileKey,
        file.fileName,
        file.fileType,
        3600, // 1 hour expiry
      );

      // Increment download count (non-blocking, best-effort)
      db.update(referenceFiles)
        .set({ downloadCount: sql`${referenceFiles.downloadCount} + 1` })
        .where(eq(referenceFiles.id, input.id))
        .execute()
        .catch(() => { /* best-effort */ });

      return { downloadUrl, fileName: file.fileName, expiresIn: 3600 };
    }),

  // ─── Update reference file metadata ───
  update: adminMutation
    .input(z.object({
      id: z.number().int().positive(),
      title: z.string().max(500).optional(),
      description: z.string().max(5000).optional(),
      category: z.string().max(100).optional(),
      isPublic: z.boolean().optional(),
      isPublished: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...updates } = input;
      const cleanUpdates = Object.fromEntries(
        Object.entries(updates).filter(([, v]) => v !== undefined),
      );
      if (Object.keys(cleanUpdates).length === 0) return { success: true };
      await db.update(referenceFiles).set(cleanUpdates).where(eq(referenceFiles.id, id));
      return { success: true };
    }),

  // ─── Delete reference file (DB record + R2 object) ───
  delete: adminMutation
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [file] = await db
        .select()
        .from(referenceFiles)
        .where(eq(referenceFiles.id, input.id))
        .limit(1);

      if (!file) {
        throw new Error("Reference file not found");
      }

      // Delete from R2 first (best-effort — DB record still gets deleted even if R2 fails)
      try {
        await deleteR2Object(file.fileKey);
      } catch (err) {
        logger.warn("[References] R2 delete failed", { fileKey: file.fileKey, error: String(err) });
      }

      // Delete DB record
      await db.delete(referenceFiles).where(eq(referenceFiles.id, input.id));
      return { success: true };
    }),
});
