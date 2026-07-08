/**
 * SCHEMA — Courses domain
 *
 * Tables: categories, courses, lessons, enrollments, lessonProgress, certificates,
 *         reviews, lessonComments, commentLikes, quizQuestions, userNotes,
 *         wishlists, chatMessages, licenses
 */

import {
  mysqlTable,
  bigint,
  varchar,
  text,
  boolean,
  timestamp,
  json,
  int,
  decimal,
  index,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/mysql-core";
import { users } from "./auth.js";

// ─────────────────────────────────────────────────────────────────────────────
// Categories
// ─────────────────────────────────────────────────────────────────────────────
export const categories = mysqlTable(
  "categories",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    slug: varchar("slug", { length: 255 }).notNull(),
    nameEn: varchar("nameEn", { length: 255 }).notNull(),
    nameAr: varchar("nameAr", { length: 255 }).notNull(),
    descriptionEn: text("descriptionEn"),
    descriptionAr: text("descriptionAr"),
    icon: varchar("icon", { length: 100 }).notNull(),
    sortOrder: int("sortOrder").notNull().default(0),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("categories_slug_unique").on(table.slug),
    index("categories_sort_idx").on(table.sortOrder),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Courses
// ─────────────────────────────────────────────────────────────────────────────
export const courses = mysqlTable(
  "courses",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    slug: varchar("slug", { length: 255 }).notNull(),
    categoryId: bigint("categoryId", { mode: "number", unsigned: true }).notNull(),
    titleEn: varchar("titleEn", { length: 500 }).notNull(),
    titleAr: varchar("titleAr", { length: 500 }).notNull(),
    descriptionEn: text("descriptionEn"),
    descriptionAr: text("descriptionAr"),
    shortDescEn: varchar("shortDescEn", { length: 500 }),
    shortDescAr: varchar("shortDescAr", { length: 500 }),
    thumbnail: varchar("thumbnail", { length: 500 }),
    trailerUrl: varchar("trailerUrl", { length: 500 }),
    level: varchar("level", { length: 50 }).notNull().default("beginner"),
    isPremium: boolean("isPremium").notNull().default(false),
    price: decimal("price", { precision: 10, scale: 2 }).notNull().default("0.00"),
    originalPrice: decimal("originalPrice", { precision: 10, scale: 2 }).notNull().default("0.00"),
    durationHours: int("durationHours").notNull().default(0),
    rating: decimal("rating", { precision: 3, scale: 1 }).notNull().default("5.0"),
    reviewCount: int("reviewCount").notNull().default(0),
    studentCount: int("studentCount").notNull().default(0),
    instructorName: varchar("instructorName", { length: 255 }).notNull().default("Eng Ahmed Elbaz"),
    isPublished: boolean("isPublished").notNull().default(true),
    isFeatured: boolean("isFeatured").notNull().default(false),
    prerequisitesEn: text("prerequisitesEn"),
    prerequisitesAr: text("prerequisitesAr"),
    learningOutcomesEn: json("learningOutcomesEn").$type<string[]>(),
    learningOutcomesAr: json("learningOutcomesAr").$type<string[]>(),
    sortOrder: int("sortOrder").notNull().default(0),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("courses_slug_unique").on(table.slug),
    index("courses_category_idx").on(table.categoryId),
    index("courses_published_idx").on(table.isPublished),
    index("courses_featured_idx").on(table.isFeatured),
    index("courses_price_idx").on(table.price),
    foreignKey({
      columns: [table.categoryId],
      foreignColumns: [categories.id],
      name: "fk_courses_category_id",
    }).onDelete("restrict").onUpdate("cascade"),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Lessons
// ─────────────────────────────────────────────────────────────────────────────
export const lessons = mysqlTable(
  "lessons",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    courseId: bigint("courseId", { mode: "number", unsigned: true }).notNull(),
    titleEn: varchar("titleEn", { length: 500 }).notNull(),
    titleAr: varchar("titleAr", { length: 500 }).notNull(),
    descriptionEn: text("descriptionEn"),
    descriptionAr: text("descriptionAr"),
    videoUrl: varchar("videoUrl", { length: 500 }),
    durationMinutes: int("durationMinutes"),
    sortOrder: int("sortOrder").notNull().default(0),
    isFree: boolean("isFree").notNull().default(false),
    isPublished: boolean("isPublished").notNull().default(false),
    attachments: json("attachments").$type<{ name: string; url: string; type: string; size?: number }[]>(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("lessons_course_idx").on(table.courseId),
    index("lessons_sort_idx").on(table.sortOrder),
    foreignKey({
      columns: [table.courseId],
      foreignColumns: [courses.id],
      name: "fk_lessons_course_id",
    }).onDelete("cascade").onUpdate("cascade"),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Enrollments
// ─────────────────────────────────────────────────────────────────────────────
export const enrollments = mysqlTable(
  "enrollments",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    courseId: bigint("courseId", { mode: "number", unsigned: true }).notNull(),
    status: varchar("status", { length: 50 }).notNull().default("active"),
    progress: decimal("progress", { precision: 5, scale: 2 }).notNull().default("0.00"),
    enrolledAt: timestamp("enrolledAt", { mode: "date" }).notNull().defaultNow(),
    completedAt: timestamp("completedAt", { mode: "date" }),
    expiresAt: timestamp("expiresAt", { mode: "date" }),
    isCompleted: boolean("isCompleted").default(false),
    lastAccessedAt: timestamp("lastAccessedAt", { mode: "date" }),
  },
  (table) => [
    uniqueIndex("enrollments_user_course_unique").on(table.userId, table.courseId),
    index("enrollments_user_idx").on(table.userId),
    index("enrollments_course_idx").on(table.courseId),
    index("enrollments_status_idx").on(table.status),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_enrollments_user_id",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.courseId],
      foreignColumns: [courses.id],
      name: "fk_enrollments_course_id",
    }).onDelete("cascade").onUpdate("cascade"),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Lesson Progress
// ─────────────────────────────────────────────────────────────────────────────
export const lessonProgress = mysqlTable(
  "lessonProgress",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    lessonId: bigint("lessonId", { mode: "number", unsigned: true }).notNull(),
    courseId: bigint("courseId", { mode: "number", unsigned: true }).notNull(),
    status: varchar("status", { length: 50 }).notNull().default("not_started"),
    watchedSeconds: int("watchedSeconds").default(0),
    completedAt: timestamp("completedAt", { mode: "date" }),
    lastAccessedAt: timestamp("lastAccessedAt", { mode: "date" }).notNull().defaultNow(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    isCompleted: boolean("isCompleted").default(false),
    isQuizPassed: boolean("isQuizPassed").default(false),
    quizScore: int("quizScore").default(0),
    lastPosition: int("lastPosition").default(0),
    lastHeartbeatAt: timestamp("lastHeartbeatAt", { mode: "date" }),
  },
  (table) => [
    uniqueIndex("lp_user_lesson_unique").on(table.userId, table.lessonId),
    index("lp_user_idx").on(table.userId),
    index("lp_lesson_idx").on(table.lessonId),
    index("lp_course_idx").on(table.courseId),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_lp_user_id",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.lessonId],
      foreignColumns: [lessons.id],
      name: "fk_lp_lesson_id",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.courseId],
      foreignColumns: [courses.id],
      name: "fk_lp_course_id",
    }).onDelete("cascade").onUpdate("cascade"),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Certificates
// ─────────────────────────────────────────────────────────────────────────────
export const certificates = mysqlTable(
  "certificates",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    courseId: bigint("courseId", { mode: "number", unsigned: true }).notNull(),
    enrollmentId: bigint("enrollmentId", { mode: "number", unsigned: true }).notNull(),
    certificateNumber: varchar("certificateNumber", { length: 100 }).notNull(),
    issuedAt: timestamp("issuedAt", { mode: "date" }).notNull().defaultNow(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    grade: varchar("grade", { length: 50 }),
    averageScore: int("averageScore", { unsigned: true }),
    verified: boolean("verified").default(false),
  },
  (table) => [
    uniqueIndex("cert_number_unique").on(table.certificateNumber),
    uniqueIndex("cert_user_course_unique").on(table.userId, table.courseId),
    index("cert_user_idx").on(table.userId),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_cert_user_id",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.courseId],
      foreignColumns: [courses.id],
      name: "fk_cert_course_id",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.enrollmentId],
      foreignColumns: [enrollments.id],
      name: "fk_cert_enrollment_id",
    }).onDelete("cascade").onUpdate("cascade"),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Reviews
// ─────────────────────────────────────────────────────────────────────────────
export const reviews = mysqlTable(
  "reviews",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    courseId: bigint("courseId", { mode: "number", unsigned: true }).notNull(),
    rating: int("rating").notNull(),
    comment: text("comment"),
    isPublished: boolean("isPublished").notNull().default(true),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("reviews_user_course_unique").on(table.userId, table.courseId),
    index("reviews_course_idx").on(table.courseId),
    index("reviews_rating_idx").on(table.rating),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_reviews_user_id",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.courseId],
      foreignColumns: [courses.id],
      name: "fk_reviews_course_id",
    }).onDelete("cascade").onUpdate("cascade"),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Quiz Questions
// ─────────────────────────────────────────────────────────────────────────────
export const quizQuestions = mysqlTable(
  "quizQuestions",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    lessonId: bigint("lessonId", { mode: "number", unsigned: true }).notNull(),
    questionEn: text("questionEn").notNull(),
    questionAr: text("questionAr").notNull(),
    optionsEn: json("optionsEn").$type<string[]>(),
    optionsAr: json("optionsAr").$type<string[]>(),
    correctIndex: int("correctIndex"),
    points: int("points").notNull().default(10),
    sortOrder: int("sortOrder").notNull().default(0),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("qq_lesson_idx").on(table.lessonId),
    foreignKey({
      columns: [table.lessonId],
      foreignColumns: [lessons.id],
      name: "fk_qq_lesson_id",
    }).onDelete("cascade").onUpdate("cascade"),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// User Notes
// ─────────────────────────────────────────────────────────────────────────────
export const userNotes = mysqlTable(
  "userNotes",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    courseId: bigint("courseId", { mode: "number", unsigned: true }),
    lessonId: bigint("lessonId", { mode: "number", unsigned: true }),
    title: varchar("title", { length: 500 }),
    content: text("content").notNull(),
    tags: json("tags"),
    isPinned: boolean("isPinned").notNull().default(false),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("user_notes_user_idx").on(table.userId),
    index("user_notes_course_idx").on(table.courseId),
    index("user_notes_lesson_idx").on(table.lessonId),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_user_notes_user",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.courseId],
      foreignColumns: [courses.id],
      name: "fk_user_notes_course",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.lessonId],
      foreignColumns: [lessons.id],
      name: "fk_user_notes_lesson",
    }).onDelete("cascade").onUpdate("cascade"),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Wishlists
