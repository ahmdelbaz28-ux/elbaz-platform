/**
 * SCHEMA — Barrel file
 *
 * Re-exports all table definitions from domain modules.
 * drizzle.config.ts points here — all existing imports of "@db/schema" continue to work.
 *
 * Domains:
 *   auth/     — users, passwordResetTokens, userSessions, notificationPreferences
 *   courses/  — categories, courses, lessons, enrollments, lessonProgress, certificates,
 *               reviews, lessonComments, commentLikes, quizQuestions, userNotes,
 *               wishlists, chatMessages, licenses
 *   payments/ — payments, promoCodes, promoCodeUsage
 *   shared/   — supportTickets, ticketReplies, testimonials, siteSettings, themes,
 *               promotions, softwareDownloads, referenceFiles, faqEntries
 */


export {
  type AiModel,
  type AiProvider,
  aiModels,
  // AI Router (dynamic multi-provider chatbot gateway)
  aiProviders,
  type InsertUserAiProvider,
  type UserAiProvider,
  userAiProviders,
} from "./schema/ai.js";
export {
  type InsertUser,
  type NotificationPreference,
  notificationPreferences,
  passwordResetTokens,
  referrals,
  // Auth types
  type User,
  userSessions,
  // Auth
  users,
} from "./schema/auth.js";
export {
  type ChatbotFeedback,
  // Chatbot (feedback loop — 👍/👎 votes on assistant replies)
  chatbotFeedback,
  type InsertChatbotFeedback,
} from "./schema/chatbot.js";
export {
  type CommentLike,
  // Courses
  categories,
  certificates,
  chatMessages,
  commentLikes,
  courses,
  enrollments,
  type LessonComment,
  lessonComments,
  lessonProgress,
  lessons,
  licenses,
  quizQuestions,
  reviews,
  userNotes,
  // Course types
  type Wishlist,
  wishlists,
} from "./schema/courses.js";
export {
  // Payments
  payments,
  promoCodes,
  promoCodeUsage,
} from "./schema/payments.js";
export {
  type AdminAuditLogRow,
  type Article,
  adminAuditLog,
  articles,
  type EmailDripLogRow,
  emailDripLog,
  // Shared types
  type FaqEntry,
  faqEntries,
  type InsertArticle,
  type InsertReferenceFile,
  type NotificationRow,
  notifications,
  type PushSubscriptionRow,
  promotions,
  pushSubscriptions,
  type ReferenceFile,
  referenceFiles,
  siteSettings,
  softwareDownloads,
  // Shared
  supportTickets,
  testimonials,
  themes,
  ticketReplies,
} from "./schema/shared.js";
