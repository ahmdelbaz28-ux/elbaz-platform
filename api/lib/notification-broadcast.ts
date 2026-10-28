import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { notifications } from "@db/schema";
import { logger } from "./logger.js";
import { makeEventId } from "./notification-utils.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Notification categories pushed to users. */
export type NotificationType =
  | "lesson"   // new course episode added on the site
  | "file"     // new reference/library file
  | "software" // new software download entry
  | "youtube"  // new episode detected on the YouTube channel
  | "promo"    // manual admin announcement
  | "system";  // anything else

export interface NotificationInput {
  type: NotificationType;
  /** Primary (Arabic-first) title shown in the bell + toast. */
  title: string;
  message: string;
  /** Click-through target: a site path ("/courses/etap") or an absolute URL. */
  url?: string;
  /** Channel link for the subscribe CTA (YouTube notifications). */
  channelUrl?: string;
  /** Undefined = broadcast to EVERY registered user. Set = visible to that user only. */
  targetUserId?: number;
  data?: Record<string, unknown>;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const TITLE_MAX = 290;
const MESSAGE_MAX = 1150;
/** How long broadcast rows live in the DB before the watcher prunes them. */
const RETENTION_DAYS = 30;

// ─── Helpers ───────────────────────────────────────────────────────────────────
// Pure helpers (event ids, cursors, YouTube feed parsing) live in
// notification-utils.ts — this module owns the DB-touching side only.

// ─── Core API ──────────────────────────────────────────────────────────────────

/**
 * Persist one notification row. NEVER throws — notification delivery is
 * best-effort and must never break the content-creation flow that triggered
 * it. Returns the eventId on success, null on any failure.
 *
 * BROADCAST rows (targetUserId undefined) additionally fan out to:
 *   1. Web Push (VAPID) — system notifications that reach users even when
 *      the site tab is closed (service worker shows them).
 *   2. The Telegram channel bot — mirrors the announcement to t.me/engahmedetap.
 * Both are fire-and-forget: a slow/dead push service or Telegram outage can
 * never delay or fail the content publish that triggered this.
 */
export async function pushNotification(input: NotificationInput): Promise<string | null> {
  let eventId: string;
  try {
    const db = getDb();
    eventId = makeEventId();
    await db.insert(notifications).values({
      eventId,
      type: input.type,
      title: input.title.slice(0, TITLE_MAX),
      message: input.message.slice(0, MESSAGE_MAX),
      url: input.url ?? null,
      channelUrl: input.channelUrl ?? null,
      targetUserId: input.targetUserId ?? null,
      data: input.data ?? null,
    });
  } catch (err) {
    logger.warn("[Notify] pushNotification failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }

  if (!input.targetUserId) {
    // Broadcast → closed-tab delivery. Both senders swallow their own errors.
    void (async () => {
      try {
        const { sendWebPushToAll } = await import("./push-delivery.js");
        const { sendTelegramBroadcast } = await import("./telegram-broadcast.js");
        await Promise.allSettled([
          sendWebPushToAll({
            eventId,
            type: input.type,
            title: input.title,
            message: input.message,
            url: input.url,
            channelUrl: input.channelUrl,
          }),
          sendTelegramBroadcast({
            type: input.type,
            title: input.title,
            message: input.message,
            url: input.url,
            channelUrl: input.channelUrl,
          }),
        ]);
      } catch {
        // Dynamic import itself failed (e.g. missing dep) — push/telegram are
        // optional channels; the in-app notification is already stored above.
      }
    })();
  }

  return eventId;
}

/**
 * Recent BROADCAST notifications (targetUserId IS NULL) — what every
 * registered user can see. Gracefully returns [] when the DB is unavailable.
 */
export async function recentBroadcasts(limit = 50): Promise<
  Array<{
    eventId: string;
    type: string;
    title: string;
    message: string;
    url: string | null;
    channelUrl: string | null;
    data: unknown;
    createdAt: Date;
  }>
> {
  try {
    const db = getDb();
    return await db
      .select({
        eventId: notifications.eventId,
        type: notifications.type,
        title: notifications.title,
        message: notifications.message,
        url: notifications.url,
        channelUrl: notifications.channelUrl,
        data: notifications.data,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(isNull(notifications.targetUserId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  } catch (err) {
    logger.warn("[Notify] recentBroadcasts failed", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/** Broadcasts newer than a cursor eventId — re-exported for route consumers. */
export { isAfterCursor } from "./notification-utils.js";

/** Notifications visible to ONE specific user (broadcasts + their own). */
export async function userNotifications(
  userId: number,
  limit = 50,
): Promise<Awaited<ReturnType<typeof recentBroadcasts>>> {
  try {
    const db = getDb();
    return await db
      .select({
        eventId: notifications.eventId,
        type: notifications.type,
        title: notifications.title,
        message: notifications.message,
        url: notifications.url,
        channelUrl: notifications.channelUrl,
        data: notifications.data,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(and(eq(notifications.targetUserId, userId)))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  } catch {
    return [];
  }
}

/**
 * Delete broadcasts older than the retention window. Called (sparsely) by the
 * YouTube watcher so the table never grows unbounded. Never throws.
 */
export async function pruneOldNotifications(): Promise<void> {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await db.delete(notifications).where(and(lt(notifications.createdAt, cutoff), isNull(notifications.targetUserId)));
  } catch {
    // best-effort
  }
}
