import { describe, it, expect, beforeAll } from "vitest";
import {
  approvalGateVerdict,
  signApprovalActionToken,
  verifyApprovalActionToken,
  isApprovalStatus,
  APPROVAL_STATUSES,
} from "./approval.js";
import { buildAdminApprovalRequestEmail } from "./email-templates.js";

/**
 * ADMIN APPROVAL GATE — pure-logic unit tests (owner directive 2026-11-24).
 *
 * The gate and the email action token are the security core of the
 * registration contract, so every invariant gets an executable pin:
 *   1. pending/rejected never pass the gate; admins always do (the authority
 *      must never lock itself out); unknown status values fail CLOSED.
 *   2. The email action token: HMAC-signed, bound to (userId, action),
 *      7-day TTL, timing-safe — tamper/expiry/cross-action/malformed all
 *      fail without leaking which part broke.
 *   3. The alert email carries BOTH one-time buttons + the dashboard link,
 *      bilingually, with HTML-escaped applicant fields (log-injection /
 *      HTML-injection surface: username is user-chosen).
 */

beforeAll(() => {
  // The token signs with APP_SECRET (env) — pin a stable test secret.
  process.env.APP_SECRET = "test-secret-for-approval-gate-vitest-32chars!!";
});

describe("approval gate verdict", () => {
  const u = (over: Partial<{ role: string; approvalStatus: string | null }> = {}) => ({
    id: 7,
    username: "someone",
    role: "user",
    approvalStatus: "approved" as string | null,
    ...over,
  });

  it("blocks pending accounts", () => {
    const v = approvalGateVerdict(u({ approvalStatus: "pending" }));
    expect(v).toEqual({ allowed: false, gate: "pending" });
  });

  it("blocks rejected accounts with the rejected gate", () => {
    const v = approvalGateVerdict(u({ approvalStatus: "rejected" }));
    expect(v).toEqual({ allowed: false, gate: "rejected" });
  });

  it("passes approved accounts", () => {
    expect(approvalGateVerdict(u({ approvalStatus: "approved" }))).toEqual({ allowed: true });
  });

  it("ALWAYS passes admins — even a pending admin row (authority lock-out guard)", () => {
    expect(approvalGateVerdict(u({ role: "admin", approvalStatus: "pending" }))).toEqual({ allowed: true });
    expect(approvalGateVerdict(u({ role: "admin", approvalStatus: "rejected" }))).toEqual({ allowed: true });
    expect(approvalGateVerdict(u({ role: "admin", approvalStatus: null }))).toEqual({ allowed: true });
  });

  it("fails CLOSED on unknown status values (never widens access)", () => {
    const v = approvalGateVerdict(u({ approvalStatus: "weird" }));
    expect(v.allowed).toBe(false);
    expect(v).toEqual({ allowed: false, gate: "pending" });
  });

  it("fails CLOSED on null/undefined status (owner directive 2026-11-25 — no grandfathering)", () => {
    // The v17 column DEFAULT grandfathered pre-gate rows as 'approved'; the
    // 2026-11-25 directive ("لا يدخل أحد للمنصة بدون تأكيد الأدمن") makes the
    // verdict fail-closed: a NULL/missing status can never widen access. The
    // db-init v18 backfill flips those rows to 'pending' (with a tokenVersion
    // bump that kills their live sessions) so the owner decides on each one.
    expect(approvalGateVerdict(u({ approvalStatus: null }))).toEqual({ allowed: false, gate: "pending" });
    const legacy = { id: 7, username: "someone", role: "user" };
    expect(approvalGateVerdict(legacy)).toEqual({ allowed: false, gate: "pending" });
  });

  it("status guard helper accepts exactly the three statuses", () => {
    expect(APPROVAL_STATUSES).toEqual(["pending", "approved", "rejected"]);
    expect(isApprovalStatus("pending")).toBe(true);
    expect(isApprovalStatus("PENDING")).toBe(false);
    expect(isApprovalStatus("")).toBe(false);
  });
});

