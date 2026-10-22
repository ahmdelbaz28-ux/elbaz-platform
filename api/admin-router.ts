import { createRouter } from "./middleware";
import { adminUsersProcedures } from "./admin-users";
import { adminTicketsProcedures } from "./admin-tickets";
import { adminCoursesProcedures } from "./admin-courses";
import { adminPaymentsProcedures } from "./admin-payments";
import { adminAiProcedures } from "./admin-ai-providers";

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
});
