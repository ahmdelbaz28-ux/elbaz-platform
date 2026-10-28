import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, adminMutation } from "./middleware";
import { adminUsersProcedures } from "./admin-users";
import { adminTicketsProcedures } from "./admin-tickets";
import { adminCoursesProcedures } from "./admin-courses";
import { adminPaymentsProcedures } from "./admin-payments";
import { adminAiProcedures } from "./admin-ai-providers";
import { pushNotification } from "./lib/notification-broadcast.js";

/**
 * ADMIN ROUTER — Composite router merging sub-domain procedure objects
 *
 * Sub-modules:
 *   admin-users     — User management (users list, updateUserRole)
 *   admin-tickets   — Support ticket management (tickets, updateTicketStatus, replyTicket)
 *   admin-courses   — Course management (listCourses, updateCourse)
 *   admin-payments  — Payments & analytics (payments, stats, analytics)
 *   admin-ai        — Dynamic AI router (providers, models, discovery, health)
 *
 * NOTE: Each sub-module exports a PLAIN object of procedures (not wrapped in
 * createRouter()). They must be spread into a single createRouter() call to
 * preserve tRPC's internal router metadata.
 */
export const adminRouter = createRouter({
  ...adminUsersProcedures,
  ...adminTicketsProcedures,
  ...adminCoursesProcedures,
  ...adminPaymentsProcedures,
  ...adminAiProcedures,

  // ─── Manual broadcast (Admin → Notifications tab) ───
  // Stores ONE broadcast row — every registered user sees it in their bell.
  // Arabic text is the primary display; English goes into `data.en` for
  // future per-language rendering.
  sendBroadcast: adminMutation
    .input(
      z.object({
        type: z.enum(["promo", "system", "lesson", "file", "software", "youtube"]).default("promo"),
        title: z.string().min(2).max(300),
        message: z.string().min(5).max(1200),
        titleEn: z.string().max(300).optional(),
        messageEn: z.string().max(1200).optional(),
        url: z.string().max(700).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const eventId = await pushNotification({
        type: input.type,
        title: input.title,
        message: input.message,
        url: input.url,
        data: input.titleEn
          ? { en: { title: input.titleEn, message: input.messageEn ?? "" } }
          : undefined,
      });
      if (!eventId) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to store notification" });
      }
      return { success: true, eventId };
    }),
});
