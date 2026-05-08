-- ═══════════════════════════════════════════════════════════════════════
-- Elbaz LMS — Step 8: CMS, Themes, Promo Codes, Promotions Migration
-- Run this SQL on your MySQL database to create the new tables
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Add promo code fields to payments table
ALTER TABLE payments ADD COLUMN promoCodeId BIGINT UNSIGNED NULL AFTER phoneNumber;
ALTER TABLE payments ADD COLUMN discountAmount DECIMAL(10,2) NULL AFTER promoCodeId;
ALTER TABLE payments ADD COLUMN finalAmount DECIMAL(10,2) NULL AFTER discountAmount;

-- 2. Site Settings (CMS key-value store)
CREATE TABLE IF NOT EXISTS siteSettings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  section VARCHAR(100) NOT NULL,
  `key` VARCHAR(255) NOT NULL,
  value TEXT NOT NULL,
  type ENUM('text','richtext','image','url','color','number','json') DEFAULT 'text' NOT NULL,
  sortOrder INT DEFAULT 0 NOT NULL,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  UNIQUE INDEX idx_settings_section_key (section, `key`),
  INDEX idx_settings_section (section)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Themes
CREATE TABLE IF NOT EXISTS themes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  isActive BOOLEAN DEFAULT FALSE NOT NULL,
  primaryColor VARCHAR(7) DEFAULT '#06b6d4' NOT NULL,
  secondaryColor VARCHAR(7) DEFAULT '#0891b2' NOT NULL,
  accentColor VARCHAR(7) DEFAULT '#f59e0b' NOT NULL,
  bgColor VARCHAR(7) DEFAULT '#0a0e17' NOT NULL,
  cardBgColor VARCHAR(7) DEFAULT '#111827' NOT NULL,
  textColor VARCHAR(7) DEFAULT '#f0f4f8' NOT NULL,
  mutedTextColor VARCHAR(7) DEFAULT '#94a3b8' NOT NULL,
  borderColor VARCHAR(7) DEFAULT '#1f2d44' NOT NULL,
  fontFamily VARCHAR(100) DEFAULT 'Inter, sans-serif' NOT NULL,
  headingFontFamily VARCHAR(100) DEFAULT 'Inter, sans-serif' NOT NULL,
  borderRadius VARCHAR(20) DEFAULT '12px' NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  UNIQUE INDEX idx_themes_slug (slug),
  INDEX idx_themes_active (isActive)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Promo Codes
