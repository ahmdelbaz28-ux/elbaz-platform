-- Elbaz Platform Schema Migration: v3-elite
-- Priority: P0 Critical + P1 High
-- This migration fixes all critical security issues

-- Step 1: Fix PK/FK type mismatches (serial -> bigint)
-- Run BEFORE adding foreign keys

ALTER TABLE `courses` MODIFY COLUMN `instructor_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `modules` MODIFY COLUMN `course_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `lessons` MODIFY COLUMN `module_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `lessons` MODIFY COLUMN `course_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `enrollments` MODIFY COLUMN `user_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `enrollments` MODIFY COLUMN `course_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `payments` MODIFY COLUMN `user_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `payments` MODIFY COLUMN `course_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `payments` MODIFY COLUMN `enrollment_id` BIGINT UNSIGNED NULL;
ALTER TABLE `payments` MODIFY COLUMN `promo_code_id` BIGINT UNSIGNED NULL;
ALTER TABLE `promo_codes` MODIFY COLUMN `created_by` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `promo_code_usages` MODIFY COLUMN `promo_code_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `promo_code_usages` MODIFY COLUMN `user_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `promo_code_usages` MODIFY COLUMN `payment_id` BIGINT UNSIGNED NULL;
ALTER TABLE `lesson_progress` MODIFY COLUMN `user_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `lesson_progress` MODIFY COLUMN `lesson_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `lesson_progress` MODIFY COLUMN `course_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `reviews` MODIFY COLUMN `user_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `reviews` MODIFY COLUMN `course_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `chat_messages` MODIFY COLUMN `user_id` BIGINT UNSIGNED NOT NULL;
ALTER TABLE `chat_messages` MODIFY COLUMN `course_id` BIGINT UNSIGNED NULL;

-- Step 2: Add missing indexes
CREATE INDEX IF NOT EXISTS `idx_courses_slug` ON `courses` (`slug`);
CREATE INDEX IF NOT EXISTS `idx_courses_instructor` ON `courses` (`instructor_id`);
CREATE INDEX IF NOT EXISTS `idx_modules_course` ON `modules` (`course_id`);
CREATE INDEX IF NOT EXISTS `idx_lessons_module` ON `lessons` (`module_id`);
CREATE INDEX IF NOT EXISTS `idx_lessons_course` ON `lessons` (`course_id`);
CREATE INDEX IF NOT EXISTS `idx_enrollments_user` ON `enrollments` (`user_id`);
CREATE INDEX IF NOT EXISTS `idx_enrollments_course` ON `enrollments` (`course_id`);
CREATE INDEX IF NOT EXISTS `idx_payments_user` ON `payments` (`user_id`);
CREATE INDEX IF NOT EXISTS `idx_payments_course` ON `payments` (`course_id`);
CREATE INDEX IF NOT EXISTS `idx_payments_status` ON `payments` (`status`);
CREATE INDEX IF NOT EXISTS `idx_payments_provider` ON `payments` (`provider`);
CREATE INDEX IF NOT EXISTS `idx_payments_provider_id` ON `payments` (`provider_payment_id`);
CREATE INDEX IF NOT EXISTS `idx_pcu_promo` ON `promo_code_usages` (`promo_code_id`);
CREATE INDEX IF NOT EXISTS `idx_pcu_user` ON `promo_code_usages` (`user_id`);
CREATE INDEX IF NOT EXISTS `idx_lp_user` ON `lesson_progress` (`user_id`);
CREATE INDEX IF NOT EXISTS `idx_lp_lesson` ON `lesson_progress` (`lesson_id`);
CREATE INDEX IF NOT EXISTS `idx_reviews_course` ON `reviews` (`course_id`);
CREATE INDEX IF NOT EXISTS `idx_chat_user` ON `chat_messages` (`user_id`);

-- Step 3: Add foreign key constraints
ALTER TABLE `courses` ADD CONSTRAINT `fk_courses_instructor`
  FOREIGN KEY (`instructor_id`) REFERENCES `users` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `modules` ADD CONSTRAINT `fk_modules_course`
  FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `lessons` ADD CONSTRAINT `fk_lessons_module`
  FOREIGN KEY (`module_id`) REFERENCES `modules` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `lessons` ADD CONSTRAINT `fk_lessons_course`
  FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `enrollments` ADD CONSTRAINT `fk_enrollments_user`
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `enrollments` ADD CONSTRAINT `fk_enrollments_course`
  FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `payments` ADD CONSTRAINT `fk_payments_user`
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `payments` ADD CONSTRAINT `fk_payments_course`
  FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `payments` ADD CONSTRAINT `fk_payments_enrollment`
  FOREIGN KEY (`enrollment_id`) REFERENCES `enrollments` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `payments` ADD CONSTRAINT `fk_payments_promo`
  FOREIGN KEY (`promo_code_id`) REFERENCES `promo_codes` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `promo_codes` ADD CONSTRAINT `fk_promo_codes_creator`
  FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `promo_code_usages` ADD CONSTRAINT `fk_pcu_promo`
  FOREIGN KEY (`promo_code_id`) REFERENCES `promo_codes` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `promo_code_usages` ADD CONSTRAINT `fk_pcu_user`
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `promo_code_usages` ADD CONSTRAINT `fk_pcu_payment`
  FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `lesson_progress` ADD CONSTRAINT `fk_lp_user`
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `lesson_progress` ADD CONSTRAINT `fk_lp_lesson`
  FOREIGN KEY (`lesson_id`) REFERENCES `lessons` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `lesson_progress` ADD CONSTRAINT `fk_lp_course`
  FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `reviews` ADD CONSTRAINT `fk_reviews_user`
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `reviews` ADD CONSTRAINT `fk_reviews_course`
  FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `chat_messages` ADD CONSTRAINT `fk_chat_user`
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `chat_messages` ADD CONSTRAINT `fk_chat_course`
  FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 4: Create session management tables (JWT revocation)

CREATE TABLE IF NOT EXISTS `user_sessions` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `jti` VARCHAR(255) NOT NULL,
  `device_fingerprint` VARCHAR(255),
  `ip_address` VARCHAR(45),
  `user_agent` TEXT,
  `expires_at` TIMESTAMP NOT NULL,
  `revoked_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `us_jti_unique` (`jti`),
  KEY `us_user_idx` (`user_id`),
  KEY `us_expires_idx` (`expires_at`),
  CONSTRAINT `fk_us_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `refresh_token_store` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `device_info` VARCHAR(500),
  `ip_address` VARCHAR(45),
  `expires_at` TIMESTAMP NOT NULL,
  `revoked_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `rts_user_idx` (`user_id`),
  KEY `rts_token_hash_idx` (`token_hash`),
  KEY `rts_expires_idx` (`expires_at`),
  CONSTRAINT `fk_rts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `password_reset_tokens` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `expires_at` TIMESTAMP NOT NULL,
  `used_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `prt_user_idx` (`user_id`),
  KEY `prt_token_hash_idx` (`token_hash`),
  KEY `prt_expires_idx` (`expires_at`),
  CONSTRAINT `fk_prt_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Step 5: Create certificates table if not exists
CREATE TABLE IF NOT EXISTS `certificates` (
  `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `course_id` BIGINT UNSIGNED NOT NULL,
  `enrollment_id` BIGINT UNSIGNED NOT NULL,
  `certificate_number` VARCHAR(100) NOT NULL,
  `issued_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `cert_number_unique` (`certificate_number`),
  UNIQUE KEY `cert_user_course_unique` (`user_id`, `course_id`),
  KEY `cert_user_idx` (`user_id`),
  CONSTRAINT `fk_cert_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_cert_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_cert_enrollment` FOREIGN KEY (`enrollment_id`) REFERENCES `enrollments` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Step 6: Add promo code validation columns if missing
ALTER TABLE `promo_codes`
  ADD COLUMN IF NOT EXISTS `is_valid_for_all_courses` BOOLEAN NOT NULL DEFAULT TRUE AFTER `course_ids`;

ALTER TABLE `promo_codes`
  ADD COLUMN IF NOT EXISTS `created_by` BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER `is_active`;
