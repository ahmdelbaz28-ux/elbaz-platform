/**
 * Google OAuth Router
 *
 * Handles Google Sign-In using the ID Token flow:
 *   POST /api/google-auth   — exchanges Google ID token for a session
 *
 * The frontend uses Google Identity Services (GIS) to obtain an ID token,
 * then sends it here. We verify it, find/create the user, and set an auth cookie.
 */

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { users } from "@db/schema";
import { getDb } from "./queries/connection";
import { createToken } from "./lib/jwt";
import { serializeAuthCookie, serializeAuthFlagCookie } from "./lib/cookies";
import { env } from "./lib/env";

const googleAuthRouter = new Hono();

// ─── Helper: set both auth cookies on a Hono response ───
function setAuthCookies(c: any, token: string): void {
  const headers = c.req.raw.headers as Headers;
  const authCookie = serializeAuthCookie(headers, token);
  const flagCookie = serializeAuthFlagCookie(headers);
  // ✅ FIX: Use appendHeader to set multiple Set-Cookie headers
  // c.header() overwrites, but we need both cookies
  c.header("Set-Cookie", authCookie, { append: true });
  c.header("Set-Cookie", flagCookie, { append: true });
}

/**
 * Verify a Google ID token by fetching Google's public certs (JWKS).
 * Returns the decoded payload or throws.
 */
async function verifyGoogleToken(idToken: string): Promise<Record<string, unknown>> {
  // Step 1: Get Google's public keys
  const jwksResponse = await fetch("https://www.googleapis.com/oauth2/v3/certs", {
    signal: AbortSignal.timeout(5000),
  });
  if (!jwksResponse.ok) {
    throw new Error("Failed to fetch Google JWKS");
  }
  const jwks = await jwksResponse.json();

  // Step 2: Decode JWT header to get the key ID
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid token format");
  }
  const headerB64 = parts[0].replace(/-/g, "+").replace(/_/g, "/");
  const headerJson = JSON.parse(Buffer.from(headerB64, "base64").toString("utf-8"));
  const kid = headerJson.kid as string | undefined;

  // Step 3: Find the matching signing key
  const key = (jwks as any).keys?.find((k: Record<string, unknown>) => k.kid === kid);
  if (!key) {
    throw new Error("No matching Google key found for kid: " + kid);
  }

  // Step 4: Verify the token signature using Node.js crypto
  const crypto = await import("node:crypto");
  const n = key.n as string;
  const e = key.e as string;
  const publicKey = crypto.createPublicKey({
    key: { kty: "RSA", n, e, alg: "RS256" } as any,
    format: "jwk",
  });

  const verify = crypto.createVerify("RSA-SHA256");
  verify.update(Buffer.from(parts[0] + "." + parts[1], "utf-8"));
  const signature = Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/"), "base64");

  if (!verify.verify(publicKey, signature)) {
    throw new Error("Token signature verification failed");
  }

  // Step 5: Decode and validate the payload
  const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf-8")) as Record<string, unknown>;

  if (payload.iss !== "accounts.google.com" && payload.iss !== "https://accounts.google.com") {
    throw new Error("Invalid token issuer: " + payload.iss);
  }
  if (payload.aud !== env.GOOGLE_CLIENT_ID) {
    throw new Error("Token audience mismatch");
  }
  if (payload.exp && Date.now() / 1000 > (payload.exp as number)) {
    throw new Error("Token expired");
  }

  return payload;
}

/**
 * Build a success response with auth cookies
 */
function successResponse(c: any, userData: Record<string, unknown>) {
  return c.json({ success: true, user: userData });
}

googleAuthRouter.options("/", (c) => c.body(null, 204));

/**
 * POST /api/google-auth
 *
 * Body: { idToken: string }
 * Response: { success: true, user: { id, username, name, email, role } }
 */
