import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { TRPCError } from "@trpc/server";
import type { User } from "@db/schema";
import { verifyToken, verifyExpiredToken, createToken, getTokenRemainingSeconds, type TokenPayload } from "./lib/jwt";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { eq } from "drizzle-orm";
import { AUTH_COOKIE_NAME, serializeAuthCookie, serializeAuthFlagCookie } from './lib/cookies';
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
// valid tokens. The access token TTL is 7d (env default), while the auth
// cookie persists 30 days. A user who returns after the TTL used to hit a hard
// 401 on their next page load → the client cleared the session → the chatbot
// FAB sent them to /login ("refresh → asks me to log in again"). Now a request
// carrying a signature-valid token that expired within this window is treated
// like the sliding refresh: DB user + tokenVersion are re-verified (revocation
// still enforced) and a fresh 30-day cookie pair is minted transparently.
// ✅ ROOT-CURE (2026-11-13, "logged out every time despite Remember this
// device"): the window was tightened to 24h in a pre-launch audit, which
// silently BROKE the 30-day "Remember this device" promise — a user idle for
// more than TTL + 24h (≈ 8 days) got a hard 401 on their next visit, the
// client destroyed the stored session, and the app demanded a fresh login
// EVERY time. The window is now AUTH_COOKIE_MAX_AGE (30 days) so the
// renewable lifetime matches the cookie lifetime the user was promised:
// a signature-valid token is accepted and transparently renewed for exactly
// as long as its cookie could still legitimately exist. Revocation semantics
// are UNCHANGED — the renewal path re-checks tokenVersion against the DB, so
// logout / password-reset / admin revoke still kill the session on the very
// next request regardless of this window.
const EXPIRED_TOKEN_GRACE_S = 30 * 24 * 60 * 60; // 30 days — matches AUTH_COOKIE_MAX_AGE

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
  const extracted = extractAuthToken(req);
  if (!extracted) return null;
  const { token } = extracted;

  const stale = await verifyExpiredToken(token);
  if (!stale) return null;

  const exp = (stale as unknown as Record<string, unknown>).exp;
  const expS = typeof exp === "number" && Number.isFinite(exp) ? exp : 0;
  const expiredAgoS = expS > 0 ? Math.floor(Date.now() / 1000) - expS : Number.POSITIVE_INFINITY;
  if (expiredAgoS > EXPIRED_TOKEN_GRACE_S) return null;

  // ✅ ROOT-CURE (2026-11-13): loadUserFromDbWithRetry propagates DB/infra
  // failures as a retryable INTERNAL_SERVER_ERROR instead of silently
  // returning null (which used to masquerade an infra outage as "guest" and
  // produced the false-401 that destroyed the client session).
  const safeUser = await loadUserFromDbWithRetry(stale, `${stale.userId}:${stale.tokenVersion}`);
  if (!safeUser) return null;

  const renewed = await createToken({
    userId: stale.userId,
    username: stale.username,
    role: stale.role,
    tokenVersion: stale.tokenVersion,
  });
  resHeaders.append("set-cookie", serializeAuthCookie(req.headers, renewed));
  resHeaders.append("set-cookie", serializeAuthFlagCookie(req.headers));
  // Native (Bearer) clients get the renewed token in a readable header so
  // their localStorage copy stops being permanently expired (see
  // isBearerAuth above). The channel is gated on the VERIFIED token's source
  // (audit run-1: native-client-detection-token-disclosure) — a cookie
  // request that carries a dummy header must never receive it.
  exposeRenewedToken(resHeaders, renewed, extracted.source);
  logger.info("[Auth] Expired token renewed via grace window", { userId: stale.userId });
  return safeUser;
}

export type AuthTokenSource = "cookie" | "header";

