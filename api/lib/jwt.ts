import { SignJWT, jwtVerify, compactVerify } from "jose";
import { env } from "./env";
import { logger } from "./logger.js";

// ✅ SECURITY FIX: Use centralized env.ts — required() throws in production if missing
// Exported so tests can mint tokens with the exact secret the module verifies against.
export function getSecret(): Uint8Array {
  const secret = env.APP_SECRET;

  if (!secret) {
    if (env.isProduction) {
      throw new Error(
        "FATAL: APP_SECRET environment variable is not set. " +
        "Generate a strong secret with: openssl rand -base64 64"
      );
    }
    logger.warn("[SECURITY WARNING] Using weak default APP_SECRET. Set a strong secret before production.");
  }

  const finalSecret = secret || "dev-only-secret-not-for-production-minimum-32-chars-long";
  if (finalSecret.length < 32) {
    throw new Error("APP_SECRET must be at least 32 characters long.");
  }

  return new TextEncoder().encode(finalSecret);
}

export interface TokenPayload {
  userId: number;
  username: string;
  role: string;
  tokenVersion: number;
  sub?: string;
  fpt?: string; // 🚀 Elite: Subtle Device Fingerprint
}

const ISSUER = "elbaz-platform";
const AUDIENCE = "elbaz-platform-users";

const ACCESS_TOKEN_TTL = env.JWT_ACCESS_EXPIRY ?? "15m";

export async function createToken(payload: TokenPayload, fingerprint?: string): Promise<string> {
  const jwt = new SignJWT({ ...payload, fpt: fingerprint } as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(`user:${payload.userId}`)
    .setExpirationTime(ACCESS_TOKEN_TTL);
  
  return jwt.sign(getSecret());
}

export async function verifyToken(token: string, expectedFingerprint?: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      clockTolerance: 30,
    });

    const tokenPayload = payload as unknown as TokenPayload;
    
    // 🛡️ Elite Security: Verify device fingerprint if provided
    if (tokenPayload.fpt && expectedFingerprint && tokenPayload.fpt !== expectedFingerprint) {
      logger.warn(`[Security][JWT] Fingerprint mismatch`, { userId: tokenPayload.userId });
      return null;
    }
    
    return tokenPayload;
  } catch {
    return null;
  }
}

/**
 * ✅ SESSION PERSISTENCE FIX: verify a token whose signature/issuer/audience
 * are valid but whose `exp` has passed. Used by the auth context to grant an
 * expired session a transparent renewal (grace window) instead of a hard 401 —
 * previously a user returning after the short access-token TTL (15m) got
 * logged out on their very next page load even though the auth cookie still
 * had a 30-day maxAge ("refresh → chatbot asks me to log in again").
 * Returns the payload (including `exp`) or null when the token is invalid
 * for any other reason (bad signature, wrong issuer/audience).
 */
export async function verifyExpiredToken(token: string): Promise<TokenPayload | null> {
  try {
    // jose v6 has no ignoreExpiration option — compactVerify validates ONLY
    // the JWS signature (no registered-claim checks), then we decode the
    // claims ourselves and enforce issuer/audience manually.
    const { payload } = await compactVerify(token, getSecret());
    const claims = JSON.parse(new TextDecoder().decode(payload)) as TokenPayload & {
      iss?: string;
      aud?: string;
      exp?: number;
    };
    if (claims.iss !== ISSUER || claims.aud !== AUDIENCE) return null;
    return claims as unknown as TokenPayload;
  } catch {
    return null;
  }
}

/**
 * ✅ SECURITY: Check how many seconds until the token expires.
 * Used by sliding session to auto-refresh tokens approaching expiry.
 * Returns remaining seconds, or 0 if already expired / no exp claim.
 */
export function getTokenRemainingSeconds(payload: TokenPayload): number {
  // jose decodes 'exp' as a number (Unix timestamp)
  const exp = (payload as unknown as Record<string, unknown>).exp as number | undefined;
  if (!exp || typeof exp !== 'number' || !Number.isFinite(exp)) return 0;
  return Math.max(0, Math.floor(exp - Date.now() / 1000));
}
