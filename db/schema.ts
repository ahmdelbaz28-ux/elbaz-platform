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
  // Auth
  users,
  passwordResetTokens,
  userSessions,
  notificationPreferences,
  // Auth types
  type User,
  type InsertUser,
  type NotificationPreference,
} from "./schema/auth.js";

export {
  // Courses
  categories,
  courses,
  lessons,
  enrollments,
  lessonProgress,
  certificates,
  reviews,
  lessonComments,
  commentLikes,
  quizQuestions,
  userNotes,
  wishlists,
  chatMessages,
  licenses,
  // Course types
  type Wishlist,
  type LessonComment,
  type CommentLike,
} from "./schema/courses.js";

export {
  // Payments
  payments,
  promoCodes,
  promoCodeUsage,
} from "./schema/payments.js";

export {
  // Shared
  supportTickets,
  ticketReplies,
  testimonials,
  siteSettings,
  themes,
  promotions,
  softwareDownloads,
  referenceFiles,
  faqEntries,
  // Shared types
  type FaqEntry,
  type ReferenceFile,
  type InsertReferenceFile,
} from "./schema/shared.js";