// ─────────────────────────────────────────────────────────────────────────────
export const wishlists = mysqlTable(
  "wishlists",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    courseId: bigint("courseId", { mode: "number", unsigned: true }).notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("wishlist_user_course_unique").on(table.userId, table.courseId),
    index("wishlist_user_idx").on(table.userId),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_wishlist_user",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.courseId],
      foreignColumns: [courses.id],
      name: "fk_wishlist_course",
    }).onDelete("cascade").onUpdate("cascade"),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Chat Messages
// ─────────────────────────────────────────────────────────────────────────────
export const chatMessages = mysqlTable(
  "chatMessages",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    courseId: bigint("courseId", { mode: "number", unsigned: true }),
    role: varchar("role", { length: 20 }).notNull(),
    content: text("content").notNull(),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("chat_user_idx").on(table.userId),
    index("chat_course_idx").on(table.courseId),
    index("chat_created_idx").on(table.createdAt),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_chat_user_id",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.courseId],
      foreignColumns: [courses.id],
      name: "fk_chat_course_id",
    }).onDelete("set null").onUpdate("cascade"),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Licenses
// ─────────────────────────────────────────────────────────────────────────────
export const licenses = mysqlTable(
  "licenses",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    courseId: bigint("courseId", { mode: "number", unsigned: true }),
    licenseKey: varchar("licenseKey", { length: 255 }).notNull().unique(),
    type: varchar("type", { length: 50 }).notNull().default("course"),
    status: varchar("status", { length: 50 }).notNull().default("active"),
    validFrom: timestamp("validFrom", { mode: "date" }).notNull().defaultNow(),
    validUntil: timestamp("validUntil", { mode: "date" }),
    maxDevices: int("maxDevices").notNull().default(3),
    activatedAt: timestamp("activatedAt", { mode: "date" }),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("licenses_key_unique").on(table.licenseKey),
    index("licenses_user_idx").on(table.userId),
    index("licenses_status_idx").on(table.status),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_licenses_user",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.courseId],
      foreignColumns: [courses.id],
      name: "fk_licenses_course",
    }).onDelete("set null").onUpdate("cascade"),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Lesson Comments
