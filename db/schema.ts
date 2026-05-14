import {
  mysqlTable,
  int,
  bigint,
  varchar,
  text,
  boolean,
  timestamp,
  decimal,
  json,
  index,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable(
  "users",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    username: varchar("username", { length: 255 }).notNull().unique(),
    passwordHash: varchar("passwordHash", { length: 255 }),
    googleId: varchar("googleId", { length: 255 }),
    name: varchar("name", { length: 255 }),
    email: varchar("email", { length: 320 }),
    pendingEmail: varchar("pendingEmail", { length: 320 }),
    avatar: text("avatar"),
    role: varchar("role", { length: 50 }).notNull().default("user"),
    preferredLanguage: varchar("preferredLanguage", { length: 10 }).notNull().default("en"),
    tokenVersion: int("tokenVersion").notNull().default(0),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
    lastSignInAt: timestamp("lastSignInAt", { mode: "date" }).notNull().defaultNow(),
    passwordResetToken: varchar("passwordResetToken", { length: 255 }),
    passwordResetExpiresAt: timestamp("passwordResetExpiresAt", { mode: "date" }),
    // ✅ RESTORED: Email verification columns — required for full email verification flow
    emailVerificationToken: varchar("emailVerificationToken", { length: 255 }),
    emailVerificationExpiry: timestamp("emailVerificationExpiry", { mode: "date" }),
    emailVerifiedAt: timestamp("emailVerifiedAt", { mode: "date" }),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_username_unique").on(table.username),
    uniqueIndex("users_google_id_unique").on(table.googleId),
    index("users_role_idx").on(table.role),
  ]
);

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

export const payments = mysqlTable(
  "payments",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    courseId: bigint("courseId", { mode: "number", unsigned: true }).notNull(),
    enrollmentId: bigint("enrollmentId", { mode: "number", unsigned: true }),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    discountAmount: decimal("discountAmount", { precision: 10, scale: 2 }).default("0.00"),
    currency: varchar("currency", { length: 10 }).notNull().default("EGP"),
    provider: varchar("provider", { length: 50 }).notNull(),
    providerPaymentId: varchar("providerPaymentId", { length: 255 }),
    status: varchar("status", { length: 50 }).notNull().default("pending"),
    promoCodeId: bigint("promoCodeId", { mode: "number", unsigned: true }),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    paidAt: timestamp("paidAt", { mode: "date" }),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
    transactionId: varchar("transactionId", { length: 255 }),
    paymentMethod: varchar("paymentMethod", { length: 50 }),
    phoneNumber: varchar("phoneNumber", { length: 20 }),
    paymobOrderId: varchar("paymobOrderId", { length: 255 }),
    finalAmount: decimal("finalAmount", { precision: 10, scale: 2 }),
  },
  (table) => [
    uniqueIndex("payments_transaction_unique").on(table.transactionId),
    index("payments_transaction_idx").on(table.transactionId),
    index("payments_user_idx").on(table.userId),
    index("payments_course_idx").on(table.courseId),
    index("payments_status_idx").on(table.status),
    index("payments_provider_idx").on(table.provider),
    index("payments_provider_payment_idx").on(table.providerPaymentId),
    index("payments_created_idx").on(table.createdAt),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_payments_user_id",
    }).onDelete("restrict").onUpdate("cascade"),
    foreignKey({
      columns: [table.courseId],
      foreignColumns: [courses.id],
      name: "fk_payments_course_id",
    }).onDelete("restrict").onUpdate("cascade"),
    foreignKey({
      columns: [table.enrollmentId],
      foreignColumns: [enrollments.id],
      name: "fk_payments_enrollment_id",
    }).onDelete("set null").onUpdate("cascade"),
  ]
);

