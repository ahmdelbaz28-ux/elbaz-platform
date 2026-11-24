-- ─────────────────────────────────────────────────────────────────────────────
-- v17 — ADMIN APPROVAL GATE on users (owner directive, 2026-11-24)
-- Reference SQL. The authoritative version runs idempotently in
-- api/lib/db-init.ts (v17 block) on every boot — this file documents it.
--
-- Contract: every self-service registration lands as 'pending' and can NEVER
-- obtain a session (local login, Google OAuth, GIS) until an admin approves
-- it — from the dashboard queue or the approval email. Rejection blocks
-- login AND revokes any live session (tokenVersion bump).
-- The column DEFAULT 'approved' grandfathers all pre-gate accounts with zero
-- data backfill; registration always writes the explicit 'pending' value.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE `users` ADD COLUMN `approvalStatus` VARCHAR(20) NOT NULL DEFAULT 'approved';
ALTER TABLE `users` ADD COLUMN `approvalDecidedAt` TIMESTAMP NULL;
ALTER TABLE `users` ADD COLUMN `approvalDecidedByUserId` BIGINT UNSIGNED NULL;
ALTER TABLE `users` ADD INDEX `users_approval_status_idx` (`approvalStatus`);
