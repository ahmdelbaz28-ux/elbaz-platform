import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User } from "@db/schema";
import { verifyToken, verifyExpiredToken, createToken, getTokenRemainingSeconds, type TokenPayload } from "./lib/jwt";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { eq } from "drizzle-orm";
import { AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE, serializeAuthCookie, serializeAuthFlagCookie } from './lib/cookies';
import { parse } from "cookie";

import { logger } from "./lib/logger";

// ✅ SECURITY FIX: Define a SafeUser type that excludes passwordHash
// The full User object (including passwordHash) should NEVER be in the tRPC context
// because any route using authedQuery has access to ctx.user — accidentally
// returning it in a response would leak the bcrypt hash.
export type SafeUser = Omit<User, "passwordHash">;

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: SafeUser;
};

// ✅ PERFORMANCE FIX: In-memory cache for authenticated user lookups
// Without this, EVERY authenticated request hits the database to verify the user
// and check tokenVersion. With 100+ req/s, this adds unnecessary DB load.
// Cache TTL is short (30s) to balance performance with security (token revocation).
const userCache = new Map<string, { user: SafeUser; expiry: number }>();
const USER_CACHE_TTL_MS = 30_000; // 30 seconds
const USER_CACHE_MAX_SIZE = 10000; // Prevent memory leak on high-traffic sites

// Periodic cleanup of expired cache entries (every 2 minutes)
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, entry] of userCache) {
    if (entry.expiry < now) {
      userCache.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.info("Auth cache cleanup", { expiredEntriesCleaned: cleaned });
  }
}, 2 * 60 * 1000).unref();

// ✅ SECURITY: Sliding session — auto-refresh tokens approaching expiry.
// If the token has < 2 hours remaining, issue a fresh one transparently.
// This keeps active users logged in indefinitely while inactive users get logged out
// after 24h (the JWT TTL). No frontend changes required.
const SLIDING_REFRESH_THRESHOLD_S = 2 * 60 * 60; // 2 hours

// ✅ SESSION PERSISTENCE FIX: Grace window for EXPIRED-but-cryptographically
// valid tokens. The access token TTL is short (15m default), while the auth
// cookie persists 30 days. A user who returns after the TTL used to hit a hard
// 401 on their next page load → the client cleared the session → the chatbot
// FAB sent them to /login ("refresh → asks me to log in again"). Now a request
// carrying a signature-valid token that expired within this window is treated
// like the sliding refresh: DB user + tokenVersion are re-verified (revocation
// still enforced) and a fresh 30-day cookie pair is minted transparently.
// The window matches the cookie maxAge so "logged in" == "cookie alive".
const EXPIRED_TOKEN_GRACE_S = AUTH_COOKIE_MAX_AGE; // 30 days, matches the cookie

/**
 * ✅ SESSION PERSISTENCE FIX: renew a session carried by a token that failed
 * normal verification ONLY because its `exp` passed. The signature, issuer and
 * audience must still be valid and the expiry must fall within the grace
 * window; the user is then re-loaded from the DB (tokenVersion revocation
 * still applies) and a fresh 30-day cookie pair is minted transparently.
 * Without this, a user returning after the short access TTL was logged out on
 * the very next page load ("refresh → chatbot asks me to log in again").
 * Returns the renewed SafeUser, or null when anything does not qualify.
 * Kept as a standalone helper so createContext stays under the complexity bar.
 */
async function renewExpiredTokenSession(
  req: Request,
  resHeaders: Headers,
): Promise<SafeUser | null> {
  const token = extractAuthToken(req);
  if (!token) return null;

  const stale = await verifyExpiredToken(token);
  if (!stale) return null;

  const exp = (stale as unknown as Record<string, unknown>).exp;
  const expS = typeof exp === "number" && Number.isFinite(exp) ? exp : 0;
  const expiredAgoS = expS > 0 ? Math.floor(Date.now() / 1000) - expS : Number.POSITIVE_INFINITY;
  if (expiredAgoS > EXPIRED_TOKEN_GRACE_S) return null;

  const safeUser = await loadUserFromDb(stale, `${stale.userId}:${stale.tokenVersion}`);
  if (!safeUser) return null;

  const renewed = await createToken({
    userId: stale.userId,
    username: stale.username,
    role: stale.role,
    tokenVersion: stale.tokenVersion,
  });
  resHeaders.append("set-cookie", serializeAuthCookie(req.headers, renewed));
  resHeaders.append("set-cookie", serializeAuthFlagCookie(req.headers));
  logger.info("[Auth] Expired token renewed via grace window", { userId: stale.userId });
  return safeUser;
}

