import { localAuthRouter } from "./local-auth-router";
import { courseRouter } from "./course-router";
import { quizRouter } from "./quiz-router";
import { paymentRouter } from "./payment-router";
import { certificateRouter } from "./certificate-router";
import { supportRouter } from "./support-router";
import { adminRouter } from "./admin-router";
import { settingsRouter } from "./settings-router";
import { promoRouter } from "./promo-router";
import { createRouter, publicQuery } from "./middleware";

/**
 * ✅ FIX: Registered settingsRouter and promoRouter
 *
 * These were MISSING — causing:
 * - "No procedure found on path settings.getActivePromotions"
 * - "No procedure found on path settings.listThemes"
 * - "No procedure found on path promo.list"
 * - "No procedure found on path promo.validate"
 *
 * Admin.tsx, Home.tsx, CourseDetail.tsx all depend on these routers.
 */
export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: localAuthRouter,
  course: courseRouter,
  quiz: quizRouter,
  payment: paymentRouter,
  certificate: certificateRouter,
  support: supportRouter,
  admin: adminRouter,
  settings: settingsRouter,
  promo: promoRouter,
});

export type AppRouter = typeof appRouter;
