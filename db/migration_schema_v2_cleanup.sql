-- ═══════════════════════════════════════════════════════════════════════
-- Elbaz LMS — Schema v2 Cleanup Migration
-- Date: 2026-05-08
-- Purpose: Sync Aiven MySQL with schema.ts (source of truth)
-- Result: 27 tables → 18 tables, removed orphaned schema
-- ═══════════════════════════════════════════════════════════════════════

-- STEP 1: Drop orphaned tables (0 rows, no code references)
-- These tables existed in the DB but had NO corresponding schema.ts
-- definition and were NEVER referenced in any API route or query.
DROP TABLE IF EXISTS blogComments;
DROP TABLE IF EXISTS blogPosts;
DROP TABLE IF EXISTS courseReviews;
DROP TABLE IF EXISTS modules;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS quizAttempts;
DROP TABLE IF EXISTS supportMessages;  -- Duplicate of ticketReplies
DROP TABLE IF EXISTS userActivityLog;
DROP TABLE IF EXISTS waitlist;

-- STEP 2: Drop orphaned columns from users table
-- These columns existed in DB but had no code usage anywhere
ALTER TABLE users DROP COLUMN emailVerificationToken;
ALTER TABLE users DROP COLUMN emailVerificationExpiresAt;
ALTER TABLE users DROP COLUMN emailVerifiedAt;
ALTER TABLE users DROP COLUMN isActive;

-- STEP 3: Drop orphaned columns from lessonProgress table
-- Video tracking columns not implemented in the application
ALTER TABLE lessonProgress DROP COLUMN watchedSeconds;
ALTER TABLE lessonProgress DROP COLUMN lastPosition;
ALTER TABLE lessonProgress DROP COLUMN lastHeartbeatAt;

-- STEP 4: Clean up duplicate/legacy indexes
-- These indexes duplicated the ones defined in schema.ts
DROP INDEX users_username_unique ON users;
DROP INDEX courses_slug_unique ON courses;
DROP INDEX categories_slug_unique ON categories;
DROP INDEX certificates_certificateNumber_unique ON certificates;
DROP INDEX idx_enrollments_userId ON enrollments;
DROP INDEX idx_enrollments_courseId ON enrollments;
DROP INDEX idx_enrollments_user ON enrollments;
DROP INDEX idx_lessons_courseId ON lessons;
DROP INDEX idx_lessons_published ON lessons;
DROP INDEX idx_courses_categoryId ON courses;
DROP INDEX idx_courses_slug ON courses;
DROP INDEX idx_courses_featured ON courses;
DROP INDEX idx_courses_published ON courses;
DROP INDEX idx_payments_userId ON payments;
DROP INDEX idx_payments_transactionId ON payments;
DROP INDEX idx_payments_courseId ON payments;
DROP INDEX idx_payments_createdAt ON payments;
DROP INDEX idx_payments_user ON payments;
DROP INDEX idx_lessonProgress_userId ON lessonProgress;
DROP INDEX idx_lessonProgress_lessonId ON lessonProgress;
DROP INDEX idx_lessonProgress_completed ON lessonProgress;
DROP INDEX idx_certificates_userId ON certificates;

-- ═══════════════════════════════════════════════════════════════════════
-- FINAL STATE: 18 tables matching schema.ts exactly
-- users (14 cols), categories (9), courses (29), lessons (12),
-- quizQuestions (11), enrollments (8), lessonProgress (8),
-- payments (17), certificates (9), supportTickets (9), ticketReplies (6),
-- testimonials (8), siteSettings (7), themes (17), promoCodes (14),
-- promoCodeUsage (6), promotions (19), __drizzle_migrations (3)
-- ═══════════════════════════════════════════════════════════════════════
