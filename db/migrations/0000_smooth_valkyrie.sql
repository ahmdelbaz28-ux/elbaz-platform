CREATE TABLE `categories` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`slug` varchar(255) NOT NULL,
	`nameEn` varchar(255) NOT NULL,
	`nameAr` varchar(255) NOT NULL,
	`descriptionEn` text,
	`descriptionAr` text,
	`icon` varchar(100) NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `categories_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `certificates` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`courseId` bigint unsigned NOT NULL,
	`enrollmentId` bigint unsigned NOT NULL,
	`certificateNumber` varchar(100) NOT NULL,
	`issuedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`grade` varchar(50),
	`averageScore` int unsigned,
	`verified` boolean DEFAULT false,
	CONSTRAINT `certificates_id` PRIMARY KEY(`id`),
	CONSTRAINT `cert_number_unique` UNIQUE(`certificateNumber`),
	CONSTRAINT `cert_user_course_unique` UNIQUE(`userId`,`courseId`)
);
--> statement-breakpoint
CREATE TABLE `chatMessages` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`courseId` bigint unsigned,
	`role` varchar(20) NOT NULL,
	`content` text NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chatMessages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `courses` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`slug` varchar(255) NOT NULL,
	`categoryId` bigint unsigned NOT NULL,
	`titleEn` varchar(500) NOT NULL,
	`titleAr` varchar(500) NOT NULL,
	`descriptionEn` text,
	`descriptionAr` text,
	`shortDescEn` varchar(500),
	`shortDescAr` varchar(500),
	`thumbnail` varchar(500),
	`trailerUrl` varchar(500),
	`level` varchar(50) NOT NULL DEFAULT 'beginner',
	`isPremium` boolean NOT NULL DEFAULT false,
	`price` decimal(10,2) NOT NULL DEFAULT '0.00',
	`originalPrice` decimal(10,2) NOT NULL DEFAULT '0.00',
	`durationHours` int NOT NULL DEFAULT 0,
	`rating` decimal(3,1) NOT NULL DEFAULT '5.0',
	`reviewCount` int NOT NULL DEFAULT 0,
	`studentCount` int NOT NULL DEFAULT 0,
	`instructorName` varchar(255) NOT NULL DEFAULT 'Eng Ahmed Elbaz',
	`isPublished` boolean NOT NULL DEFAULT true,
	`isFeatured` boolean NOT NULL DEFAULT false,
	`prerequisitesEn` text,
	`prerequisitesAr` text,
	`learningOutcomesEn` json,
	`learningOutcomesAr` json,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `courses_id` PRIMARY KEY(`id`),
	CONSTRAINT `courses_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `enrollments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`courseId` bigint unsigned NOT NULL,
	`status` varchar(50) NOT NULL DEFAULT 'active',
	`progress` decimal(5,2) NOT NULL DEFAULT '0.00',
	`enrolledAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	`expiresAt` timestamp,
	`isCompleted` boolean DEFAULT false,
	`lastAccessedAt` timestamp,
	CONSTRAINT `enrollments_id` PRIMARY KEY(`id`),
	CONSTRAINT `enrollments_user_course_unique` UNIQUE(`userId`,`courseId`)
);
--> statement-breakpoint
CREATE TABLE `lessonProgress` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`lessonId` bigint unsigned NOT NULL,
	`courseId` bigint unsigned NOT NULL,
	`status` varchar(50) NOT NULL DEFAULT 'not_started',
	`watchedSeconds` int DEFAULT 0,
	`completedAt` timestamp,
	`lastAccessedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`isCompleted` boolean DEFAULT false,
	`isQuizPassed` boolean DEFAULT false,
	`quizScore` int DEFAULT 0,
	`lastPosition` int DEFAULT 0,
	`lastHeartbeatAt` timestamp,
	CONSTRAINT `lessonProgress_id` PRIMARY KEY(`id`),
	CONSTRAINT `lp_user_lesson_unique` UNIQUE(`userId`,`lessonId`)
);
--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`courseId` bigint unsigned NOT NULL,
	`titleEn` varchar(500) NOT NULL,
	`titleAr` varchar(500) NOT NULL,
	`descriptionEn` text,
	`descriptionAr` text,
	`videoUrl` varchar(500),
	`durationMinutes` int,
	`sortOrder` int NOT NULL DEFAULT 0,
	`isFree` boolean NOT NULL DEFAULT false,
	`isPublished` boolean NOT NULL DEFAULT false,
	`attachments` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lessons_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `licenses` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`courseId` bigint unsigned,
	`licenseKey` varchar(255) NOT NULL,
	`type` varchar(50) NOT NULL DEFAULT 'course',
	`status` varchar(50) NOT NULL DEFAULT 'active',
	`validFrom` timestamp NOT NULL DEFAULT (now()),
	`validUntil` timestamp,
	`maxDevices` int NOT NULL DEFAULT 3,
	`activatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `licenses_id` PRIMARY KEY(`id`),
	CONSTRAINT `licenses_licenseKey_unique` UNIQUE(`licenseKey`),
	CONSTRAINT `licenses_key_unique` UNIQUE(`licenseKey`)
);
--> statement-breakpoint
CREATE TABLE `passwordResetTokens` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`tokenHash` varchar(255) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `passwordResetTokens_id` PRIMARY KEY(`id`),
	CONSTRAINT `prt_token_hash_idx` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`courseId` bigint unsigned NOT NULL,
	`enrollmentId` bigint unsigned,
	`amount` decimal(10,2) NOT NULL,
	`discountAmount` decimal(10,2) DEFAULT '0.00',
	`currency` varchar(10) NOT NULL DEFAULT 'EGP',
	`provider` varchar(50) NOT NULL,
	`providerPaymentId` varchar(255),
	`status` varchar(50) NOT NULL DEFAULT 'pending',
	`promoCodeId` bigint unsigned,
	`metadata` json,
	`paidAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`transactionId` varchar(255),
	`paymentMethod` varchar(50),
	`phoneNumber` varchar(20),
	`paymobOrderId` varchar(255),
	`finalAmount` decimal(10,2),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `payments_transaction_unique` UNIQUE(`transactionId`)
);
--> statement-breakpoint
CREATE TABLE `promoCodeUsage` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`promoCodeId` bigint unsigned NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`paymentId` bigint unsigned,
	`usedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `promoCodeUsage_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `promoCodes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`code` varchar(50) NOT NULL,
	`description` text,
	`discountType` varchar(20) NOT NULL DEFAULT 'percentage',
	`discountValue` decimal(5,2) NOT NULL,
	`maxUses` int,
	`maxUsesPerUser` int DEFAULT 1,
	`usedCount` int NOT NULL DEFAULT 0,
	`courseIds` json,
	`isValidForAllCourses` boolean NOT NULL DEFAULT true,
	`validFrom` timestamp NOT NULL DEFAULT (now()),
	`validUntil` timestamp,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdBy` bigint unsigned NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `promoCodes_id` PRIMARY KEY(`id`),
	CONSTRAINT `promoCodes_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `promotions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`titleEn` varchar(500) NOT NULL,
	`titleAr` varchar(500) NOT NULL,
	`subtitleEn` varchar(500),
	`subtitleAr` varchar(500),
	`discountText` varchar(100),
	`ctaTextEn` varchar(100),
	`ctaTextAr` varchar(100),
	`ctaUrl` varchar(500),
	`promoCodeId` bigint unsigned,
	`bgGradientFrom` varchar(50) DEFAULT '#06b6d4',
	`bgGradientTo` varchar(50) DEFAULT '#8b5cf6',
	`textColor` varchar(50) DEFAULT '#ffffff',
	`startsAt` timestamp NOT NULL,
	`endsAt` timestamp NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`showCountdown` boolean NOT NULL DEFAULT true,
	`position` varchar(50) NOT NULL DEFAULT 'top',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `promotions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quizQuestions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`lessonId` bigint unsigned NOT NULL,
	`questionEn` text NOT NULL,
	`questionAr` text NOT NULL,
	`optionsEn` json,
	`optionsAr` json,
	`correctIndex` int,
	`points` int NOT NULL DEFAULT 10,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `quizQuestions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`courseId` bigint unsigned NOT NULL,
	`rating` int NOT NULL,
	`comment` text,
	`isPublished` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reviews_id` PRIMARY KEY(`id`),
	CONSTRAINT `reviews_user_course_unique` UNIQUE(`userId`,`courseId`)
);
--> statement-breakpoint
CREATE TABLE `siteSettings` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`section` varchar(100) NOT NULL,
	`key` varchar(255) NOT NULL,
	`value` text NOT NULL,
	`type` varchar(50) NOT NULL DEFAULT 'text',
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `siteSettings_id` PRIMARY KEY(`id`),
	CONSTRAINT `ss_section_key_idx` UNIQUE(`section`,`key`)
);
--> statement-breakpoint
CREATE TABLE `softwareDownloads` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`titleEn` varchar(500) NOT NULL,
	`titleAr` varchar(500) NOT NULL,
	`descriptionEn` text,
	`descriptionAr` text,
	`url` varchar(1000) NOT NULL,
	`iconUrl` varchar(500),
	`isExternal` boolean NOT NULL DEFAULT true,
	`sortOrder` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `softwareDownloads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `supportTickets` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`subject` varchar(500) NOT NULL,
	`message` text NOT NULL,
	`category` varchar(100) NOT NULL DEFAULT 'general',
	`status` varchar(50) NOT NULL DEFAULT 'open',
	`priority` varchar(20) NOT NULL DEFAULT 'medium',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `supportTickets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `testimonials` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`title` varchar(255),
	`company` varchar(255),
	`content` text NOT NULL,
	`rating` int NOT NULL DEFAULT 5,
	`isPublished` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `testimonials_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `themes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`primaryColor` varchar(50) DEFAULT '#06b6d4',
	`secondaryColor` varchar(50) DEFAULT '#0891b2',
	`accentColor` varchar(50) DEFAULT '#f59e0b',
	`bgColor` varchar(50) DEFAULT '#0a0e17',
	`cardBgColor` varchar(50) DEFAULT '#111827',
	`textColor` varchar(50) DEFAULT '#f0f4f8',
	`mutedTextColor` varchar(50) DEFAULT '#94a3b8',
	`borderColor` varchar(50) DEFAULT '#1f2d44',
	`fontFamily` varchar(255) DEFAULT 'Inter, sans-serif',
	`headingFontFamily` varchar(255) DEFAULT 'Inter, sans-serif',
	`borderRadius` varchar(50) DEFAULT '12px',
	`isActive` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `themes_id` PRIMARY KEY(`id`),
	CONSTRAINT `themes_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `ticketReplies` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`ticketId` bigint unsigned NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`message` text NOT NULL,
	`isAdminReply` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ticketReplies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `userNotes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`courseId` bigint unsigned,
	`lessonId` bigint unsigned,
	`title` varchar(500),
	`content` text NOT NULL,
	`tags` json,
	`isPinned` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `userNotes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `userSessions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`userId` bigint unsigned NOT NULL,
	`deviceFingerprint` varchar(255),
	`deviceName` varchar(255),
	`browser` varchar(100),
	`os` varchar(100),
	`ipAddress` varchar(45),
	`lastActiveAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`isRevoked` boolean NOT NULL DEFAULT false,
	CONSTRAINT `userSessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`username` varchar(255) NOT NULL,
	`passwordHash` varchar(255),
	`googleId` varchar(255),
	`name` varchar(255),
	`email` varchar(320),
	`pendingEmail` varchar(320),
	`avatar` text,
	`role` varchar(50) NOT NULL DEFAULT 'user',
	`preferredLanguage` varchar(10) NOT NULL DEFAULT 'en',
	`tokenVersion` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`lastSignInAt` timestamp NOT NULL DEFAULT (now()),
	`passwordResetToken` varchar(255),
	`passwordResetExpiresAt` timestamp,
	`emailVerificationToken` varchar(255),
	`emailVerificationExpiry` timestamp,
	`emailVerifiedAt` timestamp,
	`totpSecret` varchar(255),
	`totpEnabled` boolean NOT NULL DEFAULT false,
	`totpBackupCodes` json,
	`deviceFingerprint` varchar(255),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`),
	CONSTRAINT `users_username_unique` UNIQUE(`username`),
	CONSTRAINT `users_google_id_unique` UNIQUE(`googleId`)
);
--> statement-breakpoint
ALTER TABLE `certificates` ADD CONSTRAINT `fk_cert_user_id` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `certificates` ADD CONSTRAINT `fk_cert_course_id` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `certificates` ADD CONSTRAINT `fk_cert_enrollment_id` FOREIGN KEY (`enrollmentId`) REFERENCES `enrollments`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `chatMessages` ADD CONSTRAINT `fk_chat_user_id` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `chatMessages` ADD CONSTRAINT `fk_chat_course_id` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `courses` ADD CONSTRAINT `fk_courses_category_id` FOREIGN KEY (`categoryId`) REFERENCES `categories`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `enrollments` ADD CONSTRAINT `fk_enrollments_user_id` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `enrollments` ADD CONSTRAINT `fk_enrollments_course_id` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `lessonProgress` ADD CONSTRAINT `fk_lp_user_id` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `lessonProgress` ADD CONSTRAINT `fk_lp_lesson_id` FOREIGN KEY (`lessonId`) REFERENCES `lessons`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `lessonProgress` ADD CONSTRAINT `fk_lp_course_id` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `lessons` ADD CONSTRAINT `fk_lessons_course_id` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `licenses` ADD CONSTRAINT `fk_licenses_user` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `licenses` ADD CONSTRAINT `fk_licenses_course` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `passwordResetTokens` ADD CONSTRAINT `fk_prt_user_id` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `fk_payments_user_id` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `fk_payments_course_id` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `fk_payments_enrollment_id` FOREIGN KEY (`enrollmentId`) REFERENCES `enrollments`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `promoCodeUsage` ADD CONSTRAINT `fk_pcu_promo_code_id` FOREIGN KEY (`promoCodeId`) REFERENCES `promoCodes`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `promoCodeUsage` ADD CONSTRAINT `fk_pcu_user_id` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `promoCodeUsage` ADD CONSTRAINT `fk_pcu_payment_id` FOREIGN KEY (`paymentId`) REFERENCES `payments`(`id`) ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `promoCodes` ADD CONSTRAINT `fk_promoCodes_created_by` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `quizQuestions` ADD CONSTRAINT `fk_qq_lesson_id` FOREIGN KEY (`lessonId`) REFERENCES `lessons`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `reviews` ADD CONSTRAINT `fk_reviews_user_id` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `reviews` ADD CONSTRAINT `fk_reviews_course_id` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `supportTickets` ADD CONSTRAINT `fk_st_user_id` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `ticketReplies` ADD CONSTRAINT `fk_tr_ticket_id` FOREIGN KEY (`ticketId`) REFERENCES `supportTickets`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `ticketReplies` ADD CONSTRAINT `fk_tr_user_id` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `userNotes` ADD CONSTRAINT `fk_user_notes_user` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `userNotes` ADD CONSTRAINT `fk_user_notes_course` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `userNotes` ADD CONSTRAINT `fk_user_notes_lesson` FOREIGN KEY (`lessonId`) REFERENCES `lessons`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `userSessions` ADD CONSTRAINT `fk_user_sessions_user` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `categories_sort_idx` ON `categories` (`sortOrder`);--> statement-breakpoint
CREATE INDEX `cert_user_idx` ON `certificates` (`userId`);--> statement-breakpoint
CREATE INDEX `chat_user_idx` ON `chatMessages` (`userId`);--> statement-breakpoint
CREATE INDEX `chat_course_idx` ON `chatMessages` (`courseId`);--> statement-breakpoint
CREATE INDEX `chat_created_idx` ON `chatMessages` (`createdAt`);--> statement-breakpoint
CREATE INDEX `courses_category_idx` ON `courses` (`categoryId`);--> statement-breakpoint
CREATE INDEX `courses_published_idx` ON `courses` (`isPublished`);--> statement-breakpoint
CREATE INDEX `courses_featured_idx` ON `courses` (`isFeatured`);--> statement-breakpoint
CREATE INDEX `courses_price_idx` ON `courses` (`price`);--> statement-breakpoint
CREATE INDEX `enrollments_user_idx` ON `enrollments` (`userId`);--> statement-breakpoint
CREATE INDEX `enrollments_course_idx` ON `enrollments` (`courseId`);--> statement-breakpoint
CREATE INDEX `enrollments_status_idx` ON `enrollments` (`status`);--> statement-breakpoint
CREATE INDEX `lp_user_idx` ON `lessonProgress` (`userId`);--> statement-breakpoint
CREATE INDEX `lp_lesson_idx` ON `lessonProgress` (`lessonId`);--> statement-breakpoint
CREATE INDEX `lp_course_idx` ON `lessonProgress` (`courseId`);--> statement-breakpoint
CREATE INDEX `lessons_course_idx` ON `lessons` (`courseId`);--> statement-breakpoint
CREATE INDEX `lessons_sort_idx` ON `lessons` (`sortOrder`);--> statement-breakpoint
CREATE INDEX `licenses_user_idx` ON `licenses` (`userId`);--> statement-breakpoint
CREATE INDEX `licenses_status_idx` ON `licenses` (`status`);--> statement-breakpoint
CREATE INDEX `prt_user_idx` ON `passwordResetTokens` (`userId`);--> statement-breakpoint
CREATE INDEX `prt_expires_idx` ON `passwordResetTokens` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `payments_transaction_idx` ON `payments` (`transactionId`);--> statement-breakpoint
CREATE INDEX `payments_user_idx` ON `payments` (`userId`);--> statement-breakpoint
CREATE INDEX `payments_course_idx` ON `payments` (`courseId`);--> statement-breakpoint
CREATE INDEX `payments_status_idx` ON `payments` (`status`);--> statement-breakpoint
CREATE INDEX `payments_provider_idx` ON `payments` (`provider`);--> statement-breakpoint
CREATE INDEX `payments_provider_payment_idx` ON `payments` (`providerPaymentId`);--> statement-breakpoint
CREATE INDEX `payments_created_idx` ON `payments` (`createdAt`);--> statement-breakpoint
CREATE INDEX `pcu_promo_idx` ON `promoCodeUsage` (`promoCodeId`);--> statement-breakpoint
CREATE INDEX `pcu_user_idx` ON `promoCodeUsage` (`userId`);--> statement-breakpoint
CREATE INDEX `pcu_payment_idx` ON `promoCodeUsage` (`paymentId`);--> statement-breakpoint
CREATE INDEX `promoCodes_active_idx` ON `promoCodes` (`isActive`);--> statement-breakpoint
CREATE INDEX `promoCodes_validity_idx` ON `promoCodes` (`validFrom`,`validUntil`);--> statement-breakpoint
CREATE INDEX `promotions_active_idx` ON `promotions` (`isActive`);--> statement-breakpoint
CREATE INDEX `prom_dates_idx` ON `promotions` (`startsAt`,`endsAt`);--> statement-breakpoint
CREATE INDEX `qq_lesson_idx` ON `quizQuestions` (`lessonId`);--> statement-breakpoint
CREATE INDEX `reviews_course_idx` ON `reviews` (`courseId`);--> statement-breakpoint
CREATE INDEX `reviews_rating_idx` ON `reviews` (`rating`);--> statement-breakpoint
CREATE INDEX `ss_section_idx` ON `siteSettings` (`section`);--> statement-breakpoint
CREATE INDEX `st_user_idx` ON `supportTickets` (`userId`);--> statement-breakpoint
CREATE INDEX `st_status_idx` ON `supportTickets` (`status`);--> statement-breakpoint
CREATE INDEX `st_created_idx` ON `supportTickets` (`createdAt`);--> statement-breakpoint
CREATE INDEX `testimonials_published_idx` ON `testimonials` (`isPublished`);--> statement-breakpoint
CREATE INDEX `tr_ticket_idx` ON `ticketReplies` (`ticketId`);--> statement-breakpoint
CREATE INDEX `tr_user_idx` ON `ticketReplies` (`userId`);--> statement-breakpoint
CREATE INDEX `user_notes_user_idx` ON `userNotes` (`userId`);--> statement-breakpoint
CREATE INDEX `user_notes_course_idx` ON `userNotes` (`courseId`);--> statement-breakpoint
CREATE INDEX `user_notes_lesson_idx` ON `userNotes` (`lessonId`);--> statement-breakpoint
CREATE INDEX `user_sessions_user_idx` ON `userSessions` (`userId`);--> statement-breakpoint
CREATE INDEX `user_sessions_fingerprint_idx` ON `userSessions` (`deviceFingerprint`);--> statement-breakpoint
CREATE INDEX `users_role_idx` ON `users` (`role`);