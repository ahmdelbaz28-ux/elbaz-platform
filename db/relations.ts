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
} from "./schema";

export const usersRelations = relations(users, ({ many }) => ({
  enrollments: many(enrollments),
  payments: many(payments),
  certificates: many(certificates),
  lessonProgress: many(lessonProgress),
  supportTickets: many(supportTickets),
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
}));

export const lessonsRelations = relations(lessons, ({ one, many }) => ({
  course: one(courses, { fields: [lessons.courseId], references: [courses.id] }),
  quizQuestions: many(quizQuestions),
  lessonProgress: many(lessonProgress),
}));

export const quizQuestionsRelations = relations(quizQuestions, ({ one }) => ({
  lesson: one(lessons, { fields: [quizQuestions.lessonId], references: [lessons.id] }),
}));

export const enrollmentsRelations = relations(enrollments, ({ one }) => ({
  user: one(users, { fields: [enrollments.userId], references: [users.id] }),
  course: one(courses, { fields: [enrollments.courseId], references: [courses.id] }),
}));

export const lessonProgressRelations = relations(lessonProgress, ({ one }) => ({
  user: one(users, { fields: [lessonProgress.userId], references: [users.id] }),
  lesson: one(lessons, { fields: [lessonProgress.lessonId], references: [lessons.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  user: one(users, { fields: [payments.userId], references: [users.id] }),
  course: one(courses, { fields: [payments.courseId], references: [courses.id] }),
}));

export const certificatesRelations = relations(certificates, ({ one }) => ({
  user: one(users, { fields: [certificates.userId], references: [users.id] }),
  course: one(courses, { fields: [certificates.courseId], references: [courses.id] }),
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