CREATE TABLE IF NOT EXISTS promoCodes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  discountType ENUM('percentage','fixed') NOT NULL,
  discountValue DECIMAL(10,2) NOT NULL,
  maxUses INT NULL,
  usedCount INT DEFAULT 0 NOT NULL,
  minOrderAmount DECIMAL(10,2) DEFAULT '0.00',
  appliesTo ENUM('all','specific') DEFAULT 'all' NOT NULL,
  courseId BIGINT UNSIGNED NULL,
  startsAt TIMESTAMP NOT NULL,
  expiresAt TIMESTAMP NOT NULL,
  isActive BOOLEAN DEFAULT TRUE NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  UNIQUE INDEX idx_promo_code (code),
  INDEX idx_promo_active (isActive),
  INDEX idx_promo_expires (expiresAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Promo Code Usage Tracking
CREATE TABLE IF NOT EXISTS promoCodeUsage (
  id INT AUTO_INCREMENT PRIMARY KEY,
  promoCodeId BIGINT UNSIGNED NOT NULL,
  userId BIGINT UNSIGNED NOT NULL,
  paymentId BIGINT UNSIGNED NOT NULL,
  discountAmount DECIMAL(10,2) NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  UNIQUE INDEX idx_promo_usage_promo_user (promoCodeId, userId),
  INDEX idx_promo_usage_payment (paymentId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Promotions (Header Banners)
CREATE TABLE IF NOT EXISTS promotions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  titleEn VARCHAR(500) NOT NULL,
  titleAr VARCHAR(500) NOT NULL,
  subtitleEn VARCHAR(500) NULL,
  subtitleAr VARCHAR(500) NULL,
  discountText VARCHAR(100) NULL,
  ctaTextEn VARCHAR(100) NULL,
  ctaTextAr VARCHAR(100) NULL,
  ctaUrl VARCHAR(500) NULL,
  promoCodeId BIGINT UNSIGNED NULL,
  bgGradientFrom VARCHAR(7) DEFAULT '#06b6d4' NOT NULL,
  bgGradientTo VARCHAR(7) DEFAULT '#8b5cf6' NOT NULL,
  textColor VARCHAR(7) DEFAULT '#ffffff' NOT NULL,
  startsAt TIMESTAMP NOT NULL,
  endsAt TIMESTAMP NOT NULL,
  isActive BOOLEAN DEFAULT TRUE NOT NULL,
  showCountdown BOOLEAN DEFAULT TRUE NOT NULL,
  position ENUM('top','hero_above','hero_below','floating') DEFAULT 'top' NOT NULL,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  INDEX idx_promotions_active (isActive),
  INDEX idx_promotions_dates (startsAt, endsAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Also update payment method enum (from Step 7)
ALTER TABLE payments MODIFY COLUMN paymentMethod ENUM('visa','instapay','vodafone_cash','wallet','bank_transfer','paypal','kiosk','cash_collection','other') NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════
-- SEED DATA: Default theme + sample settings
-- ═══════════════════════════════════════════════════════════════════════

-- Default Theme (already active)
INSERT INTO themes (name, slug, isActive, primaryColor, secondaryColor, accentColor, bgColor, cardBgColor, textColor, mutedTextColor, borderColor, fontFamily, headingFontFamily, borderRadius)
VALUES ('Default Dark', 'default-dark', TRUE, '#06b6d4', '#0891b2', '#f59e0b', '#0a0e17', '#111827', '#f0f4f8', '#94a3b8', '#1f2d44', 'Inter, sans-serif', 'Inter, sans-serif', '12px');

-- Electric Blue Theme
INSERT INTO themes (name, slug, isActive, primaryColor, secondaryColor, accentColor, bgColor, cardBgColor, textColor, mutedTextColor, borderColor, fontFamily, headingFontFamily, borderRadius)
VALUES ('Electric Blue', 'electric-blue', FALSE, '#3b82f6', '#2563eb', '#f59e0b', '#030712', '#111827', '#f8fafc', '#94a3b8', '#1e293b', 'Inter, sans-serif', 'Inter, sans-serif', '16px');

-- Green Emerald Theme
INSERT INTO themes (name, slug, isActive, primaryColor, secondaryColor, accentColor, bgColor, cardBgColor, textColor, mutedTextColor, borderColor, fontFamily, headingFontFamily, borderRadius)
VALUES ('Green Emerald', 'green-emerald', FALSE, '#10b981', '#059669', '#f59e0b', '#0a0e17', '#111827', '#f0f4f8', '#94a3b8', '#1f2d44', 'Inter, sans-serif', 'Inter, sans-serif', '12px');

-- Royal Purple Theme
INSERT INTO themes (name, slug, isActive, primaryColor, secondaryColor, accentColor, bgColor, cardBgColor, textColor, mutedTextColor, borderColor, fontFamily, headingFontFamily, borderRadius)
VALUES ('Royal Purple', 'royal-purple', FALSE, '#8b5cf6', '#7c3aed', '#f59e0b', '#0a0e17', '#1a1025', '#f0f4f8', '#a78bfa', '#2d1f4e', 'Inter, sans-serif', 'Inter, sans-serif', '16px');

-- Default CMS Settings (hero section)
INSERT INTO siteSettings (section, `key`, value, type, sortOrder) VALUES
('hero', 'titleEn', 'Master the Power of Electrical Engineering', 'text', 1),
('hero', 'titleAr', 'أتقن قوة الهندسة الكهربائية', 'text', 2),
('hero', 'subtitleEn', 'Join thousands of engineers learning ETAP, SKM, PowerFactory, PVSyst and more with expert-led courses.', 'richtext', 3),
('hero', 'subtitleAr', 'انضم لآلاف المهندسين المتعلمين ETAP و SKM و PowerFactory و PVSyst والمزيد مع كورسات خبراء.', 'richtext', 4),
('hero', 'ctaTextEn', 'Browse Courses', 'text', 5),
('hero', 'ctaTextAr', 'تصفح الكورسات', 'text', 6),
('hero', 'ctaUrl', '/courses', 'url', 7),
('hero', 'backgroundImage', '/hero-bg.jpg', 'image', 8);

-- Instructor settings
INSERT INTO siteSettings (section, `key`, value, type, sortOrder) VALUES
('instructor', 'name', 'Eng. Ahmed Elbaz', 'text', 1),
('instructor', 'titleEn', 'Senior Electrical Engineer & Educator', 'text', 2),
('instructor', 'titleAr', 'مهندس كهرباء أول ومُعلم', 'text', 3),
('instructor', 'bioEn', 'With over 10 years of experience in electrical engineering, specializing in power systems design, ETAP simulation, and renewable energy. Trained 2000+ engineers across the Middle East.', 'richtext', 4),
('instructor', 'bioAr', 'مع أكثر من 10 سنوات خبرة في الهندسة الكهربائية، متخصص في تصميم أنظمة الطاقة ومحاكاة ETAP والطاقة المتجددة. درب أكثر من 2000 مهندس في منطقة الشرق الأوسط.', 'richtext', 5),
('instructor', 'avatarUrl', '', 'image', 6);

-- Footer settings
INSERT INTO siteSettings (section, `key`, value, type, sortOrder) VALUES
('footer', 'copyrightText', '© 2025 Elbaz Engineering Academy. All rights reserved.', 'text', 1),
('footer', 'facebookUrl', '', 'url', 2),
('footer', 'instagramUrl', '', 'url', 3),
('footer', 'youtubeUrl', '', 'url', 4),
('footer', 'linkedinUrl', '', 'url', 5),
('footer', 'whatsappNumber', '', 'text', 6);

-- CTA section settings
INSERT INTO siteSettings (section, `key`, value, type, sortOrder) VALUES
('cta', 'titleEn', 'Ready to Power Up Your Engineering Career?', 'text', 1),
('cta', 'titleAr', 'مستعد لتطوير مسيرتك المهنية في الهندسة الكهربائية؟', 'text', 2),
('cta', 'subtitleEn', 'Start learning today with our expert-led courses and join a community of 2000+ engineers.', 'richtext', 3),
('cta', 'subtitleAr', 'ابدأ التعلم اليوم مع كورساتنا التي يقدمها خبراء وانضم لمجتمع أكثر من 2000 مهندس.', 'richtext', 4),
('cta', 'ctaTextEn', 'Get Started Free', 'text', 5),
('cta', 'ctaTextAr', 'ابدأ مجاناً', 'text', 6);
