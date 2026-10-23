-- ═══════════════════════════════════════════════════════════════════════
-- MIGRATION v10 — persist each model's context window (tokens)
--
-- WHY: thinking sends max_tokens=8192 for reasoning depth. Small-context
-- models (e.g. groq allam-2-7b, 4k window) reject it with a 400, which took
-- out the whole tier-3 safety net exactly when the free tier 429-storms.
-- The router now clamps max_tokens to ctx/3 — but it needs the ctx stored.
-- classifyRawModel already extracts it from the provider /models payload;
-- v10 adds the column and discovery persists it (insert + refresh).
--
-- Executed by api/lib/db-init.ts (v10 block, columnExists-guarded).
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE `aiModels` ADD COLUMN `contextLength` INT NULL AFTER `tier`;