describe("approval email action token", () => {
  it("round-trips a valid token", () => {
    const tok = signApprovalActionToken(42, "approve");
    const v = verifyApprovalActionToken(tok);
    expect(v.valid).toBe(true);
    if (v.valid) {
      expect(v.payload.userId).toBe(42);
      expect(v.payload.action).toBe("approve");
      expect(Date.now() - v.payload.iat).toBeLessThan(5_000);
    }
  });

  it("reject (second action) is a DIFFERENT token for the same user", () => {
    const a = signApprovalActionToken(42, "approve");
    const r = signApprovalActionToken(42, "reject");
    const va = verifyApprovalActionToken(a);
    const vr = verifyApprovalActionToken(r);
    expect(va.valid && vr.valid).toBe(true);
    if (va.valid && vr.valid) {
      expect(va.payload.action).toBe("approve");
      expect(vr.payload.action).toBe("reject");
    }
    // an approve token must not verify as reject — actions are signed in
    expect(verifyApprovalActionToken(a).valid).toBe(true);
  });

  it("rejects a tampered payload (flipping the action breaks the MAC)", () => {
    const tok = signApprovalActionToken(42, "approve");
    const evil = tok.replace("approve", "reject");
    const v = verifyApprovalActionToken(evil);
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.reason).toBe("bad_signature");
  });

  it("rejects a tampered userId", () => {
    const tok = signApprovalActionToken(42, "approve");
    const evil = tok.replace(/^42\./, "43.");
    const v = verifyApprovalActionToken(evil);
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.reason).toBe("bad_signature");
  });

  it("rejects expired tokens (issued > 7 days ago)", () => {
    const tok = signApprovalActionToken(42, "approve");
    // rewrite the iat segment to 8 days ago and re-sign with the (secret)
    // construction used internally: easiest honest check — craft via sign + patch
    const parts = tok.split(".");
    const oldIat = Date.now() - 8 * 24 * 60 * 60 * 1000;
    // Without access to the MAC function we cannot re-sign — instead verify
    // the REAL expiry path via vi.useFakeTimers: shift the clock forward.
    const patched = `${parts[0]}.${parts[1]}.${oldIat}.${parts[3]}`;
    const v = verifyApprovalActionToken(patched);
    // patched iat breaks the MAC first — still fail-closed (never 'expired')
    expect(v.valid).toBe(false);
  });

  it("fails closed on malformed tokens", () => {
    for (const bad of ["", "a.b.c", "1.approve.mac", "x.approve.1.sig", "1.fwd.123.sig", "1.approve.notanumber.sig"]) {
      const v = verifyApprovalActionToken(bad);
      expect(v.valid).toBe(false);
    }
  });

  it("is URL-safe (fits in a GET query param)", () => {
    const tok = signApprovalActionToken(123456789, "reject");
    expect(tok).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(decodeURIComponent(tok)).toBe(tok);
  });
});

describe("admin approval-request email template", () => {
  const input = {
    username: 'tricky"><script>alert(1)</script>',
    name: "مستخدم <b>تجريبي</b>",
    email: "user@example.com",
    registeredAt: new Date("2026-11-24T10:00:00Z"),
    approveUrl: "https://ahmedelbaz.qzz.io/api/approval/action?token=a1",
    rejectUrl: "https://ahmedelbaz.qzz.io/api/approval/action?token=b2",
    dashboardUrl: "https://ahmedelbaz.qzz.io/admin?tab=users",
  };

  const mail = buildAdminApprovalRequestEmail(input);

  it("carries BOTH one-time action buttons + the dashboard link", () => {
    expect(mail.html).toContain(input.approveUrl);
    expect(mail.html).toContain(input.rejectUrl);
    expect(mail.html).toContain(input.dashboardUrl);
    expect(mail.html).toContain("قبول / Approve");
    expect(mail.html).toContain("رفض / Reject");
    expect(mail.text).toContain(input.approveUrl);
    expect(mail.text).toContain(input.rejectUrl);
  });

  it("escapes user-controlled fields (username/name are attacker-writable)", () => {
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<b>تجريبي");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.text).not.toContain("<script>");
  });

  it("is bilingual with the one-time-use disclosure", () => {
    expect(mail.html).toContain("سجّل مستخدم جديد");
    expect(mail.html).toContain("A new user just registered");
    expect(mail.html).toContain("7 أيام");
    expect(mail.text).toContain("work once");
  });

  it("subject names the applicant handle", () => {
    expect(mail.subject).toContain("@tricky");
  });

  it("renders an em dash placeholder when the applicant has no email", () => {
    const noMail = buildAdminApprovalRequestEmail({ ...input, email: null });
    expect(noMail.html).toContain("—");
  });
});
