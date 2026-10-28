import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { resolveOptionalUser } from "./context";
import { getDb } from "./queries/connection";
import { pushSubscriptions } from "@db/schema";
import { getVapidPublicKey } from "./lib/push-delivery";
import { logger } from "./lib/logger";

// ─── Web Push subscription management ─────────────────────────────────────────
// Mounted at /api/notifications/push in boot.ts.
//
//   GET  /public-key   → { enabled, publicKey } — the browser needs the VAPID
//                        public key before pushManager.subscribe().
//   POST /subscribe    → upsert this browser's endpoint (auth required — push
//                        notifications are a registered-user feature).
//   POST /unsubscribe  → remove an endpoint (endpoint URL is itself a bearer
//                        capability, so an exact-match delete is safe).

const subscribeSchema = z.object({
  endpoint: z.string().url().startsWith("https://").max(500),
  keys: z.object({
    p256dh: z.string().min(40).max(300),
    auth: z.string().min(16).max(300),
  }),
  userAgent: z.string().max(300).optional(),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(500),
});

export const pushSubscriptionRoute = new Hono();

pushSubscriptionRoute.get("/public-key", (c) => {
  const publicKey = getVapidPublicKey();
  return c.json({ enabled: Boolean(publicKey), publicKey });
});

pushSubscriptionRoute.post("/subscribe", async (c) => {
  const user = await resolveOptionalUser(c.req.raw);
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid subscription payload" }, 400);
  }

  const { endpoint, keys, userAgent } = parsed.data;
  try {
    const db = getDb();
    await db
      .insert(pushSubscriptions)
      .values({
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userId: user.id,
        userAgent: (userAgent ?? c.req.header("User-Agent") ?? "").slice(0, 300) || null,
      })
      .onDuplicateKeyUpdate({
        set: {
          p256dh: keys.p256dh,
          auth: keys.auth,
          userId: user.id,
          lastSeenAt: new Date(),
        },
      });
    logger.info("[Push] subscription stored", { userId: user.id, endpointHost: new URL(endpoint).host });
    return c.json({ ok: true });
  } catch (err) {
    logger.warn("[Push] subscribe failed", { error: err instanceof Error ? err.message : String(err) });
    return c.json({ error: "Failed to store subscription" }, 500);
  }
});

pushSubscriptionRoute.post("/unsubscribe", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = unsubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid payload" }, 400);
  }

  try {
    const db = getDb();
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, parsed.data.endpoint));
    return c.json({ ok: true });
  } catch (err) {
    logger.warn("[Push] unsubscribe failed", { error: err instanceof Error ? err.message : String(err) });
    return c.json({ error: "Failed to remove subscription" }, 500);
  }
});
