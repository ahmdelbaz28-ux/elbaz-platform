/**
 * SCHEMA — Auth domain
 *
 * Tables: users, passwordResetTokens, userSessions, notificationPreferences
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
  index,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/mysql-core";

// ─────────────────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────────────────
export const users = mysqlTable(
  "users",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    username: varchar("username", { length: 255 }).notNull(),
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
    emailVerificationToken: varchar("emailVerificationToken", { length: 255 }),
    emailVerificationExpiry: timestamp("emailVerificationExpiry", { mode: "date" }),
    emailVerifiedAt: timestamp("emailVerifiedAt", { mode: "date" }),
    totpSecret: varchar("totpSecret", { length: 255 }),
    totpEnabled: boolean("totpEnabled").notNull().default(false),
    totpBackupCodes: json("totpBackupCodes"),
    deviceFingerprint: varchar("deviceFingerprint", { length: 255 }),
    /** Public referral code — lazily generated on first profile view; shared
     *  as ?ref= on /register links. Unique across users. */
    referralCode: varchar("referralCode", { length: 24 }),
    /** The user who invited this account (set once at registration). */
    referredByUserId: bigint("referredByUserId", { mode: "number", unsigned: true }),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_username_unique").on(table.username),
    uniqueIndex("users_google_id_unique").on(table.googleId),
    uniqueIndex("users_referral_code_unique").on(table.referralCode),
    index("users_role_idx").on(table.role),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Password Reset Tokens
// ─────────────────────────────────────────────────────────────────────────────
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
    uniqueIndex("prt_token_hash_idx").on(table.tokenHash),
    index("prt_expires_idx").on(table.expiresAt),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_prt_user_id",
    }).onDelete("cascade").onUpdate("cascade"),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// User Sessions
// ─────────────────────────────────────────────────────────────────────────────
export const userSessions = mysqlTable(
  "userSessions",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    deviceFingerprint: varchar("deviceFingerprint", { length: 255 }),
    deviceName: varchar("deviceName", { length: 255 }),
    browser: varchar("browser", { length: 100 }),
    os: varchar("os", { length: 100 }),
    ipAddress: varchar("ipAddress", { length: 45 }),
    lastActiveAt: timestamp("lastActiveAt", { mode: "date" }).notNull().defaultNow(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    isRevoked: boolean("isRevoked").notNull().default(false),
  },
  (table) => [
    index("user_sessions_user_idx").on(table.userId),
    index("user_sessions_fingerprint_idx").on(table.deviceFingerprint),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_user_sessions_user",
    }).onDelete("cascade").onUpdate("cascade"),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Notification Preferences
// ─────────────────────────────────────────────────────────────────────────────
export const notificationPreferences = mysqlTable(
  "notificationPreferences",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    emailNewCourses: boolean("emailNewCourses").notNull().default(true),
    emailPromotions: boolean("emailPromotions").notNull().default(true),
    emailLessonReplies: boolean("emailLessonReplies").notNull().default(true),
    emailCertificates: boolean("emailCertificates").notNull().default(true),
    pushNewCourses: boolean("pushNewCourses").notNull().default(true),
    pushPromotions: boolean("pushPromotions").notNull().default(false),
    pushLessonReplies: boolean("pushLessonReplies").notNull().default(true),
    pushCertificates: boolean("pushCertificates").notNull().default(true),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("notif_prefs_user_unique").on(table.userId),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_notif_prefs_user",
    }).onDelete("cascade").onUpdate("cascade"),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Referrals — student-to-student invitation rewards
// ─────────────────────────────────────────────────────────────────────────────
// One row per invited friend. When a new user registers with ?ref=CODE,
// both parties get a discount coupon: the referrer earns a reward coupon,
// the friend receives a welcome coupon. Codes live in promoCodes (payments).
export const referrals = mysqlTable(
  "referrals",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    referrerUserId: bigint("referrerUserId", { mode: "number", unsigned: true }).notNull(),
    referredUserId: bigint("referredUserId", { mode: "number", unsigned: true }).notNull(),
    /** Reward coupon granted to the referrer (promoCodes.code). */
    rewardPromoCode: varchar("rewardPromoCode", { length: 50 }),
    /** Welcome coupon granted to the invited friend (promoCodes.code). */
    friendPromoCode: varchar("friendPromoCode", { length: 50 }),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("referrals_referred_unique").on(table.referredUserId),
    index("referrals_referrer_idx").on(table.referrerUserId),
    foreignKey({
      columns: [table.referrerUserId],
      foreignColumns: [users.id],
      name: "fk_referrals_referrer",
    }).onDelete("cascade").onUpdate("cascade"),
    foreignKey({
      columns: [table.referredUserId],
      foreignColumns: [users.id],
      name: "fk_referrals_referred",
    }).onDelete("cascade").onUpdate("cascade"),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
