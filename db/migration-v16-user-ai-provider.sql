-- ─────────────────────────────────────────────────────────────────────────────
-- v16 — userAiProviders table (BYOK: bring-your-own-key, optional per user)
-- Reference SQL. The authoritative version runs idempotently in
-- api/lib/db-init.ts (v16 block) on every boot — this file documents it.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `userAiProviders` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `userId` BIGINT UNSIGNED NOT NULL,
  `provider` VARCHAR(48) NOT NULL DEFAULT 'custom',
  `baseUrl` VARCHAR(255) NOT NULL,
  `modelId` VARCHAR(190) NOT NULL,
  `apiKeyEnc` TEXT NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `lastTestOk` BOOLEAN NULL,
  `lastTestError` VARCHAR(400) NULL,
  `lastTestedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `user_ai_providers_user_unique` (`userId`),
  CONSTRAINT `fk_user_ai_providers_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
