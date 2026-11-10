/**
 * ADMIN TESTIMONIALS — home-page review management with certificate linking
 *
 * Procedures: listTestimonials, upsertTestimonial, deleteTestimonial
 *
 * The "verified review" trust loop: admin attaches a PUBLIC certificate
 * number to a testimonial → the home page renders a "شهادة موثّقة" badge
 * linking to /verify/:certificateNumber → visitors can prove the reviewer
 * actually holds a platform certificate.
 */

import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { adminQuery, adminMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { testimonials } from "@db/schema";
import { getCache, cacheKeys } from "./lib/cache";

async function invalidateTestimonialsCache(): Promise<void> {
  const cache = getCache();
  await cache.del(cacheKeys.testimonials());
}

export const adminTestimonialsProcedures = {
  listTestimonials: adminQuery
    .input(z.void().optional())
    .query(async () => {
      const db = getDb();
      const items = await db
        .select()
        .from(testimonials)
        .orderBy(desc(testimonials.createdAt));
      return { items };
    }),

  upsertTestimonial: adminMutation
    .input(z.object({
      id: z.number().optional(), // present = update, absent = create
      name: z.string().min(2).max(255),
      title: z.string().max(255).optional(),
      company: z.string().max(255).optional(),
      content: z.string().min(5).max(2000),
      rating: z.number().int().min(1).max(5).default(5),
      /** Public certificate number (e.g. ELB-2026-XXXX) — nullable. */
      certificateNumber: z.string().max(64).optional().or(z.literal("")),
      isPublished: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const cert = input.certificateNumber?.trim() ? input.certificateNumber.trim() : null;
      const values = {
        name: input.name.trim(),
        title: input.title?.trim() || null,
        company: input.company?.trim() || null,
        content: input.content.trim(),
        rating: input.rating,
        certificateNumber: cert,
        isPublished: input.isPublished,
      };

      if (input.id) {
        const [existing] = await db
          .select({ id: testimonials.id })
          .from(testimonials)
          .where(eq(testimonials.id, input.id))
          .limit(1);
        if (!existing) {
          return { success: false, error: "not_found" };
        }
        await db.update(testimonials).set(values).where(eq(testimonials.id, input.id));
      } else {
        await db.insert(testimonials).values(values);
      }
      await invalidateTestimonialsCache();
      return { success: true };
    }),

  deleteTestimonial: adminMutation
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(testimonials).where(eq(testimonials.id, input.id));
      await invalidateTestimonialsCache();
      return { success: true };
    }),
};
