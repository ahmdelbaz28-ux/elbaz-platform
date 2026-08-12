/**
 * SCHEMA — Shared / misc domain
 *
 * Tables: supportTickets, ticketReplies, testimonials, siteSettings, themes,
 *         promotions, softwareDownloads, referenceFiles, faqEntries
 */

import {
  mysqlTable,
  bigint,
  varchar,
  text,
  boolean,
  timestamp,
  int,
  index,
  uniqueIndex,
  foreignKey,
} from "drizzle-orm/mysql-core";
import { users } from "./auth.js";

// ─────────────────────────────────────────────────────────────────────────────
// Support Tickets
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Ticket Replies
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Testimonials
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Site Settings
// ─────────────────────────────────────────────────────────────────────────────
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
    uniqueIndex("ss_section_key_idx").on(table.section, table.key),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Themes
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Promotions (marketing banners)
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Software Downloads
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Reference Files
// ─────────────────────────────────────────────────────────────────────────────
export const referenceFiles = mysqlTable(
  "referenceFiles",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    fileName: varchar("fileName", { length: 500 }).notNull(),
    fileKey: varchar("fileKey", { length: 1000 }).notNull(), // R2 object key
    fileUrl: varchar("fileUrl", { length: 1000 }).notNull(), // Public/presigned URL or direct R2 path
    fileType: varchar("fileType", { length: 100 }).notNull(), // MIME type
    fileSize: bigint("fileSize", { mode: "number", unsigned: true }).notNull(),
    category: varchar("category", { length: 100 }).default("general"),
    uploadedById: bigint("uploadedById", { mode: "number", unsigned: true }), // admin who uploaded
    isPublic: boolean("isPublic").notNull().default(true),
    isPublished: boolean("isPublished").notNull().default(true),
    downloadCount: int("downloadCount").notNull().default(0),
    sortOrder: int("sortOrder").notNull().default(0),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("reference_files_category_idx").on(table.category),
    index("reference_files_published_idx").on(table.isPublished),
    index("reference_files_sort_idx").on(table.sortOrder),
    foreignKey({
      columns: [table.uploadedById],
      foreignColumns: [users.id],
      name: "fk_reference_files_uploader",
    }).onDelete("set null").onUpdate("cascade"),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// FAQ Entries
// ─────────────────────────────────────────────────────────────────────────────
export const faqEntries = mysqlTable(
  "faqEntries",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    questionEn: varchar("questionEn", { length: 500 }).notNull(),
    questionAr: varchar("questionAr", { length: 500 }).notNull(),
    answerEn: text("answerEn").notNull(),
    answerAr: text("answerAr").notNull(),
    category: varchar("category", { length: 100 }).notNull().default("general"),
    sortOrder: int("sortOrder").notNull().default(0),
    isPublished: boolean("isPublished").notNull().default(true),
    viewCount: int("viewCount").notNull().default(0),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("faq_category_idx").on(table.category),
    index("faq_published_idx").on(table.isPublished),
    index("faq_sort_idx").on(table.sortOrder),
  ]
);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export type FaqEntry = typeof faqEntries.$inferSelect;
export type ReferenceFile = typeof referenceFiles.$inferSelect;
export type InsertReferenceFile = typeof referenceFiles.$inferInsert;
