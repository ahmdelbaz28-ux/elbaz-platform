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

/** Daily image allowance per user (per IP) — kept small to preserve the vision providers' quota. */
export const DAILY_IMAGE_LIMIT = 5;

/**
 * ✅ ROOT-CURE (2026-11-13, live screen sessions died after 5 frames): LIVE
 * screen-teacher frames get their OWN daily lane. The screen-teacher contract
 * demands a fresh frame with EVERY message ("2-3 steps, then send a new
 * capture"), so a real guidance session needs far more than 5 frames — under
 * the shared 5/day cap the advertised live-screen capability was unusable
 * after five exchanges. The lane is still hard-bounded: the per-IP message
 * cap (60/day) already limits how many frames can possibly be sent, so a
 * 60/day frame allowance can never exceed the message quota's cost ceiling
 * (60 screen frames + 5 attachments = ≤65 vision reads/day/IP).
 * The tag is client-supplied, so an abuser gains nothing: tagging a plain
 * attachment as "screen_capture" merely moves it from the 5-bucket to the
 * 60-bucket — the total vision cost per IP stays bounded either way.
 */
export const DAILY_SCREEN_FRAME_LIMIT = 60;

/** Distinct quota key for the live-screen lane (same storage, own bucket). */
export function screenFrameQuotaKey(ip: string): string {
  return `${ip}#screen`;
}

/**
 * Which daily quota lane a vision request rides: live screen frames
 * (`source: "screen_capture"`) use the 60/day screen lane, ordinary
 * attachments keep the 5/day lane. Pure + unit-testable.
 */
export function visionQuotaLane(screenCapture: boolean, ip: string): { key: string; limit: number; screen: boolean } {
  return screenCapture
    ? { key: screenFrameQuotaKey(ip), limit: DAILY_SCREEN_FRAME_LIMIT, screen: true }
    : { key: ip, limit: DAILY_IMAGE_LIMIT, screen: false };
}

const memQuota = new Map<string, { day: string; used: number }>();
// ✅ SECURITY FIX (pre-launch audit run-2, chatbot.map-bounds): the mirror
// is keyed by client IP — spoofable header values used to grow it without
// bound between cleanup ticks. Hard cap with stale-entry eviction.
const MEM_QUOTA_MAX_SIZE = 20_000;

function evictMemQuotaIfNeeded(today: string): void {
  if (memQuota.size < MEM_QUOTA_MAX_SIZE) return;
  for (const [key, entry] of memQuota) {
    if (entry.day !== today) memQuota.delete(key);
  }
  if (memQuota.size >= MEM_QUOTA_MAX_SIZE) {
    const oldest = memQuota.keys().next().value;
    if (oldest !== undefined) memQuota.delete(oldest);
  }
}

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
  evictMemQuotaIfNeeded(day);
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
