import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  int,
  decimal,
  boolean,
  bigint,
  json,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

// ─── Users ───
export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  preferredLanguage: varchar("preferredLanguage", { length: 10 }).default("en").notNull(),
  // ✅ SECURITY: tokenVersion enables token revocation
  // When admin changes a user's role or user changes password, increment this.
  // The JWT includes tokenVersion — if it doesn't match DB, the token is rejected.
  tokenVersion: int("tokenVersion").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
  // ✅ Password reset fields (dedicated columns — don't hijack avatar anymore!)
  passwordResetToken: varchar("passwordResetToken", { length: 255 }),
  passwordResetExpiresAt: timestamp("passwordResetExpiresAt"),
  emailVerifiedAt: timestamp("emailVerifiedAt"),
  emailVerificationToken: varchar("emailVerificationToken", { length: 255 }),
  emailVerificationExpiresAt: timestamp("emailVerificationExpiresAt"),
}, (table) => ({
  // ✅ Index for auth lookups
  usernameIdx: uniqueIndex("idx_users_username").on(table.username),
  emailIdx: index("idx_users_email").on(table.email),
  roleIdx: index("idx_users_role").on(table.role),
}));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Categories ───
export const categories = mysqlTable("categories", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  nameEn: varchar("nameEn", { length: 255 }).notNull(),
  nameAr: varchar("nameAr", { length: 255 }).notNull(),
  descriptionEn: text("descriptionEn"),
  descriptionAr: text("descriptionAr"),
  icon: varchar("icon", { length: 100 }).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  slugIdx: uniqueIndex("idx_categories_slug").on(table.slug),
  sortIdx: index("idx_categories_sort").on(table.sortOrder),
}));

export type Category = typeof categories.$inferSelect;

// ─── Courses ───
export const courses = mysqlTable("courses", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  categoryId: bigint("categoryId", { mode: "number", unsigned: true }).notNull(),
  titleEn: varchar("titleEn", { length: 500 }).notNull(),
  titleAr: varchar("titleAr", { length: 500 }).notNull(),
  descriptionEn: text("descriptionEn"),
  descriptionAr: text("descriptionAr"),
  shortDescEn: varchar("shortDescEn", { length: 500 }),
  shortDescAr: varchar("shortDescAr", { length: 500 }),
  thumbnail: varchar("thumbnail", { length: 500 }),
  trailerUrl: varchar("trailerUrl", { length: 500 }),
  level: mysqlEnum("level", ["beginner", "intermediate", "advanced"]).default("beginner").notNull(),
  isPremium: boolean("isPremium").default(false).notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).default("0.00").notNull(),
  originalPrice: decimal("originalPrice", { precision: 10, scale: 2 }).default("0.00").notNull(),
  durationHours: int("durationHours").default(0).notNull(),
  rating: decimal("rating", { precision: 3, scale: 1 }).default("5.0").notNull(),
  reviewCount: int("reviewCount").default(0).notNull(),
  studentCount: int("studentCount").default(0).notNull(),
  instructorName: varchar("instructorName", { length: 255 }).default("Eng Ahmed Elbaz").notNull(),
  isPublished: boolean("isPublished").default(true).notNull(),
  isFeatured: boolean("isFeatured").default(false).notNull(),
  prerequisitesEn: text("prerequisitesEn"),
  prerequisitesAr: text("prerequisitesAr"),
  learningOutcomesEn: json("learningOutcomesEn").$type<string[]>(),
  learningOutcomesAr: json("learningOutcomesAr").$type<string[]>(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  // ✅ Critical indexes for all common query patterns
  slugIdx: uniqueIndex("idx_courses_slug").on(table.slug),
  categoryIdx: index("idx_courses_category").on(table.categoryId),
  publishedFeaturedIdx: index("idx_courses_published_featured").on(table.isPublished, table.isFeatured),
  publishedLevelIdx: index("idx_courses_published_level").on(table.isPublished, table.level),
  publishedPremiumIdx: index("idx_courses_published_premium").on(table.isPublished, table.isPremium),
}));

export type Course = typeof courses.$inferSelect;

// ─── Lessons ───
export const lessons = mysqlTable("lessons", {
  id: serial("id").primaryKey(),
  courseId: bigint("courseId", { mode: "number", unsigned: true }).notNull(),
  titleEn: varchar("titleEn", { length: 500 }).notNull(),
  titleAr: varchar("titleAr", { length: 500 }).notNull(),
  descriptionEn: text("descriptionEn"),
  descriptionAr: text("descriptionAr"),
  videoUrl: varchar("videoUrl", { length: 500 }),
  durationMinutes: int("durationMinutes").default(0).notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  isFree: boolean("isFree").default(false).notNull(),
  isPublished: boolean("isPublished").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  // ✅ Index for "get all lessons of a course" — the most common query
  coursePublishedIdx: index("idx_lessons_course_published").on(table.courseId, table.isPublished, table.sortOrder),
}));

