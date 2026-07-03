/**
 * Google OAuth utilities — client-side OAuth flow helper
 */

// Generate CSRF state for OAuth request.
// We use crypto.randomUUID() (available in all modern browsers and Node ≥ 19)
// and never fall back to Math.random() — the state protects against CSRF so a
// CSPRNG is mandatory (SonarCloud S2245).
function generateState(): string {
  // crypto.randomUUID is guaranteed to be available in the runtime targets we
  // support (see tsconfig + Dockerfile). The optional-chain in the original
  // code was a leftover from a Node 16 era; remove it so the fallback to
  // Math.random() can never silently engage.
  return crypto.randomUUID();
}

// Store state in cookie (for server callback verification) and sessionStorage (backup)
function storeOAuthState(state: string): void {
  document.cookie = `google_oauth_state=${state}; Path=/; Secure; SameSite=Lax; Max-Age=600`;
  sessionStorage.setItem("google_oauth_state", state);
}

// Build Google OAuth URL and navigate directly (bypasses Cloudflare Bot Management)
export function initiateGoogleOAuth(clientId: string): void {
  const state = generateState();
  storeOAuthState(state);

  const redirectUri = `${globalThis.location.origin}/api/google-auth/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });

  globalThis.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
