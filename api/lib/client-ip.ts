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
 *   3. x-forwarded-for   — first entry only (leftmost = original client when
 *                          the first proxy is trusted, e.g. Cloudflare)
 *
 * x-forwarded-for semantics: the header is a comma-separated list where the
 * leftmost entry is the original client IP and each subsequent entry is a
 * proxy that forwarded the request. Taking the first entry is correct when
 * your trust boundary starts at the first proxy. We must NOT use .pop()
 * (that would return the last proxy, not the client).
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
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
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
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return "unknown";
}
