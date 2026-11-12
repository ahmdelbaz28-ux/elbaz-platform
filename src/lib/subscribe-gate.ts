/**
 * Subscribe-gate — device-level unlock state for the HARD "subscribe to the
 * channel before watching" gate. ════════════════════════════════════════════
 *
 * Owner contract (2026): watching ANY lesson video is blocked until the
 * viewer completes the subscribe flow — the gate has NO skip button. The
 * only unlock path is: press «اشترك الآن» (opens YouTube's native
 * confirm-subscription dialog via ?sub_confirmation=1) → press «اشتركت».
 * The unlock is stored per device for `days` so an already-subscribed viewer
 * is never re-asked inside that window.
 *
 * Honesty note (unchanged): YouTube gives third parties no way to VERIFY a
 * viewer's subscription without a full Google OAuth round-trip on the
 * viewer's account (heavy, privacy-invasive, consent-scary). So the gate
 * enforces the FLOW (must click subscribe → must confirm) instead of
 * pretending to verify — the strongest enforcement that stays respectful.
 *
 * Pure, dependency-free, and safe in private-browsing modes (localStorage may
 * throw — every accessor is guarded; a throwing store simply stays locked,
 * which is the honest default).
 */

const STORAGE_KEY = "elbaz-sub-gate-unlock";
/** sessionStorage marker for "viewer pressed the subscribe button" (tab-scoped). */
const FLOW_KEY = "elbaz-sub-gate-flow";
/** How long a pressed-subscribe marker stays valid (survives back-navigation). */
export const SUBSCRIBE_FLOW_TTL_MS = 60 * 60 * 1000;

interface StoredUnlock {
  until: number;
  /** How this device was unlocked — always "subscribe-flow" for new unlocks. */
  via?: string;
}

/** Milliseconds until the stored unlock expires (0 = not unlocked). */
export function subscribeUnlockUntil(): number {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as Partial<StoredUnlock> | null;
    const until = typeof parsed?.until === "number" ? parsed.until : 0;
    return Number.isFinite(until) && until > 0 ? until : 0;
  } catch {
    return 0;
  }
}

/** true when this device's unlock exists AND has not expired. */
export function isSubscribeUnlocked(now: number = Date.now()): boolean {
  const until = subscribeUnlockUntil();
  return until > now;
}

/**
 * Grant (or extend) this device's unlock for `days`. Idempotent-safe.
 * `via` records the unlock path for honest analytics — new unlocks always
 * come from the enforced subscribe flow.
 */
export function unlockSubscribe(
  days: number,
  now: number = Date.now(),
  via: string = "subscribe-flow",
): void {
  const safeDays = Number.isFinite(days) && days >= 1 ? Math.floor(days) : 30;
  const current = subscribeUnlockUntil();
  // Keep whichever is LATER: the existing grant or now + days. A shorter
  // re-unlock must never shorten the window — nor silently pile days on top.
  const candidate = now + safeDays * 24 * 60 * 60 * 1000;
  const until = Math.max(current, candidate);
  try {
    globalThis.localStorage?.setItem(
      STORAGE_KEY,
      JSON.stringify({ until, via } satisfies StoredUnlock),
    );
  } catch {
    // Private mode — the device stays gated for the session only.
  }
}

/** Forget this device's unlock (admin/reset/test lever). */
export function clearSubscribeUnlock(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clear
  }
}

/**
 * True when this viewer has ALREADY pressed «اشترك الآن» on this device
 * (within the flow TTL) — e.g. opened the channel, went back, or reloaded.
 * The gate then shows the confirm step directly instead of re-asking for the
 * subscribe click. sessionStorage = tab-scoped, so a fresh visit re-runs the
 * flow; the grant itself (localStorage) is what keeps them unlocked.
 */
export function hasPressedSubscribe(now: number = Date.now()): boolean {
  try {
    const raw = globalThis.sessionStorage?.getItem(FLOW_KEY);
    if (!raw) return false;
    const at = Number.parseInt(raw, 10);
    return Number.isFinite(at) && at > 0 && now - at < SUBSCRIBE_FLOW_TTL_MS;
  } catch {
    return false;
  }
}

/** Record that the viewer pressed the subscribe button right now. */
export function markSubscribePressed(now: number = Date.now()): void {
  try {
    globalThis.sessionStorage?.setItem(FLOW_KEY, String(now));
  } catch {
    // Private mode — the confirm step just isn't pre-armed across reloads.
  }
}

/** Forget the pressed-subscribe marker (test/reset lever). */
export function clearSubscribeFlow(): void {
  try {
    globalThis.sessionStorage?.removeItem(FLOW_KEY);
  } catch {
    // nothing to clear
  }
}

/**
 * Build the channel URL that opens YouTube's native confirm-subscription
 * dialog: https://www.youtube.com/@handle?sub_confirmation=1
 * (Existing query params are preserved; `?` vs `&` handled.)
 */
export function buildSubscribeUrl(channelUrl: string): string {
  const trimmed = channelUrl.trim();
  if (!trimmed) return "https://www.youtube.com/@AhmedElbazEng?sub_confirmation=1";
  return trimmed.includes("?")
    ? `${trimmed}&sub_confirmation=1`
    : `${trimmed}?sub_confirmation=1`;
}
