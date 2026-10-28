/**
 * OFFLINE smoke test for the closed-tab notification stack — no DB, no server.
 * Exercises the real modules: env schema (VAPID/TELEGRAM keys), web-push init
 * with a real generated key pair, payload building, Telegram formatting, and
 * the subscription router round-trip (Hono in-process).
 *
 * Usage:
 *   npx tsx scripts/smoke-notification-stack.ts
 */
import webpush from "web-push";

// Env defaults BEFORE any api module import (env.ts validates at import time).
process.env.DATABASE_URL ||= "mysql://user:pass@127.0.0.1:3306/db";
process.env.APP_SECRET ||= "0123456789abcdef0123456789abcdef";
process.env.GOOGLE_CLIENT_ID ||= "dummy.apps.googleusercontent.com";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  const suffix = detail ? ` — ${detail}` : "";
  console.log(`${ok ? "✓" : "✗"} ${label}${suffix}`);
  if (!ok) failures++;
}

// ── 1. VAPID keys generate + are accepted by web-push ──
const { publicKey, privateKey } = webpush.generateVAPIDKeys();
try {
  webpush.setVapidDetails("mailto:contact@ahmedelbaz.qzz.io", publicKey, privateKey);
  check("VAPID: generated pair accepted by web-push", true, `${publicKey.slice(0, 16)}...`);
} catch (err) {
  check("VAPID: generated pair accepted by web-push", false, (err as Error).message);
}

// ── 2. Payload building ──
process.env.VAPID_PUBLIC_KEY = publicKey;
process.env.VAPID_PRIVATE_KEY = privateKey;
const { buildPushPayload } = await import("../api/lib/push-delivery.js");
const payload = buildPushPayload({
  eventId: "smoke-1",
  type: "youtube",
  title: "🎬 حلقة جديدة على قناة اليوتيوب",
  message: "«شرح جديد» نزلت الآن على قناة AhmedEtap — كورس ETAP كامل بالعربي.",
  url: "https://www.youtube.com/watch?v=abc&list=PLeeb5_Qjhcgc",
  channelUrl: "https://www.youtube.com/channel/UClZy6YZ-dSKdOH6ThPOEn_g",
});
const parsed = JSON.parse(payload) as { eventId: string; type: string; url: string };
check("Web Push payload: valid JSON with all fields", parsed.eventId === "smoke-1" && parsed.type === "youtube");
check("Web Push payload: within 4KB budget", payload.length < 4096, `${payload.length} bytes`);

// ── 3. Telegram message formatting (Arabic, buttons) ──
const { formatTelegramMessage } = await import("../api/lib/telegram-broadcast.js");
const tg = formatTelegramMessage({
  type: "youtube",
  title: "🎬 حلقة جديدة على قناة اليوتيوب",
  message: "«شرح جديد» نزلت الآن على قناة AhmedEtap.",
  url: "https://www.youtube.com/watch?v=abc",
  channelUrl: "https://www.youtube.com/channel/UClZy6YZ-dSKdOH6ThPOEn_g",
});
check(
  "Telegram: Arabic bell CTA + two button rows (episode/channel + site)",
  tg.text.includes("فعّل الجرس") && tg.inlineKeyboard.length === 2,
);
check(
  "Telegram: inline buttons carry the right URLs",
  tg.inlineKeyboard[0].some((b) => b.url === "https://www.youtube.com/watch?v=abc") &&
    tg.inlineKeyboard[1][0].url === "https://ahmedelbaz.qzz.io",
);

// ── 4. Subscription router: public-key round-trip ──
const { pushSubscriptionRoute } = await import("../api/push-subscription-route.js");
const res = await pushSubscriptionRoute.request("/public-key");
const body = (await res.json()) as { enabled: boolean; publicKey: string | null };
check("GET /api/notifications/push/public-key: 200 + serves the key", res.status === 200 && body.enabled);

const anonRes = await pushSubscriptionRoute.request("/subscribe", {
  method: "POST",
  body: JSON.stringify({
    endpoint: "https://fcm.googleapis.com/fcm/send/smoke",
    keys: { p256dh: "k".repeat(87), auth: "a".repeat(24) },
  }),
  headers: { "Content-Type": "application/json" },
});
check("POST /subscribe without session: rejected 401", anonRes.status === 401);

console.log(failures === 0 ? "\nAll smoke checks passed ✓" : `\n${failures} check(s) failed ✗`);
process.exit(failures === 0 ? 0 : 1);