googleAuthRouter.post("/", async (c) => {
  try {
    const body = await c.req.json<{ idToken: string }>();

    if (!body.idToken || typeof body.idToken !== "string") {
      return c.json({ success: false, error: "ID token is required" }, 400);
    }

    // Verify the Google ID token
    let googleUser: Record<string, unknown>;
    try {
      googleUser = await verifyGoogleToken(body.idToken);
    } catch (err) {
      console.error("[GoogleAuth] Token verification failed:", (err as Error).message);
      return c.json({ success: false, error: "Invalid Google ID token" }, 401);
    }

    const googleId = googleUser.sub as string;
    const googleEmail = (googleUser.email as string) || "";
    const googleName = (googleUser.name as string) || "";
    const googlePicture = (googleUser.picture as string) || "";

    if (!googleId || !googleEmail) {
      return c.json({ success: false, error: "Invalid Google token: missing user info" }, 400);
    }

    const db = getDb();

    // ── Step 1: Check if a user with this Google ID already exists ──
    const existingByGoogle = await db
      .select()
      .from(users)
      .where(eq(users.googleId, googleId))
      .limit(1);

    if (existingByGoogle.length > 0) {
      const user = existingByGoogle[0];

      await db
        .update(users)
        .set({
          lastSignInAt: new Date(),
          ...(googlePicture && { avatar: googlePicture }),
        })
        .where(eq(users.id, user.id));

      const token = await createToken({
        userId: user.id,
        username: user.username,
        role: user.role,
        tokenVersion: user.tokenVersion,
      });

      setAuthCookies(c, token);
      console.log(`[GoogleAuth] Existing user signed in: ${user.username} (id=${user.id})`);

      return successResponse(c, {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
      });
    }

    // ── Step 2: Check if a user with this email exists (link accounts) ──
    if (googleEmail) {
      const existingByEmail = await db
        .select()
        .from(users)
        .where(eq(users.email, googleEmail))
        .limit(1);

      if (existingByEmail.length > 0) {
        const user = existingByEmail[0];

        await db
          .update(users)
          .set({
            googleId: googleId,
            lastSignInAt: new Date(),
            ...(googlePicture && !user.avatar && { avatar: googlePicture }),
          })
          .where(eq(users.id, user.id));

        const token = await createToken({
          userId: user.id,
          username: user.username,
          role: user.role,
          tokenVersion: user.tokenVersion,
        });

        setAuthCookies(c, token);
        console.log(`[GoogleAuth] Linked Google to existing account: ${user.username} (id=${user.id})`);

        return successResponse(c, {
          id: user.id,
          username: user.username,
          name: user.name,
          email: user.email,
          role: user.role,
          avatar: user.avatar,
        });
      }
    }

    // ── Step 3: Create a new user from Google ──
    let baseUsername = googleEmail.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
    if (baseUsername.length < 3) baseUsername = "user_" + googleId.slice(0, 6);

    // Ensure username uniqueness
    let username = baseUsername;
    let counter = 1;
    while (counter <= 100) {
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, username))
        .limit(1);
      if (existing.length === 0) break;
      username = baseUsername + counter;
      counter++;
    }
    if (counter > 100) {
      username = baseUsername + "_" + Math.random().toString(36).slice(2, 8);
    }

    const insertResult = await db.insert(users).values({
      username: username,
      passwordHash: null,
      googleId: googleId,
      name: googleName || username,
      email: googleEmail,
      avatar: googlePicture || null,
    });

    const resultArr = Array.isArray(insertResult) ? insertResult : [insertResult];
    const userId = Number(resultArr[0]?.insertId);

    if (!userId || userId === 0 || !Number.isFinite(userId)) {
      console.error("[GoogleAuth] Insert succeeded but insertId is invalid");
      return c.json({ success: false, error: "Account creation failed" }, 500);
    }

    const token = await createToken({
      userId,
      username: username,
      role: "user",
      tokenVersion: 0,
    });

    setAuthCookies(c, token);
    console.log(`[GoogleAuth] New user created via Google: ${username} (id=${userId}, email=${googleEmail})`);

    return successResponse(c, {
      id: userId,
      username: username,
      name: googleName || username,
      email: googleEmail,
      role: "user",
      avatar: googlePicture || null,
    });
  } catch (err) {
    console.error("[GoogleAuth] Error in /api/google-auth:", err);
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
});

export { googleAuthRouter };
