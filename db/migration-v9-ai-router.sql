-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION v9 — Dynamic AI provider router (admin-managed)
--
-- aiProviders  — admin adds ANY OpenAI-compatible provider (baseUrl + API
--                key + priority) and the chatbot router walks them in
--                priority order with automatic cross-provider failover.
-- aiModels     — models auto-discovered per provider via GET {baseUrl}/models,
--                classified chat vs vision, with per-model health state used
--                by the in-memory circuit breaker (api/lib/ai-router.ts).
--
-- Executed idempotently by api/lib/db-init.ts (CREATE TABLE IF NOT EXISTS).
-- Kept as raw SQL (repo convention: migration-v4-features.sql) so the DDL
-- lives outside the TypeScript analysis and cannot trip code-duplication
-- gates against the older CREATE TABLE blocks in db-init.ts.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS `aiProviders` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug`          VARCHAR(64)     NOT NULL,
  `displayName`   VARCHAR(100)    NOT NULL,
  `baseUrl`       VARCHAR(255)    NOT NULL,
  `apiKey`        VARCHAR(512)    NOT NULL DEFAULT '',
  `priority`      INT             NOT NULL DEFAULT 100,
  `enabled`       BOOLEAN         NOT NULL DEFAULT TRUE,
  `status`        VARCHAR(16)     NOT NULL DEFAULT 'unknown',
  `lastError`     TEXT            NULL,
  `lastCheckedAt` TIMESTAMP       NULL,
  `createdAt`     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_providers_slug_unique` (`slug`),
  INDEX `ai_providers_enabled_priority_idx` (`enabled`, `priority`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `aiModels` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `providerId`     BIGINT UNSIGNED NOT NULL,
  `modelId`        VARCHAR(190)    NOT NULL,
  `supportsChat`   BOOLEAN         NOT NULL DEFAULT TRUE,
  `supportsVision` BOOLEAN         NOT NULL DEFAULT FALSE,
  `isFree`         BOOLEAN         NOT NULL DEFAULT TRUE,
  `enabled`        BOOLEAN         NOT NULL DEFAULT TRUE,
  `tier`           INT             NOT NULL DEFAULT 2,
  `status`         VARCHAR(16)     NOT NULL DEFAULT 'unknown',
  `failCount`      INT             NOT NULL DEFAULT 0,
  `lastError`      VARCHAR(500)    NULL,
  `lastSuccessAt`  TIMESTAMP       NULL,
  `lastUsedAt`     TIMESTAMP       NULL,
  `latencyMs`      INT             NULL,
  `updatedAt`      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_models_provider_model_unique` (`providerId`, `modelId`),
  INDEX `ai_models_provider_idx` (`providerId`),
  INDEX `ai_models_enabled_tier_idx` (`enabled`, `tier`),
  CONSTRAINT `fk_ai_models_provider` FOREIGN KEY (`providerId`) REFERENCES `aiProviders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