function extractAuthToken(req: Request): string | undefined {
  // 1. Try httpOnly cookie (preferred — XSS cannot steal httpOnly cookies)
  const cookieHeader = req.headers.get("cookie") || "";
  const parsedCookies = parse(cookieHeader);
  if (parsedCookies[AUTH_COOKIE_NAME]) {
    return parsedCookies[AUTH_COOKIE_NAME];
  }
  // 2. Fallback to Authorization header (for backward compatibility during migration)
  return req.headers.get("x-auth-token")
    || req.headers.get("authorization")?.replaceAll("Bearer ", "");
}

async function maybeRefreshToken(
  payload: TokenPayload,
  reqHeaders: Headers,
  resHeaders: Headers,
): Promise<void> {
  const remaining = getTokenRemainingSeconds(payload);
  if (remaining <= 0 || remaining >= SLIDING_REFRESH_THRESHOLD_S) return;
  const newToken = await createToken({
    userId: payload.userId,
    username: payload.username,
    role: payload.role,
    tokenVersion: payload.tokenVersion,
  });
  resHeaders.append("set-cookie", serializeAuthCookie(reqHeaders, newToken));
  resHeaders.append("set-cookie", serializeAuthFlagCookie(reqHeaders));
}

function evictOldestCacheEntries(): void {
  if (userCache.size < USER_CACHE_MAX_SIZE) return;
  // Evict oldest 20% of entries (approximate LRU)
  const keysToEvict = Array.from(userCache.keys()).slice(0, Math.floor(USER_CACHE_MAX_SIZE * 0.2));
  for (const k of keysToEvict) {
    userCache.delete(k);
  }
}

async function loadUserFromDb(
  payload: TokenPayload,
  cacheKey: string,
): Promise<SafeUser | null> {
  const db = getDb();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, payload.userId))
    .limit(1);
  if (!user) return null;

  // ✅ SECURITY FIX: Verify tokenVersion to support token revocation
  // ✅ SECURITY FIX (audit run-1): comparison is now unconditional — a minted
  // token without the claim (future caller bug) must fail closed, not skip
  // revocation entirely.
  if (payload.tokenVersion !== user.tokenVersion) {
    // Token has been revoked — do not authenticate
    return null;
  }

  // ✅ SECURITY FIX: Strip passwordHash before putting user in context
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash: _ph, ...safeUser } = user;

  evictOldestCacheEntries();
  userCache.set(cacheKey, {
    user: safeUser,
    expiry: Date.now() + USER_CACHE_TTL_MS,
  });
  return safeUser;
}

/**
 * Resolve the logged-in user for a plain Hono Request (optional auth).
 * Shares the exact same pipeline as createContext (cookie/header token →
 * verify → user cache → DB load with tokenVersion revocation check) so both
 * the tRPC layer and Hono routes agree on who is logged in.
 * Returns null for guests or any auth failure — callers treat chat as anonymous.
 */
export async function resolveOptionalUser(req: Request): Promise<SafeUser | null> {
  try {
    const token = extractAuthToken(req);
    if (!token) return null;
    const payload = await verifyToken(token);
    if (!payload) return null;
    const cacheKey = `${payload.userId}:${payload.tokenVersion}`;
    const cached = userCache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) return cached.user;
    return await loadUserFromDb(payload, cacheKey);
  } catch {
    // Authentication is optional — a guest simply gets null.
    return null;
  }
}

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };

  // Try local auth token
  try {
    const token = extractAuthToken(opts.req);
    if (!token) return ctx;

    const payload = await verifyToken(token);
    if (!payload) {
      // ✅ SESSION PERSISTENCE FIX: normal verification failed — renew the
      // session if the token merely expired within the grace window (see
      // renewExpiredTokenSession). Invalid/revoked tokens stay rejected.
      const renewedUser = await renewExpiredTokenSession(opts.req, ctx.resHeaders);
      if (renewedUser) ctx.user = renewedUser;
      return ctx;
    }

    // ✅ PERFORMANCE FIX: Check cache first to avoid DB query
    const cacheKey = `${payload.userId}:${payload.tokenVersion}`;
    const cached = userCache.get(cacheKey);
    // Use `&&` instead of `?.` here because we need TypeScript to narrow
    // `cached` to non-undefined inside the block (cached.expiry is then
    // safely accessible). The `?.` form would leave `cached` as
    // `T | undefined` and trip TS18048 on subsequent accesses.
    // sonar:off[typescript:S6582] — see comment above.
    if (cached && cached.expiry > Date.now()) {
      ctx.user = cached.user;
      // ✅ SLIDING SESSION: Check if token needs refresh even for cached users
      await maybeRefreshToken(payload, opts.req.headers, ctx.resHeaders);
      return ctx;
    }

    const safeUser = await loadUserFromDb(payload, cacheKey);
    if (!safeUser) return ctx;
    ctx.user = safeUser;

    // ✅ SLIDING SESSION: Auto-refresh token if < 2h remaining
    await maybeRefreshToken(payload, opts.req.headers, ctx.resHeaders);
  } catch {
    // Authentication is optional
  }

  return ctx;
}
