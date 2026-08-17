/**
 * Google OAuth Router
 *
 * Handles Google Sign-In using TWO flows:
 *   1. OAuth Redirect flow (primary): GET /api/google-auth/redirect → /callback
 *   2. GIS ID Token flow (fallback):  POST /api/google-auth  (body: { idToken })
 *
 * 🔧 ROOT CAUSE FIX (v2):
 *   - Always use a HARDCODED production redirect URI (env.GOOGLE_OAUTH_REDIRECT_URI).
 *     This avoids redirect_uri mismatches when users access via different domains
 *     (ahmedelbaz.qzz.io vs ahmdelbaz28-ahmdrtap.hf.space).
 *   - State cookie uses SameSite=Lax so it survives the Google OAuth redirect.
 *   - Detailed error logging + user-friendly redirect with localized error codes.
 */

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { users } from "@db/schema";
import { getDb } from "./queries/connection";
import { createToken } from "./lib/jwt";
import { serializeAuthCookie, serializeAuthFlagCookie } from "./lib/cookies";
import { env } from "./lib/env";
import { checkRateLimit } from "./lib/rate-limiter";
import { logger } from "./lib/logger";
import { getClientIpFromHono as getClientIp } from "./lib/client-ip";

const googleAuthRouter = new Hono();

// ─── Helper: determine the canonical redirect URI for Google OAuth ───
// We ALWAYS use the production URL to avoid redirect_uri mismatches.
// This URL must be registered in Google Cloud Console under:
//   APIs & Services → Credentials → OAuth 2 Client → Authorized redirect URIs
function getOAuthRedirectUri(): string {
  // 1. Explicit env override (highest priority)
  if (env.GOOGLE_OAUTH_REDIRECT_URI) {
    return env.GOOGLE_OAUTH_REDIRECT_URI;
  }
  // 2. Default: production URL
  return `${env.FRONTEND_URL}/api/google-auth/callback`;
}