export type Lesson = typeof lessons.$inferSelect;

// ─── Quiz Questions ───
export const quizQuestions = mysqlTable("quizQuestions", {
  id: serial("id").primaryKey(),
  lessonId: bigint("lessonId", { mode: "number", unsigned: true }).notNull(),
  questionEn: text("questionEn").notNull(),
  questionAr: text("questionAr").notNull(),
  optionsEn: json("optionsEn").$type<string[]>().notNull(),
  optionsAr: json("optionsAr").$type<string[]>().notNull(),
  correctOptionIndex: int("correctOptionIndex").notNull(),
  explanationEn: text("explanationEn"),
  explanationAr: text("explanationAr"),
  points: int("points").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  lessonIdx: index("idx_quiz_lesson").on(table.lessonId),
}));

export type QuizQuestion = typeof quizQuestions.$inferSelect;

// ─── Enrollments ───
export const enrollments = mysqlTable("enrollments", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  courseId: bigint("courseId", { mode: "number", unsigned: true }).notNull(),
  progress: int("progress").default(0).notNull(),
  isCompleted: boolean("isCompleted").default(false).notNull(),
  completedAt: timestamp("completedAt"),
  lastAccessedAt: timestamp("lastAccessedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  // ✅ Composite unique index — prevents duplicate enrollments + fast lookups
  userCourseIdx: uniqueIndex("idx_enrollments_user_course").on(table.userId, table.courseId),
  userIdx: index("idx_enrollments_user").on(table.userId),
}));

export type Enrollment = typeof enrollments.$inferSelect;

// ─── Lesson Progress ───
export const lessonProgress = mysqlTable("lessonProgress", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  lessonId: bigint("lessonId", { mode: "number", unsigned: true }).notNull(),
  isCompleted: boolean("isCompleted").default(false).notNull(),
  isQuizPassed: boolean("isQuizPassed").default(false).notNull(),
  quizScore: int("quizScore").default(0).notNull(),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  // Watch time tracking fields
  watchedSeconds: int("watchedSeconds").default(0).notNull(),
  lastPosition: int("lastPosition").default(0).notNull(),
  lastHeartbeatAt: timestamp("lastHeartbeatAt"),
}, (table) => ({
  userLessonIdx: uniqueIndex("idx_progress_user_lesson").on(table.userId, table.lessonId),
  userIdx: index("idx_progress_user").on(table.userId),
}));

export type LessonProgress = typeof lessonProgress.$inferSelect;

// ─── Payments ───
export const payments = mysqlTable("payments", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  courseId: bigint("courseId", { mode: "number", unsigned: true }).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 10 }).default("EGP").notNull(),
  paymentMethod: mysqlEnum("paymentMethod", ["visa", "instapay", "vodafone_cash", "wallet", "bank_transfer", "paypal", "kiosk", "cash_collection", "other"]).notNull(),
  transactionId: varchar("transactionId", { length: 255 }),
  status: mysqlEnum("status", ["pending", "completed", "failed", "refunded", "expired"]).default("pending").notNull(),
  paidAt: timestamp("paidAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  // ✅ Paymob integration fields
  paymobOrderId: varchar("paymobOrderId", { length: 100 }),          // Paymob order ID (for refunds + matching)
  paymobTransactionId: varchar("paymobTransactionId", { length: 100 }), // Paymob transaction ID from webhook
  gatewayTxnId: varchar("gatewayTxnId", { length: 100 }),          // Paymob transaction ID (for reconciliation)
  expiresAt: timestamp("expiresAt"),                                // Payment expiry time
  phoneNumber: varchar("phoneNumber", { length: 20 }),             // Customer phone (required by Paymob)
  promoCodeId: bigint("promoCodeId", { mode: "number", unsigned: true }),  // Applied promo code
  discountAmount: decimal("discountAmount", { precision: 10, scale: 2 }), // Amount discounted
  finalAmount: decimal("finalAmount", { precision: 10, scale: 2 }),       // Amount after discount
}, (table) => ({
  userIdx: index("idx_payments_user").on(table.userId),
  transactionIdx: uniqueIndex("idx_payments_transaction").on(table.transactionId),
  statusIdx: index("idx_payments_status").on(table.status),
  paymobOrderIdx: index("idx_payments_paymob_order").on(table.paymobOrderId),
  expiresIdx: index("idx_payments_expires").on(table.expiresAt),
  // Composite index for admin "get payments by user + status" queries
  userStatusIdx: index("idx_payments_user_status").on(table.userId, table.status),
  // Composite index for expiry cleanup queries (status + expiresAt)
  pendingExpiresIdx: index("idx_payments_pending_expires").on(table.status, table.expiresAt),
}));

