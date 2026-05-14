import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { TRPCError } from "@trpc/server";
import { getCache } from "./lib/cache";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type NotificationEventType = "enrollment" | "promo" | "update" | "system";

export interface NotificationEvent {
  id: string;
  type: NotificationEventType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  createdAt: string; // ISO timestamp
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Redis key prefix for per-user notification event lists (JSON array). */
const NOTIFICATIONS_KEY_PREFIX = "notifications:user:";

/**
 * Per-user rate limit for notification polling.
 * Max 1 request every 10 seconds per userId.
 */
const POLL_RATE_LIMIT_TTL = 10; // seconds
const POLL_RATE_LIMIT_KEY = (userId: number) => `rl:notificationPoll:${userId}`;

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Generate a unique, sortable event ID.
 * Format: `{timestamp-millis}-{random}` — the timestamp prefix ensures
 * chronological ordering so we can do cursor-based filtering by ID.
 */
function generateEventId(): string {
  return `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Gracefully read notifications from the cache layer.
 * Returns null when the cache is unavailable (not an error worth surfacing).
 */
async function readNotifications(userId: number): Promise<NotificationEvent[] | null> {
  try {
    const cache = getCache();
    // ✅ FIX: Always use per-user key — never fall back to a global key that could
    // leak notifications between users if userId is ever falsy/0.
    const key = NOTIFICATIONS_KEY_PREFIX + userId;
    const raw = await cache.get<NotificationEvent[]>(key);
    return raw;
  } catch {
    // Graceful degradation — cache unavailable
    return null;
  }
}

// ─── Router ────────────────────────────────────────────────────────────────────

/**
 * Notification Polling Router
 *
 * Provides a cursor-based polling endpoint for real-time notifications.
 *
 * Architecture:
 * - Notifications are stored in Redis (or in-memory LRU fallback) as a
 *   JSON array under a single key.
 * - Clients send `lastEventId` to receive only events that arrived after
 *   their last seen event (cursor-based, no pagination offset).
 * - Rate limited to 1 request per 10 seconds per authenticated user.
 * - Gracefully returns an empty array when the cache layer is unavailable.
 *
 * Future improvements:
 * - Migrate to a `notifications` MySQL table + Drizzle ORM when one is
 *   added to `@db/schema`.
 * - Add a `push` mutation for admins to publish events.
 * - Add a `read` mutation for users to mark events as read.
 */
export const notificationPollRouter = createRouter({
  poll: authedQuery
    .input(
      z.object({
        /** Cursor — only return events with an ID lexicographically greater than this. */
        lastEventId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // ── Per-user rate limit: 1 request per 10 seconds ────────────────
      // authedQuery already applies a global IP-based rate limit (60/min),
      // but polling is user-scoped so we add a tighter per-user throttle.
      try {
        const cache = getCache();
        const rlKey = POLL_RATE_LIMIT_KEY(ctx.user.id);
        const alreadyPolled = await cache.get<string>(rlKey);
        if (alreadyPolled) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Please wait at least 10 seconds between notification polls.",
          });
        }
        // Set the rate-limit flag with a 10-second TTL.
        await cache.set(rlKey, "1", POLL_RATE_LIMIT_TTL);
      } catch (e) {
        // If it's already a TRPCError (rate limited), re-throw it.
        if (e instanceof TRPCError) throw e;
        // Cache unavailable — allow the request through (graceful degradation).
      }

      // ── Read notification events from cache (scoped to this user) ─────
      const allEvents = await readNotifications(ctx.user.id);

      // Graceful degradation: if cache is unavailable, return empty.
      if (!allEvents) {
        return { events: [] as NotificationEvent[] };
      }

      // ── Cursor-based filtering ────────────────────────────────────────
      // Event IDs start with `{timestamp}-` so lexical comparison is
      // equivalent to chronological ordering.
      const filtered = input.lastEventId
        ? allEvents.filter((ev) => ev.id > input.lastEventId!)
        : allEvents;

      // Return newest events first for the client.
      const sorted = [...filtered].sort((a, b) => b.id.localeCompare(a.id));

      return { events: sorted };
    }),
});

// ─── Utility: push a notification event (for use by other routers/services) ────

/**
 * Publish a notification event to a user's notification stream.
 *
 * This is exported as a utility so other routers (e.g., payment, enrollment)
 * and mini-services can push notifications when important events occur.
 *
 * Events are stored for up to 24 hours (86400 seconds) since they are
 * ephemeral polling data — clients are expected to consume them promptly.
 *
 * ✅ FIX: Always requires an explicit targetUserId — no global key fallback
 * that could leak notifications between users.
 */
export async function pushNotificationEvent(
  type: NotificationEventType,
  title: string,
  message: string,
  targetUserId: number,
  data?: Record<string, unknown>,
): Promise<void> {
  try {
    const cache = getCache();
    const event: NotificationEvent = {
      id: generateEventId(),
      type,
      title,
      message,
      data,
      createdAt: new Date().toISOString(),
    };

    const key = NOTIFICATIONS_KEY_PREFIX + targetUserId;

    const existing = await cache.get<NotificationEvent[]>(key);
    const updated = [event, ...(existing || [])].slice(0, 200);

    await cache.set(key, updated, 86400); // 24 hours TTL
  } catch {
    // Silent fail — notification delivery is best-effort.
  }
}
