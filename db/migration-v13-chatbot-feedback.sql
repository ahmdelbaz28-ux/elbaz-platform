-- ─────────────────────────────────────────────────────────────────────────────
-- v13 — chatbotFeedback table (chatbot 👍/👎 feedback loop)
-- Reference SQL. The authoritative version runs idempotently in
-- api/lib/db-init.ts (v13 block) on every boot — this file documents it.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `chatbotFeedback` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `chatId` VARCHAR(64) NOT NULL,
  `userId` BIGINT UNSIGNED NULL,
  `rating` VARCHAR(8) NOT NULL,
  `comment` VARCHAR(600) NULL,
  `question` TEXT NOT NULL,
  `answer` TEXT NOT NULL,
  `language` VARCHAR(8) NOT NULL DEFAULT 'ar',
  `mode` VARCHAR(12) NULL,
  `model` VARCHAR(120) NULL,
  `source` VARCHAR(16) NOT NULL DEFAULT 'web',
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `chatbot_feedback_created_idx` (`createdAt`),
  INDEX `chatbot_feedback_rating_idx` (`rating`),
  INDEX `chatbot_feedback_chat_idx` (`chatId`),
  CONSTRAINT `fk_chatbot_feedback_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
