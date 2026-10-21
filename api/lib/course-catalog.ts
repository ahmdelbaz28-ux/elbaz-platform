/**
 * COURSE CATALOG FOR CHATBOT — real course data injected into the system prompt
 *
 * Why: the chatbot must quote real course names, levels and prices from the
 * database instead of inventing them (live-audit finding: the bot once quoted
 * prices in SAR with random numbers). This module builds a compact bilingual
 * catalog block and serves it stale-while-revalidate so chat latency is never
 * blocked by a DB query.
 *
 * Consumer: api/chatbot-router.ts → getChatResponse / getStreamResponse as
 * the `catalog` argument of getSystemPrompt (see api/lib/chatbot-skills.ts).
 */

import { eq, asc, desc } from "drizzle-orm";
import { getDb } from "../queries/connection.js";
import { courses } from "@db/schema";
import { fetchWithSWR } from "./cache.js";
import { logger } from "./logger.js";

/** Hard cap to bound prompt tokens even if the catalog grows large. */
const MAX_COURSES = 40;

/** Cache TTL (seconds) — matches other course caches (COURSES: 5 min). */
const CATALOG_TTL_SECONDS = 10 * 60;

export const COURSE_CATALOG_CACHE_KEY = "chatbot:course-catalog";

const LEVEL_AR: Record<string, string> = {
  beginner: "مبتدئ",
  intermediate: "متوسط",
  advanced: "متقدم",
  "beginner-intermediate": "مبتدئ → متوسط",
  "intermediate-advanced": "متوسط → متقدم",
};

function formatPrice(price: string): string {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) return "مجاني / Free";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} EGP`;
}

/**
 * Format one course line for the prompt. Bilingual title so the bot can
 * quote it in the language of the question (language-mirror rule).
 */
function formatCourseLine(c: {
  titleAr: string;
  titleEn: string;
  level: string;
  price: string;
  durationHours: number;
  isPremium: boolean;
  slug: string;
}): string {
  const levelAr = LEVEL_AR[c.level] ?? c.level;
  const duration = c.durationHours > 0 ? ` | المدة/Duration: ${c.durationHours} ساعة` : "";
  const premium = c.isPremium ? " | مدفوع/Premium" : "";
  return `- ${c.titleAr} | ${c.titleEn} — المستوى/Level: ${levelAr} | السعر/Price: ${formatPrice(c.price)}${duration}${premium} — داخل المنصة (on-platform path): /courses/${c.slug}`;
}

/**
 * Build the catalog text from the database. Returns "" on any failure —
 * the chatbot still works (buildCourseCatalogBlock shows the fallback line).
 */
async function fetchCatalogFromDb(): Promise<string> {
  try {
    const db = getDb();
    const rows = await db
      .select({
        titleAr: courses.titleAr,
        titleEn: courses.titleEn,
        level: courses.level,
        price: courses.price,
        durationHours: courses.durationHours,
        isPremium: courses.isPremium,
        isPublished: courses.isPublished,
        slug: courses.slug,
      })
      .from(courses)
      .where(eq(courses.isPublished, true))
      .orderBy(desc(courses.isFeatured), asc(courses.sortOrder))
      .limit(MAX_COURSES);

    if (!rows || rows.length === 0) return "";
    return rows.map(formatCourseLine).join("\n");
  } catch (err) {
    // Fail-open: chatbot answers without catalog rather than erroring.
    logger.warn("[Chatbot/Catalog] Failed to load course catalog", { error: err instanceof Error ? err.message : String(err) });
    return "";
  }
}

/**
 * Get the formatted course-catalog text (SWR-cached, 10 min, deduplicated).
 * Never throws — returns "" if the database is unavailable.
 */
export async function getCourseCatalogText(): Promise<string> {
  try {
    return await fetchWithSWR(COURSE_CATALOG_CACHE_KEY, fetchCatalogFromDb, CATALOG_TTL_SECONDS);
  } catch (err) {
    logger.warn("[Chatbot/Catalog] Catalog fetch failed (fail-open)", { error: err instanceof Error ? err.message : String(err) });
    return "";
  }
}