// ─── Helper: set both auth cookies on a Hono response ───
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  const headerB64 = parts[0].replaceAll("-", "+").replaceAll("_", "/");
  const headerJson = JSON.parse(Buffer.from(headerB64, "base64").toString("utf-8"));
  const kid = headerJson.kid as string | undefined;

  // Step 3: Find the matching signing key
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const key = (jwks as any).keys?.find((k: Record<string, unknown>) => k.kid === kid);
  if (!key) {
    throw new Error(`No matching Google key found for kid: ${kid}`);
  }

  // Step 4: Verify the token signature using Node.js crypto
  const crypto = await import("node:crypto");
  const n = key.n as string;
  const e = key.e as string;
  const publicKey = crypto.createPublicKey({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    key: { kty: "RSA", n, e, alg: "RS256" } as any,
    format: "jwk",
  });

  const verify = crypto.createVerify("RSA-SHA256");
  verify.update(Buffer.from(`${parts[0]}.${parts[1]}`, "utf-8"));
  const signature = Buffer.from(parts[2].replaceAll("-", "+").replaceAll("_", "/"), "base64");

  if (!verify.verify(publicKey, signature)) {
    throw new Error("Token signature verification failed");
  }

  // Step 5: Decode and validate the payload
  const payloadB64 = parts[1].replaceAll("-", "+").replaceAll("_", "/");
  const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf-8")) as Record<string, unknown>;

  if (payload.iss !== "accounts.google.com" && payload.iss !== "https://accounts.google.com") {
    throw new Error(`Invalid token issuer: ${payload.iss}`);
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function successResponse(c: any, userData: Record<string, unknown>) {
  return c.json({ success: true, user: userData });
}

googleAuthRouter.options("/", (c) => c.body(null, 204));

/**
 * GET /api/google-auth/redirect
 *
 * Redirects the user to Google's OAuth consent screen using the
 * Authorization Code flow (NOT GIS popup). This flow works on ANY
 * domain because it uses redirect URIs instead of JavaScript origins.
 *
 * After Google authenticates the user, it redirects to:
 *   /api/google-auth/callback?code=...&state=...
 */
googleAuthRouter.get("/redirect", (c) => {
  const clientId = env.GOOGLE_CLIENT_ID;
  // Note: `clientSecret` was previously read here but never used in this
  // handler — the /redirect route only builds the Google OAuth URL, the
  // secret is used in /callback. Removed (SonarCloud S1854).
  if (!clientId) {
    logger.error("Google OAuth: GOOGLE_CLIENT_ID not set");
    return c.redirect("/?google_error=not_configured");
  }

  // 🔧 FIX: Always use the canonical redirect URI (not derived from request headers).
  // This ensures Google sees the SAME redirect_uri on both /redirect and /callback,
  // avoiding "redirect_uri_mismatch" errors.
  const redirectUri = getOAuthRedirectUri();

  // State parameter for CSRF protection — must come from a CSPRNG, never
  // Math.random() (SonarCloud S2245). crypto.randomUUID() is available in
  // Node 19+ (we target Node 22, see Dockerfile).
  const state = randomUUID();

  // Store state in a short-lived cookie for verification.
  // SameSite=Lax is REQUIRED so the cookie is sent on the top-level GET redirect
  // back from Google. SameSite=Strict would block it.
  c.header("Set-Cookie", `google_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: state,
    prompt: "select_account",
  });

  logger.info("Google OAuth redirect initiated", { redirectUri });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

/**
 * Parse a cookie header string into a Map<string, string>.
 */
function parseCookieHeader(cookieHeader: string): Map<string, string> {
  const cookieMap = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = decodeURIComponent(trimmed.substring(0, eqIdx));
    const val = decodeURIComponent(trimmed.substring(eqIdx + 1));
    cookieMap.set(key, val);
  }
  return cookieMap;
}

/**
 * Verify the OAuth state parameter against the cookie-stored value (CSRF protection).
 * Returns an error redirect string if validation fails, or null on success.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function verifyOAuthState(c: any, state: string): string | null {
  const cookieHeader = c.req.header("cookie") || "";
  const cookieMap = parseCookieHeader(cookieHeader);
  const storedState = cookieMap.get("google_oauth_state");
  if (!storedState || storedState !== state) {
    logger.warn("Google OAuth callback: state mismatch", {
      hasStoredState: !!storedState,
      stateMatch: storedState === state,
    });
    return "/?google_error=state_mismatch";
  }
  return null;
}

/**
 * Exchange the OAuth authorization code for Google tokens.
 * Returns either the tokens object or an error redirect string.
 */
async function exchangeCodeForTokens(
  code: string,
  state: string,
  redirectUri: string,
): Promise<{ id_token?: string; access_token?: string } | { errorRedirect: string }> {
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (tokenResp.ok) {
    return await tokenResp.json() as { id_token?: string; access_token?: string };
  }

  const errBody = await tokenResp.text().catch(() => "");
  let googleError = "unknown";
  let googleErrorDesc = "";
  try {
    const errJson = JSON.parse(errBody);
    googleError = errJson.error || "unknown";
    googleErrorDesc = errJson.error_description || "";
  } catch {
    googleErrorDesc = errBody.substring(0, 200);
  }

  logger.error("Google OAuth: token exchange failed", {
    status: tokenResp.status,
    error: googleError,
    errorDescription: googleErrorDesc,
    redirectUri,
    codeLength: code.length,
    stateLength: state.length,
  });

  const errorParam = encodeURIComponent(`${googleError}:${googleErrorDesc}`);
  return { errorRedirect: `/?google_error=token_exchange_failed&google_detail=${errorParam}` };
}

/**
 * Extract a unique username based on the Google email/local-part.
 * Appends a counter or random suffix if the username is already taken.
 */
async function ensureUniqueUsername(
  db: ReturnType<typeof getDb>,
  baseUsername: string,
): Promise<string> {
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
    // Append a 6-char random suffix from a CSPRNG so generated usernames
    // are not predictable. Avoids Math.random() (SonarCloud S2245).
    username = `${baseUsername}_${randomUUID().split("-")[0]}`;
  }
  return username;
}

/**
 * GET /api/google-auth/callback
 *
 * Handles the redirect back from Google after the user consents.
 * Exchanges the authorization code for tokens, verifies the ID token,
 * creates/updates the user, sets auth cookies, and redirects to home.
 */
googleAuthRouter.get("/callback", async (c) => { // NOSONAR — complex function, refactoring would risk breaking critical behavior
  try {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    // If Google returned an error (user denied, etc.)
    if (error) {
      logger.warn("Google OAuth callback: Google returned error", { error });
      return c.redirect(`/?google_error=${encodeURIComponent(error)}`);
    }

    if (!code || !state) {
      logger.warn("Google OAuth callback: missing code or state", { hasCode: !!code, hasState: !!state });
      return c.redirect("/?google_error=missing_params");
    }

    // Verify state (CSRF protection)
    const stateError = verifyOAuthState(c, state);
    if (stateError) return c.redirect(stateError);

    // Clear the state cookie
    c.header("Set-Cookie", "google_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");

    // 🔧 FIX: Use the same canonical redirect URI that was used in /redirect
    const redirectUri = getOAuthRedirectUri();

    // Exchange authorization code for tokens
    const tokenResult = await exchangeCodeForTokens(code, state, redirectUri);
    if ("errorRedirect" in tokenResult) {
      return c.redirect(tokenResult.errorRedirect);
    }

    const tokens = tokenResult;
    if (!tokens.id_token) {
      logger.error("[GoogleAuth] No id_token in token response");
      return c.redirect("/?google_error=no_id_token");
    }

    // Verify the ID token (reuse existing verification logic)
    let googleUser: Record<string, unknown>;
    try {
      googleUser = await verifyGoogleToken(tokens.id_token);
    } catch (err) {
      logger.error("[GoogleAuth] Token verification failed", { error: (err as Error).message });
      return c.redirect("/?google_error=invalid_token");
    }

    const googleId = googleUser.sub as string;
    const googleEmail = (googleUser.email as string) || "";
    const googleName = (googleUser.name as string) || "";
    const googlePicture = (googleUser.picture as string) || "";

    if (!googleId || !googleEmail) {
      return c.redirect("/?google_error=invalid_user_info");
    }

    const db = getDb();

    // Check if user exists by Google ID
    const existingByGoogle = await db.select().from(users).where(eq(users.googleId, googleId)).limit(1);

    let userId: number;
    let username: string;
    let userRole: string;
    // Note: `userName`, `userEmail`, `userAvatar` were previously declared
    // and assigned in each branch below but never read after the if/else —
    // SonarCloud S1854 (dead stores). Removed; only `userId`, `username`,
    // `userRole` are actually consumed by createToken() below.

    if (existingByGoogle.length > 0) {
      const user = existingByGoogle[0];
      await db.update(users).set({ lastSignInAt: new Date(), ...(googlePicture && { avatar: googlePicture }) }).where(eq(users.id, user.id));
      userId = user.id;
      username = user.username;
      userRole = user.role;
    } else {
      // Check by email
      const existingByEmail = googleEmail ? await db.select().from(users).where(eq(users.email, googleEmail)).limit(1) : [];

      if (existingByEmail.length > 0) {
        const user = existingByEmail[0];
        await db.update(users).set({ googleId: googleId, lastSignInAt: new Date(), ...(googlePicture && !user.avatar && { avatar: googlePicture }) }).where(eq(users.id, user.id));
        userId = user.id;
        username = user.username;
        userRole = user.role;
      } else {
        // Create new user
        let baseUsername = googleEmail.split("@")[0].replaceAll(/\W/g, "_").toLowerCase();
        if (baseUsername.length < 3) baseUsername = `user_${googleId.slice(0, 6)}`;

        const newUsername = await ensureUniqueUsername(db, baseUsername);

        const insertResult = await db.insert(users).values({
          username: newUsername,
          passwordHash: null,
          googleId: googleId,
          name: googleName || newUsername,
          email: googleEmail,
          avatar: googlePicture || null,
        });

        const resultArr = Array.isArray(insertResult) ? insertResult : [insertResult];
        userId = Number(resultArr[0]?.insertId);
        username = newUsername;
        userRole = "user";
      }
    }

    // Create JWT + set cookies
    const token = await createToken({ userId, username, role: userRole, tokenVersion: 0 });
    setAuthCookies(c, token);

    logger.info(`[GoogleAuth/OAuth] User signed in: ${username} (id=${userId})`);

    // Redirect to home page — cookies are set, user is logged in
    return c.redirect("/");
  } catch (err) {
    logger.error("[GoogleAuth/OAuth] Callback error", { error: err instanceof Error ? err.message : String(err) });
    return c.redirect("/?google_error=callback_error");
  }
});

// ─── Helper: build a public user response object from a user record ───
function buildUserResponseData(user: { id: number; username: string; name: string | null; email: string | null; role: string; avatar: string | null }) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
  };
}

// ─── Helper: issue a JWT + set auth cookies for an existing user record ───
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function issueSessionForUser(c: any, user: { id: number; username: string; role: string; tokenVersion: number }, logLabel: string): Promise<string> {
  const token = await createToken({
    userId: user.id,
    username: user.username,
    role: user.role,
    tokenVersion: user.tokenVersion,
  });
  setAuthCookies(c, token);
  logger.info(logLabel, { userId: user.id, username: user.username });
  return token;
}

/**
 * POST /api/google-auth
 *
 * Body: { idToken: string }
 * Response: { success: true, user: { id, username, name, email, role } }
 */
googleAuthRouter.post("/", async (c) => {
  try {
    const ip = getClientIp(c);
    try {
      await checkRateLimit(ip, "login");
    } catch (err) {
      // Rate limit exceeded — surface a 429 without leaking internal details.
      // Logged for ops visibility; user-facing message stays generic. — SonarCloud S2486
      logger.warn("Rate limit exceeded on google-auth login attempt", { ip, error: String(err) });
      return c.json({ success: false, error: "Too many requests. Please try again later." }, 429);
    }

    const body = await c.req.json<{ idToken: string }>();

    if (!body.idToken || typeof body.idToken !== "string") {
      return c.json({ success: false, error: "ID token is required" }, 400);
    }

    // Verify the Google ID token
    let googleUser: Record<string, unknown>;
    try {
      googleUser = await verifyGoogleToken(body.idToken);
    } catch (err) {
      logger.error("Google auth token verification failed", { error: (err as Error).message, ip });
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
      await issueSessionForUser(c, user, "Google auth — existing user sign-in");
      return successResponse(c, buildUserResponseData(user));
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
        await issueSessionForUser(c, user, "Google auth — linked to existing account");
        return successResponse(c, buildUserResponseData(user));
      }
    }

    // ── Step 3: Create a new user from Google ──
    let baseUsername = googleEmail.split("@")[0].replaceAll(/\W/g, "_").toLowerCase();
    if (baseUsername.length < 3) baseUsername = `user_${googleId.slice(0, 6)}`;

    const username = await ensureUniqueUsername(db, baseUsername);

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
      logger.error("Google auth — insert succeeded but insertId invalid");
      return c.json({ success: false, error: "Account creation failed" }, 500);
    }

    const token = await createToken({
      userId,
      username: username,
      role: "user",
      tokenVersion: 0,
    });

    setAuthCookies(c, token);
    logger.info("Google auth — new user created", { userId, username, email: googleEmail });

    return successResponse(c, {
      id: userId,
      username: username,
      name: googleName || username,
      email: googleEmail,
      role: "user",
      avatar: googlePicture || null,
    });
  } catch (err) {
    logger.error("Google auth — unexpected error", { error: String(err) });
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
});

export { googleAuthRouter };
