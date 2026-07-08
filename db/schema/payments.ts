/**
 * SCHEMA — Payments domain
 *
 * Tables: payments, promoCodes, promoCodeUsage
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
import { courses, enrollments } from "./courses.js";

// ─────────────────────────────────────────────────────────────────────────────
// Payments
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Promo Codes
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Promo Code Usage
// ─────────────────────────────────────────────────────────────────────────────
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
