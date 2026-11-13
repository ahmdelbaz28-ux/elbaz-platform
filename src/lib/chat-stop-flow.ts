/**
 * Pure decision table for the chat send→stop lifecycle (2026-11-14).
 *
 * ✅ OWNER REQUEST: the send button transforms into a STOP button the moment
 * a message is sent, and pressing it aborts the assistant's response.
 *
 * Why this module exists: the stop path has three root-cure subtleties that a
 * naive `abortController.abort()` does NOT handle, and they are all pure
 * decisions — extracted here so they are unit-testable without a browser:
 *
 * 1. RETRY RESURRECTION — the send loop silently retries failed attempts.
 *    A user stop aborts the main controller WITHOUT bumping the generation
 *    (only clearChat bumps it), so `isStale()` alone cannot see the stop:
 *    without a stop gate the loop would classify the abort as "unreachable"
 *    and keep retrying — the non-stream fallback would even launch a brand
 *    NEW request (a listener attached to an already-aborted signal never
 *    fires). Every gate below therefore takes `userStopped` explicitly.
 *
 * 2. PARTIAL TEXT PRESERVATION — ChatGPT-style freeze: whatever text the
 *    user already watched being typed is committed as the assistant's
 *    message (a normal, replayable bubble — the conversation keeps its
 *    context). Stopping before ANY text arrived leaves the question in
 *    place with no error noise.
 *
 * 3. NO FALSE "BUSY" — a user stop is a deliberate action, never a
 *    failure: the soft-busy note must not appear for it.
 */

/** Outcome of one streaming attempt inside ChatBot's send loop. */
export type StreamAttemptOutcome = "ok" | "failed" | "unreachable" | "stopped";

export interface AttemptGateInput {
  /** Attempts COMPLETED so far (0 = none started yet). */
  attempt: number;
  /** Maximum streaming attempts the loop may make. */
  maxAttempts: number;
  /** A reply was fully handled (committed) — nothing left to do. */
  handled: boolean;
  /** Generation bumped (clearChat) — the whole send is stale. */
  stale: boolean;
  /** Stop button pressed (main abort signal fired without a generation bump). */
  userStopped: boolean;
}

/**
 * Whether the send loop may start (or continue into) another streaming
 * attempt. The stop gate is what makes "stop" actually stop — without it
 * the silent-retry chain would resurrect the request the user just killed.
 */
export function shouldAttemptNext(input: AttemptGateInput): boolean {
  return input.attempt < input.maxAttempts
    && !input.handled
    && !input.stale
    && !input.userStopped;
}

export interface AfterAttemptsInput {
  handled: boolean;
  stale: boolean;
  userStopped: boolean;
  /** Everything received so far for the CURRENT reply ("" if none). */
  partialText: string;
}

export type AfterAttemptsAction =
  | { kind: "commit-partial"; text: string }
  | { kind: "soft-busy" }
  | { kind: "none" };

/**
 * What the send loop must do once no more attempts will be made:
 * - user stopped with received text → commit it (guarded upstream so an
 *   earlier in-attempt commit wins — the caller's commit helper dedupes);
 * - user stopped with nothing received → stay silent (deliberate stop,
 *   the user's question just stays there);
 * - every attempt failed on its own (no stop, no clear) → the calm
 *   soft-busy note, exactly as before this feature existed.
 */
export function resolveAfterAttempts(input: AfterAttemptsInput): AfterAttemptsAction {
  if (input.handled) return { kind: "none" };
  if (input.stale) return { kind: "none" };
  const text = input.partialText.trim();
  if (input.userStopped) {
    return text ? { kind: "commit-partial", text } : { kind: "none" };
  }
  return { kind: "soft-busy" };
}