export const promoCodes = mysqlTable(
  "promoCodes",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    code: varchar("code", { length: 50 }).notNull(),
    description: text("description"),
    discountType: varchar("discountType", { length: 20 }).notNull().default("percentage"),
    discountValue: decimal("discountValue", { precision: 5, scale: 2 }).notNull(),
    maxUses: int("maxUses"),
    maxUsesPerUser: int("maxUsesPerUser").default(1),
    usedCount: int("usedCount").notNull().default(0),
    courseIds: json("courseIds").$type<number[]>(),
    isValidForAllCourses: boolean("isValidForAllCourses").notNull().default(true),
    validFrom: timestamp("validFrom", { mode: "date" }).notNull().defaultNow(),
    validUntil: timestamp("validUntil", { mode: "date" }),
    isActive: boolean("isActive").notNull().default(true),
    createdBy: bigint("createdBy", { mode: "number", unsigned: true }).notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("promoCodes_code_unique").on(table.code),
    index("promoCodes_active_idx").on(table.isActive),
    index("promoCodes_validity_idx").on(table.validFrom, table.validUntil),
    foreignKey({
      columns: [table.createdBy],
      foreignColumns: [users.id],
      name: "fk_promoCodes_created_by",
    }).onDelete("restrict").onUpdate("cascade"),
  ]
);

export const promoCodeUsage = mysqlTable(
  "promoCodeUsage",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    promoCodeId: bigint("promoCodeId", { mode: "number", unsigned: true }).notNull(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    paymentId: bigint("paymentId", { mode: "number", unsigned: true }),
    usedAt: timestamp("usedAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("pcu_promo_idx").on(table.promoCodeId),
    index("pcu_user_idx").on(table.userId),
    index("pcu_payment_idx").on(table.paymentId),
    foreignKey({
      columns: [table.promoCodeId],
      foreignColumns: [promoCodes.id],
      name: "fk_pcu_promo_code_id",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_pcu_user_id",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.paymentId],
      foreignColumns: [payments.id],
      name: "fk_pcu_payment_id",
    }).onDelete("set null").onUpdate("cascade"),
  ]
);

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

export const passwordResetTokens = mysqlTable(
  "passwordResetTokens",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    tokenHash: varchar("tokenHash", { length: 255 }).notNull(),
    expiresAt: timestamp("expiresAt", { mode: "date" }).notNull(),
    usedAt: timestamp("usedAt", { mode: "date" }),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("prt_user_idx").on(table.userId),
    index("prt_token_hash_idx").on(table.tokenHash),
    index("prt_expires_idx").on(table.expiresAt),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_prt_user_id",
    }).onDelete("cascade").onUpdate("cascade"),
  ]
);

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

export const supportTickets = mysqlTable(
  "supportTickets",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    subject: varchar("subject", { length: 500 }).notNull(),
    message: text("message").notNull(),
    category: varchar("category", { length: 100 }).notNull().default("general"),
    status: varchar("status", { length: 50 }).notNull().default("open"),
    priority: varchar("priority", { length: 20 }).notNull().default("medium"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("st_user_idx").on(table.userId),
    index("st_status_idx").on(table.status),
    index("st_created_idx").on(table.createdAt),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_st_user_id",
    }).onDelete("cascade").onUpdate("cascade"),
  ]
);

export const ticketReplies = mysqlTable(
  "ticketReplies",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    ticketId: bigint("ticketId", { mode: "number", unsigned: true }).notNull(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    message: text("message").notNull(),
    isAdminReply: boolean("isAdminReply").notNull().default(false),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("tr_ticket_idx").on(table.ticketId),
    index("tr_user_idx").on(table.userId),
    foreignKey({
      columns: [table.ticketId],
      foreignColumns: [supportTickets.id],
      name: "fk_tr_ticket_id",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_tr_user_id",
    }).onDelete("cascade").onUpdate("cascade"),
  ]
);

export const testimonials = mysqlTable(
  "testimonials",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    name: varchar("name", { length: 255 }).notNull(),
    title: varchar("title", { length: 255 }),
    company: varchar("company", { length: 255 }),
    content: text("content").notNull(),
    rating: int("rating").notNull().default(5),
    isPublished: boolean("isPublished").notNull().default(true),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("testimonials_published_idx").on(table.isPublished),
  ]
);

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

export const siteSettings = mysqlTable(
  "siteSettings",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    section: varchar("section", { length: 100 }).notNull(),
    key: varchar("key", { length: 255 }).notNull(),
    value: text("value").notNull(),
    type: varchar("type", { length: 50 }).notNull().default("text"),
    sortOrder: int("sortOrder").notNull().default(0),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("ss_section_idx").on(table.section),
    index("ss_section_key_idx").on(table.section, table.key),
  ]
);

