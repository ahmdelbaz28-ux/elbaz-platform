import webpush from "web-push";
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { pushSubscriptions } from "@db/schema";
import { env } from "./env.js";
import { logger } from "./logger.js";

// ─── Web Push delivery (VAPID) ─────────────────────────────────────────────────
// Sends browser push notifications to every stored subscription endpoint so a
// broadcast reaches the user EVEN WHEN THE SITE TAB IS CLOSED — the service
// worker (public/push-sw.js) wakes up and shows the system notification.
//
// Design rules (same philosophy as notification-broadcast.ts):
//   - Delivery is BEST-EFFORT and NEVER throws into the caller's flow.
//   - Unconfigured VAPID keys = feature off (public key endpoint reports it,
//     clients hide the toggle, senders skip silently). No third-party service,
//     keys are self-issued VAPID pairs.

/** Payload the service worker turns into a system notification. */
export interface PushPayload {
  eventId: string;
  type: string;
  title: string;
  message: string;
  url?: string;
  channelUrl?: string;
}

/** Push-service payload budget is ~4KB — stay far below with these caps. */
const PUSH_TITLE_MAX = 120;
const PUSH_MESSAGE_MAX = 300;
/** Concurrent pushes per batch — protects the event loop + DB pool. */
const SEND_BATCH_SIZE = 25;

let vapidReady = false;

/**
 * Configure web-push once. Returns true when VAPID keys are present and valid,
 * false when the feature is simply off (missing env) — logs a warning when
 * keys are present but the library rejects them.
 */
export function ensureWebPushConfigured(): boolean {
  if (vapidReady) return true;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
  try {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    vapidReady = true;
    logger.info("[Push] VAPID configured", { subject: env.VAPID_SUBJECT });
  } catch (err) {
    logger.warn("[Push] Invalid VAPID keys — web push disabled", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
  return vapidReady;
}

/** Public VAPID key for the browser subscribe call (null = push off). */
export function getVapidPublicKey(): string | null {
  if (!ensureWebPushConfigured()) return null;
  return env.VAPID_PUBLIC_KEY ?? null;
}

/** True when the push-service response means "this subscription is dead". */
export function isStalePushResponse(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410;
}

/** Build the JSON push payload with hard truncation to respect the 4KB budget. */
export function buildPushPayload(input: PushPayload): string {
  return JSON.stringify({
    eventId: input.eventId,
    type: input.type,
    title: input.title.slice(0, PUSH_TITLE_MAX),
    message: input.message.slice(0, PUSH_MESSAGE_MAX),
    url: input.url,
    channelUrl: input.channelUrl,
  });
}

/**
 * Send one push to one endpoint. Returns true when accepted by the push
 * service. Throws only on transport errors (caller decides stale cleanup).
 */
async function sendToOne(sub: { endpoint: string; p256dh: string; auth: string }, payload: string): Promise<void> {
  await webpush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    payload,
    { TTL: 7 * 24 * 60 * 60, urgency: "high" } // a week of offline catch-up
  );
}

/** Delete dead endpoints so the table self-cleans. Never throws. */
async function deleteStale(endpoint: string): Promise<void> {
  try {
    const db = getDb();
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  } catch {
    // stale row survives until the next pass — harmless
  }
}

/**
 * Fan out one broadcast payload to ALL stored push subscriptions.
 * Fire-and-forget safe: partial failures are logged, never propagated.
 */
export async function sendWebPushToAll(payload: PushPayload): Promise<{ sent: number; stale: number }> {
  if (!ensureWebPushConfigured()) return { sent: 0, stale: 0 };

  let subs: Array<{ endpoint: string; p256dh: string; auth: string }> = [];
  try {
    const db = getDb();
    subs = await db
      .select({ endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
      .from(pushSubscriptions);
  } catch (err) {
    logger.warn("[Push] Cannot load subscriptions", { error: err instanceof Error ? err.message : String(err) });
    return { sent: 0, stale: 0 };
  }

  if (subs.length === 0) return { sent: 0, stale: 0 };

  const body = buildPushPayload(payload);
  let sent = 0;
  let stale = 0;
  const staleEndpoints: string[] = [];

  for (let i = 0; i < subs.length; i += SEND_BATCH_SIZE) {
    const batch = subs.slice(i, i + SEND_BATCH_SIZE);
    // Bounded concurrency is intentional: a fully parallel fan-out over every
    // subscription would spike sockets/memory in one tick. NOSONAR
    const results = await Promise.allSettled(batch.map((sub) => sendToOne(sub, body))); // NOSONAR: deliberate sequential batches — backpressure by design, see comment above.
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled") {
        sent++;
        continue;
      }
      const statusCode = (r.reason as { statusCode?: number } | undefined)?.statusCode;
      if (isStalePushResponse(statusCode)) {
        stale++;
        staleEndpoints.push(batch[j].endpoint);
      }
    }
  }

  // Self-clean every dead endpoint AFTER the fan-out, all in parallel —
  // failures are harmless (row survives until the next pass).
  if (staleEndpoints.length > 0) {
    await Promise.allSettled(staleEndpoints.map(deleteStale));
  }

  logger.info("[Push] broadcast fanned out", { total: subs.length, sent, stale });
  return { sent, stale };
}
