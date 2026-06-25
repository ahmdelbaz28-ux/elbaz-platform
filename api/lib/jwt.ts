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
      console.warn(`[Security][JWT] Fingerprint mismatch for user ${tokenPayload.userId}. Hijack attempt?`);
      return null;
    }
    
    return tokenPayload;
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
