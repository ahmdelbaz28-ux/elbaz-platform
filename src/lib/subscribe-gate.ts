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
/** Server-signed unlock ticket (localStorage) — the API-level proof. */
const TICKET_KEY = "elbaz-sub-gate-ticket";
/** Stable per-browser device subject `d<uuid>` (guest ticket binding). */
const DEVICE_KEY = "elbaz-sub-gate-device";
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

/** Forget this device's unlock AND its ticket (admin/reset/self-heal lever). */
export function clearSubscribeUnlock(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
    globalThis.localStorage?.removeItem(TICKET_KEY);
  } catch {
    // nothing to clear
  }
}

// ── Server-signed unlock ticket (the API-level proof) ────────────────────
// The UI marker above decides what the SCREEN shows; the ticket decides what
// the SERVER answers. lessonVideo/previewVideo verify the HMAC ticket — a
// forged marker yields an empty gate-less UI until the server answers
// SUBSCRIBE_REQUIRED and the caller re-locks (self-heal).

/** The stored server-signed ticket, or null (never throws). */
export function getStoredSubscribeTicket(): string | null {
  try {
    return globalThis.localStorage?.getItem(TICKET_KEY) || null;
  } catch {
    return null;
  }
}

/** Persist the ticket issued by course.completeSubscribeUnlock. */
export function storeSubscribeTicket(token: string): void {
  try {
    if (token) globalThis.localStorage?.setItem(TICKET_KEY, token);
  } catch {
    // Private mode — the server will re-lock on the next video fetch.
  }
}

/** Forget ONLY the ticket (self-heal path — marker cleared alongside). */
export function clearSubscribeTicket(): void {
  try {
    globalThis.localStorage?.removeItem(TICKET_KEY);
  } catch {
    // nothing to clear
  }
}

/**
 * Stable per-browser device subject `d<uuid>` — binds a GUEST's ticket to
 * this device (authenticated viewers get account-bound `u<id>` subjects
 * server-side regardless). Persisted so re-unlocks keep the same subject.
 */
export function getDeviceSubject(): string {
  try {
    const existing = globalThis.localStorage?.getItem(DEVICE_KEY);
    if (existing && /^d[0-9a-zA-Z-]{6,64}$/.test(existing)) return existing;
    const uuid =
      globalThis.crypto?.randomUUID?.() ??
      `fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    const subject = `d${uuid}`;
    globalThis.localStorage?.setItem(DEVICE_KEY, subject);
    return subject;
  } catch {
    // No storage — ephemeral subject (the ticket simply won't outlive reload).
    const uuid =
      globalThis.crypto?.randomUUID?.() ?? `ephemeral-${Date.now().toString(36)}`;
    return `d${uuid}`;
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
