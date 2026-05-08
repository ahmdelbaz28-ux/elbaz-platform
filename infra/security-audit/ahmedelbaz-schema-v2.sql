SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = 'NO_ENGINE_SUBSTITUTION';
SET time_zone = '+00:00';

CREATE DATABASE IF NOT EXISTS ahmedelbaz_lms
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE ahmedelbaz_lms;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL,
  email VARCHAR(255) NOT NULL,
  passwordHash VARCHAR(255) NOT NULL,
  name VARCHAR(191) NOT NULL,
  role ENUM('student', 'instructor', 'admin', 'superadmin') NOT NULL DEFAULT 'student',
  phone VARCHAR(30) DEFAULT NULL,
  avatarUrl VARCHAR(500) DEFAULT NULL,
  emailVerified TINYINT(1) NOT NULL DEFAULT 0,
  emailVerifyToken VARCHAR(255) DEFAULT NULL,
  emailVerifyExpires DATETIME DEFAULT NULL,
  isActive TINYINT(1) NOT NULL DEFAULT 1,
  lastLoginAt DATETIME DEFAULT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deletedAt DATETIME DEFAULT NULL,
  preferences JSON DEFAULT NULL,
  loginCount INT UNSIGNED NOT NULL DEFAULT 0,
  lastLoginIp VARCHAR(45) DEFAULT NULL,
  twoFactorEnabled TINYINT(1) NOT NULL DEFAULT 0,
  twoFactorSecret VARCHAR(255) DEFAULT NULL,
  bio TEXT DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_email (email),
  KEY idx_users_role (role),
  KEY idx_users_emailVerified (emailVerified),
  KEY idx_users_isActive (isActive),
  KEY idx_users_createdAt (createdAt),
  KEY idx_users_deletedAt (deletedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
  id CHAR(36) NOT NULL,
  name VARCHAR(191) NOT NULL,
  nameAr VARCHAR(191) DEFAULT NULL,
  slug VARCHAR(191) NOT NULL,
  iconUrl VARCHAR(500) DEFAULT NULL,
  sortOrder INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_categories_slug (slug),
  KEY idx_categories_sortOrder (sortOrder)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS courses (
  id CHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  titleAr VARCHAR(255) DEFAULT NULL,
  description TEXT DEFAULT NULL,
  descriptionAr TEXT DEFAULT NULL,
  thumbnailUrl VARCHAR(500) DEFAULT NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  discountedPrice DECIMAL(10,2) DEFAULT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'EGP',
  instructorId CHAR(36) NOT NULL,
  categoryId CHAR(36) DEFAULT NULL,
  level ENUM('beginner', 'intermediate', 'advanced', 'all_levels') NOT NULL DEFAULT 'beginner',
  language VARCHAR(10) NOT NULL DEFAULT 'ar',
  durationHours DECIMAL(6,2) NOT NULL DEFAULT 0.00,
  isPublished TINYINT(1) NOT NULL DEFAULT 0,
  enrolledCount INT UNSIGNED NOT NULL DEFAULT 0,
  rating DECIMAL(3,2) NOT NULL DEFAULT 0.00,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_courses_instructorId (instructorId),
  KEY idx_courses_categoryId (categoryId),
  KEY idx_courses_isPublished (isPublished),
  KEY idx_courses_level (level),
  KEY idx_courses_rating (rating),
  KEY idx_courses_createdAt (createdAt),
  CONSTRAINT fk_courses_instructorId FOREIGN KEY (instructorId) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_courses_categoryId FOREIGN KEY (categoryId) REFERENCES categories (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS modules (
  id CHAR(36) NOT NULL,
  courseId CHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  titleAr VARCHAR(255) DEFAULT NULL,
  description TEXT DEFAULT NULL,
  sortOrder INT NOT NULL DEFAULT 0,
  durationMinutes INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_modules_courseId (courseId),
  KEY idx_modules_sortOrder (sortOrder),
  CONSTRAINT fk_modules_courseId FOREIGN KEY (courseId) REFERENCES courses (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lessons (
  id CHAR(36) NOT NULL,
  moduleId CHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  titleAr VARCHAR(255) DEFAULT NULL,
  type ENUM('video', 'article', 'quiz', 'assignment', 'downloadable') NOT NULL DEFAULT 'video',
  contentUrl VARCHAR(1000) DEFAULT NULL,
  durationMinutes INT UNSIGNED NOT NULL DEFAULT 0,
  isFree TINYINT(1) NOT NULL DEFAULT 0,
  sortOrder INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_lessons_moduleId (moduleId),
  KEY idx_lessons_type (type),
  KEY idx_lessons_sortOrder (sortOrder),
  CONSTRAINT fk_lessons_moduleId FOREIGN KEY (moduleId) REFERENCES modules (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS enrollments (
  id CHAR(36) NOT NULL,
  userId CHAR(36) NOT NULL,
  courseId CHAR(36) NOT NULL,
  status ENUM('active', 'completed', 'cancelled', 'refunded', 'expired') NOT NULL DEFAULT 'active',
  progressPercent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  enrolledAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completedAt DATETIME DEFAULT NULL,
  certificateId CHAR(36) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_enrollments_user_course (userId, courseId),
  KEY idx_enrollments_userId (userId),
  KEY idx_enrollments_courseId (courseId),
  KEY idx_enrollments_status (status),
  KEY idx_enrollments_enrolledAt (enrolledAt),
  CONSTRAINT fk_enrollments_userId FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_enrollments_courseId FOREIGN KEY (courseId) REFERENCES courses (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quizQuestions (
  id CHAR(36) NOT NULL,
  courseId CHAR(36) NOT NULL,
  moduleId CHAR(36) DEFAULT NULL,
  lessonId CHAR(36) DEFAULT NULL,
  question TEXT NOT NULL,
  questionAr TEXT DEFAULT NULL,
  type ENUM('multiple_choice', 'true_false', 'fill_blank', 'matching', 'short_answer') NOT NULL DEFAULT 'multiple_choice',
  options JSON DEFAULT NULL,
  correctAnswer TEXT NOT NULL,
  explanation TEXT DEFAULT NULL,
  difficulty ENUM('easy', 'medium', 'hard') NOT NULL DEFAULT 'medium',
  sortOrder INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_quizQuestions_courseId (courseId),
  KEY idx_quizQuestions_moduleId (moduleId),
  KEY idx_quizQuestions_lessonId (lessonId),
  KEY idx_quizQuestions_difficulty (difficulty),
  KEY idx_quizQuestions_sortOrder (sortOrder),
  CONSTRAINT fk_quizQuestions_courseId FOREIGN KEY (courseId) REFERENCES courses (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_quizQuestions_moduleId FOREIGN KEY (moduleId) REFERENCES modules (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_quizQuestions_lessonId FOREIGN KEY (lessonId) REFERENCES lessons (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS quizAttempts (
  id CHAR(36) NOT NULL,
  userId CHAR(36) NOT NULL,
  courseId CHAR(36) NOT NULL,
  quizId CHAR(36) NOT NULL,
  score DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  totalQuestions INT UNSIGNED NOT NULL DEFAULT 0,
  correctAnswers INT UNSIGNED NOT NULL DEFAULT 0,
  attemptNumber INT UNSIGNED NOT NULL DEFAULT 1,
  timeSpentSeconds INT UNSIGNED NOT NULL DEFAULT 0,
  startedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completedAt DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_quizAttempts_userId (userId),
  KEY idx_quizAttempts_courseId (courseId),
  KEY idx_quizAttempts_quizId (quizId),
  KEY idx_quizAttempts_score (score),
  KEY idx_quizAttempts_startedAt (startedAt),
  CONSTRAINT fk_quizAttempts_userId FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_quizAttempts_courseId FOREIGN KEY (courseId) REFERENCES courses (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_quizAttempts_quizId FOREIGN KEY (quizId) REFERENCES quizQuestions (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS progress (
  id CHAR(36) NOT NULL,
  userId CHAR(36) NOT NULL,
  lessonId CHAR(36) NOT NULL,
  status ENUM('not_started', 'in_progress', 'completed') NOT NULL DEFAULT 'not_started',
  completedAt DATETIME DEFAULT NULL,
  timeSpentSeconds INT UNSIGNED NOT NULL DEFAULT 0,
  lastPosition INT UNSIGNED DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_progress_user_lesson (userId, lessonId),
  KEY idx_progress_userId (userId),
  KEY idx_progress_lessonId (lessonId),
  KEY idx_progress_status (status),
  CONSTRAINT fk_progress_userId FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_progress_lessonId FOREIGN KEY (lessonId) REFERENCES lessons (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS certificates (
  id CHAR(36) NOT NULL,
  userId CHAR(36) NOT NULL,
  courseId CHAR(36) NOT NULL,
  certificateUrl VARCHAR(1000) DEFAULT NULL,
  issuedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verificationCode VARCHAR(64) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_certificates_verificationCode (verificationCode),
  UNIQUE KEY uk_certificates_user_course (userId, courseId),
  KEY idx_certificates_userId (userId),
  KEY idx_certificates_courseId (courseId),
  KEY idx_certificates_issuedAt (issuedAt),
  CONSTRAINT fk_certificates_userId FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_certificates_courseId FOREIGN KEY (courseId) REFERENCES courses (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id CHAR(36) NOT NULL,
  userId CHAR(36) NOT NULL,
  courseId CHAR(36) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'EGP',
  provider ENUM('stripe', 'paypal', 'paymob', 'fawry', 'manual') NOT NULL,
  providerPaymentId VARCHAR(255) DEFAULT NULL,
  status ENUM('pending', 'completed', 'failed', 'refunded', 'cancelled') NOT NULL DEFAULT 'pending',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payments_userId (userId),
  KEY idx_payments_courseId (courseId),
  KEY idx_payments_provider (provider),
  KEY idx_payments_status (status),
  KEY idx_payments_createdAt (createdAt),
  KEY idx_payments_providerPaymentId (providerPaymentId),
  CONSTRAINT fk_payments_userId FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_payments_courseId FOREIGN KEY (courseId) REFERENCES courses (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS promoCodes (
  id CHAR(36) NOT NULL,
  code VARCHAR(50) NOT NULL,
  discountPercent DECIMAL(5,2) NOT NULL,
  maxUses INT UNSIGNED NOT NULL DEFAULT 0,
  usedCount INT UNSIGNED NOT NULL DEFAULT 0,
  validFrom DATETIME NOT NULL,
  validTo DATETIME NOT NULL,
  isActive TINYINT(1) NOT NULL DEFAULT 1,
  createdBy CHAR(36) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_promoCodes_code (code),
  KEY idx_promoCodes_isActive (isActive),
  KEY idx_promoCodes_validFrom (validFrom),
  KEY idx_promoCodes_validTo (validTo),
  CONSTRAINT fk_promoCodes_createdBy FOREIGN KEY (createdBy) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reviews (
  id CHAR(36) NOT NULL,
  userId CHAR(36) NOT NULL,
  courseId CHAR(36) NOT NULL,
  rating TINYINT UNSIGNED NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT DEFAULT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_reviews_user_course (userId, courseId),
  KEY idx_reviews_userId (userId),
  KEY idx_reviews_courseId (courseId),
  KEY idx_reviews_rating (rating),
  KEY idx_reviews_createdAt (createdAt),
  CONSTRAINT fk_reviews_userId FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_reviews_courseId FOREIGN KEY (courseId) REFERENCES courses (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supportTickets (
  id CHAR(36) NOT NULL,
  userId CHAR(36) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  status ENUM('open', 'in_progress', 'waiting', 'resolved', 'closed') NOT NULL DEFAULT 'open',
  priority ENUM('low', 'medium', 'high', 'critical') NOT NULL DEFAULT 'medium',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_supportTickets_userId (userId),
  KEY idx_supportTickets_status (status),
  KEY idx_supportTickets_priority (priority),
  KEY idx_supportTickets_createdAt (createdAt),
  CONSTRAINT fk_supportTickets_userId FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supportMessages (
  id CHAR(36) NOT NULL,
  ticketId CHAR(36) NOT NULL,
  userId CHAR(36) NOT NULL,
  message TEXT NOT NULL,
  isFromAdmin TINYINT(1) NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_supportMessages_ticketId (ticketId),
  KEY idx_supportMessages_userId (userId),
  KEY idx_supportMessages_createdAt (createdAt),
  CONSTRAINT fk_supportMessages_ticketId FOREIGN KEY (ticketId) REFERENCES supportTickets (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_supportMessages_userId FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) NOT NULL,
  userId CHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  titleAr VARCHAR(255) DEFAULT NULL,
  message TEXT NOT NULL,
  messageAr TEXT DEFAULT NULL,
  type ENUM('info', 'success', 'warning', 'error', 'enrollment', 'payment', 'certificate', 'announcement', 'system') NOT NULL DEFAULT 'info',
  isRead TINYINT(1) NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notifications_userId (userId),
  KEY idx_notifications_type (type),
  KEY idx_notifications_isRead (isRead),
  KEY idx_notifications_createdAt (createdAt),
  CONSTRAINT fk_notifications_userId FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS settings (
  id CHAR(36) NOT NULL,
  `key` VARCHAR(191) NOT NULL,
  value TEXT DEFAULT NULL,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_settings_key (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blogPosts (
  id CHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  titleAr VARCHAR(255) DEFAULT NULL,
  slug VARCHAR(255) NOT NULL,
  content LONGTEXT DEFAULT NULL,
  contentAr LONGTEXT DEFAULT NULL,
  excerpt TEXT DEFAULT NULL,
  excerptAr TEXT DEFAULT NULL,
  thumbnailUrl VARCHAR(500) DEFAULT NULL,
  authorId CHAR(36) NOT NULL,
  isPublished TINYINT(1) NOT NULL DEFAULT 0,
  publishedAt DATETIME DEFAULT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_blogPosts_slug (slug),
  KEY idx_blogPosts_authorId (authorId),
  KEY idx_blogPosts_isPublished (isPublished),
  KEY idx_blogPosts_publishedAt (publishedAt),
  KEY idx_blogPosts_createdAt (createdAt),
  CONSTRAINT fk_blogPosts_authorId FOREIGN KEY (authorId) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blogComments (
  id CHAR(36) NOT NULL,
  postId CHAR(36) NOT NULL,
  userId CHAR(36) NOT NULL,
  content TEXT NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_blogComments_postId (postId),
  KEY idx_blogComments_userId (userId),
  KEY idx_blogComments_createdAt (createdAt),
  CONSTRAINT fk_blogComments_postId FOREIGN KEY (postId) REFERENCES blogPosts (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_blogComments_userId FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS waitlist (
  id CHAR(36) NOT NULL,
  email VARCHAR(255) NOT NULL,
  courseId CHAR(36) DEFAULT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_waitlist_email_course (email, courseId),
  KEY idx_waitlist_email (email),
  KEY idx_waitlist_courseId (courseId),
  KEY idx_waitlist_createdAt (createdAt),
  CONSTRAINT fk_waitlist_courseId FOREIGN KEY (courseId) REFERENCES courses (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