export type Payment = typeof payments.$inferSelect;

// ─── Certificates ───
export const certificates = mysqlTable("certificates", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  courseId: bigint("courseId", { mode: "number", unsigned: true }).notNull(),
  certificateNumber: varchar("certificateNumber", { length: 255 }).notNull().unique(),
  grade: varchar("grade", { length: 50 }),
  issuedAt: timestamp("issuedAt").defaultNow().notNull(),
  verified: boolean("verified").default(false).notNull(),
  pdfUrl: varchar("pdfUrl", { length: 500 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userCourseIdx: uniqueIndex("idx_certs_user_course").on(table.userId, table.courseId),
  certNumberIdx: uniqueIndex("idx_certs_number").on(table.certificateNumber),
}));

export type Certificate = typeof certificates.$inferSelect;

// ─── Support Tickets ───
export const supportTickets = mysqlTable("supportTickets", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  message: text("message").notNull(),
  category: mysqlEnum("category", ["technical", "billing", "content", "general"]).default("general").notNull(),
  status: mysqlEnum("status", ["open", "in_progress", "resolved", "closed"]).default("open").notNull(),
  priority: mysqlEnum("priority", ["low", "medium", "high", "urgent"]).default("medium").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  userIdx: index("idx_tickets_user").on(table.userId),
  statusIdx: index("idx_tickets_status").on(table.status),
  // Composite index for admin "get tickets by user + status" queries
  userStatusIdx: index("idx_tickets_user_status").on(table.userId, table.status),
}));

export type SupportTicket = typeof supportTickets.$inferSelect;

// ─── Support Ticket Replies ───
export const ticketReplies = mysqlTable("ticketReplies", {
  id: serial("id").primaryKey(),
  ticketId: bigint("ticketId", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  message: text("message").notNull(),
  isAdminReply: boolean("isAdminReply").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  ticketIdx: index("idx_replies_ticket").on(table.ticketId),
}));

export type TicketReply = typeof ticketReplies.$inferSelect;

// ─── Testimonials ───
export const testimonials = mysqlTable("testimonials", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  title: varchar("title", { length: 255 }),
  company: varchar("company", { length: 255 }),
  content: text("content").notNull(),
  rating: int("rating").default(5).notNull(),
  isPublished: boolean("isPublished").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  publishedIdx: index("idx_testimonials_published").on(table.isPublished),
}));

export type Testimonial = typeof testimonials.$inferSelect;

// ─── Site Settings (CMS — key-value store for all editable content) ───
export const siteSettings = mysqlTable("siteSettings", {
  id: serial("id").primaryKey(),
  section: varchar("section", { length: 100 }).notNull(),        // e.g. "hero", "features", "footer", "instructor"
  key: varchar("key", { length: 255 }).notNull(),                // e.g. "titleEn", "subtitleAr", "image"
  value: text("value").notNull(),                                 // The actual content
  type: mysqlEnum("type", ["text", "richtext", "image", "url", "color", "number", "json"]).default("text").notNull(),
  sortOrder: int("sortOrder").default(0).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  sectionKeyIdx: uniqueIndex("idx_settings_section_key").on(table.section, table.key),
  sectionIdx: index("idx_settings_section").on(table.section),
}));

export type SiteSetting = typeof siteSettings.$inferSelect;

