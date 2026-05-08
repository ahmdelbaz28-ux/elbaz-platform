/**
 * Microsoft Clarity — GDPR-Compliant Enhanced Event Tracking
 *
 * Event naming convention (unified prefixes for Dashboard filtering):
 * - platform_*   — General platform events (auth, payments, support)
 * - learning_*   — Educational events (courses, lessons, quizzes, certificates)
 * - ui_*         — UI interaction events (clicks, searches, navigation)
 *
 * Session tagging (survive across calls — each action gets unique key):
 * - baz_plat_{action}  — Latest platform action (for Dashboard filtering)
 * - baz_learn_{action} — Latest learning action (for Dashboard filtering)
 *
 * Consent flow:
 * 1. index.html loads Clarity and calls clarity('revoke') immediately
 * 2. CookieConsent.tsx shows banner on ALL pages
 * 3. On "Accept all" → grantConsent() → clarity('consent')
 * 4. On "Essential only" → revokeConsent() → clarity('revoke')
 *
 * Usage:
 *   import { trackEvent, trackPlatform, trackLearning } from "@/lib/clarity";
 *   trackPlatform("login_success");
 *   trackLearning("lesson_start", { courseId: 1, lessonId: 5 });
 *   trackEvent("cta_click", { button: "Start Free", page: "homepage" });
 */

type EventMap = Record<string, string | number | boolean | undefined>;

/**
 * Get the global clarity function (loaded via index.html script tag).
 * Returns null in development mode or if Clarity is not loaded.
 */
function getClarity(): ((...args: any[]) => void) | null {
  // Skip analytics in development to avoid polluting production data
  if (import.meta.env.DEV) return null;
  try {
    const w = window as any;
    if (typeof w.clarity === "function") return w.clarity;
  } catch { /* silent */ }
  return null;
}

/**
 * Check if user has consented to analytics tracking.
 * Matches CookieConsent.tsx storage key.
 */
function hasConsent(): boolean {
  try {
    const raw = localStorage.getItem("elbaz_cookie_consent");
    if (!raw) return false;
    const prefs = JSON.parse(raw);
    return prefs.analytics === true;
  } catch {
    return false;
  }
}

/**
 * Fire a custom Clarity event using clarity('event', name, props).
 * These appear as Custom Events in the Clarity Dashboard for filtering.
 * Only fires if user has consented to analytics.
 *
 * @param name - Event name (e.g., "ui_cta_click", "ui_video_play", "ui_enrollment_click")
 * @param meta - Optional key-value metadata attached to the event
 */
export function trackEvent(name: string, meta?: EventMap): void {
  const c = getClarity();
  if (!c || !hasConsent()) return;
  try {
    c("event", name, meta);
  } catch { /* silent — analytics must never break the app */ }
}

/**
 * Track a general platform event with session tagging.
 * Use for: login, register, payment, support, account changes.
 *
 * Session tag: baz_plat_{action} — each action gets its own key so no values are lost.
 * Dashboard event: platform_{action} — appears in Custom Events for filtering.
 *
 * @param action - What happened (e.g., "login_success", "payment_initiated")
 * @param meta   - Optional key-value metadata for filtering
 */
export function trackPlatform(action: string, meta?: EventMap): void {
  const c = getClarity();
  if (!c || !hasConsent()) return;
  try {
    // Set unique session tag (won't overwrite other action tags)
    c("set", `baz_plat_${action}`, "1");
    if (meta) {
      for (const [key, value] of Object.entries(meta)) {
        if (value !== undefined) c("set", `baz_plat_${key}`, String(value));
      }
    }
    // Fire as custom event for Dashboard filtering
    c("event", `platform_${action}`, meta);
  } catch { /* silent — analytics must never break the app */ }
}

/**
 * Track a learning/educational event with session tagging.
 * Use for: course views, lesson starts, quiz attempts, certificate earned.
 *
 * Session tag: baz_learn_{action} — each action gets its own key so no values are lost.
 * Dashboard event: learning_{action} — appears in Custom Events for filtering.
 *
 * @param action - What happened (e.g., "course_view", "quiz_passed")
 * @param meta   - Optional key-value metadata for filtering
 */
export function trackLearning(action: string, meta?: EventMap): void {
  const c = getClarity();
  if (!c || !hasConsent()) return;
  try {
    // Set unique session tag (won't overwrite other action tags)
    c("set", `baz_learn_${action}`, "1");
    if (meta) {
      for (const [key, value] of Object.entries(meta)) {
        if (value !== undefined) c("set", `baz_learn_${key}`, String(value));
      }
    }
    // Fire as custom event for Dashboard filtering
    c("event", `learning_${action}`, meta);
  } catch { /* silent — analytics must never break the app */ }
}

/**
 * Grant Clarity consent after user accepts analytics cookies.
 * Call this from CookieConsent after user clicks "Accept all" or enables analytics.
 * Without consent, Clarity won't start tracking (revoke is called on page load).
 */
export function grantConsent(): void {
  const c = getClarity();
  if (!c) return;
  try {
    c("consent");
  } catch { /* silent */ }
}

/**
 * Revoke Clarity consent — stops all tracking immediately.
 * Call this from CookieConsent when user chooses "Essential only".
 */
export function revokeConsent(): void {
  const c = getClarity();
  if (!c) return;
  try {
    c("revoke");
  } catch { /* silent */ }
}

/**
 * Identify a user in Clarity (links session recordings to a user profile).
 * Call after successful login or registration.
 *
 * @param userId   - The user's database ID
 * @param username - The user's display name
 * @param meta     - Optional metadata (role, plan, etc.)
 */
export function identifyUser(userId: number, username: string, meta?: EventMap): void {
  const c = getClarity();
  if (!c || !hasConsent()) return;
  try {
    // Clarity's identify API: clarity('identify', userId)
    c("identify", String(userId));
    // Set persistent user attributes for filtering
    c("set", "baz_user_id", String(userId));
    c("set", "baz_username", username);
    if (meta) {
      for (const [key, value] of Object.entries(meta)) {
        if (value !== undefined) c("set", `baz_user_${key}`, String(value));
      }
    }
  } catch { /* silent — analytics must never break the app */ }
}

/**
 * Set a persistent user attribute for the current session.
 * Useful for tagging user type, language preference, etc.
 */
export function setUserAttribute(key: string, value: string): void {
  const c = getClarity();
  if (!c || !hasConsent()) return;
  try {
    c("set", key, value);
  } catch { /* silent */ }
}
