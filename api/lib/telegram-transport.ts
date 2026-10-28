/**
 * Telegram API transport resolver.
 *
 * ROOT-CURE (2026-10-29 outage): the HF Space's shared egress IP could no
 * longer reach api.telegram.org — every call died with "fetch failed" at the
 * connect level while every OTHER external host (MySQL, R2, Resend) answered
 * normally. A shared-datacenter IP block like this is not fixable in code —
 * it is fixed by changing the TRANSPORT: all Bot API traffic can be routed
 * through a Cloudflare Worker transport relay (Cloudflare → Telegram egress
 * is clean, and Space → Cloudflare is proven healthy by the R2 check).
 *
 * Relay contract (implemented in infra/security-audit/worker-v7-hardened.js):
 *   POST {TELEGRAM_API_BASE}/bot<token>/<method>
 *   X-Relay-Secret: <TELEGRAM_API_RELAY_SECRET — must equal the worker's
 *                    TG_RELAY_SECRET binding>
 * The worker forwards the path verbatim to https://api.telegram.org/<path>.
 * Requests without the secret get a stealth 404 — the relay is never an
 * open Telegram proxy.
 *
 * Unset env (default) → direct https://api.telegram.org — local dev and
 * self-hosted deployments are unchanged.
 */

/** Base URL for all Bot API calls (relay base when configured, direct otherwise). */
export function telegramApiBase(): string {
  const raw = (process.env.TELEGRAM_API_BASE ?? "").trim();
  if (!raw) return "https://api.telegram.org";
  return raw.replace(/\/+$/, "");
}

/** Extra headers the transport requires (relay shared secret when configured). */
export function telegramRelayHeaders(): Record<string, string> {
  const secret = (process.env.TELEGRAM_API_RELAY_SECRET ?? "").trim();
  return secret ? { "X-Relay-Secret": secret } : {};
}
