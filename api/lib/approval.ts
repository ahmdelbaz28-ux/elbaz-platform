/**
 * ADMIN APPROVAL GATE — the owner's registration contract (2026-11-24).
 *
 * "أنا كأدمن لازم أقبل أو أرفض أي حد يسجل في المنصة قبل ما يدخل" — every
 * self-service registration lands as `pending` and can NEVER obtain a
 * session through ANY path (local login, Google OAuth callback, Google GIS
 * id-token) until an admin approves it. Rejection blocks login AND revokes
 * any live session (tokenVersion bump + auth-cache eviction).
 *
 * This module is the single choke point for:
 *   1. The login/issuance gate (assertSessionIssuable)
 *   2. The decision state machine (decideApproval)
 *   3. The HMAC-signed, single-purpose email action token
 *      (sign/verifyApprovalActionToken) — lets the owner approve/reject
 *      straight from the notification email without opening the platform
 *   4. The admin fan-out: in-app notification stream (polled by the admin's
 *      open clients — toast + chime + device notification) + the alert email
 *      to the owner's inbox
 *
 * SECURITY:
 *   - Gate is enforced SERVER-SIDE at every session-issuance point; the
 *     frontend messages are presentation only.
 *   - Admin accounts bypass the gate (the authority must never lock itself
 *     out) and are never written as 'pending' by the seed path.
 *   - Email action tokens: HMAC-SHA256 over a canonical payload with the
 *     APP_SECRET, 7-day expiry, timing-safe compare, single-purpose (the
 *     action and the user are signed in), and the decision state machine
 *     makes a replay of a consumed link an inert "already decided" page —
 *     never an error oracle.
 *   - All notifications/email are best-effort: a failed alert must never
 *     fail the registration itself.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { users } from "@db/schema";
import { and, eq, ne } from "drizzle-orm";
import { evictUserAuthCache } from "../context.js";
import { pushNotificationEvent } from "../notification-poll-router.js";
import { getDb } from "../queries/connection.js";
import { sendEmailWithDiagnostics } from "./email.js";
import { buildAdminApprovalRequestEmail } from "./email-templates.js";
import { env } from "./env.js";
import { logger, maskEmail } from "./logger.js";
import { grantReferralRewardForInvitee } from "./referral.js";

// ─────────────────────────────────────────────────────────────────────────────
// Statuses + the gate
// ─────────────────────────────────────────────────────────────────────────────

export type ApprovalStatus = "pending" | "approved" | "rejected";

export const APPROVAL_STATUSES: readonly ApprovalStatus[] = ["pending", "approved", "rejected"];

export function isApprovalStatus(v: string): v is ApprovalStatus {
  return (APPROVAL_STATUSES as readonly string[]).includes(v);
}

export interface GateUser {
  id: number;
  username: string;
  role: string;
  approvalStatus?: string | null;
}

export type ApprovalGateVerdict =
  | { allowed: true }
  | { allowed: false; gate: "pending" | "rejected" };

/**
 * The ONE gate every session-issuance path must pass. Admins bypass it: the
 * authority that approves accounts can never be locked out of its own
 * dashboard (also covers the seeded admin whose row predates the column).
 *
 * ✅ SECURITY FIX (owner directive 2026-11-25, "لا يدخل أحد للمنصة بدون تأكيد
 * الإيميل من الأدمن"): the verdict is now FAIL-CLOSED for EVERYTHING that is
 * not literally 'approved'. The previous verdict allowed NULL/legacy rows
 * through ("grandfathered pre-gate accounts"), which is exactly how a
 * pre-gate registration kept entering the platform — and kept its old live
 * session — with no admin confirmation, ever. The db-init v18 backfill flips
 * those rows to 'pending' (one time), so the owner sees them in the approval
 * queue; from that point on, approval is granted exactly once and the account
 * is never asked again (decideApproval 'approve' — no re-confirmation loop).
 */
export function approvalGateVerdict(user: GateUser): ApprovalGateVerdict {
  if (user.role === "admin") return { allowed: true };
  if (user.approvalStatus === "rejected") return { allowed: false, gate: "rejected" };
  if (user.approvalStatus === "approved") return { allowed: true };
  // pending, NULL, missing, or any unknown value → pending gate (fail-closed).
  return { allowed: false, gate: "pending" };
}

