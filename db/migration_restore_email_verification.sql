-- ═══════════════════════════════════════════════════════════════════════
-- Restore email verification columns to users table
-- These columns were incorrectly dropped by migration_schema_v2_cleanup.sql
-- but are required by the email verification flow in local-auth-router.ts
-- ═══════════════════════════════════════════════════════════════════════

-- Add columns back (IF NOT EXISTS not supported for ADD COLUMN in MySQL 8.0,
-- so we use a procedure to handle the case where columns already exist)

-- Restore emailVerificationToken
SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'emailVerificationToken'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN emailVerificationToken VARCHAR(255) NULL AFTER passwordResetExpiresAt',
  'SELECT "emailVerificationToken already exists" AS status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Restore emailVerificationExpiry
SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'emailVerificationExpiry'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN emailVerificationExpiry TIMESTAMP NULL AFTER emailVerificationToken',
  'SELECT "emailVerificationExpiry already exists" AS status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Restore emailVerifiedAt
SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'emailVerifiedAt'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN emailVerifiedAt TIMESTAMP NULL AFTER emailVerificationExpiry',
  'SELECT "emailVerifiedAt already exists" AS status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Also restore lessonProgress columns that were incorrectly dropped
SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'lessonProgress'
    AND COLUMN_NAME = 'watchedSeconds'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE lessonProgress ADD COLUMN watchedSeconds INT NOT NULL DEFAULT 0 AFTER completed',
  'SELECT "watchedSeconds already exists" AS status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'lessonProgress'
    AND COLUMN_NAME = 'lastPosition'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE lessonProgress ADD COLUMN lastPosition INT NOT NULL DEFAULT 0 AFTER watchedSeconds',
  'SELECT "lastPosition already exists" AS status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'lessonProgress'
    AND COLUMN_NAME = 'lastHeartbeatAt'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE lessonProgress ADD COLUMN lastHeartbeatAt TIMESTAMP NULL AFTER lastPosition',
  'SELECT "lastHeartbeatAt already exists" AS status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
