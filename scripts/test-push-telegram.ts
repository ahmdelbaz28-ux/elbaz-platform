/**
 * Smoke test for the closed-tab notification delivery stack (Web Push + Telegram).
 *
 * Checks, in order:
 *   1. VAPID env keys present + web-push accepts them.
 *   2. Telegram env present → optionally send a REAL test message to the channel.
 *   3. Endpoint sanity: /api/notifications/push/public-key answers.
 *
 * Usage:
 *   npx tsx scripts/test-push-telegram.ts            # checks only (no sends)
 *   npx tsx scripts/test-push-telegram.ts --send     # also sends the Telegram test message
 *   BASE_URL=https://ahmedelbaz.qzz.io npx tsx scripts/test-push-telegram.ts
 */
import webpush from "web-push";

const send = process.argv.includes("--send");
const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:7860";

/** Log-injection guard (S5145): CRLF/control chars stripped before printing. */
function safeLog(input: string): string {
  // eslint-disable-next-line no-control-regex -- the control chars are exactly what we strip
  return input.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 200);
}

// ── 1. VAPID ──────────────────────────────────────────────────────────────────
const pub = process.env.VAPID_PUBLIC_KEY;
const priv = process.env.VAPID_PRIVATE_KEY;
if (!pub || !priv) {
  console.log("① VAPID: ✗ not configured — generate with: node scripts/generate-vapid-keys.mjs");
} else {
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contact@ahmedelbaz.qzz.io", pub, priv);
    console.log("① VAPID: ✓ keys accepted by web-push");
  } catch (err) {
    console.log(`① VAPID: ✗ invalid keys — ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

// ── 2. Telegram ───────────────────────────────────────────────────────────────
const tgToken = process.env.TELEGRAM_BOT_TOKEN;
const tgChat = process.env.TELEGRAM_CHAT_ID;
if (!tgToken || !tgChat) {
  console.log("② Telegram: ✗ not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)");
} else {
  console.log(`② Telegram: ✓ configured for ${tgChat}`);
  if (send) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: tgChat,
          text: "🧪 <b>رسالة اختبار</b>\n\nمن نظام إشعارات منصة أحمد الباز — لو شايف الرسالة دي، البوت شغال تمام. ✓",
          parse_mode: "HTML",
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json()) as { ok: boolean; description?: string };
      const sendNote = body.ok
        ? "✓ delivered — check the channel"
        : `✗ ${safeLog(body.description ?? "unknown error")}`;
      console.log(`   ↳ send: ${sendNote}`);
      if (!body.ok) process.exitCode = 1;
    } catch (err) {
      console.log(`   ↳ send: ✗ ${safeLog(err instanceof Error ? err.message : String(err))}`);
      process.exitCode = 1;
    }
  }
}

// ── 3. Endpoint ───────────────────────────────────────────────────────────────
// Direct-origin runs (BASE_URL = the hf.space host) must present the worker's
// forwarded-host identity or the EDGE_HOST_ENFORCE shield answers a stealth
// 404 — send the same headers the CF worker adds in production.
const originHeaders: Record<string, string> = {};
if (new URL(BASE_URL).hostname.endsWith(".hf.space")) {
  originHeaders["X-Forwarded-Host"] = "ahmedelbaz.qzz.io";
  originHeaders["X-Forwarded-Proto"] = "https";
}
try {
  const res = await fetch(`${BASE_URL}/api/notifications/push/public-key`, {
    headers: originHeaders,
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as { enabled: boolean; publicKey: string | null };
  // No remote-derived data in the message — response booleans stay out of the log (S5145).
  console.log(
    `③ API ${safeLog(BASE_URL)}: ${res.ok && body.enabled ? "✓ push enabled, public key served" : "✗ push not enabled (set VAPID_* env and restart)"}`
  );
} catch (err) {
  console.log(`③ API ${safeLog(BASE_URL)}: ✗ unreachable — ${safeLog(err instanceof Error ? err.message : String(err))}`);
  process.exitCode = 1;
}