// ─────────────────────────────────────────────────────────────────────────────
export const lessonComments = mysqlTable(
  "lessonComments",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    lessonId: bigint("lessonId", { mode: "number", unsigned: true }).notNull(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    content: text("content").notNull(),
    parentCommentId: bigint("parentCommentId", { mode: "number", unsigned: true }),
    isPinned: boolean("isPinned").notNull().default(false),
    isHidden: boolean("isHidden").notNull().default(false),
    likeCount: int("likeCount").notNull().default(0),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("comments_lesson_idx").on(table.lessonId),
    index("comments_user_idx").on(table.userId),
    index("comments_parent_idx").on(table.parentCommentId),
    foreignKey({
      columns: [table.lessonId],
      foreignColumns: [lessons.id],
      name: "fk_comments_lesson",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_comments_user",
    }).onDelete("cascade").onUpdate("cascade"),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Comment Likes
// ─────────────────────────────────────────────────────────────────────────────
export const commentLikes = mysqlTable(
  "commentLikes",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    commentId: bigint("commentId", { mode: "number", unsigned: true }).notNull(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("comment_like_unique").on(table.commentId, table.userId),
    index("comment_like_comment_idx").on(table.commentId),
    foreignKey({
      columns: [table.commentId],
      foreignColumns: [lessonComments.id],
      name: "fk_comment_like_comment",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_comment_like_user",
    }).onDelete("cascade").onUpdate("cascade"),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export type Wishlist = typeof wishlists.$inferSelect;
export type LessonComment = typeof lessonComments.$inferSelect;
export type CommentLike = typeof commentLikes.$inferSelect;
