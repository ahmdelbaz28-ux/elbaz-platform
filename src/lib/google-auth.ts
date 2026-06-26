/**
 * Google OAuth utilities — client-side OAuth flow helper
 */

// Generate CSRF state for OAuth request
function generateState(): string {
  return crypto.randomUUID?.() || Math.random().toString(36).slice(2);
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

  const redirectUri = `${window.location.origin}/api/google-auth/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });

  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
