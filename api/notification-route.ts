import { Hono } from "hono";
import { resolveOptionalUser } from "./context";
import { getCache } from "./lib/cache";
import { isAfterCursor, recentBroadcasts, userNotifications } from "./lib/notification-broadcast";

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Wire shape returned to the client poller (src/components/NotificationCenter.tsx). */
export interface PollEvent {
  id: string;
  type: string;
  title: string;
  message: string;
  url?: string;
  channelUrl?: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

/** Legacy per-user cache event shape (notification-poll-router.ts). */
interface CacheEvent {
  id: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

const NOTIFICATIONS_KEY_PREFIX = "notifications:user:";
const POLL_RATE_LIMIT_TTL = 10; // seconds — matches the tRPC poll throttle
const MAX_EVENTS = 50;
/** How far back a first (cursor-less) poll reaches — avoids dumping full history. */
const FIRST_POLL_WINDOW_DAYS = 7;

// ─── Router ────────────────────────────────────────────────────────────────────

/**
 * Notification Poll Route — the live endpoint the frontend bell polls.
 *
 * Merges two sources into one cursor-based stream:
 *   1. DB broadcasts (targetUserId IS NULL) — new lessons/files/software and
 *      YouTube episode announcements. Persistent, visible to every registered
 *      user, survive restarts, and are also seen by users who register later
 *      (within the first-poll window).
 *   2. Legacy per-user cache events (enrollment/payment pushes).
 *
 * Guests get an empty 200 (the client only polls when authenticated anyway —
 * a quiet empty response keeps the console clean for logged-out sessions).
 */
export const notificationRoute = new Hono();

notificationRoute.get("/poll", async (c) => {
  const user = await resolveOptionalUser(c.req.raw);
  if (!user) return c.json({ events: [] as PollEvent[] });

  const after = c.req.query("after") || undefined;

  // ── Per-user throttle: 1 poll / 10s (skip silently when cache is down) ──
  try {
    const cache = getCache();
    const rlKey = `rl:notificationPollRoute:${user.id}`;
    const already = await cache.get<string>(rlKey);
    if (already) return c.json({ events: [] as PollEvent[] });
    await cache.set(rlKey, "1", POLL_RATE_LIMIT_TTL);
  } catch {
    // cache unavailable — allow through (graceful degradation)
  }

  // ── Source 1: DB broadcasts (+ this user's own targeted rows) ──
  const collected: PollEvent[] = [];
  try {
    const [broadcasts, targeted] = await Promise.all([
      recentBroadcasts(MAX_EVENTS),
      userNotifications(user.id, 20),
    ]);
    const cutoff = Date.now() - FIRST_POLL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    for (const row of [...broadcasts, ...targeted]) {
      if (row.createdAt.getTime() < cutoff) continue;
      collected.push({
        id: row.eventId,
        type: row.type,
        title: row.title,
        message: row.message,
        url: row.url ?? undefined,
        channelUrl: row.channelUrl ?? undefined,
        data: (row.data as Record<string, unknown> | null) ?? undefined,
        createdAt: row.createdAt.toISOString(),
      });
    }
  } catch {
    // DB unavailable — fall through to cache-only events
  }

  // ── Source 2: legacy per-user cache events ──
  try {
    const cache = getCache();
    const cached = await cache.get<CacheEvent[]>(NOTIFICATIONS_KEY_PREFIX + user.id);
    if (Array.isArray(cached)) {
      for (const ev of cached) {
        collected.push({
          id: ev.id,
          type: ev.type,
          title: ev.title,
          message: ev.message,
          data: ev.data,
          createdAt: ev.createdAt,
        });
      }
    }
  } catch {
    // cache unavailable — broadcasts alone are enough
  }

  // ── Cursor filter + dedupe + newest-first + cap ──
  const seen = new Set<string>();
  const deduped: PollEvent[] = [];
  for (const ev of collected) {
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    if (!isAfterCursor(ev.id, after)) continue;
    deduped.push(ev);
  }
  const events = deduped.sort((a, b) => b.id.localeCompare(a.id)).slice(0, MAX_EVENTS);

  return c.json({ events });
});
