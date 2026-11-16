/**
 * Subscribe-gate tickets — server-signed proof that THIS viewer completed the
 * mandatory "subscribe to the channel before watching" flow.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Owner contract (2026): watching ANY lesson video is blocked until the
 * viewer completes the subscribe flow. The client-side gate (SubscribeGate)
 * enforces the FLOW in the UI; this module makes the enforcement REAL at the
 * API boundary too:
 *
 *   • `course.completeSubscribeUnlock` (the confirm step) issues an
 *     HMAC-signed ticket bound to the account (u<userId>) or device
 *     (d<uuid>) with a clamped expiry.
 *   • `course.lessonVideo` and `course.previewVideo` REFUSE to hand out any
 *     playback data unless a valid, unexpired, correctly-bound ticket is
 *     presented. A forged localStorage marker alone unlocks nothing — the
 *     server simply answers SUBSCRIBE_REQUIRED.
 *
 * Signing key: APP_SECRET (always present, min 32 chars per env schema).
 * Rotating APP_SECRET invalidates outstanding tickets — the gate simply
 * re-arms, which is the correct fail-closed behaviour.
 *
 * Pure crypto — no DB/cache imports, fully unit-testable.
 */

import crypto from "node:crypto";
import { env } from "./env";

/** Tickets live at most 60 days — the admin "days" setting is clamped here. */
const TICKET_MAX_DAYS = 60;
/** Clock skew tolerance between issue and verify (same host, defensive). */
const SKEW_MS = 120_000;
/** One day in seconds. */
const DAY_SECONDS = 86_400;

interface TicketPayload {
  v: 1;
  /** Subject: `u<userId>` for account-bound, `d<uuid>` for device-bound. */
  sub: string;
  /** Issued-at, epoch seconds. */
  iat: number;
  /** Expiry, epoch seconds. */
  exp: number;
}

/** Clamp the admin-configured unlock window into the sane 1..60 range. */
export function clampGateDays(days: number): number {
  const n = Math.floor(Number(days));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, TICKET_MAX_DAYS);
}

/** A subject must be `u<digits>` (account) or `d<opaque-device-id>`. */
export function isValidTicketSubject(sub: string): boolean {
  return /^u\d{1,10}$/.test(sub) || /^d[0-9a-zA-Z-]{6,64}$/.test(sub);
}

function signingKey(): string {
  // APP_SECRET is validated at boot (min 32 chars) — always present.
  return env.APP_SECRET;
}

function sign(body: string): string {
  return crypto.createHmac("sha256", signingKey()).update(body).digest("base64url");
}

/**
 * Issue a signed unlock ticket for `subject` valid for `days` (clamped).
 * Format: `<base64url(payload)>.<base64url(hmac)>`.
 */
export function issueSubscribeTicket(
  subject: string,
  days: number,
  now: number = Date.now(),
): string {
  if (!isValidTicketSubject(subject)) {
    throw new Error(`Invalid subscribe-ticket subject: ${subject.slice(0, 8)}…`);
  }
  const safeDays = clampGateDays(days);
  const iat = Math.floor(now / 1000);
  const payload: TicketPayload = {
    v: 1,
    sub: subject,
    iat,
    exp: iat + safeDays * DAY_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

/**
 * Verify a presented ticket.
 *
 * Binding rule:
 *   • `u<id>` subject — accepted only when `opts.userId` matches (or when the
 *     caller passes no userId, e.g. the guest preview path).
 *   • `d<uuid>` subject — device-level unlock, accepted for any viewer of
 *     this device (covers the guest→login transition without re-asking).
 *
 * Rejects: tampered payloads/signatures, wrong version, invalid subjects,
 * expired tickets, far-future issued-at, and over-long lifetimes.
 */
export function verifySubscribeTicket(
  token: string | undefined | null,
  opts: { userId?: number } = {},
  now: number = Date.now(),
): boolean {
  try {
    if (typeof token !== "string" || token.length < 3) return false;
    const dot = token.indexOf(".");
    if (dot <= 0 || dot === token.length - 1) return false;
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);

    const expected = Buffer.from(sign(body));
    const presented = Buffer.from(sig);
    if (presented.length !== expected.length) return false;
    if (!crypto.timingSafeEqual(presented, expected)) return false;

    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<TicketPayload>;
    if (payload.v !== 1 || typeof payload.sub !== "string") return false;
    if (!isValidTicketSubject(payload.sub)) return false;
    if (typeof payload.iat !== "number" || typeof payload.exp !== "number") return false;

    const nowSec = Math.floor(now / 1000);
    if (payload.exp <= nowSec) return false; // expired
    if (payload.iat > nowSec + Math.floor(SKEW_MS / 1000)) return false; // far-future iat
    if (payload.exp - payload.iat > TICKET_MAX_DAYS * DAY_SECONDS + 5) return false; // over-long life

    if (payload.sub.startsWith("u")) {
      if (opts.userId === undefined) return true; // unbound check (guest path)
      return Number.parseInt(payload.sub.slice(1), 10) === opts.userId;
    }
    // Device-bound subject — device-level unlock.
    return true;
  } catch {
    return false;
  }
}
