import { localAuthRouter } from "./local-auth-router";
import { courseRouter } from "./course-router";
import { quizRouter } from "./quiz-router";
import { paymentRouter } from "./payment-router";
import { certificateRouter } from "./certificate-router";
import { supportRouter } from "./support-router";
import { adminRouter } from "./admin-router";
import { createRouter, publicQuery } from "./middleware";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: localAuthRouter,
  course: courseRouter,
  quiz: quizRouter,
  payment: paymentRouter,
  certificate: certificateRouter,
  support: supportRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;