import { relations } from "drizzle-orm";
import {
  users,
  categories,
  courses,
  lessons,
  quizQuestions,
  enrollments,
  lessonProgress,
  payments,
  certificates,
  supportTickets,
  ticketReplies,
  testimonials,
  promoCodes,
  promoCodeUsage,
  chatMessages,
  passwordResetTokens,
  siteSettings,
  themes,
  promotions,
  softwareDownloads,
  reviews,
  userSessions,
  userNotes,
  licenses,
} from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
  enrollments: many(enrollments),
  payments: many(payments),
  certificates: many(certificates),
  lessonProgress: many(lessonProgress),
  supportTickets: many(supportTickets),
  promoCodes: many(promoCodes),
  promoCodeUsage: many(promoCodeUsage),
  chatMessages: many(chatMessages),
  passwordResetTokens: many(passwordResetTokens),
  ticketReplies: many(ticketReplies),
  reviews: many(reviews),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  courses: many(courses),
}));

export const coursesRelations = relations(courses, ({ one, many }) => ({
  category: one(categories, { fields: [courses.categoryId], references: [categories.id] }),
  lessons: many(lessons),
  enrollments: many(enrollments),
  payments: many(payments),
  certificates: many(certificates),
  chatMessages: many(chatMessages),
  reviews: many(reviews),
}));

export const lessonsRelations = relations(lessons, ({ one, many }) => ({
  course: one(courses, { fields: [lessons.courseId], references: [courses.id] }),
  quizQuestions: many(quizQuestions),
  lessonProgress: many(lessonProgress),
}));

export const quizQuestionsRelations = relations(quizQuestions, ({ one }) => ({
  lesson: one(lessons, { fields: [quizQuestions.lessonId], references: [lessons.id] }),
}));

export const enrollmentsRelations = relations(enrollments, ({ one, many }) => ({
  user: one(users, { fields: [enrollments.userId], references: [users.id] }),
  course: one(courses, { fields: [enrollments.courseId], references: [courses.id] }),
  payments: many(payments),
  certificates: many(certificates),
}));

export const lessonProgressRelations = relations(lessonProgress, ({ one }) => ({
  user: one(users, { fields: [lessonProgress.userId], references: [users.id] }),
  lesson: one(lessons, { fields: [lessonProgress.lessonId], references: [lessons.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  user: one(users, { fields: [payments.userId], references: [users.id] }),
  course: one(courses, { fields: [payments.courseId], references: [courses.id] }),
  enrollment: one(enrollments, { fields: [payments.enrollmentId], references: [enrollments.id] }),
}));

export const certificatesRelations = relations(certificates, ({ one }) => ({
  user: one(users, { fields: [certificates.userId], references: [users.id] }),
  course: one(courses, { fields: [certificates.courseId], references: [courses.id] }),
  enrollment: one(enrollments, { fields: [certificates.enrollmentId], references: [enrollments.id] }),
}));

export const supportTicketsRelations = relations(supportTickets, ({ one, many }) => ({
  user: one(users, { fields: [supportTickets.userId], references: [users.id] }),
  replies: many(ticketReplies),
}));

export const ticketRepliesRelations = relations(ticketReplies, ({ one }) => ({
  ticket: one(supportTickets, { fields: [ticketReplies.ticketId], references: [supportTickets.id] }),
  user: one(users, { fields: [ticketReplies.userId], references: [users.id] }),
}));

export const testimonialsRelations = relations(testimonials, () => ({}));

export const promoCodesRelations = relations(promoCodes, ({ one, many }) => ({
  createdBy: one(users, { fields: [promoCodes.createdBy], references: [users.id] }),
  usages: many(promoCodeUsage),
}));

export const promoCodeUsageRelations = relations(promoCodeUsage, ({ one }) => ({
  promoCode: one(promoCodes, { fields: [promoCodeUsage.promoCodeId], references: [promoCodes.id] }),
  user: one(users, { fields: [promoCodeUsage.userId], references: [users.id] }),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  user: one(users, { fields: [chatMessages.userId], references: [users.id] }),
  course: one(courses, { fields: [chatMessages.courseId], references: [courses.id] }),
}));

export const passwordResetTokensRelations = relations(passwordResetTokens, ({ one }) => ({
  user: one(users, { fields: [passwordResetTokens.userId], references: [users.id] }),
}));

export const siteSettingsRelations = relations(siteSettings, () => ({}));

export const themesRelations = relations(themes, () => ({}));

export const promotionsRelations = relations(promotions, ({ one }) => ({
  promoCode: one(promoCodes, { fields: [promotions.promoCodeId], references: [promoCodes.id] }),
}));

export const softwareDownloadsRelations = relations(softwareDownloads, () => ({}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  user: one(users, { fields: [reviews.userId], references: [users.id] }),
  course: one(courses, { fields: [reviews.courseId], references: [courses.id] }),
}));

export const userSessionsRelations = relations(userSessions, ({ one }) => ({
  user: one(users, { fields: [userSessions.userId], references: [users.id] }),
}));

export const userNotesRelations = relations(userNotes, ({ one }) => ({
  user: one(users, { fields: [userNotes.userId], references: [users.id] }),
  course: one(courses, { fields: [userNotes.courseId], references: [courses.id] }),
  lesson: one(lessons, { fields: [userNotes.lessonId], references: [lessons.id] }),
}));

export const licensesRelations = relations(licenses, ({ one }) => ({
  user: one(users, { fields: [licenses.userId], references: [users.id] }),
  course: one(courses, { fields: [licenses.courseId], references: [courses.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  enrollments: many(enrollments),
  payments: many(payments),
  certificates: many(certificates),
  lessonProgress: many(lessonProgress),
  supportTickets: many(supportTickets),
  promoCodes: many(promoCodes),
  promoCodeUsage: many(promoCodeUsage),
  chatMessages: many(chatMessages),
  passwordResetTokens: many(passwordResetTokens),
  ticketReplies: many(ticketReplies),
  reviews: many(reviews),
  sessions: many(userSessions),
  notes: many(userNotes),
  licenses: many(licenses),
}));
