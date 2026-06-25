-- Migration v4: 2FA, Sessions, Notes, Licenses
-- Date: 2026-05-19

-- Add 2FA columns to users
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `totpSecret` VARCHAR(255) NULL;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `totpEnabled` BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `totpBackupCodes` JSON NULL;
ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `deviceFingerprint` VARCHAR(255) NULL;

-- User sessions table
CREATE TABLE IF NOT EXISTS `userSessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `userId` BIGINT UNSIGNED NOT NULL,
  `deviceFingerprint` VARCHAR(255) NULL,
  `deviceName` VARCHAR(255) NULL,
  `browser` VARCHAR(100) NULL,
  `os` VARCHAR(100) NULL,
  `ipAddress` VARCHAR(45) NULL,
  `lastActiveAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `isRevoked` BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (`id`),
  INDEX `user_sessions_user_idx` (`userId`),
  INDEX `user_sessions_fingerprint_idx` (`deviceFingerprint`),
  CONSTRAINT `fk_user_sessions_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- User notes table (cloud sync)
CREATE TABLE IF NOT EXISTS `userNotes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `userId` BIGINT UNSIGNED NOT NULL,
  `courseId` BIGINT UNSIGNED NULL,
  `lessonId` BIGINT UNSIGNED NULL,
  `title` VARCHAR(500) NULL,
  `content` TEXT NOT NULL,
  `tags` JSON NULL,
  `isPinned` BOOLEAN NOT NULL DEFAULT FALSE,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `user_notes_user_idx` (`userId`),
  INDEX `user_notes_course_idx` (`courseId`),
  INDEX `user_notes_lesson_idx` (`lessonId`),
  CONSTRAINT `fk_user_notes_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_user_notes_course` FOREIGN KEY (`courseId`) REFERENCES `courses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_user_notes_lesson` FOREIGN KEY (`lessonId`) REFERENCES `lessons` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Licenses table
CREATE TABLE IF NOT EXISTS `licenses` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `userId` BIGINT UNSIGNED NOT NULL,
  `courseId` BIGINT UNSIGNED NULL,
  `licenseKey` VARCHAR(255) NOT NULL,
  `type` VARCHAR(50) NOT NULL DEFAULT 'course',
  `status` VARCHAR(50) NOT NULL DEFAULT 'active',
  `validFrom` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `validUntil` TIMESTAMP NULL,
  `maxDevices` INT NOT NULL DEFAULT 3,
  `activatedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `licenses_key_unique` (`licenseKey`),
  INDEX `licenses_user_idx` (`userId`),
  INDEX `licenses_status_idx` (`status`),
  CONSTRAINT `fk_licenses_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_licenses_course` FOREIGN KEY (`courseId`) REFERENCES `courses` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
