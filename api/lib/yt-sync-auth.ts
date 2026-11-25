/**
 * YT-SYNC INGEST AUTH — pure request authentication for the playlist ingest
 * endpoint (audit run-2 STEP 2). Extracted from yt-sync-ingest.ts so the
 * replay-protection contract is unit-testable without the route/DB graph.
 *
 * Contract (audit run-1, fp yt-sync-ingest.legacy-body-only-hmac
 * .unbounded-replay-lane): the relay MUST send `x-sync-ts` (epoch ms) and
 * sign `body + "." + ts` with the shared secret (HMAC-SHA256, hex, timing-safe
 * compare). Timestamps outside the window are refused; requests WITHOUT the
 * timestamp header are hard-rejected — the legacy body-only lane that let a
 * captured request replay forever (republishing stale videos + fake
 * broadcasts) is retired. Fail-closed on every branch.
 */

import crypto from "node:crypto";
import { logger } from "./logger.js";

/** Anti-replay window for signed `x-sync-ts` timestamps. */
export const TS_WINDOW_MS = 10 * 60_000;

/** Hex HMAC-SHA256 over an arbitrary signing payload. */
export function computeSignature(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export function signatureMatches(expected: string, received: string | undefined): boolean {
  if (!received) return false;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received.trim().toLowerCase(), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface AuthOutcome {
  ok: boolean;
  status?: 401;
  replayProtected: boolean;
}

/**
 * Verify the request with replay protection: the relay MUST send
 * `x-sync-ts` (epoch ms) and sign `body + "." + ts` with the shared secret.
 * Requests without the timestamp header are REJECTED (audit run-2 STEP 2 —
 * the legacy body-only fallback lane is retired; captured body-only
 * requests can no longer be replayed into the catalog).
 */
export function authenticateIngest(secret: string, raw: string, c: { req: { header: (name: string) => string | undefined } }): AuthOutcome {
  const received = c.req.header("x-sync-signature");
  const tsHeader = c.req.header("x-sync-ts");
  if (tsHeader === undefined) {
    // ✅ SECURITY FIX (audit run-2 STEP 2): no freshness commitment → no
    // admission. Log at warn so a mis-migrated sender is immediately visible
    // in ops without re-opening a replay lane.
    logger.warn("[YtSyncIngest] rejected — legacy body-only HMAC no longer accepted; sender must send x-sync-ts (audit run-2 STEP 2)");
    return { ok: false, status: 401, replayProtected: false };
  }
  const ts = Number(tsHeader);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TS_WINDOW_MS) {
    return { ok: false, status: 401, replayProtected: true };
  }
  if (!signatureMatches(computeSignature(secret, `${raw}.${tsHeader.trim()}`), received)) {
    return { ok: false, status: 401, replayProtected: true };
  }
  return { ok: true, replayProtected: true };
}
