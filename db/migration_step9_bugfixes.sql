-- ═══════════════════════════════════════════════════════════════════════
-- Elbaz LMS — Step 9: Bug Fixes Migration
-- Run this SQL on your MySQL database to apply security fixes
-- ═══════════════════════════════════════════════════════════════════════

-- 1. ✅ CRITICAL FIX: Add dedicated password reset columns
-- Previously, password reset tokens were stored in the avatar field,
-- which permanently destroyed user avatars on every reset request!
ALTER TABLE users ADD COLUMN passwordResetToken VARCHAR(255) NULL AFTER lastSignInAt;
ALTER TABLE users ADD COLUMN passwordResetExpiresAt TIMESTAMP NULL AFTER passwordResetToken;

-- 2. ✅ SECURITY: Add index for password reset token lookups
CREATE INDEX idx_users_password_reset ON users (passwordResetToken) WHERE passwordResetToken IS NOT NULL;