export function extractAuthToken(req: Request): { token: string; source: AuthTokenSource } | undefined {
  // 1. Try httpOnly cookie (preferred — XSS cannot steal httpOnly cookies)
  const cookieHeader = req.headers.get("cookie") || "";
  const parsedCookies = parse(cookieHeader);
  if (parsedCookies[AUTH_COOKIE_NAME]) {
    return { token: parsedCookies[AUTH_COOKIE_NAME], source: "cookie" };
  }
  // 2. Fallback to Authorization header (for backward compatibility during migration)
  const headerToken = req.headers.get("x-auth-token")
    || req.headers.get("authorization")?.replaceAll("Bearer ", "");
  if (headerToken) {
    return { token: headerToken, source: "header" };
  }
  return undefined;
}

/**
 * ✅ SESSION PERSISTENCE FIX (native sliding sessions): did the request carry
 * its token in the Authorization/x-auth-token header (Capacitor/Electron
 * native path) rather than the HttpOnly cookie? Native clients run with
 * `credentials: "omit"` — renewed tokens delivered as Set-Cookie NEVER reach
 * their localStorage, so the stored JWT stayed expired forever and every
 * restart rode the grace window until it ran out ("must log in again every
 * time I open the app"). For Bearer-authenticated callers we mirror the
 * renewed token in the `x-renewed-token` RESPONSE header; the client fetch
 * wrapper updates its localStorage. Cookie (web) requests never receive the
 * header — the HttpOnly cookie remains the only web JWT channel.
 * ✅ SECURITY FIX (audit run-1, native-client-detection-token-disclosure):
 * the gate is the VERIFIED token's source, not header presence. A cookie
 * authenticated request that appends a dummy authorization header must NOT
 * flip into the header channel — the header is only a fallback when no
 * cookie is present, so source === "header" already implies no cookie.
 */
function isBearerAuth(source: AuthTokenSource): boolean {
  return source === "header";
}

function exposeRenewedToken(resHeaders: Headers, token: string, source?: AuthTokenSource): void {
  if (!source || !isBearerAuth(source)) return;
  resHeaders.set("x-renewed-token", token);
}

async function maybeRefreshToken(
  payload: TokenPayload,
  reqHeaders: Headers,
  resHeaders: Headers,
  tokenSource: AuthTokenSource,
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
  // Native (Bearer) clients: keep their localStorage token sliding too.
  // Gated on the verified token's source (audit run-1 fix).
  exposeRenewedToken(resHeaders, newToken, tokenSource);
}

function evictOldestCacheEntries(): void {
  if (userCache.size < USER_CACHE_MAX_SIZE) return;
  // Evict oldest 20% of entries (approximate LRU)
  const keysToEvict = Array.from(userCache.keys()).slice(0, Math.floor(USER_CACHE_MAX_SIZE * 0.2));
  for (const k of keysToEvict) {
    userCache.delete(k);
  }
}

/**
 * ✅ SECURITY FIX (pre-launch audit run-2, auth-cache.revocation-window):
 * The user cache is keyed `userId:tokenVersion` and checked BEFORE the DB
 * tokenVersion comparison, so after a logout / password change / reset /
 * session revoke (all of which bump tokenVersion) a stolen JWT remained
 * servable from cache for up to USER_CACHE_TTL_MS (30s). Every revocation
 * site now calls this helper to drop ALL cache entries for the user, making
 * revocation effective on the very next request.
 */
export function evictUserAuthCache(userId: number): void {
  const prefix = `${userId}:`;
  for (const key of userCache.keys()) {
    if (key.startsWith(prefix)) userCache.delete(key);
  }
}

