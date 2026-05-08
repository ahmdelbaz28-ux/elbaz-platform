import { localAuthRouter } from "./local-auth-router";
import { authRouter } from "./auth-router";
import { courseRouter } from "./course-router";
import { quizRouter } from "./quiz-router";
import { paymentRouter } from "./payment-router";
import { certificateRouter } from "./certificate-router";
import { supportRouter } from "./support-router";
import { adminRouter } from "./admin-router";
import { settingsRouter } from "./settings-router";
import { promoRouter } from "./promo-router";
import { notificationPollRouter } from "./notification-poll-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: localAuthRouter,
  session: authRouter,
  course: courseRouter,
  quiz: quizRouter,
  payment: paymentRouter,
  certificate: certificateRouter,
  support: supportRouter,
  admin: adminRouter,
  settings: settingsRouter,
  promo: promoRouter,
  notifications: notificationPollRouter,
});

export type AppRouter = typeof appRouter;
