/**
 * Auto Database Migration & Seed
 *
 * On every startup:
 * 1. Checks if the `users` table exists (proxy for "schema initialized")
 * 2. If NOT, runs init-schema.sql to create all 22 tables
 * 3. Runs seed data (INSERT IGNORE — idempotent)
 * 4. Seeds default contact settings
 *
 * This ensures the app ALWAYS works, even on a fresh Aiven database.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import crypto from "node:crypto";
import { getRawConnection } from "../queries/connection.js";
import { hashPassword } from "./password.js";
import { env } from "./env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let migrationDone = false;

export async function ensureDatabase(): Promise<void> {
  if (migrationDone) return;

  try {
    const conn = await getRawConnection();

    try {
    // ── Step 1: Check if users table exists ──
    const [rows] = await conn.execute(
      "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'"
    );
    const tableExists = (rows as { cnt: number }[])[0]?.cnt > 0;

    if (tableExists) {
      console.log("[DB] Schema already initialized — checking for incremental migrations...");

      // ── Helper: check if a column exists before adding it ──────────────
      // MySQL does NOT support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
      // (that's PostgreSQL syntax). On MySQL we must check INFORMATION_SCHEMA
      // first, otherwise every restart logs 8 syntax-error warnings.
      const columnExists = async (table: string, column: string): Promise<boolean> => {
        const rows = await conn.execute(
          "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
          [table, column]
        );
        return (rows as { cnt: number }[])[0]?.cnt > 0;
      };

      const indexExists = async (table: string, indexName: string): Promise<boolean> => {
        const rows = await conn.execute(
          "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
          [table, indexName]
        );
        return (rows as { cnt: number }[])[0]?.cnt > 0;
      };

      // ── Incremental migrations for existing databases ──
      // Each migration checks existence first → no syntax errors, no warnings.
      console.log("[DB] Running incremental migrations...");

      // Migration 1: make passwordHash nullable (for Google OAuth users)
      try {
        await conn.execute(`ALTER TABLE users MODIFY COLUMN passwordHash VARCHAR(255) NULL`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("Duplicate") && !message.includes("already exists")) {
          console.warn("[DB] Migration warning (passwordHash):", message);
        }
      }

      // Migration 2: add googleId column if missing
      if (!(await columnExists("users", "googleId"))) {
        try {
          await conn.execute(`ALTER TABLE users ADD COLUMN googleId VARCHAR(255) NULL`);
          console.log("[DB]   + Added column users.googleId");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("Duplicate") && !message.includes("already exists")) {
            console.warn("[DB] Migration warning (googleId):", message);
          }
        }
      }

      // Migration 3: add passwordResetToken column if missing
      if (!(await columnExists("users", "passwordResetToken"))) {
        try {
          await conn.execute(`ALTER TABLE users ADD COLUMN passwordResetToken VARCHAR(255) NULL`);
          console.log("[DB]   + Added column users.passwordResetToken");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("Duplicate") && !message.includes("already exists")) {
            console.warn("[DB] Migration warning (passwordResetToken):", message);
          }
        }
      }

      // Migration 4: add passwordResetExpiresAt column if missing
      if (!(await columnExists("users", "passwordResetExpiresAt"))) {
        try {
          await conn.execute(`ALTER TABLE users ADD COLUMN passwordResetExpiresAt TIMESTAMP NULL`);
          console.log("[DB]   + Added column users.passwordResetExpiresAt");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("Duplicate") && !message.includes("already exists")) {
            console.warn("[DB] Migration warning (passwordResetExpiresAt):", message);
          }
        }
      }

      // Migration 5: add emailVerificationToken column if missing
      if (!(await columnExists("users", "emailVerificationToken"))) {
        try {
          await conn.execute(`ALTER TABLE users ADD COLUMN emailVerificationToken VARCHAR(255) NULL`);
          console.log("[DB]   + Added column users.emailVerificationToken");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("Duplicate") && !message.includes("already exists")) {
            console.warn("[DB] Migration warning (emailVerificationToken):", message);
          }
        }
      }

      // Migration 6: add emailVerificationExpiry column if missing
      if (!(await columnExists("users", "emailVerificationExpiry"))) {
        try {
          await conn.execute(`ALTER TABLE users ADD COLUMN emailVerificationExpiry TIMESTAMP NULL`);
          console.log("[DB]   + Added column users.emailVerificationExpiry");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("Duplicate") && !message.includes("already exists")) {
            console.warn("[DB] Migration warning (emailVerificationExpiry):", message);
          }
        }
      }

      // Migration 7: add emailVerifiedAt column if missing
      if (!(await columnExists("users", "emailVerifiedAt"))) {
        try {
          await conn.execute(`ALTER TABLE users ADD COLUMN emailVerifiedAt TIMESTAMP NULL`);
          console.log("[DB]   + Added column users.emailVerifiedAt");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("Duplicate") && !message.includes("already exists")) {
            console.warn("[DB] Migration warning (emailVerifiedAt):", message);
          }
        }
      }

      // Migration 8: add pendingEmail column if missing
      if (!(await columnExists("users", "pendingEmail"))) {
        try {
          await conn.execute(`ALTER TABLE users ADD COLUMN pendingEmail VARCHAR(255) NULL`);
          console.log("[DB]   + Added column users.pendingEmail");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("Duplicate") && !message.includes("already exists")) {
            console.warn("[DB] Migration warning (pendingEmail):", message);
          }
        }
      }

      // Migration 9: add unique index on googleId if missing
      if (!(await indexExists("users", "users_google_id_unique"))) {
        try {
          await conn.execute(`ALTER TABLE users ADD UNIQUE INDEX users_google_id_unique (googleId)`);
          console.log("[DB]   + Added index users_google_id_unique");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("Duplicate") && !message.includes("already exists")) {
            console.warn("[DB] Migration warning (users_google_id_unique):", message);
          }
        }
      }

      console.log("[DB] ✅ Incremental migrations complete");
      migrationDone = true;
      return;
    }

    console.log("[DB] First run detected — initializing schema...");

    // ── Step 2: Create all tables ──
    const schemaPath = join(__dirname, "..", "..", "db", "init-schema.sql");
    const schemaSql = readFileSync(schemaPath, "utf-8");
    await conn.query(schemaSql);
    console.log("[DB] ✅ All 22 tables created");

    // ── Step 3: Seed admin user + categories + courses + testimonials ──
    // ✅ SECURITY: Generate a random admin password if ADMIN_PASSWORD not set
    const adminPassword = env.ADMIN_PASSWORD || crypto.randomBytes(16).toString("hex");
    const adminPasswordHash = await hashPassword(adminPassword);

    // Admin user — parameterized query to prevent SQL injection
    // INSERT IGNORE + UPDATE ensures password stays in sync with ADMIN_PASSWORD env var
    await conn.execute(
      `INSERT INTO users (username, passwordHash, name, email, role, preferredLanguage, createdAt, updatedAt, lastSignInAt)
       VALUES (?, ?, 'Ahmed Elbaz', 'admin@ahmedelbaz.qzz.io', 'admin', 'ar', NOW(), NOW(), NOW())
       ON DUPLICATE KEY UPDATE passwordHash = VALUES(passwordHash)`,
      ['admin', adminPasswordHash]
    );

    const seedSql = [

      // Categories
      `INSERT IGNORE INTO categories (slug, nameEn, nameAr, icon, sortOrder, createdAt) VALUES
       ('electrical-power', 'Electrical Power Systems', 'أنظمة الطاقة الكهربائية', 'Zap', 1, NOW()),
       ('etap', 'ETAP Software', 'برنامج ETAP', 'Monitor', 2, NOW()),
       ('power-protection', 'Protection & Relay', 'الحماية والريليه', 'Shield', 3, NOW()),
       ('renewable-energy', 'Renewable Energy', 'الطاقة المتجددة', 'Sun', 4, NOW())`,

      // Courses
      `SET @cat1 = (SELECT id FROM categories WHERE slug = 'electrical-power' LIMIT 1)`,
      `SET @cat2 = (SELECT id FROM categories WHERE slug = 'etap' LIMIT 1)`,
      `SET @cat3 = (SELECT id FROM categories WHERE slug = 'power-protection' LIMIT 1)`,
      `SET @cat4 = (SELECT id FROM categories WHERE slug = 'renewable-energy' LIMIT 1)`,

      // Course 1: Power Systems Basics (FREE)
      `INSERT IGNORE INTO courses (slug, categoryId, titleEn, titleAr, descriptionEn, descriptionAr, shortDescEn, shortDescAr, thumbnail, level, isPremium, price, durationHours, rating, reviewCount, studentCount, instructorName, isPublished, isFeatured, sortOrder, createdAt, updatedAt)
       VALUES ('power-systems-basics', @cat1,
         'Power Systems Fundamentals', 'أساسيات أنظمة الطاقة الكهربائية',
         'A comprehensive introduction to electrical power systems covering generation, transmission, distribution, and load analysis fundamentals.',
         'مقدمة شاملة لأنظمة الطاقة الكهربائية تغطي التوليد والنقل والتوزيع وأساسيات تحليل الأحمال.',
         'Learn power system basics from scratch', 'تعلم أساسيات أنظمة الطاقة من الصفر',
          '/course-panel.jpg', 'beginner', 0, '0.00', 8, 4.8, 24, 156, 'Eng Ahmed Elbaz', 1, 1, 1, NOW(), NOW())`,

      // Course 2: ETAP Full Course (PREMIUM)
      `INSERT IGNORE INTO courses (slug, categoryId, titleEn, titleAr, descriptionEn, descriptionAr, shortDescEn, shortDescAr, thumbnail, level, isPremium, price, originalPrice, durationHours, rating, reviewCount, studentCount, instructorName, isPublished, isFeatured, sortOrder, createdAt, updatedAt)
       VALUES ('etap-complete-course', @cat2,
         'ETAP Complete Course — From Zero to Expert', 'كورس ETAP الشامل — من الصفر للاحتراف',
         'Master ETAP software for power system analysis including load flow, short circuit, arc flash, relay coordination, and harmonic analysis.',
         'أتقن برنامج ETAP لتحليل أنظمة الطاقة بما في ذلك تدفق الأحمال والدوائر القصيرة وقوس الكهرباء وتنسيق الريليه.',
         'Become an ETAP expert', 'أصبح خبير ETAP',
          '/course-etap.jpg', 'intermediate', 1, '1999.00', '3499.00', 40, 4.9, 42, 234, 'Eng Ahmed Elbaz', 1, 1, 2, NOW(), NOW())`,

      // Course 3: Protection & Relay (PREMIUM)
      `INSERT IGNORE INTO courses (slug, categoryId, titleEn, titleAr, descriptionEn, descriptionAr, shortDescEn, shortDescAr, thumbnail, level, isPremium, price, originalPrice, durationHours, rating, reviewCount, studentCount, instructorName, isPublished, isFeatured, sortOrder, createdAt, updatedAt)
       VALUES ('protection-relay-coordination', @cat3,
         'Protection Systems & Relay Coordination', 'أنظمة الحماية وتنسيق الريليه',
         'Learn power system protection design: relay coordination, protective device settings, fault calculations, and IEEE/IEC standards application.',
         'تعلم تصميم حماية أنظمة الطاقة: تنسيق الريليه وإعدادات أجهزة الحماية وحسابات الأعطال وتطبيق معايير IEEE/IEC.',
         'Master protection engineering', 'أتقن هندسة الحماية',
          '/course-skm.jpg', 'advanced', 1, '1499.00', '2499.00', 30, 4.7, 18, 98, 'Eng Ahmed Elbaz', 1, 0, 3, NOW(), NOW())`,

      // Course 4: Renewable Energy (PREMIUM)
      `INSERT IGNORE INTO courses (slug, categoryId, titleEn, titleAr, descriptionEn, descriptionAr, shortDescEn, shortDescAr, thumbnail, level, isPremium, price, originalPrice, durationHours, rating, reviewCount, studentCount, instructorName, isPublished, isFeatured, sortOrder, createdAt, updatedAt)
       VALUES ('renewable-energy-design', @cat4,
         'Solar & Renewable Energy Systems Design', 'تصميم أنظمة الطاقة الشمسية والمتجددة',
         'Design grid-connected and off-grid solar PV systems, perform energy yield calculations, and understand inverter selection and battery sizing.',
         'تصميم أنظمة الطاقة الشمسية الكهروضوئية المتصلة بالشبكة والمستقلة، حسابات إنتاج الطاقة، واختيار الانفرتر وحجم البطاريات.',
         'Design solar systems professionally', 'صمم أنظمة طاقة شمسية باحتراف',
          '/course-pvsyst.jpg', 'intermediate', 1, '999.00', '1799.00', 25, 4.6, 15, 67, 'Eng Ahmed Elbaz', 1, 0, 4, NOW(), NOW())`,

      // Testimonials
      `INSERT IGNORE INTO testimonials (name, title, company, content, rating, isPublished, createdAt) VALUES
       ('Mohamed Ali', 'Electrical Engineer', 'EGYPTCO',
        'هذه المنصة غيرت مسار حياتي المهنية بالكامل. كورس أنظمة الطاقة كان منظماً بشكل رائع، وانتقلت من لا شيء إلى الحصول على أول وظيفة كمهندس طاقة في 3 أشهر فقط.',
        5, 1, NOW()),
       ('Sara Hassan', 'Power Systems Specialist', 'Orascom',
        'كورس ETAP ممتاز. كنت أعرف أساسيات الطاقة لكن هذا الكورس نقل مهاراتي لمستوى آخر. المشاريع الواقعية كانت قيمة للغاية.',
        5, 1, NOW()),
       ('Omar Khaled', 'Protection Engineer', 'EETC',
        'جربت منصات كثيرة لكن لا شيء يقارن بهذه المنصة. النهج التدريجي والشرح الواضح بالعربية جعل التعلم ممتعاً. حصلت على ترقية بعد إتمام كورس الحماية!',
        4, 1, NOW())`,

      // Contact settings
      `INSERT INTO siteSettings (section, \`key\`, value, type, sortOrder) VALUES
       ('contact', 'whatsappNumber', '201061857305', 'text', 1),
       ('contact', 'phone', '01061857305', 'text', 2),
       ('contact', 'email', 'contact@ahmedelbaz.com', 'text', 3),
       ('contact', 'whatsappMessageEn', 'Hi! I am interested in your engineering courses.', 'text', 4),
       ('contact', 'whatsappMessageAr', 'مرحباً! أنا مهتم بالكورسات الهندسية.', 'text', 5),
       ('contact', 'youtubeUrl', '#', 'url', 10),
       ('contact', 'linkedinUrl', '#', 'url', 11),
       ('contact', 'facebookUrl', '#', 'url', 12),
       ('contact', 'instagramUrl', '#', 'url', 13),
       ('contact', 'websiteUrl', 'https://ahmedelbaz.qzz.io', 'url', 16)
       ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)`,
    ];

    // Log the generated admin password in development
    if (!env.isProduction) {
      console.log("\n[DB] 🔐 Admin account created:");
      console.log("    Username: admin");
      console.log("    Password: " + adminPassword);
      console.log("    ⚠️  Save this — you won't see it again!\n");
    } else {
      console.log("[DB] Admin account created (password from ADMIN_PASSWORD env variable)");
    }

    for (const sql of seedSql) {
      try {
        await conn.execute(sql);
      } catch (err) {
        // Ignore SET variable errors or duplicate key warnings
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("INSERT IGNORE") && !message.includes("Duplicate") && !sql.startsWith("SET ")) {
          console.warn("[DB] Seed warning:", message);
        }
      }
    }

    console.log("[DB] ✅ Seed data inserted (admin user, 4 categories, 4 courses, 3 testimonials, contact settings)");
    migrationDone = true;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error("[DB] ❌ Migration failed:", err);
    // Don't crash — let the app start anyway and queries will fail with proper 500 errors
    migrationDone = true;
  }
}
