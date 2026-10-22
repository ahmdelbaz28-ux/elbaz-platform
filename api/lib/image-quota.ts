/**
 * CHATBOT IMAGE QUOTA — daily per-user limit for vision requests
 *
 * The chatbot endpoints are intentionally unauthenticated (public chat), so
 * the quota is keyed by client IP (the same key the chatbot rate limiter
 * already uses). Primary storage is the MySQL `chatbotImageQuota` table
 * (created idempotently by api/lib/db-init.ts); an in-memory mirror keeps the
 * quota enforceable if the DB is briefly unavailable — the larger of the two
 * counts wins, so a DB outage can never reset the day's usage.
 *
 * Day boundary: UTC (documented; simple + matches the DB DATE type).
 */

import { pool } from "../queries/connection.js";
import { logger } from "./logger.js";

/** Daily image allowance per user (per IP). */
export const DAILY_IMAGE_LIMIT = 10;

const memQuota = new Map<string, { day: string; used: number }>();

/** Cleanup ticker keeps the memory mirror bounded (matches chatbot-router style). */
setInterval(() => {
  const today = new Date().toISOString().slice(0, 10);
  for (const [key, entry] of memQuota) {
    if (entry.day !== today) memQuota.delete(key);
  }
}, 30 * 60_000).unref();

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function memUsed(key: string): number {
  const entry = memQuota.get(key);
  if (!entry || entry.day !== todayUtc()) return 0;
  return entry.used;
}

/**
 * How many images the key already consumed today. Best-effort: if the DB is
 * unreachable the in-memory mirror is used instead (never throws).
 */
export async function getImageQuotaUsed(key: string): Promise<number> {
  const mem = memUsed(key);
  try {
    const [rows] = await pool.execute(
      "SELECT imagesUsed FROM `chatbotImageQuota` WHERE quotaKey = ? AND quotaDay = ? LIMIT 1",
      [key, todayUtc()],
    );
    const dbUsed = Number((rows as { imagesUsed?: number }[])[0]?.imagesUsed ?? 0);
    return Math.max(dbUsed, mem);
  } catch (err) {
    logger.warn("[ImageQuota] DB read failed — using in-memory mirror", { error: err instanceof Error ? err.message : String(err) });
    return mem;
  }
}

/**
 * Record `n` consumed images for the key today. Always updates the in-memory
 * mirror; DB upsert is best-effort (quota stays enforceable during DB hiccups).
 */
export async function incrementImageQuota(key: string, n: number): Promise<void> {
  const day = todayUtc();
  const entry = memQuota.get(key);
  if (entry && entry.day === day) {
    entry.used += n;
  } else {
    memQuota.set(key, { day, used: n });
  }
  try {
    await pool.execute(
      "INSERT INTO `chatbotImageQuota` (quotaKey, quotaDay, imagesUsed) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE imagesUsed = imagesUsed + ?",
      [key, day, n, n],
    );
  } catch (err) {
    logger.warn("[ImageQuota] DB write failed — memory mirror still counts", { error: err instanceof Error ? err.message : String(err) });
  }
}
