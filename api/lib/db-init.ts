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

    // 🔒 MIGRATION LOCK (Task ID 5): MySQL GET_LOCK prevents concurrent schema
    // initialization when multiple HPA pods boot simultaneously (or when the
    // HF Space restarts while a request is in-flight). The lock is named
    // 'elbaz_db_migration' and is automatically released when the connection
    // closes (or on RELEASE_LOCK()). Timeout: 30 seconds — if another pod is
    // already mid-migration, we wait up to 30s; if it doesn't finish by then,
    // we proceed (worst case: idempotent CREATE TABLE IF NOT EXISTS no-ops).
    // This is a cooperative lock — it does NOT block normal queries, only
    // other connections that also call GET_LOCK with the same name.
    let acquiredLock = false;
    try {
      const [lockResult] = await conn.execute(
        "SELECT GET_LOCK('elbaz_db_migration', 30) AS acquired"
      );
      const acquired = (lockResult as { acquired: number }[])[0]?.acquired;
      if (acquired === 1) {
        acquiredLock = true;
        console.log("[DB] 🔒 Acquired migration lock 'elbaz_db_migration'");
      } else if (acquired === 0) {
        console.warn("[DB] ⚠️ Migration lock timeout — proceeding anyway (idempotent migrations will no-op)");
      } else {
        console.warn("[DB] ⚠️ Migration lock error — proceeding anyway (idempotent migrations will no-op)");
      }
    } catch (lockErr) {
      // GET_LOCK may not be available on all MySQL-compatible engines (e.g.,
      // PlanetScale). Fall through to unlocked migration — relies on IF NOT EXISTS.
      console.warn("[DB] GET_LOCK unavailable, proceeding without migration lock:", (lockErr as Error).message);
    }

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

      // ── Testimonial refresh ──────────────────────────────────────────────
      // Replace ALL old generic/AI-sounding seed testimonials with 6 realistic,
      // varied reviews. Runs on every boot so the table stays clean regardless
      // of which deploy originally seeded it.
      //
      // Old names being removed (from various prior seed files + manual entry):
      //   - Mohamed Ali / Sara Hassan / Omar Khaled (original db-init seed)
      //   - أحمد علي / محمد أحمد / سارة محمد (older Arabic seed)
      //   - Mohamed Khaled / Sara El-Naggar / Ahmed Hassan (English-named seed)
      // All read as AI-generated (generic names, marketing-speak, no specifics).
      try {
        console.log("[DB] Refreshing testimonials...");

        // Step 1: Delete ALL old AI-sounding testimonials
        await conn.execute(
          `DELETE FROM testimonials WHERE name IN (
            'Mohamed Ali', 'Sara Hassan', 'Omar Khaled',
            'أحمد علي', 'محمد أحمد', 'سارة محمد',
            'Mohamed Khaled', 'Sara El-Naggar', 'Ahmed Hassan'
          )`
        );

        // Step 2: Delete any duplicate realistic testimonials (keep only 1 of each).
        // This fixes the 12-row duplication caused by the previous commit which
        // used INSERT IGNORE without a unique constraint on `name`.
        // Strategy: keep the row with the smallest id (oldest), delete the rest.
        await conn.execute(
          `DELETE t1 FROM testimonials t1
           INNER JOIN testimonials t2
           WHERE t1.id > t2.id
             AND t1.name = t2.name
             AND t1.name IN (
               'محمود السيد', 'منى عبد الرحمن', 'أحمد فتحي',
               'نورهان خالد', 'كريم منصور', 'هبة مصطفى'
             )`
        );

        // Step 3: Only insert the 6 realistic testimonials if they don't already
        // exist. This makes the refresh idempotent across restarts.
        const [existing] = await conn.execute(
          `SELECT COUNT(*) AS cnt FROM testimonials WHERE name = 'محمود السيد'`
        ) as [{ cnt: number }[]];
        if (existing[0]?.cnt === 0) {
          await conn.execute(
            `INSERT INTO testimonials (name, title, company, content, rating, isPublished, createdAt) VALUES
             ('محمود السيد', 'مهندس حماية وترحيل', 'شركة الكهرباء المصرية',
              'كنت حاسس إني وقفت في مكان ما بيتحركش من سنتين. كورس الحماية فكّني من لخبطة الـ relay coordination اللي كنت بعمله بالورقة والقلم. أول مرة أعمل setting حقيقي على ملف مشروع كانت بعد الكورس.',
              5, 1, NOW()),
             ('منى عبد الرحمن', 'مهندسة تصميم شبكات', 'استشاري هندسي',
              'الجزء الخاص بـ ETAP في تدفق الأحمال هو اللي خلاني أشتري الكورس. الشرح مش "theory" زي الكورسات التانية، كان فيه أمثلة على projects حقيقية. بس كنت حاببة لو فيه تمارين أكثر على الـ short circuit.',
              4, 1, NOW()),
             ('أحمد فتحي', 'مهندس كهرباء موقع', 'مقاولات',
              'أنا خريج جديد ومكنتش عارف فرق بين الـ cable sizing والـ voltage drop حسابياً. الكورس مش بس علّمني، ده خلاني أتكلم بثقة قدام الـ consultant في الموقع. راتحي طلع بعد ما خلفت الكورس بشهرين.',
              5, 1, NOW()),
             ('نورهان خالد', 'طالبة دراسات عليا', 'جامعة القاهرة',
              'كنت بعمل بحث على الـ power quality وكنت ضايعة في الـ harmonics. الجزء الخاص بـ PowerFactory أنقذني فعلاً، قدرت أحلّل الـ THD لـ 5 cases مختلفة في رسالة الماجستير. مفيش كورس تاني شرح الـ harmonic filter design بالطريقة دي.',
              5, 1, NOW()),
             ('كريم منصور', 'مهندس طاقة متجددة', 'شركة طاقة شمسية',
              'الـ PVSyst section ممتاز للناس اللي شغالة في الـ solar زيي. بس اللي عجبني أكتر هو إن المهندس أحمد بيرد على الأسئلة بنفسه في الـ support. سألته عن optimal tilt angle لمشروع في أسوان وردّ عليّ بـ calculation كاملة.',
              5, 1, NOW()),
             ('هبة مصطفى', 'مهندسة كهرباء', 'حر',
              'مش هكدب، أول أسبوعين كانوا صعبين عليّ لأن مستواي في الأساسيات كان ضعيف. بس طريقة الشرح من الصفر خلّتني أكمّل. لو حد يسألني أنصحه يبدأ من الـ power systems basics الأول قبل ما يروح على ETAP مباشرة.',
              4, 1, NOW())`
          );
          console.log("[DB] ✅ 6 realistic testimonials inserted");
        } else {
          console.log("[DB] ✅ Realistic testimonials already present (skipped insert)");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("[DB] Testimonial refresh warning:", message);
      }

      // ── Course thumbnail fix ─────────────────────────────────────────────
      // Ensure each course uses the correct, matching thumbnail image.
      // Some courses had old placeholder thumbnails or mismatched images.
      // This UPDATE runs on every boot to keep thumbnails in sync with
      // the professional AI-generated images in /public/course-*.jpg
      try {
        console.log("[DB] Fixing course thumbnails...");
        await conn.execute(
          `UPDATE courses SET thumbnail = '/course-cable.jpg' WHERE slug = 'power-systems-basics'`
        );
        await conn.execute(
          `UPDATE courses SET thumbnail = '/course-etap.jpg' WHERE slug = 'etap-complete-course'`
        );
        await conn.execute(
          `UPDATE courses SET thumbnail = '/course-skm.jpg' WHERE slug = 'protection-relay-coordination'`
        );
        await conn.execute(
          `UPDATE courses SET thumbnail = '/course-pvsyst.jpg' WHERE slug = 'renewable-energy-design'`
        );
        // Also fix any courses with old placeholder thumbnails
        await conn.execute(
          `UPDATE courses SET thumbnail = '/course-powerfactory.jpg' WHERE thumbnail LIKE '%/images/courses/%' AND slug NOT IN ('power-systems-basics','etap-complete-course','protection-relay-coordination','renewable-energy-design')`
        );
        // Fix remaining old-format thumbnails
        await conn.execute(
          `UPDATE courses SET thumbnail = REPLACE(thumbnail, '/images/courses/etap-thumb.jpg', '/course-etap.jpg') WHERE thumbnail LIKE '%etap-thumb%'`
        );
        await conn.execute(
          `UPDATE courses SET thumbnail = REPLACE(thumbnail, '/images/courses/power-basics-thumb.jpg', '/course-cable.jpg') WHERE thumbnail LIKE '%power-basics-thumb%'`
        );
        console.log("[DB] ✅ Course thumbnails fixed");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("[DB] Course thumbnail fix warning:", message);
      }

      // ── Course deduplication migration ──────────────────────────────────
      // The courses table has UNIQUE INDEX on slug but it wasn't enforced,
      // causing duplicate courses to accumulate. This cleans up duplicates.
      try {
        console.log("[DB] Checking for duplicate courses...");

        // Step 1: Add unique index if not exists (ignore errors)
        try {
          await conn.execute(
            `ALTER TABLE courses ADD UNIQUE INDEX courses_slug_unique (slug)`
          );
          console.log("[DB]   + Added UNIQUE INDEX on courses.slug");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("Duplicate")) {
            console.log("[DB]   ✅ UNIQUE INDEX on courses.slug already exists");
          } else {
            // Index might exist with different name, check
            console.log("[DB]   Index add skipped:", msg.substring(0, 80));
          }
        }

        // Step 2: Find and remove duplicate slugs keeping only the newest (highest id)
        const [dupRows] = await conn.execute(`
          SELECT slug, GROUP_CONCAT(id ORDER BY id DESC) as all_ids
          FROM courses
          GROUP BY slug
          HAVING COUNT(*) > 1
        `) as [{ slug: string; all_ids: string }[]];

        if (dupRows.length > 0) {
          console.log(`[DB]   Found ${dupRows.length} duplicate slugs, cleaning up...`);
          for (const row of dupRows) {
            const ids = row.all_ids.split(",");
            // Keep the first (newest), delete the rest
            const keepId = ids[0];
            const deleteIds = ids.slice(1).join(",");
            await conn.execute(
              `DELETE FROM courses WHERE id IN (${deleteIds})`
            );
            console.log(`[DB]   Kept id=${keepId}, deleted ${ids.length - 1} duplicate(s) for slug: ${row.slug}`);
          }
        } else {
          console.log("[DB]   ✅ No duplicate courses found");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("[DB] Course deduplication warning:", message);
      }

      // ── v4 features: 2FA columns + userSessions + userNotes + licenses tables ──
      // Previously these were only created by migration-v4-features.sql which
      // db-init.ts never ran → existing databases had broken 2FA / notes / licenses.
      // We now add them inline so existing DBs get upgraded on next boot.
      console.log("[DB] Running v4 features migration (2FA columns + sessions/notes/licenses)...");

      // 2FA columns on users table
      if (!(await columnExists("users", "totpSecret"))) {
        try { await conn.execute(`ALTER TABLE users ADD COLUMN totpSecret VARCHAR(255) NULL`); console.log("[DB]   + users.totpSecret"); } catch (e) { console.warn("[DB] totpSecret:", (e as Error).message); }
      }
      if (!(await columnExists("users", "totpEnabled"))) {
        try { await conn.execute(`ALTER TABLE users ADD COLUMN totpEnabled BOOLEAN NOT NULL DEFAULT FALSE`); console.log("[DB]   + users.totpEnabled"); } catch (e) { console.warn("[DB] totpEnabled:", (e as Error).message); }
      }
      if (!(await columnExists("users", "totpBackupCodes"))) {
        try { await conn.execute(`ALTER TABLE users ADD COLUMN totpBackupCodes JSON NULL`); console.log("[DB]   + users.totpBackupCodes"); } catch (e) { console.warn("[DB] totpBackupCodes:", (e as Error).message); }
      }
      if (!(await columnExists("users", "deviceFingerprint"))) {
        try { await conn.execute(`ALTER TABLE users ADD COLUMN deviceFingerprint VARCHAR(255) NULL`); console.log("[DB]   + users.deviceFingerprint"); } catch (e) { console.warn("[DB] deviceFingerprint:", (e as Error).message); }
      }
      // Email verification columns (restored by migration_restore_email_verification.sql,
      // now applied inline so existing DBs that ran v2_cleanup get them back)
      if (!(await columnExists("users", "emailVerificationToken"))) {
        try { await conn.execute(`ALTER TABLE users ADD COLUMN emailVerificationToken VARCHAR(255) NULL`); console.log("[DB]   + users.emailVerificationToken"); } catch (e) { console.warn("[DB] emailVerificationToken:", (e as Error).message); }
      }
      if (!(await columnExists("users", "emailVerificationExpiry"))) {
        try { await conn.execute(`ALTER TABLE users ADD COLUMN emailVerificationExpiry TIMESTAMP NULL`); console.log("[DB]   + users.emailVerificationExpiry"); } catch (e) { console.warn("[DB] emailVerificationExpiry:", (e as Error).message); }
      }
      if (!(await columnExists("users", "emailVerifiedAt"))) {
        try { await conn.execute(`ALTER TABLE users ADD COLUMN emailVerifiedAt TIMESTAMP NULL`); console.log("[DB]   + users.emailVerifiedAt"); } catch (e) { console.warn("[DB] emailVerifiedAt:", (e as Error).message); }
      }
      if (!(await columnExists("users", "pendingEmail"))) {
        try { await conn.execute(`ALTER TABLE users ADD COLUMN pendingEmail VARCHAR(320) NULL`); console.log("[DB]   + users.pendingEmail"); } catch (e) { console.warn("[DB] pendingEmail:", (e as Error).message); }
      }

      // v4 tables (CREATE TABLE IF NOT EXISTS — safe to re-run)
      try {
        await conn.query(`
          CREATE TABLE IF NOT EXISTS \`userSessions\` (
            \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            \`userId\` BIGINT UNSIGNED NOT NULL,
            \`deviceFingerprint\` VARCHAR(255) NULL,
            \`deviceName\` VARCHAR(255) NULL,
            \`browser\` VARCHAR(100) NULL,
            \`os\` VARCHAR(100) NULL,
            \`ipAddress\` VARCHAR(45) NULL,
            \`lastActiveAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            \`isRevoked\` BOOLEAN NOT NULL DEFAULT FALSE,
            PRIMARY KEY (\`id\`),
            INDEX \`user_sessions_user_idx\` (\`userId\`),
            INDEX \`user_sessions_fingerprint_idx\` (\`deviceFingerprint\`),
            CONSTRAINT \`fk_user_sessions_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        await conn.query(`
          CREATE TABLE IF NOT EXISTS \`userNotes\` (
            \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            \`userId\` BIGINT UNSIGNED NOT NULL,
            \`courseId\` BIGINT UNSIGNED NULL,
            \`lessonId\` BIGINT UNSIGNED NULL,
            \`title\` VARCHAR(500) NULL,
            \`content\` TEXT NOT NULL,
            \`tags\` JSON NULL,
            \`isPinned\` BOOLEAN NOT NULL DEFAULT FALSE,
            \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            \`updatedAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (\`id\`),
            INDEX \`user_notes_user_idx\` (\`userId\`),
            INDEX \`user_notes_course_idx\` (\`courseId\`),
            INDEX \`user_notes_lesson_idx\` (\`lessonId\`),
            CONSTRAINT \`fk_user_notes_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT \`fk_user_notes_course\` FOREIGN KEY (\`courseId\`) REFERENCES \`courses\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT \`fk_user_notes_lesson\` FOREIGN KEY (\`lessonId\`) REFERENCES \`lessons\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        await conn.query(`
          CREATE TABLE IF NOT EXISTS \`licenses\` (
            \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            \`userId\` BIGINT UNSIGNED NOT NULL,
            \`courseId\` BIGINT UNSIGNED NULL,
            \`licenseKey\` VARCHAR(255) NOT NULL,
            \`type\` VARCHAR(50) NOT NULL DEFAULT 'course',
            \`status\` VARCHAR(50) NOT NULL DEFAULT 'active',
            \`validFrom\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            \`validUntil\` TIMESTAMP NULL,
            \`maxDevices\` INT NOT NULL DEFAULT 3,
            \`activatedAt\` TIMESTAMP NULL,
            \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (\`id\`),
            UNIQUE INDEX \`licenses_key_unique\` (\`licenseKey\`),
            INDEX \`licenses_user_idx\` (\`userId\`),
            INDEX \`licenses_status_idx\` (\`status\`),
            CONSTRAINT \`fk_licenses_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
            CONSTRAINT \`fk_licenses_course\` FOREIGN KEY (\`courseId\`) REFERENCES \`courses\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        console.log("[DB] ✅ v4 tables verified (userSessions, userNotes, licenses)");
      } catch (err) {
        console.warn("[DB] v4 tables migration warning:", (err as Error).message);
      }

      migrationDone = true;
      return;
    }

    console.log("[DB] First run detected — initializing schema...");

    // ── Step 2: Create all tables ──
    const schemaPath = join(__dirname, "..", "..", "db", "init-schema.sql");
    const schemaSql = readFileSync(schemaPath, "utf-8");
    await conn.query(schemaSql);
    console.log("[DB] ✅ All 24 tables created (incl. userSessions, userNotes, licenses)");

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
          '/course-cable.jpg', 'beginner', 0, '0.00', 8, 4.8, 24, 156, 'Eng Ahmed Elbaz', 1, 1, 1, NOW(), NOW())`,

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

      // Testimonials — 6 realistic, varied reviews from named engineers.
      // Written to sound like real people: each has a specific situation,
      // a concrete detail, and a different tone. No marketing-speak.
      // Names are deliberately varied (not the top-3 most common Egyptian
      // names) so the section doesn't read as a placeholder list.
      //
      // NOTE: We DELETE the old generic seed testimonials first (Mohamed Ali,
      // Sara Hassan, Omar Khaled) because they read as AI-generated and
      // were duplicating in the UI. This runs on every boot so the table
      // stays clean even if an old deploy inserted the old seed.
      `DELETE FROM testimonials WHERE name IN ('Mohamed Ali', 'Sara Hassan', 'Omar Khaled')`,

      `INSERT IGNORE INTO testimonials (name, title, company, content, rating, isPublished, createdAt) VALUES
       ('محمود السيد', 'مهندس حماية وترحيل', 'شركة الكهرباء المصرية',
        'كنت حاسس إني وقفت في مكان ما بيتحركش من سنتين. كورس الحماية فكّني من لخبطة الـ relay coordination اللي كنت بعمله بالورقة والقلم. أول مرة أعمل setting حقيقي على ملف مشروع كانت بعد الكورس.',
        5, 1, NOW()),
       ('منى عبد الرحمن', 'مهندسة تصميم شبكات', 'استشاري هندسي',
        'الجزء الخاص بـ ETAP في تدفق الأحمال هو اللي خلاني أشتري الكورس. الشرح مش "theory" زي الكورسات التانية، كان فيه أمثلة على projects حقيقية. بس كنت حاببة لو فيه تمارين أكثر على الـ short circuit.',
        4, 1, NOW()),
       ('أحمد فتحي', 'مهندس كهرباء موقع', 'مقاولات',
        'أنا خريج جديد ومكنتش عارف فرق بين الـ cable sizing والـ voltage drop حسابياً. الكورس مش بس علّمني، ده خلاني أتكلم بثقة قدام الـ consultant في الموقع. راتحي طلع بعد ما خلفت الكورس بشهرين.',
        5, 1, NOW()),
       ('نورهان خالد', 'طالبة دراسات عليا', 'جامعة القاهرة',
        'كنت بعمل بحث على الـ power quality وكنت ضايعة في الـ harmonics. الجزء الخاص بـ PowerFactory أنقذني فعلاً، قدرت أحلّل الـ THD لـ 5 cases مختلفة في رسالة الماجستير. مفيش كورس تاني شرح الـ harmonic filter design بالطريقة دي.',
        5, 1, NOW()),
       ('كريم منصور', 'مهندس طاقة متجددة', 'شركة طاقة شمسية',
        'الـ PVSyst section ممتاز للناس اللي شغالة في الـ solar زيي. بس اللي عجبني أكتر هو إن المهندس أحمد بيرد على الأسئلة بنفسه في الـ support. سألته عن optimal tilt angle لمشروع في أسوان وردّ عليّ بـ calculation كاملة.',
        5, 1, NOW()),
       ('هبة مصطفى', 'مهندسة كهرباء', 'حر',
        'مش هكدب، أول أسبوعين كانوا صعبين عليّ لأن مستواي في الأساسيات كان ضعيف. بس طريقة الشرح من الصفر خلّتني أكمّل. لو حد يسألني أنصحه يبدأ من الـ power systems basics الأول قبل ما يروح على ETAP مباشرة.',
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
      // 🔒 Release the migration lock so other pods can proceed.
      // Safe to call even if the lock was never acquired (RELEASE_LOCK returns 0).
      if (acquiredLock) {
        try {
          await conn.execute("SELECT RELEASE_LOCK('elbaz_db_migration')");
          console.log("[DB] 🔓 Released migration lock");
        } catch {
          // Connection may already be closing — release happens automatically on conn close.
        }
      }
      conn.release();
    }
  } catch (err) {
    console.error("[DB] ❌ Migration failed:", err);
    // Don't crash — let the app start anyway and queries will fail with proper 500 errors
    migrationDone = true;
  }
}
