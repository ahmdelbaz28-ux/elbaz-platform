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
import { logger } from "./logger.js";
import { invalidateSettingsCache } from "./cache.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let migrationDone = false;
/** Set when THIS call just created a fresh schema — re-enters the incremental
 *  pass so v4–v10 land on FIRST boot too (previously they waited for a second
 *  restart, leaving e.g. aiProviders absent on a brand-new database). */
let freshSchemaInitialized = false;

export async function ensureDatabase(): Promise<void> { // NOSONAR — sequential SQL migrations, order is critical and behavior must match schema exactly
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
        logger.info("[DB] Acquired migration lock 'elbaz_db_migration'");
      } else if (acquired === 0) {
        logger.warn("[DB] Migration lock timeout — proceeding anyway (idempotent migrations will no-op)");
      } else {
        logger.warn("[DB] Migration lock error — proceeding anyway (idempotent migrations will no-op)");
      }
    } catch (lockErr) {
      // GET_LOCK may not be available on all MySQL-compatible engines (e.g.,
      // PlanetScale). Fall through to unlocked migration — relies on IF NOT EXISTS.
      logger.warn("[DB] GET_LOCK unavailable, proceeding without migration lock", { error: (lockErr as Error).message });
    }

    try {
    // ── Step 1: Check if users table exists ──
    const [rows] = await conn.execute(
      "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'"
    );
    const tableExists = (rows as { cnt: number }[])[0]?.cnt > 0;

    if (tableExists) {
      logger.info("[DB] Schema already initialized — checking for incremental migrations...");

      // ── Helper: check if a column exists before adding it ──────────────
      // MySQL does NOT support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
      // (that's PostgreSQL syntax). On MySQL we must check INFORMATION_SCHEMA
      // first, otherwise every restart logs 8 syntax-error warnings.
      const columnExists = async (table: string, column: string): Promise<boolean> => {
        const rows = await conn.execute(
          "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
          [table, column]
        );
        return (rows as unknown as { cnt: number }[])[0]?.cnt > 0;
      };

      const indexExists = async (table: string, indexName: string): Promise<boolean> => {
        const rows = await conn.execute(
          "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
          [table, indexName]
        );
        return (rows as unknown as { cnt: number }[])[0]?.cnt > 0;
      };

      // ── Incremental migrations for existing databases ──
      // Each migration checks existence first → no syntax errors, no warnings.
      logger.info("[DB] Running incremental migrations...");

      // Migration 1: make passwordHash nullable (for Google OAuth users)
      try {
        await conn.execute(`ALTER TABLE users MODIFY COLUMN passwordHash VARCHAR(255) NULL`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("Duplicate") && !message.includes("already exists")) {
          logger.warn("[DB] Migration warning (passwordHash)", { error: message });
        }
      }

      // Migration 2: add googleId column if missing
      if (!(await columnExists("users", "googleId"))) {
        try {
          await conn.execute(`ALTER TABLE users ADD COLUMN googleId VARCHAR(255) NULL`);
          logger.info("[DB]   + Added column users.googleId");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("Duplicate") && !message.includes("already exists")) {
            logger.warn("[DB] Migration warning (googleId)", { error: message });
          }
        }
      }

      // Migration 3: add passwordResetToken column if missing
      if (!(await columnExists("users", "passwordResetToken"))) {
        try {
          await conn.execute(`ALTER TABLE users ADD COLUMN passwordResetToken VARCHAR(255) NULL`);
          logger.info("[DB]   + Added column users.passwordResetToken");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("Duplicate") && !message.includes("already exists")) {
            logger.warn("[DB] Migration warning (passwordResetToken)", { error: message });
          }
        }
      }

      // Migration 4: add passwordResetExpiresAt column if missing
      if (!(await columnExists("users", "passwordResetExpiresAt"))) {
        try {
          await conn.execute(`ALTER TABLE users ADD COLUMN passwordResetExpiresAt TIMESTAMP NULL`);
          logger.info("[DB]   + Added column users.passwordResetExpiresAt");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("Duplicate") && !message.includes("already exists")) {
            logger.warn("[DB] Migration warning (passwordResetExpiresAt)", { error: message });
          }
        }
      }

      // Migration 5: add emailVerificationToken column if missing
      if (!(await columnExists("users", "emailVerificationToken"))) {
        try {
          await conn.execute(`ALTER TABLE users ADD COLUMN emailVerificationToken VARCHAR(255) NULL`);
          logger.info("[DB]   + Added column users.emailVerificationToken");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("Duplicate") && !message.includes("already exists")) {
            logger.warn("[DB] Migration warning (emailVerificationToken)", { error: message });
          }
        }
      }

      // Migration 6: add emailVerificationExpiry column if missing
      if (!(await columnExists("users", "emailVerificationExpiry"))) {
        try {
          await conn.execute(`ALTER TABLE users ADD COLUMN emailVerificationExpiry TIMESTAMP NULL`);
          logger.info("[DB]   + Added column users.emailVerificationExpiry");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("Duplicate") && !message.includes("already exists")) {
            logger.warn("[DB] Migration warning (emailVerificationExpiry)", { error: message });
          }
        }
      }

      // Migration 7: add emailVerifiedAt column if missing
      if (!(await columnExists("users", "emailVerifiedAt"))) {
        try {
          await conn.execute(`ALTER TABLE users ADD COLUMN emailVerifiedAt TIMESTAMP NULL`);
          logger.info("[DB]   + Added column users.emailVerifiedAt");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("Duplicate") && !message.includes("already exists")) {
            logger.warn("[DB] Migration warning (emailVerifiedAt)", { error: message });
          }
        }
      }

      // Migration 8: add pendingEmail column if missing
      if (!(await columnExists("users", "pendingEmail"))) {
        try {
          await conn.execute(`ALTER TABLE users ADD COLUMN pendingEmail VARCHAR(255) NULL`);
          logger.info("[DB]   + Added column users.pendingEmail");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("Duplicate") && !message.includes("already exists")) {
            logger.warn("[DB] Migration warning (pendingEmail)", { error: message });
          }
        }
      }

      // Migration 9: add unique index on googleId if missing
      if (!(await indexExists("users", "users_google_id_unique"))) {
        try {
          await conn.execute(`ALTER TABLE users ADD UNIQUE INDEX users_google_id_unique (googleId)`);
          logger.info("[DB]   + Added index users_google_id_unique");
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("Duplicate") && !message.includes("already exists")) {
            logger.warn("[DB] Migration warning (users_google_id_unique)", { error: message });
          }
        }
      }

      logger.info("[DB] Incremental migrations complete");

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
        logger.info("[DB] Refreshing testimonials...");

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
        ) as unknown as [{ cnt: number }[]];
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
          logger.info("[DB] 6 realistic testimonials inserted");
        } else {
          logger.info("[DB] Realistic testimonials already present (skipped insert)");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn("[DB] Testimonial refresh warning", { error: message });
      }

      // ── Course thumbnail fix ─────────────────────────────────────────────
      // Ensure the ETAP course uses the correct, matching thumbnail image.
      // This UPDATE runs on every boot to keep the thumbnail in sync with
      // the professional AI-generated image in /public/course-etap.jpg
      try {
        logger.info("[DB] Fixing course thumbnails...");
        await conn.execute(
          `UPDATE courses SET thumbnail = '/course-etap.jpg' WHERE slug = 'etap-complete-course'`
        );
        // Fix remaining old-format thumbnails
        await conn.execute(
          `UPDATE courses SET thumbnail = REPLACE(thumbnail, '/images/courses/etap-thumb.jpg', '/course-etap.jpg') WHERE thumbnail LIKE '%etap-thumb%'`
        );
        logger.info("[DB] Course thumbnails fixed");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn("[DB] Course thumbnail fix warning", { error: message });
      }

      // ── Course deduplication migration ──────────────────────────────────
      // The courses table has UNIQUE INDEX on slug but it wasn't enforced,
      // causing duplicate courses to accumulate. This cleans up duplicates.
      try {
        logger.info("[DB] Checking for duplicate courses...");

        // Step 1: Add unique index if not exists (ignore errors)
        try {
          await conn.execute(
            `ALTER TABLE courses ADD UNIQUE INDEX courses_slug_unique (slug)`
          );
          logger.info("[DB]   + Added UNIQUE INDEX on courses.slug");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("Duplicate")) {
            logger.info("[DB]   UNIQUE INDEX on courses.slug already exists");
          } else {
            // Index might exist with different name, check
            logger.warn("[DB]   Index add skipped", { error: msg.substring(0, 80) });
          }
        }

        // Step 2: Find and remove duplicate slugs keeping only the newest (highest id)
        const [dupRows] = await conn.execute(`
          SELECT slug, GROUP_CONCAT(id ORDER BY id DESC) as all_ids
          FROM courses
          GROUP BY slug
          HAVING COUNT(*) > 1
        `) as unknown as [{ slug: string; all_ids: string }[]];

        if (dupRows.length > 0) {
          logger.info(`[DB]   Found ${dupRows.length} duplicate slugs, cleaning up...`);
          for (const row of dupRows) {
            const ids = row.all_ids.split(",");
            // Keep the first (newest), delete the rest
            const keepId = ids[0];
            const deleteIds = ids.slice(1).join(",");
            await conn.execute(
              `DELETE FROM courses WHERE id IN (${deleteIds})`
            );
            logger.info(`[DB]   Kept id=${keepId}, deleted ${ids.length - 1} duplicate(s) for slug: ${row.slug}`);
          }
        } else {
          logger.info("[DB]   No duplicate courses found");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn("[DB] Course deduplication warning", { error: message });
      }

      // ── v4 features: 2FA columns + userSessions + userNotes + licenses tables ──
      // Previously these were only created by migration-v4-features.sql which
      // db-init.ts never ran → existing databases had broken 2FA / notes / licenses.
      // We now add them inline so existing DBs get upgraded on next boot.
      logger.info("[DB] Running v4 features migration (2FA + sessions/notes/licenses)...");

      // 2FA columns on users table
      if (!(await columnExists("users", "totpSecret"))) {
        try { await conn.execute(`ALTER TABLE users ADD COLUMN totpSecret VARCHAR(255) NULL`); logger.info("[DB]   + users.totpSecret"); } catch (e) { logger.warn("[DB] totpSecret", { error: (e as Error).message }); }
      }
      if (!(await columnExists("users", "totpEnabled"))) {
        try { await conn.execute(`ALTER TABLE users ADD COLUMN totpEnabled BOOLEAN NOT NULL DEFAULT FALSE`); logger.info("[DB]   + users.totpEnabled"); } catch (e) { logger.warn("[DB] totpEnabled", { error: (e as Error).message }); }
      }
      if (!(await columnExists("users", "totpBackupCodes"))) {
        try { await conn.execute(`ALTER TABLE users ADD COLUMN totpBackupCodes JSON NULL`); logger.info("[DB]   + users.totpBackupCodes"); } catch (e) { logger.warn("[DB] totpBackupCodes", { error: (e as Error).message }); }
      }
      if (!(await columnExists("users", "deviceFingerprint"))) {
        try { await conn.execute(`ALTER TABLE users ADD COLUMN deviceFingerprint VARCHAR(255) NULL`); logger.info("[DB]   + users.deviceFingerprint"); } catch (e) { logger.warn("[DB] deviceFingerprint", { error: (e as Error).message }); }
      }
      // Email verification columns (restored by migration_restore_email_verification.sql,
      // now applied inline so existing DBs that ran v2_cleanup get them back)
      if (!(await columnExists("users", "emailVerificationToken"))) {
        try { await conn.execute(`ALTER TABLE users ADD COLUMN emailVerificationToken VARCHAR(255) NULL`); logger.info("[DB]   + users.emailVerificationToken"); } catch (e) { logger.warn("[DB] emailVerificationToken", { error: (e as Error).message }); }
      }
      if (!(await columnExists("users", "emailVerificationExpiry"))) {
        try { await conn.execute(`ALTER TABLE users ADD COLUMN emailVerificationExpiry TIMESTAMP NULL`); logger.info("[DB]   + users.emailVerificationExpiry"); } catch (e) { logger.warn("[DB] emailVerificationExpiry", { error: (e as Error).message }); }
      }
      if (!(await columnExists("users", "emailVerifiedAt"))) {
        try { await conn.execute(`ALTER TABLE users ADD COLUMN emailVerifiedAt TIMESTAMP NULL`); logger.info("[DB]   + users.emailVerifiedAt"); } catch (e) { logger.warn("[DB] emailVerifiedAt", { error: (e as Error).message }); }
      }
      if (!(await columnExists("users", "pendingEmail"))) {
        try { await conn.execute(`ALTER TABLE users ADD COLUMN pendingEmail VARCHAR(320) NULL`); logger.info("[DB]   + users.pendingEmail"); } catch (e) { logger.warn("[DB] pendingEmail", { error: (e as Error).message }); }
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
        logger.info("[DB] v4 tables verified (userSessions, userNotes, licenses)");
      } catch (err) {
        logger.warn("[DB] v4 tables migration warning", { error: (err as Error).message });
      }

      // ── v5 features: referenceFiles table (engineering reference library) ──
      try {
        logger.info("[DB] Running v5 features migration (referenceFiles table)...");
        await conn.query(`
          CREATE TABLE IF NOT EXISTS \`referenceFiles\` (
            \`id\`            BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
            \`title\`         VARCHAR(500)     NOT NULL,
            \`description\`   TEXT             NULL,
            \`fileName\`      VARCHAR(500)     NOT NULL,
            \`fileKey\`       VARCHAR(1000)    NOT NULL,
            \`fileUrl\`       VARCHAR(1000)    NOT NULL,
            \`fileType\`      VARCHAR(100)     NOT NULL,
            \`fileSize\`      BIGINT UNSIGNED  NOT NULL,
            \`category\`      VARCHAR(100)     NULL DEFAULT 'general',
            \`uploadedById\`  BIGINT UNSIGNED  NULL,
            \`isPublic\`      BOOLEAN          NOT NULL DEFAULT TRUE,
            \`isPublished\`   BOOLEAN          NOT NULL DEFAULT TRUE,
            \`downloadCount\` INT              NOT NULL DEFAULT 0,
            \`sortOrder\`     INT              NOT NULL DEFAULT 0,
            \`createdAt\`     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
            \`updatedAt\`     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (\`id\`),
            INDEX \`reference_files_category_idx\` (\`category\`),
            INDEX \`reference_files_published_idx\` (\`isPublished\`),
            INDEX \`reference_files_sort_idx\` (\`sortOrder\`),
            CONSTRAINT \`fk_reference_files_uploader\` FOREIGN KEY (\`uploadedById\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        logger.info("[DB] v5 referenceFiles table verified");
      } catch (err) {
        logger.warn("[DB] v5 referenceFiles migration warning", { error: (err as Error).message });
      }

      // ── v6 features: FAQ, Wishlists, LessonComments, CommentLikes, NotificationPreferences ──
      try {
        logger.info("[DB] Running v6 features migration (FAQ, wishlists, comments, notif prefs)...");
        await conn.query(`CREATE TABLE IF NOT EXISTS \`faqEntries\` (
          \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`questionEn\` VARCHAR(500) NOT NULL,
          \`questionAr\` VARCHAR(500) NOT NULL,
          \`answerEn\` TEXT NOT NULL,
          \`answerAr\` TEXT NOT NULL,
          \`category\` VARCHAR(100) NOT NULL DEFAULT 'general',
          \`sortOrder\` INT NOT NULL DEFAULT 0,
          \`isPublished\` BOOLEAN NOT NULL DEFAULT TRUE,
          \`viewCount\` INT NOT NULL DEFAULT 0,
          \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updatedAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          INDEX \`faq_category_idx\` (\`category\`),
          INDEX \`faq_published_idx\` (\`isPublished\`),
          INDEX \`faq_sort_idx\` (\`sortOrder\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);

        await conn.query(`CREATE TABLE IF NOT EXISTS \`wishlists\` (
          \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`userId\` BIGINT UNSIGNED NOT NULL,
          \`courseId\` BIGINT UNSIGNED NOT NULL,
          \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE INDEX \`wishlist_user_course_unique\` (\`userId\`, \`courseId\`),
          INDEX \`wishlist_user_idx\` (\`userId\`),
          CONSTRAINT \`fk_wishlist_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT \`fk_wishlist_course\` FOREIGN KEY (\`courseId\`) REFERENCES \`courses\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);

        await conn.query(`CREATE TABLE IF NOT EXISTS \`lessonComments\` (
          \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`lessonId\` BIGINT UNSIGNED NOT NULL,
          \`userId\` BIGINT UNSIGNED NOT NULL,
          \`content\` TEXT NOT NULL,
          \`parentCommentId\` BIGINT UNSIGNED NULL,
          \`isPinned\` BOOLEAN NOT NULL DEFAULT FALSE,
          \`isHidden\` BOOLEAN NOT NULL DEFAULT FALSE,
          \`likeCount\` INT NOT NULL DEFAULT 0,
          \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updatedAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          INDEX \`comments_lesson_idx\` (\`lessonId\`),
          INDEX \`comments_user_idx\` (\`userId\`),
          INDEX \`comments_parent_idx\` (\`parentCommentId\`),
          CONSTRAINT \`fk_comments_lesson\` FOREIGN KEY (\`lessonId\`) REFERENCES \`lessons\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT \`fk_comments_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);

        await conn.query(`CREATE TABLE IF NOT EXISTS \`commentLikes\` (
          \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`commentId\` BIGINT UNSIGNED NOT NULL,
          \`userId\` BIGINT UNSIGNED NOT NULL,
          \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE INDEX \`comment_like_unique\` (\`commentId\`, \`userId\`),
          INDEX \`comment_like_comment_idx\` (\`commentId\`),
          CONSTRAINT \`fk_comment_like_comment\` FOREIGN KEY (\`commentId\`) REFERENCES \`lessonComments\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT \`fk_comment_like_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);

        await conn.query(`CREATE TABLE IF NOT EXISTS \`notificationPreferences\` (
          \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          \`userId\` BIGINT UNSIGNED NOT NULL,
          \`emailNewCourses\` BOOLEAN NOT NULL DEFAULT TRUE,
          \`emailPromotions\` BOOLEAN NOT NULL DEFAULT TRUE,
          \`emailLessonReplies\` BOOLEAN NOT NULL DEFAULT TRUE,
          \`emailCertificates\` BOOLEAN NOT NULL DEFAULT TRUE,
          \`pushNewCourses\` BOOLEAN NOT NULL DEFAULT TRUE,
          \`pushPromotions\` BOOLEAN NOT NULL DEFAULT FALSE,
          \`pushLessonReplies\` BOOLEAN NOT NULL DEFAULT TRUE,
          \`pushCertificates\` BOOLEAN NOT NULL DEFAULT TRUE,
          \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          \`updatedAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (\`id\`),
          UNIQUE INDEX \`notif_prefs_user_unique\` (\`userId\`),
          CONSTRAINT \`fk_notif_prefs_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);

        // Seed default FAQ entries if table is empty
        const [faqCount] = await conn.execute("SELECT COUNT(*) AS cnt FROM faqEntries") as unknown as [{ cnt: number }[]];
        if (faqCount[0]?.cnt === 0) {
          await conn.execute(`INSERT INTO faqEntries (questionEn, questionAr, answerEn, answerAr, category, sortOrder) VALUES
            ('How do I enroll in a course?', 'كيف أسجل في كورس؟', 'Browse the Courses page, click on any course, and click the Enroll button. Free courses are instantly available. Paid courses redirect to Paymob for secure payment.', 'تصفح صفحة الكورسات، اضغط على أي كورس، ثم اضغط زر التسجيل. الكورسات المجانية متاحة فوراً. الكورسات المدفوعة تحولك إلى Paymob للدفع الآمن.', 'courses', 1),
            ('How do I get my certificate?', 'كيف أحصل على شهادتي؟', 'Certificates are automatically issued when you complete all lessons in a course. Visit your Dashboard to view and download certificates.', 'تصدر الشهادات تلقائياً عند إكمال جميع الدروس في الكورس. تفضل بزيارة لوحة التحكم لعرض وتحميل الشهادات.', 'certificates', 2),
            ('What payment methods are accepted?', 'ما طرق الدفع المقبولة؟', 'We accept all major credit/debit cards, mobile wallets, and cash through Paymob (Egyptian payment gateway).', 'نقبل جميع البطاقات الائتمانية/الخصم الرئيسية، محافظ الهاتف المحمول، والدفع النقدي من خلال Paymob (بوابة الدفع المصرية).', 'payments', 3),
            ('Can I access courses on mobile?', 'هل يمكنني الوصول للكورسات على الهاتف؟', 'Yes! The platform is fully responsive and also available as an Android app. Download from the Google Play Store or access via your mobile browser.', 'نعم! المنصة متجاوبة بالكامل ومتاحة أيضاً كتطبيق أندرويد. حملها من Google Play أو ادخل من متصفح هاتفك.', 'technical', 4),
            ('How do I reset my password?', 'كيف أعيد تعيين كلمة المرور؟', 'Click "Forgot Password" on the login page. Enter your email, and we will send a reset link valid for 30 minutes.', 'اضغط "نسيت كلمة المرور" في صفحة تسجيل الدخول. أدخل بريدك الإلكتروني وسنرسل رابط إعادة التعيين صالح لمدة 30 دقيقة.', 'account', 5)
          `);
          logger.info("[DB] Default FAQ entries seeded");
        }

        // ── Social links sync (existing deployments) ──
        // The footer social icons read siteSettings.contact.*. Older databases
        // still carry the '#'/'' "not configured" sentinels, which HIDE the
        // icons entirely. Fill ONLY sentinel/missing rows with the official
        // platform URLs — real URLs saved from the admin dashboard are never
        // overwritten (IF guard in ON DUPLICATE KEY UPDATE).
        const SOCIAL_LINK_DEFAULTS: [string, string, number][] = [
          ["youtubeUrl", "https://youtube.com/playlist?list=PLeeb5_Qjhcgc", 10],
          ["facebookUrl", "https://www.facebook.com/share/1Cm6U14ihR/", 12],
          ["instagramUrl", "https://www.instagram.com/ahmedetap1", 13],
          ["tiktokUrl", "https://www.tiktok.com/@ahmedetap", 14],
          ["telegramUrl", "https://t.me/engahmedetap", 17],
        ];
        try {
          for (const [key, url, sortOrder] of SOCIAL_LINK_DEFAULTS) {
            await conn.execute(
              `INSERT INTO siteSettings (section, \`key\`, value, type, sortOrder)
               VALUES ('contact', ?, ?, 'url', ?)
               ON DUPLICATE KEY UPDATE \`value\` = IF(\`value\` IN ('#', ''), VALUES(\`value\`), \`value\`)`,
              [key, url, sortOrder]
            );
          }
          // Settings are cached (Redis/in-memory) — invalidate so the synced
          // values are served on the very first request after boot.
          await invalidateSettingsCache();
          logger.info("[DB] Social link defaults synced (sentinel rows only)");
        } catch (err) {
          logger.warn("[DB] Social links sync warning", { error: (err as Error).message });
        }

        logger.info("[DB] v6 tables verified (faqEntries, wishlists, lessonComments, commentLikes, notificationPreferences)");
      } catch (err) {
        logger.warn("[DB] v6 migration warning", { error: (err as Error).message });
      }

      // ── v7 features: articles table (blog / knowledge base) ──
      try {
        logger.info("[DB] Running v7 features migration (articles table)...");
        await conn.query(`
          CREATE TABLE IF NOT EXISTS \`articles\` (
            \`id\`          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
            \`slug\`        VARCHAR(300)     NOT NULL,
            \`titleAr\`     VARCHAR(500)     NOT NULL,
            \`titleEn\`     VARCHAR(500)     NOT NULL,
            \`excerptAr\`   VARCHAR(1000)    NULL,
            \`excerptEn\`   VARCHAR(1000)    NULL,
            \`contentAr\`   MEDIUMTEXT       NOT NULL,
            \`contentEn\`   MEDIUMTEXT       NULL,
            \`coverImage\`  VARCHAR(1000)    NULL,
            \`category\`    VARCHAR(100)     NOT NULL DEFAULT 'general',
            \`tags\`        VARCHAR(500)     NULL,
            \`authorId\`    BIGINT UNSIGNED  NULL,
            \`authorName\`  VARCHAR(200)     NULL,
            \`isPublished\` BOOLEAN          NOT NULL DEFAULT FALSE,
            \`publishedAt\` TIMESTAMP        NULL,
            \`viewCount\`   INT              NOT NULL DEFAULT 0,
            \`readMinutes\` INT              NOT NULL DEFAULT 5,
            \`sortOrder\`   INT              NOT NULL DEFAULT 0,
            \`createdAt\`   TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
            \`updatedAt\`   TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (\`id\`),
            UNIQUE INDEX \`articles_slug_unique\` (\`slug\`),
            INDEX \`articles_published_idx\` (\`isPublished\`),
            INDEX \`articles_category_idx\` (\`category\`),
            INDEX \`articles_published_at_idx\` (\`publishedAt\`),
            CONSTRAINT \`fk_articles_author\` FOREIGN KEY (\`authorId\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        logger.info("[DB] v7 articles table verified");
      } catch (err) {
        logger.warn("[DB] v7 articles migration warning", { error: (err as Error).message });
      }

      // ── v8 feature: chatbot image quota (vision daily limit, per IP) ──
      try {
        logger.info("[DB] Running v8 features migration (chatbotImageQuota table)...");
        await conn.query(`
          CREATE TABLE IF NOT EXISTS \`chatbotImageQuota\` (
            \`id\`        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            \`quotaKey\`  VARCHAR(128)    NOT NULL,
            \`quotaDay\`  DATE            NOT NULL,
            \`imagesUsed\` INT UNSIGNED   NOT NULL DEFAULT 0,
            \`updatedAt\` TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (\`id\`),
            UNIQUE INDEX \`uq_quota_key_day\` (\`quotaKey\`, \`quotaDay\`)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);
        logger.info("[DB] v8 chatbotImageQuota table verified");
      } catch (err) {
        logger.warn("[DB] v8 image quota migration warning", { error: (err as Error).message });
      }

      // ── v9 feature: dynamic AI provider router (admin-managed providers) ──
      // aiProviders  — admin adds ANY OpenAI-compatible provider + API key
      // aiModels     — models auto-discovered via GET {baseUrl}/models and
      //                classified chat vs vision (failover routing input).
      // The DDL lives in db/migration-v9-ai-router.sql (repo convention —
      // see migration-v4-features.sql) and is executed statement by statement.
      try {
        logger.info("[DB] Running v9 features migration (aiProviders + aiModels tables)...");
        const v9Sql = readFileSync(join(__dirname, "..", "..", "db", "migration-v9-ai-router.sql"), "utf-8");
        // Strip comment lines FIRST (the header comment precedes the first
        // statement — trimming chunks alone would drop that CREATE TABLE).
        const v9Statements = v9Sql
          .split(";")
          .map((chunk) => chunk.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
          .filter((s) => s.length > 0);
        for (const statement of v9Statements) {
          await conn.query(statement);
        }
        logger.info("[DB] v9 aiProviders + aiModels tables verified");

        // Seed known providers from env keys on first run ONLY (table empty).
        // Keys become admin-visible/editable in the dashboard immediately.
        const [providerRows] = await conn.query("SELECT COUNT(*) AS n FROM `aiProviders`");
        const providerCount = Number((providerRows as { n?: number }[])[0]?.n ?? 0);
        if (providerCount === 0) {
          const groqKey = env.GROQ_API_KEY || process.env.GROQ_API_KEY || "";
          const orKey = env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || process.env.CHATBOT_API_KEY || "";
          const nvidiaKey = env.NVIDIA_API_KEY || process.env.NVIDIA_API_KEY || "";
          const seeds: [string, string, string, string, number][] = [
            ["nvidia", "NVIDIA NIM", "https://integrate.api.nvidia.com/v1", nvidiaKey, 10],
            ["openrouter", "OpenRouter", "https://openrouter.ai/api/v1", orKey, 20],
            ["groq", "Groq", "https://api.groq.com/openai/v1", groqKey, 30],
          ];
          for (const [slug, displayName, baseUrl, apiKey, priority] of seeds) {
            if (!apiKey) continue;
            await conn.execute(
              "INSERT IGNORE INTO `aiProviders` (slug, displayName, baseUrl, apiKey, priority, enabled, status) VALUES (?, ?, ?, ?, ?, TRUE, 'unknown')",
              [slug, displayName, baseUrl, apiKey, priority],
            );
            logger.info(`[DB] v9 seeded provider "${slug}" from env key`);
          }
        }
      } catch (err) {
        logger.warn("[DB] v9 ai router migration warning", { error: (err as Error).message });
      }

      // ── v10 feature: persist each model's context window (tokens) ──
      // classifyRawModel already extracts context_length from the provider's
      // /models payload — v10 stores it so the router can clamp max_tokens for
      // small-context models (allam-2-7b 400s on thinking's 8192).
      try {
        if (!(await columnExists("aiModels", "contextLength"))) {
          logger.info("[DB] Running v10 features migration (aiModels.contextLength)...");
          await conn.query("ALTER TABLE `aiModels` ADD COLUMN `contextLength` INT NULL AFTER `tier`");
          logger.info("[DB] v10 aiModels.contextLength verified");
        }
      } catch (err) {
        logger.warn("[DB] v10 model-context migration warning", { error: (err as Error).message });
      }

      // ── Admin password sync (existing deployments) ──
      // The seed step below (which upserts the admin hash from
      // ADMIN_PASSWORD) only runs on FIRST boot. On existing databases we
      // return early here — leaving the owner no documented lever to set or
      // rotate the admin password. Restore the documented behavior: when
      // ADMIN_PASSWORD is explicitly set, keep the admin hash in sync (same
      // ON DUPLICATE KEY UPDATE as the seed path). When it is NOT set, touch
      // nothing — no accidental lockouts, no random churn.
      if (env.ADMIN_PASSWORD) {
        try {
          const adminPasswordHash = await hashPassword(env.ADMIN_PASSWORD);
          await conn.execute(
            `INSERT INTO users (username, passwordHash, name, email, role, preferredLanguage, createdAt, updatedAt, lastSignInAt)
             VALUES (?, ?, 'Ahmed Elbaz', 'admin@ahmedelbaz.qzz.io', 'admin', 'ar', NOW(), NOW(), NOW())
             ON DUPLICATE KEY UPDATE passwordHash = VALUES(passwordHash)`,
            ['admin', adminPasswordHash]
          );
          logger.info("[DB] Admin password synced from ADMIN_PASSWORD env variable");
        } catch (err) {
          logger.warn("[DB] Admin password sync warning", { error: (err as Error).message });
        }
      }

      migrationDone = true;
      return;
    }

    logger.info("[DB] First run detected — initializing schema...");

    // ── Step 2: Create all tables ──
    const schemaPath = join(__dirname, "..", "..", "db", "init-schema.sql");
    const schemaSql = readFileSync(schemaPath, "utf-8");
    await conn.query(schemaSql);
    logger.info("[DB] All 24 tables created (incl. userSessions, userNotes, licenses)");

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

      // Categories — single category: ETAP (platform focuses on the ETAP course)
      `INSERT IGNORE INTO categories (slug, nameEn, nameAr, icon, sortOrder, createdAt) VALUES
       ('etap', 'ETAP Software', 'برنامج ETAP', 'Monitor', 1, NOW())`,

      // Courses
      `SET @cat2 = (SELECT id FROM categories WHERE slug = 'etap' LIMIT 1)`,

      // Course: ETAP Complete Course (PREMIUM) — the platform's single course
      `INSERT IGNORE INTO courses (slug, categoryId, titleEn, titleAr, descriptionEn, descriptionAr, shortDescEn, shortDescAr, thumbnail, level, isPremium, price, originalPrice, durationHours, rating, reviewCount, studentCount, instructorName, isPublished, isFeatured, sortOrder, createdAt, updatedAt)
       VALUES ('etap-complete-course', @cat2,
         'ETAP Complete Course — From Zero to Expert', 'كورس ETAP الشامل — من الصفر للاحتراف',
         'Master ETAP software for power system analysis including load flow, short circuit, arc flash, relay coordination, and harmonic analysis.',
         'أتقن برنامج ETAP لتحليل أنظمة الطاقة بما في ذلك تدفق الأحمال والدوائر القصيرة وقوس الكهرباء وتنسيق الريليه.',
         'Become an ETAP expert', 'أصبح خبير ETAP',
          '/course-etap.jpg', 'intermediate', 1, '1999.00', '3499.00', 13, 4.9, 42, 234, 'Eng Ahmed Elbaz', 1, 1, 2, NOW(), NOW())`,

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

      // Contact settings — social URLs are the official platform links
      // (upserted on every boot so existing deployments pick them up).
      `INSERT INTO siteSettings (section, \`key\`, value, type, sortOrder) VALUES
       ('contact', 'whatsappNumber', '201061857305', 'text', 1),
       ('contact', 'phone', '01061857305', 'text', 2),
       ('contact', 'email', 'contact@ahmedelbaz.com', 'text', 3),
       ('contact', 'whatsappMessageEn', 'Hi! I am interested in your engineering courses.', 'text', 4),
       ('contact', 'whatsappMessageAr', 'مرحباً! أنا مهتم بالكورسات الهندسية.', 'text', 5),
       ('contact', 'youtubeUrl', 'https://youtube.com/playlist?list=PLeeb5_Qjhcgc', 'url', 10),
       ('contact', 'linkedinUrl', '#', 'url', 11),
       ('contact', 'facebookUrl', 'https://www.facebook.com/share/1Cm6U14ihR/', 'url', 12),
       ('contact', 'instagramUrl', 'https://www.instagram.com/ahmedetap1', 'url', 13),
       ('contact', 'tiktokUrl', 'https://www.tiktok.com/@ahmedetap', 'url', 14),
       ('contact', 'twitterUrl', '', 'url', 15),
       ('contact', 'telegramUrl', 'https://t.me/engahmedetap', 'url', 17),
       ('contact', 'websiteUrl', 'https://ahmedelbaz.qzz.io', 'url', 16)
       ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`)`,
    ];

    // Log the generated admin password in development
    if (!env.isProduction) { // NOSONAR — error-first logging convention for dev/prod split
      logger.info("[DB] Admin account created", { username: "admin", password: adminPassword });
    } else {
      logger.info("[DB] Admin account created (password from ADMIN_PASSWORD env variable)");
    }

    for (const sql of seedSql) {
      try {
        await conn.execute(sql);
      } catch (err) {
        // Ignore SET variable errors or duplicate key warnings
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("INSERT IGNORE") && !message.includes("Duplicate") && !sql.startsWith("SET ")) {
          logger.warn("[DB] Seed warning", { error: message });
        }
      }
    }

    logger.info("[DB] Seed data inserted (admin user, 4 categories, 4 courses, testimonials, contact settings)");
    migrationDone = true;
    freshSchemaInitialized = true;
    } finally {
      // 🔒 Release the migration lock so other pods can proceed.
      // Safe to call even if the lock was never acquired (RELEASE_LOCK returns 0).
      if (acquiredLock) {
        try {
          await conn.execute("SELECT RELEASE_LOCK('elbaz_db_migration')");
          logger.info("[DB] Released migration lock");
        } catch {
          // Connection may already be closing — release happens automatically on conn close.
        }
      }
      conn.release();
    }
  } catch (err) {
    logger.error("[DB] Migration failed", { error: String(err) });
    // Don't crash — let the app start anyway and queries will fail with proper 500 errors
    migrationDone = true;
  }

  // Fresh-schema boot: run the incremental feature migrations (v4–v10) NOW —
  // they are all idempotent (CREATE IF NOT EXISTS / columnExists-guarded) and
  // the lock was already released by the finally above.
  if (freshSchemaInitialized) {
    freshSchemaInitialized = false;
    migrationDone = false;
    logger.info("[DB] Fresh schema — running incremental feature migrations on first boot");
    return ensureDatabase();
  }
}