export const themes = mysqlTable(
  "themes",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    name: varchar("name", { length: 100 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    primaryColor: varchar("primaryColor", { length: 50 }).default("#06b6d4"),
    secondaryColor: varchar("secondaryColor", { length: 50 }).default("#0891b2"),
    accentColor: varchar("accentColor", { length: 50 }).default("#f59e0b"),
    bgColor: varchar("bgColor", { length: 50 }).default("#0a0e17"),
    cardBgColor: varchar("cardBgColor", { length: 50 }).default("#111827"),
    textColor: varchar("textColor", { length: 50 }).default("#f0f4f8"),
    mutedTextColor: varchar("mutedTextColor", { length: 50 }).default("#94a3b8"),
    borderColor: varchar("borderColor", { length: 50 }).default("#1f2d44"),
    fontFamily: varchar("fontFamily", { length: 255 }).default("Inter, sans-serif"),
    headingFontFamily: varchar("headingFontFamily", { length: 255 }).default("Inter, sans-serif"),
    borderRadius: varchar("borderRadius", { length: 50 }).default("12px"),
    isActive: boolean("isActive").notNull().default(false),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("themes_slug_unique").on(table.slug),
  ]
);

export const promotions = mysqlTable(
  "promotions",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    titleEn: varchar("titleEn", { length: 500 }).notNull(),
    titleAr: varchar("titleAr", { length: 500 }).notNull(),
    subtitleEn: varchar("subtitleEn", { length: 500 }),
    subtitleAr: varchar("subtitleAr", { length: 500 }),
    discountText: varchar("discountText", { length: 100 }),
    ctaTextEn: varchar("ctaTextEn", { length: 100 }),
    ctaTextAr: varchar("ctaTextAr", { length: 100 }),
    ctaUrl: varchar("ctaUrl", { length: 500 }),
    promoCodeId: bigint("promoCodeId", { mode: "number", unsigned: true }),
    bgGradientFrom: varchar("bgGradientFrom", { length: 50 }).default("#06b6d4"),
    bgGradientTo: varchar("bgGradientTo", { length: 50 }).default("#8b5cf6"),
    textColor: varchar("textColor", { length: 50 }).default("#ffffff"),
    startsAt: timestamp("startsAt", { mode: "date" }).notNull(),
    endsAt: timestamp("endsAt", { mode: "date" }).notNull(),
    isActive: boolean("isActive").notNull().default(true),
    showCountdown: boolean("showCountdown").notNull().default(true),
    position: varchar("position", { length: 50 }).notNull().default("top"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("promotions_active_idx").on(table.isActive),
    index("prom_dates_idx").on(table.startsAt, table.endsAt),
  ]
);

export const softwareDownloads = mysqlTable(
  "softwareDownloads",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    titleEn: varchar("titleEn", { length: 500 }).notNull(),
    titleAr: varchar("titleAr", { length: 500 }).notNull(),
    descriptionEn: text("descriptionEn"),
    descriptionAr: text("descriptionAr"),
    url: varchar("url", { length: 1000 }).notNull(),
    iconUrl: varchar("iconUrl", { length: 500 }),
    isExternal: boolean("isExternal").notNull().default(true),
    sortOrder: int("sortOrder").notNull().default(0),
    isActive: boolean("isActive").notNull().default(true),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  }
);

export const certificates = mysqlTable(
  "certificates",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    certId: varchar("certId", { length: 100 }).notNull().unique(), // The public verification ID (e.g., UUID or short ID)
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    courseId: bigint("courseId", { mode: "number", unsigned: true }).notNull(),
    issuedAt: timestamp("issuedAt", { mode: "date" }).notNull().defaultNow(),
    grade: varchar("grade", { length: 50 }),
  },
  (table) => [
    index("cert_user_idx").on(table.userId),
    index("cert_course_idx").on(table.courseId),
    index("cert_verify_idx").on(table.certId),
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
  ]
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