/**
 * ✅ ROOT-CURE (2026-11-13, "logged out every time despite Remember this
 * device"): a transient database failure inside the auth pipeline used to be
 * swallowed by createContext's blanket catch, leaving ctx.user undefined for
 * a request that carried a perfectly valid session — requireAuth then threw
 * UNAUTHORIZED, and the client's auth-failure handler DESTROYED the stored
 * session (flag cookie / native token). One brief MySQL hiccup — e.g. the HF
 * Space waking up, a free-tier DB connection reset, a cold-start race — was
 * therefore enough to permanently log the user out. This wrapper:
 *  1. retries the DB load once after a short delay (covers micro-outages and
 *     pool-reconnect windows without meaningfully slowing real failures),
 *  2. converts a persistent DB failure into a retryable 5xx
 *     (INTERNAL_SERVER_ERROR) instead of letting it become a guest-401.
 * The client keeps the session on 5xx and React-Query's retry picks the
 * request back up — the session is only ever destroyed by a REAL auth
 * rejection (invalid signature / revoked tokenVersion / expired beyond the
 * grace window).
 */
const DB_LOAD_RETRY_DELAY_MS = 300;

async function loadUserFromDbWithRetry(
  payload: TokenPayload,
  cacheKey: string,
): Promise<SafeUser | null> {
  try {
    return await loadUserFromDb(payload, cacheKey);
  } catch (err) {
    logger.warn("[Auth] DB load failed — retrying once before failing auth as 5xx", {
      userId: payload.userId,
      error: (err as Error)?.message,
    });
  }
  await new Promise((res) => setTimeout(res, DB_LOAD_RETRY_DELAY_MS));
  try {
    return await loadUserFromDb(payload, cacheKey);
  } catch (err) {
    logger.error("[Auth] DB load failed twice — failing the request as retryable 5xx (session preserved client-side)", {
      userId: payload.userId,
      error: (err as Error)?.message,
    });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Session verification is temporarily unavailable. Please try again in a moment.",
    });
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
    const extracted = extractAuthToken(req);
    if (!extracted) return null;
    let payload = await verifyToken(extracted.token);
    if (!payload) {
      // ✅ ROOT-CURE (2026-11-13): keep REST routes (chatbot, notifications…)
      // consistent with the tRPC pipeline — a signature-valid token that only
      // expired within the grace window still resolves to its user, so a
      // returning user is never degraded to anonymous on these endpoints.
      // No cookie renewal here: this helper has no response headers to write.
      const stale = await verifyExpiredToken(extracted.token);
      if (!stale) return null;
      const exp = (stale as unknown as Record<string, unknown>).exp;
      const expS = typeof exp === "number" && Number.isFinite(exp) ? exp : 0;
      const expiredAgoS = expS > 0 ? Math.floor(Date.now() / 1000) - expS : Number.POSITIVE_INFINITY;
      if (expiredAgoS > EXPIRED_TOKEN_GRACE_S) return null;
      payload = stale;
    }
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
    const extracted = extractAuthToken(opts.req);
    if (!extracted) return ctx;

    const payload = await verifyToken(extracted.token);
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
      await maybeRefreshToken(payload, opts.req.headers, ctx.resHeaders, extracted.source);
      return ctx;
    }

    // ✅ ROOT-CURE (2026-11-13): DB/infra failures now propagate as a retryable
    // 5xx (see loadUserFromDbWithRetry) instead of collapsing into "guest" —
    // a guest context made requireAuth throw UNAUTHORIZED and the client
    // destroyed a perfectly valid session on that false 401.
    const safeUser = await loadUserFromDbWithRetry(payload, cacheKey);
    if (!safeUser) return ctx;
    ctx.user = safeUser;

    // ✅ SLIDING SESSION: Auto-refresh token if < 2h remaining
    await maybeRefreshToken(payload, opts.req.headers, ctx.resHeaders, extracted.source);
  } catch (err) {
    // ✅ ROOT-CURE (2026-11-13): rethrow auth-pipeline infra failures so the
    // client sees a retryable 5xx, never a session-destroying 401. Only
    // genuinely non-auth problems (malformed cookie edge cases etc.) fall
    // back to the optional-guest behavior.
    if (err instanceof TRPCError) throw err;
    logger.warn("[Auth] createContext non-TRPC error — treating request as guest", {
      error: (err as Error)?.message,
    });
  }

  return ctx;
}
