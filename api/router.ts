import { adminRouter } from "./admin-router";
import { articlesRouter } from "./articles-router";
import { authRouter } from "./auth-router";
import { certificateRouter } from "./certificate-router";
import { commentsRouter } from "./comments-router";
import { courseRouter } from "./course-router";
import { exportRouter } from "./export-router";
import { faqRouter } from "./faq-router";
import { journeyRouter } from "./journey-router";
import { licenseRouter } from "./license-router";
import { localAuthRouter } from "./local-auth-router";
import { createRouter, publicQuery } from "./middleware";
import { notesRouter } from "./notes-router";
import { notificationPollRouter } from "./notification-poll-router";
import { notificationPrefsRouter } from "./notification-prefs-router";
import { paymentRouter } from "./payment-router";
import { promoRouter } from "./promo-tsrp-router.js";
import { quizRouter } from "./quiz-router";
import { referencesRouter } from "./references-router";
import { referralRouter } from "./referral-router";
import { reviewRouter } from "./review-router";
import { searchRouter } from "./search-router";
import { sessionsRouter } from "./sessions-router";
import { settingsRouter } from "./settings-router";
import { softwareRouter } from "./software-router";
import { supportRouter } from "./support-router";
import { twoFaRouter } from "./twofa-router";
import { wishlistRouter } from "./wishlist-router";

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
  notifications: notificationPollRouter,
  promo: promoRouter,
  twoFa: twoFaRouter,
  review: reviewRouter,
  software: softwareRouter,
  notes: notesRouter,
  sessions: sessionsRouter,
  license: licenseRouter,
  export: exportRouter,
  references: referencesRouter,
  articles: articlesRouter,
  faq: faqRouter,
  wishlist: wishlistRouter,
  comments: commentsRouter,
  search: searchRouter,
  notificationPrefs: notificationPrefsRouter,
  journey: journeyRouter,
  referral: referralRouter,
});

export type AppRouter = typeof appRouter;