/** Convenience wrapper — true when the user may receive a session NOW. */
export function sessionAllowed(user: GateUser): boolean {
  return approvalGateVerdict(user).allowed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Decision state machine
// ─────────────────────────────────────────────────────────────────────────────

export type ApprovalAction = "approve" | "reject";

export type DecisionResult =
  | { ok: true; status: ApprovalStatus; decidedAt: Date }
  | { ok: false; reason: "not_found" | "not_pending" | "db_error" };

/**
 * Apply an approval decision.
 *
 *  - approve: pending → approved. The account can log in on the next attempt.
 *  - reject:  pending|approved → rejected AND tokenVersion++ AND auth-cache
 *             eviction — the owner's authority to pull access at ANY time,
 *             including accounts that are logged in right now. Their very
 *             next request fails the tokenVersion check and every future
 *             login hits the gate.
 *
 * Idempotency-by-state: approving an already-approved user or rejecting an
 * already-rejected user returns not_pending (the caller renders an inert
 * "already decided" page — no error oracle for replayed email links).
 */
export async function decideApproval(params: {
  userId: number;
  action: ApprovalAction;
  adminUserId: number | null;
  /** "dashboard" | "email" — provenance for the audit trail. */
  source: "dashboard" | "email";
}): Promise<DecisionResult> {
  const db = getDb();
  try {
    const [row] = await db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        approvalStatus: users.approvalStatus,
        tokenVersion: users.tokenVersion,
      })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);
    if (!row) return { ok: false, reason: "not_found" };

    if (params.action === "approve") {
      if (row.approvalStatus !== "pending") return { ok: false, reason: "not_pending" };
    } else {
      // Reject pulls access from pending AND approved accounts — but not from
      // other admins (an admin cannot lock another admin out of the platform).
      if (row.role === "admin") return { ok: false, reason: "not_pending" };
      if (row.approvalStatus === "rejected") return { ok: false, reason: "not_pending" };
    }

    const now = new Date();
    // Reject bumps the revocation counter in the SAME statement as the status
    // flip — one atomic row write, no window where status=rejected but old
    // sessions still verify.
    await db
      .update(users)
      .set({
        approvalStatus: params.action === "approve" ? "approved" : "rejected",
        approvalDecidedAt: now,
        approvalDecidedByUserId: params.adminUserId,
        // ✅ OWNER DIRECTIVE (2026-11-25): the admin approval IS the email
        // confirmation — an approved account must NEVER be asked to verify
        // (or wait) again. Stamping emailVerifiedAt here anchors that promise:
        // pre-gate accounts flipped to pending by the v18 backfill come out
        // of approval with a verified email, and no UI state can nag them.
        // ✅ SECURITY FIX (audit run-3, google-link-email-provenance): the
        // PROVENANCE is recorded ('approval') so Google linking by email match
        // can distinguish approval-stamped addresses from delivered ones —
        // an attacker-created row with someone else's email must never merge
        // the victim's Google identity into it.
        ...(params.action === "approve" ? { emailVerifiedAt: now, emailVerificationSource: "approval" } : {}),
        ...(params.action === "reject" ? { tokenVersion: row.tokenVersion + 1 } : {}),
      })
      .where(eq(users.id, params.userId));

    // Close the in-memory auth-cache window immediately (30s TTL otherwise).
    if (params.action === "reject") {
      evictUserAuthCache(params.userId);
    }

    // ✅ SECURITY FIX (audit run-3, referral-reward-granted-on-unapproved-registration-self-referral-farming):
    // the referrer reward is granted HERE — when the invitee is actually
    // approved — instead of at registration. Best-effort + idempotent (see
    // grantReferralRewardForInvitee); both the dashboard and the email-action
    // paths go through this single decision function.
    if (params.action === "approve") {
      await grantReferralRewardForInvitee(params.userId);
    }

    logger.info("[Approval] decision applied", {
      userId: params.userId,
      username: row.username,
      action: params.action,
      source: params.source,
      adminUserId: params.adminUserId,
    });
    return { ok: true, status: params.action === "approve" ? "approved" : "rejected", decidedAt: now };
  } catch (err) {
    logger.error("[Approval] decision failed", {
      userId: params.userId,
      action: params.action,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, reason: "db_error" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Email action token — HMAC-SHA256, 7-day, single-purpose
// ─────────────────────────────────────────────────────────────────────────────

const APPROVAL_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface ApprovalTokenPayload {
  userId: number;
  action: ApprovalAction;
  /** Issued-at epoch millis — bounded by TTL at verify time. */
  iat: number;
}

function approvalTokenSecret(): string {
  // APP_SECRET already guards JWTs; reusing it keeps the deployment surface
  // at exactly one secret. Rotating APP_SECRET invalidates outstanding
  // approval emails — the desired behavior for a rotation event.
  return env.APP_SECRET || "dev-only-secret-not-for-production-minimum-32-chars-long";
}

function mac(payload: string): string {
  return createHmac("sha256", approvalTokenSecret()).update(payload).digest("base64url");
}

/** `userId.action.iat.mac` — URL-safe (base64url MAC), fits in a query param. */
export function signApprovalActionToken(userId: number, action: ApprovalAction): string {
  const iat = Date.now();
  const canonical = `${userId}.${action}.${iat}`;
  return `${canonical}.${mac(canonical)}`;
}

export type ApprovalTokenVerdict =
  | { valid: true; payload: ApprovalTokenPayload }
  | { valid: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyApprovalActionToken(token: string): ApprovalTokenVerdict {
  const parts = token.split(".");
  if (parts.length !== 4) return { valid: false, reason: "malformed" };
  const [userIdPart, actionPart, iatPart, sigPart] = parts;
  if (!/^\d{1,12}$/.test(userIdPart) || !/^\d{1,15}$/.test(iatPart)) {
    return { valid: false, reason: "malformed" };
  }
  if (actionPart !== "approve" && actionPart !== "reject") {
    return { valid: false, reason: "malformed" };
  }
  const canonical = `${userIdPart}.${actionPart}.${iatPart}`;
  const expected = mac(canonical);
  const given = Buffer.from(sigPart, "utf8");
  const want = Buffer.from(expected, "utf8");
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { valid: false, reason: "bad_signature" };
  }
  const iat = Number(iatPart);
  if (!Number.isFinite(iat) || Date.now() - iat > APPROVAL_TOKEN_TTL_MS) {
    return { valid: false, reason: "expired" };
  }
  return {
    valid: true,
    payload: { userId: Number(userIdPart), action: actionPart as ApprovalAction, iat },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin fan-out — in-app stream + email alert
// ─────────────────────────────────────────────────────────────────────────────

/** The owner inbox the approval alert lands in. ADMIN_ALERT_EMAIL (Space
 *  secret, rotatable without a redeploy) wins when set; otherwise the
 *  deployment's owner inbox — the platform's public identity (it appears in
 *  every email footer already), not a credential, and this repo is private. */
export function adminAlertEmail(): string | null {
  const v = (env.ADMIN_ALERT_EMAIL || "").trim().toLowerCase();
  if (v.includes("@")) return v;
  return "ahmdelbaz28@gmail.com";
}

/** ✅ ROOT-CURE (owner report 2026-11-26, "قبول/رفض الإيميل مش بينفذ"): the
 *  base URL the email's Approve/Reject buttons point at. The canonical domain
 *  sits behind a Cloudflare managed challenge that mail-app webviews and
 *  non-JS clients never pass (measured: real-browser navigation stuck on
 *  "Just a moment…", curl 403 cf-mitigated) — clicks carrying the owner's
 *  signed authority died at the edge. APPROVAL_ACTION_BASE_URL (Space
 *  variable, set to the raw *.hf.space origin) routes the buttons straight
 *  to the app — no edge challenge in the path; the HMAC-signed token remains
 *  the sole authority (see the shield exemption for /api/approval/action).
 *  Falls back to FRONTEND_URL when unset (canonical-domain behavior). */
export function approvalActionBaseUrl(): string {
  const v = (env.APPROVAL_ACTION_BASE_URL || "").trim().replace(/\/+$/, "");
  if (/^https:\/\//.test(v)) return v;
  return env.FRONTEND_URL.replace(/\/+$/, "");
}

async function loadAdminIds(): Promise<number[]> {
  const db = getDb();
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), ne(users.approvalStatus, "rejected")))
    .limit(50);
  return rows.map((r) => r.id);
}

/**
 * Fan out a registration event to the admin channels. BEST-EFFORT by
 * contract: any failure is logged and swallowed — the registration that
 * triggered it has already succeeded and must never be failed by its own
 * alert.
 *
 *  1. In-app stream: pushNotificationEvent per admin — the admin's open
 *     clients toast it within ~15s (NotificationPollerBridge), the approval
 *     card refreshes, and the frontend plays the chime + device notification.
 *  2. Email alert with Approve/Reject buttons (signed single-purpose links).
 *
 * ✅ EMAIL DELIVERY VISIBILITY (owner report 2026-11-26, "no approval email
 * ever reached my inbox and nothing told me"): the email verdict is now part
 * of the notification itself — the send happens FIRST (with ONE transient
 * retry), and the in-app alert either confirms the delivery ("بريد التنبيه
 * في طريقه") or carries the exact provider failure reason, so the owner
 * never silently misses a registration because an email died. Every outcome
 * is also persisted in the email_delivery_log ledger (see email.ts).
 */
export async function notifyAdminsOfRegistration(params: {
  userId: number;
  username: string;
  name: string | null;
  email: string | null;
  preferredLanguage?: string | null;
  /** Absolute frontend origin for the dashboard deep-link. */
  frontendUrl: string;
}): Promise<void> {
  const { userId, username, name, email, frontendUrl } = params;

  // ── 1. Email alert FIRST (one transient retry) — its verdict feeds the
  // in-app notification so the dashboard always tells the truth. ──
  const to = adminAlertEmail();
  let emailVerdict: string | null = null; // null = skipped (no inbox), true/false flows below
  let emailOk = false;
  if (to) {
    try {
      const approveToken = signApprovalActionToken(userId, "approve");
      const rejectToken = signApprovalActionToken(userId, "reject");
      const emailDoc = buildAdminApprovalRequestEmail({
        username,
        name,
        email,
        registeredAt: new Date(),
        approveUrl: `${approvalActionBaseUrl()}/api/approval/action?token=${encodeURIComponent(approveToken)}`,
        rejectUrl: `${approvalActionBaseUrl()}/api/approval/action?token=${encodeURIComponent(rejectToken)}`,
        dashboardUrl: `${frontendUrl}/admin?tab=users`,
      });
      const message = {
        to,
        subject: emailDoc.subject,
        html: emailDoc.html,
        text: emailDoc.text,
        deliveryClass: "approval-alert",
      };
      let result = await sendEmailWithDiagnostics(message);
      // ONE retry for TRANSIENT failures only (network unreachable, provider
      // 5xx). A config/validation failure (missing key, 4xx) will fail again
      // identically — retrying it just delays the truthful notification.
      if (!result.ok && isTransientEmailFailure(result)) {
        await new Promise((r) => setTimeout(r, 3000));
        result = await sendEmailWithDiagnostics(message);
      }
      emailOk = result.ok;
      emailVerdict = result.ok
        ? null
        : (result.reason || "سبب غير معروف من مزوّد البريد");
      if (emailOk) {
        logger.info("[Approval] alert email sent", { userId, to: maskEmail(to) });
      } else {
        logger.warn("[Approval] alert email failed (best-effort)", { userId, reason: emailVerdict });
      }
    } catch (err) {
      emailVerdict = err instanceof Error ? err.message : String(err);
      logger.warn("[Approval] alert email threw (best-effort)", { userId, error: emailVerdict });
    }
  } else {
    logger.info("[Approval] no ADMIN_ALERT_EMAIL resolved — email alert skipped", { userId });
  }

  // ── 2. In-app fan-out, now carrying the email verdict. ──
  try {
    const adminIds = await loadAdminIds();
    const title = "طلب انضمام جديد — Needs approval";
    const base = `${name || username} (@${username}) سجل في المنصة ويحتاج موافقتك — new registration awaiting your approval`;
    const verdictSuffix = to
      ? emailOk
        ? " ✅ بريد التنبيه أُرسل إلى صندوقك — يمكنك القبول/الرفض من رابطه أو من هذه اللوحة."
        : ` ⚠️ تعذّر إرسال بريد التنبيه (${emailVerdict}) — اعتمد الحساب من هذه اللوحة مباشرة أو اضغط "إعادة الإرسال".`
      : "";
    const message = `${base}${verdictSuffix}`;
    for (const adminId of adminIds) {
      await pushNotificationEvent("system", title, message, adminId, {
        approvalRequest: { userId, username, name, email, emailAlertOk: emailOk, emailAlertReason: emailVerdict },
        url: "/admin?tab=users",
      });
    }
    logger.info("[Approval] admin fan-out pushed", { userId, admins: adminIds.length, emailOk });
  } catch (err) {
    logger.warn("[Approval] admin notification push failed (best-effort)", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** True when an email failure is worth ONE retry: provider unreachable
 *  (network class) or a server-side 5xx. Deterministic 4xx/config failures
 *  are never retried — the answer will be identical. */
function isTransientEmailFailure(result: { ok: boolean; reason?: string }): boolean {
  if (result.ok) return false;
  const r = result.reason || "";
  return r.startsWith("Resend unreachable:") || /error 5\d\d/.test(r);
}
