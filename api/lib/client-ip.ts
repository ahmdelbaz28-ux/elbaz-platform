/**
 * Client IP extraction — unified helper.
 *
 * Replaces ~12 duplicated implementations across the codebase that each
 * extracted the client IP from proxy headers with slightly different logic
 * (and at least one bug: shield.ts returned "127.0.1" as fallback).
 *
 * Trust order (most-trusted first):
 *   1. cf-connecting-ip  — set by Cloudflare, cannot be spoofed by clients
 *   2. x-real-ip         — set by nginx/typical reverse proxies
 *   3. x-forwarded-for   — RIGHTMOST entry only
 *
 * x-forwarded-for semantics: the header is a comma-separated list where each
 * proxy APPENDS the peer it received the request from. The rightmost entry is
 * the last hop ADDED BY OUR OWN TRUSTED INFRASTRUCTURE (Cloudflare/HF edge)
 * and is therefore the only entry a client cannot freely forge (✅ SECURITY
 * FIX audit run-1 — previously the code took the first entry, letting a
 * caller spoof an arbitrary "client IP" in the leftmost slot).
 */

/**
 * Extract client IP from a Headers object (Fetch API / tRPC context).
 *
 * Usage:
 *   const ip = getClientIpFromHeaders(ctx.req.headers);
 */
export function getClientIpFromHeaders(headers: Headers): string {
  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    // ✅ SECURITY FIX (audit run-1): use the RIGHTMOST XFF entry. Appending
    // proxies add the observed client to the END of the chain, so the leftmost
    // entry is the one the CLIENT chose (fully spoofable — rotating it reset
    // every rate-limit bucket). The last entry is the closest-trusted-proxy
    // view of the peer.
    const entries = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
    const last = entries[entries.length - 1];
    if (last) return last;
  }

  return "unknown";
}

/**
 * Extract client IP from a Hono context (c.req.header() accessor).
 *
 * Usage:
 *   const ip = getClientIpFromHono(c);
 */
export function getClientIpFromHono(c: { req: { header: (name: string) => string | undefined } }): string {
  const cfIp = c.req.header("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  const realIp = c.req.header("x-real-ip");
  if (realIp) return realIp.trim();

  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    // ✅ SECURITY FIX (audit run-1): rightmost XFF entry — see getClientIpFromHeaders.
    const entries = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
    const last = entries[entries.length - 1];
    if (last) return last;
  }

  return "unknown";
}
