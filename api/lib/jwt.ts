import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";

// ✅ SECURITY FIX: Use centralized env.ts — required() throws in production if missing
function getSecret(): Uint8Array {
  const secret = env.APP_SECRET;

  if (!secret) {
    if (env.isProduction) {
      throw new Error(
        "FATAL: APP_SECRET environment variable is not set. " +
        "Generate a strong secret with: openssl rand -base64 64"
      );
    }
    console.warn("[SECURITY WARNING] Using weak default APP_SECRET. Set a strong secret before production.");
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
  // ✅ SECURITY: Add issuer, audience, and subject for token validation
  sub?: string;
}

const ISSUER = "elbaz-platform";
const AUDIENCE = "elbaz-platform-users";

// ✅ SECURITY FIX: Extended to 30 days (Remember Me) to improve UX and keep users logged in.
// Active users get auto-refreshed via sliding session in context.ts
const ACCESS_TOKEN_TTL = "30d";

export async function createToken(payload: TokenPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)               // ✅ SECURITY: Bind token to this application
    .setAudience(AUDIENCE)           // ✅ SECURITY: Prevent token confusion attacks
    .setSubject(`user:${payload.userId}`) // ✅ SECURITY: Add subject claim
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(getSecret());
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: ISSUER,                // ✅ SECURITY: Reject tokens from other issuers
      audience: AUDIENCE,            // ✅ SECURITY: Reject tokens for other audiences
      clockTolerance: 30,            // 30 seconds clock skew tolerance
    });
    return payload as unknown as TokenPayload;
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
  if (!exp || typeof exp !== 'number' || !isFinite(exp)) return 0;
  return Math.max(0, Math.floor(exp - Date.now() / 1000));
}
