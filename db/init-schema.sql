-- ============================================================================
-- elbaz-platform – Full Schema Initialization
-- Idempotent: uses CREATE TABLE IF NOT EXISTS throughout.
-- Target: Aiven MySQL 8.x  (utf8mb4, InnoDB)
-- Generated from: db/schema.ts (Drizzle ORM)
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================================
-- 1. users
-- ============================================================================
CREATE TABLE IF NOT EXISTS `users` (
  `id`              BIGINT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `username`        VARCHAR(255)           NOT NULL,
  `passwordHash`    VARCHAR(255)           NULL,
  `googleId`        VARCHAR(255)           NULL,
  `name`            VARCHAR(255)           NULL,
  `email`           VARCHAR(320)           NULL,
  `pendingEmail`    VARCHAR(320)           NULL,
  `avatar`          TEXT                   NULL,
  `role`            VARCHAR(50)            NOT NULL DEFAULT 'user',
  `preferredLanguage` VARCHAR(10)          NOT NULL DEFAULT 'en',
  `tokenVersion`    INT                    NOT NULL DEFAULT 0,
  `createdAt`       TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`       TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `lastSignInAt`    TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `passwordResetToken`  VARCHAR(255)       NULL,
  `passwordResetExpiresAt` TIMESTAMP       NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `users_email_unique` (`email`),
  UNIQUE INDEX `users_username_unique` (`username`),
  UNIQUE INDEX `users_google_id_unique` (`googleId`),
  INDEX `users_role_idx` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 2. categories
-- ============================================================================
CREATE TABLE IF NOT EXISTS `categories` (
  `id`              BIGINT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `slug`            VARCHAR(255)           NOT NULL,
  `nameEn`          VARCHAR(255)           NOT NULL,
  `nameAr`          VARCHAR(255)           NOT NULL,
  `descriptionEn`   TEXT                   NULL,
  `descriptionAr`   TEXT                   NULL,
  `icon`            VARCHAR(100)           NOT NULL,
  `sortOrder`       INT                    NOT NULL DEFAULT 0,
  `createdAt`       TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `categories_slug_unique` (`slug`),
  INDEX `categories_sort_idx` (`sortOrder`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 3. courses  (FK → categories)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `courses` (
  `id`                    BIGINT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `slug`                  VARCHAR(255)           NOT NULL,
  `categoryId`            BIGINT UNSIGNED        NOT NULL,
  `titleEn`               VARCHAR(500)           NOT NULL,
  `titleAr`               VARCHAR(500)           NOT NULL,
  `descriptionEn`         TEXT                   NULL,
  `descriptionAr`         TEXT                   NULL,
  `shortDescEn`           VARCHAR(500)           NULL,
  `shortDescAr`           VARCHAR(500)           NULL,
  `thumbnail`             VARCHAR(500)           NULL,
  `trailerUrl`            VARCHAR(500)           NULL,
  `level`                 VARCHAR(50)            NOT NULL DEFAULT 'beginner',
  `isPremium`             BOOLEAN                NOT NULL DEFAULT FALSE,
  `price`                 DECIMAL(10,2)          NOT NULL DEFAULT '0.00',
  `originalPrice`         DECIMAL(10,2)          NOT NULL DEFAULT '0.00',
  `durationHours`         INT                    NOT NULL DEFAULT 0,
  `rating`                DECIMAL(3,1)           NOT NULL DEFAULT '5.0',
  `reviewCount`           INT                    NOT NULL DEFAULT 0,
  `studentCount`          INT                    NOT NULL DEFAULT 0,
  `instructorName`        VARCHAR(255)           NOT NULL DEFAULT 'Eng Ahmed Elbaz',
  `isPublished`           BOOLEAN                NOT NULL DEFAULT TRUE,
  `isFeatured`            BOOLEAN                NOT NULL DEFAULT FALSE,
  `prerequisitesEn`       TEXT                   NULL,
  `prerequisitesAr`       TEXT                   NULL,
  `learningOutcomesEn`    JSON                   NULL,
  `learningOutcomesAr`    JSON                   NULL,
  `sortOrder`             INT                    NOT NULL DEFAULT 0,
  `createdAt`             TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`             TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `courses_slug_unique` (`slug`),
  INDEX `courses_category_idx` (`categoryId`),
  INDEX `courses_published_idx` (`isPublished`),
  INDEX `courses_featured_idx` (`isFeatured`),
  INDEX `courses_price_idx` (`price`),
  CONSTRAINT `fk_courses_category_id` FOREIGN KEY (`categoryId`) REFERENCES `categories` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 4. lessons  (FK → courses)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `lessons` (
  `id`              BIGINT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `courseId`        BIGINT UNSIGNED        NOT NULL,
  `titleEn`         VARCHAR(500)           NOT NULL,
  `titleAr`         VARCHAR(500)           NOT NULL,
  `descriptionEn`   TEXT                   NULL,
  `descriptionAr`   TEXT                   NULL,
  `videoUrl`        VARCHAR(500)           NULL,
  `durationMinutes` INT                    NULL,
  `sortOrder`       INT                    NOT NULL DEFAULT 0,
  `isFree`          BOOLEAN                NOT NULL DEFAULT FALSE,
  `isPublished`     BOOLEAN                NOT NULL DEFAULT FALSE,
  `createdAt`       TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `lessons_course_idx` (`courseId`),
  INDEX `lessons_sort_idx` (`sortOrder`),
  CONSTRAINT `fk_lessons_course_id` FOREIGN KEY (`courseId`) REFERENCES `courses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 5. enrollments  (FK → users, courses)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `enrollments` (
  `id`              BIGINT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `userId`          BIGINT UNSIGNED        NOT NULL,
  `courseId`        BIGINT UNSIGNED        NOT NULL,
  `status`          VARCHAR(50)            NOT NULL DEFAULT 'active',
  `progress`        DECIMAL(5,2)           NOT NULL DEFAULT '0.00',
  `enrolledAt`      TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completedAt`     TIMESTAMP              NULL,
  `expiresAt`       TIMESTAMP              NULL,
  `isCompleted`     BOOLEAN                NULL DEFAULT FALSE,
  `lastAccessedAt`  TIMESTAMP              NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `enrollments_user_course_unique` (`userId`, `courseId`),
  INDEX `enrollments_user_idx` (`userId`),
  INDEX `enrollments_course_idx` (`courseId`),
  INDEX `enrollments_status_idx` (`status`),
  CONSTRAINT `fk_enrollments_user_id`  FOREIGN KEY (`userId`)   REFERENCES `users`   (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_enrollments_course_id` FOREIGN KEY (`courseId`) REFERENCES `courses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 6. payments  (FK → users, courses, enrollments)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `payments` (
  `id`                BIGINT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `userId`            BIGINT UNSIGNED        NOT NULL,
  `courseId`          BIGINT UNSIGNED        NOT NULL,
  `enrollmentId`      BIGINT UNSIGNED        NULL,
  `amount`            DECIMAL(10,2)          NOT NULL,
  `discountAmount`    DECIMAL(10,2)          NULL DEFAULT '0.00',
  `currency`          VARCHAR(10)            NOT NULL DEFAULT 'EGP',
  `provider`          VARCHAR(50)            NOT NULL,
  `providerPaymentId` VARCHAR(255)           NULL,
  `status`            VARCHAR(50)            NOT NULL DEFAULT 'pending',
  `promoCodeId`       BIGINT UNSIGNED        NULL,
  `metadata`          JSON                   NULL,
  `paidAt`            TIMESTAMP              NULL,
  `createdAt`         TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`         TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `transactionId`     VARCHAR(255)           NULL,
  `paymentMethod`     VARCHAR(50)            NULL,
  `phoneNumber`       VARCHAR(20)            NULL,
  `paymobOrderId`     VARCHAR(255)           NULL,
  `finalAmount`       DECIMAL(10,2)          NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `payments_transaction_unique` (`transactionId`),
  INDEX `payments_transaction_idx` (`transactionId`),
  INDEX `payments_user_idx` (`userId`),
  INDEX `payments_course_idx` (`courseId`),
  INDEX `payments_status_idx` (`status`),
  INDEX `payments_provider_idx` (`provider`),
  INDEX `payments_provider_payment_idx` (`providerPaymentId`),
  INDEX `payments_created_idx` (`createdAt`),
  CONSTRAINT `fk_payments_user_id`       FOREIGN KEY (`userId`)       REFERENCES `users`       (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_payments_course_id`     FOREIGN KEY (`courseId`)     REFERENCES `courses`     (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_payments_enrollment_id` FOREIGN KEY (`enrollmentId`) REFERENCES `enrollments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 7. promoCodes  (FK → users via createdBy)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `promoCodes` (
  `id`                  BIGINT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `code`                VARCHAR(50)            NOT NULL,
  `description`         TEXT                   NULL,
  `discountType`        VARCHAR(20)            NOT NULL DEFAULT 'percentage',
  `discountValue`       DECIMAL(5,2)           NOT NULL,
  `maxUses`             INT                    NULL,
  `maxUsesPerUser`      INT                    NULL DEFAULT 1,
  `usedCount`           INT                    NOT NULL DEFAULT 0,
  `courseIds`           JSON                   NULL,
  `isValidForAllCourses` BOOLEAN               NOT NULL DEFAULT TRUE,
  `validFrom`           TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `validUntil`          TIMESTAMP              NULL,
  `isActive`            BOOLEAN                NOT NULL DEFAULT TRUE,
  `createdBy`           BIGINT UNSIGNED        NOT NULL,
  `createdAt`           TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`           TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `promoCodes_code_unique` (`code`),
  INDEX `promoCodes_active_idx` (`isActive`),
  INDEX `promoCodes_validity_idx` (`validFrom`, `validUntil`),
  CONSTRAINT `fk_promoCodes_created_by` FOREIGN KEY (`createdBy`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 8. promoCodeUsage  (FK → promoCodes, users, payments)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `promoCodeUsage` (
  `id`           BIGINT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `promoCodeId`  BIGINT UNSIGNED        NOT NULL,
  `userId`       BIGINT UNSIGNED        NOT NULL,
  `paymentId`    BIGINT UNSIGNED        NULL,
  `usedAt`       TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `pcu_promo_idx`  (`promoCodeId`),
  INDEX `pcu_user_idx`   (`userId`),
  INDEX `pcu_payment_idx` (`paymentId`),
  CONSTRAINT `fk_pcu_promo_code_id` FOREIGN KEY (`promoCodeId`) REFERENCES `promoCodes` (`id`) ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT `fk_pcu_user_id`       FOREIGN KEY (`userId`)      REFERENCES `users`     (`id`) ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT `fk_pcu_payment_id`    FOREIGN KEY (`paymentId`)   REFERENCES `payments`   (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 9. lessonProgress  (FK → users, lessons, courses)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `lessonProgress` (
  `id`              BIGINT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `userId`          BIGINT UNSIGNED        NOT NULL,
  `lessonId`        BIGINT UNSIGNED        NOT NULL,
  `courseId`        BIGINT UNSIGNED        NOT NULL,
  `status`          VARCHAR(50)            NOT NULL DEFAULT 'not_started',
  `watchedSeconds`  INT                    NULL DEFAULT 0,
  `completedAt`     TIMESTAMP              NULL,
  `lastAccessedAt`  TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt`       TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `isCompleted`     BOOLEAN                NULL DEFAULT FALSE,
  `isQuizPassed`    BOOLEAN                NULL DEFAULT FALSE,
  `quizScore`       INT                    NULL DEFAULT 0,
  `lastPosition`    INT                    NULL DEFAULT 0,
  `lastHeartbeatAt` TIMESTAMP              NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `lp_user_lesson_unique` (`userId`, `lessonId`),
  INDEX `lp_user_idx`   (`userId`),
  INDEX `lp_lesson_idx` (`lessonId`),
  INDEX `lp_course_idx` (`courseId`),
  CONSTRAINT `fk_lp_user_id`   FOREIGN KEY (`userId`)   REFERENCES `users`   (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_lp_lesson_id` FOREIGN KEY (`lessonId`) REFERENCES `lessons` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_lp_course_id` FOREIGN KEY (`courseId`) REFERENCES `courses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 10. reviews  (FK → users, courses)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `reviews` (
  `id`          BIGINT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `userId`      BIGINT UNSIGNED        NOT NULL,
  `courseId`    BIGINT UNSIGNED        NOT NULL,
  `rating`      INT                    NOT NULL,
  `comment`     TEXT                   NULL,
  `isPublished` BOOLEAN                NOT NULL DEFAULT TRUE,
  `createdAt`   TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`   TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `reviews_user_course_unique` (`userId`, `courseId`),
  INDEX `reviews_course_idx` (`courseId`),
  INDEX `reviews_rating_idx` (`rating`),
  CONSTRAINT `fk_reviews_user_id`   FOREIGN KEY (`userId`)   REFERENCES `users`   (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_reviews_course_id` FOREIGN KEY (`courseId`) REFERENCES `courses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 11. chatMessages  (FK → users, courses)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `chatMessages` (
  `id`        BIGINT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `userId`    BIGINT UNSIGNED        NOT NULL,
  `courseId`  BIGINT UNSIGNED        NULL,
  `role`      VARCHAR(20)            NOT NULL,
  `content`   TEXT                   NOT NULL,
  `metadata`  JSON                   NULL,
  `createdAt` TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `chat_user_idx`   (`userId`),
  INDEX `chat_course_idx` (`courseId`),
  INDEX `chat_created_idx` (`createdAt`),
  CONSTRAINT `fk_chat_user_id`   FOREIGN KEY (`userId`)   REFERENCES `users`   (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_chat_course_id` FOREIGN KEY (`courseId`) REFERENCES `courses` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 12. passwordResetTokens  (FK → users)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `passwordResetTokens` (
  `id`        BIGINT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `userId`    BIGINT UNSIGNED        NOT NULL,
  `tokenHash` VARCHAR(255)           NOT NULL,
  `expiresAt` TIMESTAMP              NOT NULL,
  `usedAt`    TIMESTAMP              NULL,
  `createdAt` TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `prt_user_idx`       (`userId`),
  INDEX `prt_token_hash_idx` (`tokenHash`),
  INDEX `prt_expires_idx`    (`expiresAt`),
  CONSTRAINT `fk_prt_user_id` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 13. certificates  (FK → users, courses, enrollments)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `certificates` (
  `id`                BIGINT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `userId`            BIGINT UNSIGNED        NOT NULL,
  `courseId`          BIGINT UNSIGNED        NOT NULL,
  `enrollmentId`      BIGINT UNSIGNED        NOT NULL,
  `certificateNumber` VARCHAR(100)           NOT NULL,
  `issuedAt`          TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt`         TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `grade`             VARCHAR(50)            NULL,
  `averageScore`      INT UNSIGNED           NULL DEFAULT 0,
  `verified`          BOOLEAN                NULL DEFAULT FALSE,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `cert_number_unique`    (`certificateNumber`),
  UNIQUE INDEX `cert_user_course_unique` (`userId`, `courseId`),
  INDEX `cert_user_idx` (`userId`),
  CONSTRAINT `fk_cert_user_id`       FOREIGN KEY (`userId`)       REFERENCES `users`       (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_cert_course_id`     FOREIGN KEY (`courseId`)     REFERENCES `courses`     (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_cert_enrollment_id` FOREIGN KEY (`enrollmentId`) REFERENCES `enrollments` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 16. supportTickets  (FK → users)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `supportTickets` (
  `id`        BIGINT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `userId`    BIGINT UNSIGNED        NOT NULL,
  `subject`   VARCHAR(500)           NOT NULL,
  `message`   TEXT                   NOT NULL,
  `category`  VARCHAR(100)           NOT NULL DEFAULT 'general',
  `status`    VARCHAR(50)            NOT NULL DEFAULT 'open',
  `priority`  VARCHAR(20)            NOT NULL DEFAULT 'medium',
  `createdAt` TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `st_user_idx`   (`userId`),
  INDEX `st_status_idx` (`status`),
  INDEX `st_created_idx` (`createdAt`),
  CONSTRAINT `fk_st_user_id` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 17. ticketReplies  (FK → supportTickets, users)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `ticketReplies` (
  `id`           BIGINT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `ticketId`     BIGINT UNSIGNED        NOT NULL,
  `userId`       BIGINT UNSIGNED        NOT NULL,
  `message`      TEXT                   NOT NULL,
  `isAdminReply` BOOLEAN                NOT NULL DEFAULT FALSE,
  `createdAt`    TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `tr_ticket_idx` (`ticketId`),
  INDEX `tr_user_idx`   (`userId`),
  CONSTRAINT `fk_tr_ticket_id` FOREIGN KEY (`ticketId`) REFERENCES `supportTickets` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_tr_user_id`   FOREIGN KEY (`userId`)   REFERENCES `users`          (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 18. testimonials
-- ============================================================================
CREATE TABLE IF NOT EXISTS `testimonials` (
  `id`          BIGINT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(255)           NOT NULL,
  `title`       VARCHAR(255)           NULL,
  `company`     VARCHAR(255)           NULL,
  `content`     TEXT                   NOT NULL,
  `rating`      INT                    NOT NULL DEFAULT 5,
  `isPublished` BOOLEAN                NOT NULL DEFAULT TRUE,
  `createdAt`   TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `testimonials_published_idx` (`isPublished`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 19. quizQuestions  (FK → lessons)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `quizQuestions` (
  `id`          BIGINT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `lessonId`    BIGINT UNSIGNED        NOT NULL,
  `questionEn`  TEXT                   NOT NULL,
  `questionAr`  TEXT                   NOT NULL,
  `optionsEn`   JSON                   NULL,
  `optionsAr`   JSON                   NULL,
  `correctIndex` INT                   NULL,
  `points`      INT                    NOT NULL DEFAULT 10,
  `sortOrder`   INT                    NOT NULL DEFAULT 0,
  `createdAt`   TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `qq_lesson_idx` (`lessonId`),
  CONSTRAINT `fk_qq_lesson_id` FOREIGN KEY (`lessonId`) REFERENCES `lessons` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 20. siteSettings
-- ============================================================================
CREATE TABLE IF NOT EXISTS `siteSettings` (
  `id`        BIGINT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `section`   VARCHAR(100)           NOT NULL,
  `key`       VARCHAR(255)           NOT NULL,
  `value`     TEXT                   NOT NULL,
  `type`      VARCHAR(50)            NOT NULL DEFAULT 'text',
  `sortOrder` INT                    NOT NULL DEFAULT 0,
  `createdAt` TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `ss_section_idx`      (`section`),
  INDEX `ss_section_key_idx`  (`section`, `key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 21. themes
-- ============================================================================
CREATE TABLE IF NOT EXISTS `themes` (
  `id`                BIGINT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `name`              VARCHAR(100)           NOT NULL,
  `slug`              VARCHAR(100)           NOT NULL,
  `primaryColor`      VARCHAR(50)            NULL DEFAULT '#06b6d4',
  `secondaryColor`    VARCHAR(50)            NULL DEFAULT '#0891b2',
  `accentColor`       VARCHAR(50)            NULL DEFAULT '#f59e0b',
  `bgColor`           VARCHAR(50)            NULL DEFAULT '#0a0e17',
  `cardBgColor`       VARCHAR(50)            NULL DEFAULT '#111827',
  `textColor`         VARCHAR(50)            NULL DEFAULT '#f0f4f8',
  `mutedTextColor`    VARCHAR(50)            NULL DEFAULT '#94a3b8',
  `borderColor`       VARCHAR(50)            NULL DEFAULT '#1f2d44',
  `fontFamily`        VARCHAR(255)           NULL DEFAULT 'Inter, sans-serif',
  `headingFontFamily` VARCHAR(255)           NULL DEFAULT 'Inter, sans-serif',
  `borderRadius`      VARCHAR(50)            NULL DEFAULT '12px',
  `isActive`          BOOLEAN                NOT NULL DEFAULT FALSE,
  `createdAt`         TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`         TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `themes_slug_unique` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 22. promotions  (FK → promoCodes via promoCodeId)
-- ============================================================================
CREATE TABLE IF NOT EXISTS `promotions` (
  `id`              BIGINT UNSIGNED        NOT NULL AUTO_INCREMENT,
  `titleEn`         VARCHAR(500)           NOT NULL,
  `titleAr`         VARCHAR(500)           NOT NULL,
  `subtitleEn`      VARCHAR(500)           NULL,
  `subtitleAr`      VARCHAR(500)           NULL,
  `discountText`    VARCHAR(100)           NULL,
  `ctaTextEn`       VARCHAR(100)           NULL,
  `ctaTextAr`       VARCHAR(100)           NULL,
  `ctaUrl`          VARCHAR(500)           NULL,
  `promoCodeId`     BIGINT UNSIGNED        NULL,
  `bgGradientFrom`  VARCHAR(50)            NULL DEFAULT '#06b6d4',
  `bgGradientTo`    VARCHAR(50)            NULL DEFAULT '#8b5cf6',
  `textColor`       VARCHAR(50)            NULL DEFAULT '#ffffff',
  `startsAt`        TIMESTAMP              NOT NULL,
  `endsAt`          TIMESTAMP              NOT NULL,
  `isActive`        BOOLEAN                NOT NULL DEFAULT TRUE,
  `showCountdown`   BOOLEAN                NOT NULL DEFAULT TRUE,
  `position`        VARCHAR(50)            NOT NULL DEFAULT 'top',
  `createdAt`       TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`       TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `promotions_active_idx` (`isActive`),
  INDEX `prom_dates_idx` (`startsAt`, `endsAt`),
  INDEX `prom_promo_code_idx` (`promoCodeId`),
  CONSTRAINT `fk_promo_promo_code_id` FOREIGN KEY (`promoCodeId`) REFERENCES `promoCodes` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- Re-enable FK checks
-- ============================================================================
SET FOREIGN_KEY_CHECKS = 1;
