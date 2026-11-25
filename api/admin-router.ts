import { adminAuditLog } from "@db/schema";
import { TRPCError } from "@trpc/server";
import { count, desc } from "drizzle-orm";
import { z } from "zod";
import { adminAiProcedures } from "./admin-ai-providers";
import { adminChatbotProcedures } from "./admin-chatbot";
import { adminCoursesProcedures } from "./admin-courses";
import { categoryProcedures, enrollmentAdminProcedures, quizAdminProcedures } from "./admin-learning";
import { adminPaymentsProcedures } from "./admin-payments";
import { adminTestimonialsProcedures } from "./admin-testimonials";
import { adminTicketsProcedures } from "./admin-tickets";
import { adminUsersProcedures } from "./admin-users";
import { pushNotification, recentBroadcasts } from "./lib/notification-broadcast.js";
import { adminMutation, adminQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";

/**
 * ADMIN ROUTER — Composite router merging sub-domain procedure objects
 *
 * Sub-modules:
 *   admin-users     — User management (users list, updateUserRole)
 *   admin-tickets   — Support ticket management (tickets, updateTicketStatus, replyTicket)
 *   admin-courses   — Course management (listCourses, updateCourse)
 *   admin-payments  — Payments & analytics (payments, stats, analytics)
 *   admin-ai        — Dynamic AI router (providers, models, discovery, health)
 *   admin-chatbot   — Chatbot 👍/👎 feedback review (evolution loop fuel)
 *   admin-learning  — Categories CRUD, quiz question bank, course rosters
 *                     (grant / revoke / reactivate enrollments)
 *   admin-testimonials — Home-page reviews with certificate verification links
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
  ...adminChatbotProcedures,
  ...categoryProcedures,
  ...quizAdminProcedures,
  ...enrollmentAdminProcedures,
  ...adminTestimonialsProcedures,

  // ─── Admin audit trail reader (Audit tab) ───
  // Latest-first, paginated view of every admin.* call recorded by the
  // auditAdmin middleware. Read-only — the trail is append-only by design.
  auditLog: adminQuery
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(50),
      }).optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const page = input?.page ?? 1;
      const limit = input?.limit ?? 50;
      const offset = (page - 1) * limit;
      const [[{ total }], items] = await Promise.all([
        db.select({ total: count() }).from(adminAuditLog),
        db
          .select()
          .from(adminAuditLog)
          .orderBy(desc(adminAuditLog.createdAt), desc(adminAuditLog.id))
          .limit(limit)
          .offset(offset),
      ]);
      return { items, total: total ?? 0 };
    }),

  // ─── Broadcast history reader (Admin → Notifications tab → History) ───
  // ✅ ROOT FIX (dashboard audit): the panel's History tab previously kept a
  // localStorage-only list that claimed "sent/scheduled" without the backend
  // confirming anything. This returns SERVER truth — the actual broadcast
  // rows in the notifications table (targetUserId IS NULL), newest first,
  // same source the users' bells read from. `en` carries the English copy
  // stored by sendBroadcast in `data.en`.
  broadcastHistory: adminQuery
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).default(50),
      }).optional()
    )
    .query(async ({ input }) => {
      const rows = await recentBroadcasts(input?.limit ?? 50);
      return rows.map((r) => ({
        eventId: r.eventId,
        type: r.type as "promo" | "system" | "lesson" | "file" | "software" | "youtube",
        title: r.title,
        message: r.message,
        url: r.url,
        en:
          (r.data as { en?: { title?: string; message?: string } } | null)?.en ??
          null,
        createdAt: r.createdAt,
      }));
    }),

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
        // ✅ SECURITY FIX (audit run-1, notification-url.window-open
        // .missing-scheme-policy): the broadcast url is opened client-side via
        // window.open/openWindow — restrict it to relative app paths or
        // http(s) URLs so a javascript:/data: destination can never be stored.
        url: z
          .string()
          .max(700)
          .optional()
          .refine((v) => v === undefined || v.startsWith("/") || /^https?:\/\//i.test(v), {
            message: "url must be a relative path or an http(s) URL",
          }),
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