// ─── Themes ───
export const themes = mysqlTable("themes", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),              // e.g. "Default Dark", "Electric Blue"
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  isActive: boolean("isActive").default(false).notNull(),        // Only one theme can be active
  primaryColor: varchar("primaryColor", { length: 7 }).default("#06b6d4").notNull(),
  secondaryColor: varchar("secondaryColor", { length: 7 }).default("#0891b2").notNull(),
  accentColor: varchar("accentColor", { length: 7 }).default("#f59e0b").notNull(),
  bgColor: varchar("bgColor", { length: 7 }).default("#0a0e17").notNull(),
  cardBgColor: varchar("cardBgColor", { length: 7 }).default("#111827").notNull(),
  textColor: varchar("textColor", { length: 7 }).default("#f0f4f8").notNull(),
  mutedTextColor: varchar("mutedTextColor", { length: 7 }).default("#94a3b8").notNull(),
  borderColor: varchar("borderColor", { length: 7 }).default("#1f2d44").notNull(),
  fontFamily: varchar("fontFamily", { length: 100 }).default("Inter, sans-serif").notNull(),
  headingFontFamily: varchar("headingFontFamily", { length: 100 }).default("Inter, sans-serif").notNull(),
  borderRadius: varchar("borderRadius", { length: 20 }).default("12px").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  slugIdx: uniqueIndex("idx_themes_slug").on(table.slug),
  activeIdx: index("idx_themes_active").on(table.isActive),
}));

export type Theme = typeof themes.$inferSelect;

// ─── Promo Codes ───
export const promoCodes = mysqlTable("promoCodes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),      // e.g. "ELBAZ20", "SUMMER50"
  description: varchar("description", { length: 255 }),
  discountType: mysqlEnum("discountType", ["percentage", "fixed"]).notNull(), // % or fixed amount
  discountValue: decimal("discountValue", { precision: 10, scale: 2 }).notNull(), // e.g. 20.00 (20% or 20 EGP)
  maxUses: int("maxUses"),                                         // null = unlimited
  usedCount: int("usedCount").default(0).notNull(),
  minOrderAmount: decimal("minOrderAmount", { precision: 10, scale: 2 }).default("0.00"), // Minimum course price
  appliesTo: mysqlEnum("appliesTo", ["all", "specific"]).default("all").notNull(), // all courses or specific
  courseId: bigint("courseId", { mode: "number", unsigned: true }),  // null if appliesTo = "all"
  startsAt: timestamp("startsAt").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  codeIdx: uniqueIndex("idx_promo_code").on(table.code),
  activeIdx: index("idx_promo_active").on(table.isActive),
  expiresIdx: index("idx_promo_expires").on(table.expiresAt),
}));

export type PromoCode = typeof promoCodes.$inferSelect;

// ─── Promo Code Usage Tracking ───
export const promoCodeUsage = mysqlTable("promoCodeUsage", {
  id: serial("id").primaryKey(),
  promoCodeId: bigint("promoCodeId", { mode: "number", unsigned: true }).notNull(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  paymentId: bigint("paymentId", { mode: "number", unsigned: true }).notNull(),
  discountAmount: decimal("discountAmount", { precision: 10, scale: 2 }).notNull(), // How much was discounted
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  promoUserIdx: uniqueIndex("idx_promo_usage_promo_user").on(table.promoCodeId, table.userId),
  paymentIdx: index("idx_promo_usage_payment").on(table.paymentId),
}));

export type PromoCodeUsage = typeof promoCodeUsage.$inferSelect;

// ─── Promotions (Header Banners with Countdown) ───
export const promotions = mysqlTable("promotions", {
  id: serial("id").primaryKey(),
  titleEn: varchar("titleEn", { length: 500 }).notNull(),
  titleAr: varchar("titleAr", { length: 500 }).notNull(),
  subtitleEn: varchar("subtitleEn", { length: 500 }),
  subtitleAr: varchar("subtitleAr", { length: 500 }),
  discountText: varchar("discountText", { length: 100 }),     // e.g. "20% OFF", "EGP 100 OFF"
  ctaTextEn: varchar("ctaTextEn", { length: 100 }),
  ctaTextAr: varchar("ctaTextAr", { length: 100 }),
  ctaUrl: varchar("ctaUrl", { length: 500 }),                  // e.g. "/courses" or specific course URL
  promoCodeId: bigint("promoCodeId", { mode: "number", unsigned: true }),  // Link to a promo code
  bgGradientFrom: varchar("bgGradientFrom", { length: 7 }).default("#06b6d4").notNull(),
  bgGradientTo: varchar("bgGradientTo", { length: 7 }).default("#8b5cf6").notNull(),
  textColor: varchar("textColor", { length: 7 }).default("#ffffff").notNull(),
  startsAt: timestamp("startsAt").notNull(),
  endsAt: timestamp("endsAt").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  showCountdown: boolean("showCountdown").default(true).notNull(),
  position: mysqlEnum("position", ["top", "hero_above", "hero_below", "floating"]).default("top").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  activeIdx: index("idx_promotions_active").on(table.isActive),
  datesIdx: index("idx_promotions_dates").on(table.startsAt, table.endsAt),
}));

export type Promotion = typeof promotions.$inferSelect;
