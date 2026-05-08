import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";

// ✅ SECURITY FIX: Use centralized env.ts — required() throws in production if missing
function getSecret(): Uint8Array {
  const secret = env.appSecret;

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
  // ✅ SECURITY: Add issuer and audience for token validation
}

const ISSUER = "elbaz-platform";
const AUDIENCE = "elbaz-platform-users";

export async function createToken(payload: TokenPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)               // ✅ SECURITY: Bind token to this application
    .setAudience(AUDIENCE)           // ✅ SECURITY: Prevent token confusion attacks
    .setExpirationTime("7d")
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
