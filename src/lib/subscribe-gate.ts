/**
 * Subscribe-gate — device-level unlock state for "subscribe to the channel
 * before watching" support gate. ════════════════════════════════════════════
 *
 * Honest-contract design: YouTube gives third parties no way to VERIFY a
 * viewer's subscription without a full Google OAuth round-trip on the viewer's
 * account (heavy, privacy-invasive, quota-bound). So the gate is a light,
 * respectful prompt: one click opens YouTube with the channel's native
 * confirm-subscription dialog (?sub_confirmation=1), and the unlock is stored
 * per device for `days` — the viewer is never re-asked inside that window.
 *
 * Pure, dependency-free, and safe in private-browsing modes (localStorage may
 * throw — every accessor is guarded; a throwing store simply stays locked,
 * which is the honest default).
 */

const STORAGE_KEY = "elbaz-sub-gate-unlock";

interface StoredUnlock {
  until: number;
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

/** Grant (or extend) this device's unlock for `days`. Idempotent-safe. */
export function unlockSubscribe(days: number, now: number = Date.now()): void {
  const safeDays = Number.isFinite(days) && days >= 1 ? Math.floor(days) : 30;
  const current = subscribeUnlockUntil();
  // Keep whichever is LATER: the existing grant or now + days. A shorter
  // re-unlock must never shorten the window — nor silently pile days on top.
  const candidate = now + safeDays * 24 * 60 * 60 * 1000;
  const until = Math.max(current, candidate);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ until } satisfies StoredUnlock));
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
