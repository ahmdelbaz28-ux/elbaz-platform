import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * REGRESSION GUARD — "My Profile" email-flow root-cure round (2026-11-22).
 *
 * The owner asked for a full review of the profile page: every button/icon,
 * email verification, code sending, and every required setting. The audit
 * found six root defects in the verification/email-change pipeline; these
 * source-level pins (same pattern as audit-run1-fixes.test.ts /
 * security-audit-cfskill-run2.test.ts — a live DB/browser cannot be invoked
 * from vitest) lock the invariants that make the flow honest and safe:
 *
 * 1. completeEmailVerification honors pendingEmail BEFORE the
 *    "already verified" idempotency return — email changes used to be
 *    IMPOSSIBLE for already-verified users (the normal verify-then-change
 *    order): the confirmation code "succeeded" while the address never
 *    switched.
 * 2. initiateEmailVerification writes credentials + pendingEmail ONLY after
 *    the provider accepted the send, and a PLAIN send clears pendingEmail —
 *    a failed send must never arm a change that a later unrelated
 *    verification would silently apply.
 * 3. completeEmailVerification re-checks address ownership at completion
 *    time (the uniqueness check ran when the change was REQUESTED — another
 *    account may claim the address in between; users_email_unique would
 *    otherwise surface as a raw 500) and wraps the final update.
 * 4. updateProfile: the email-change branch is rate-limited
 *    (sendVerification bucket — it triggers a real provider send to an
 *    arbitrary address), applies name/preferredLanguage instead of silently
 *    dropping them, and checks the send result — every branch returns the
 *    normalized { success, emailVerificationRequired, message } shape.
 * 5. Profile.tsx never reloads the page after profile/verification
 *    mutations (the reload killed every toast), branches truthfully on
 *    emailVerificationRequired, arms the in-page change-confirmation code
 *    box for VERIFIED users, and renders a bilingual Account Level card.
 */
describe("profile email-flow root-cure regression guards", () => {
  const src = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");

  const emailSource = src("./lib/email.ts");
  const localAuthSource = src("./local-auth-router.ts");
  const profileSource = src("../src/pages/Profile.tsx");

  it("completeEmailVerification reads pendingEmail BEFORE the already-verified idempotency return", () => {
    const pendingReadIdx = emailSource.indexOf("const pendingEmail = user.pendingEmail || null;");
    const idempotentIdx = emailSource.indexOf("if (user.emailVerifiedAt && !pendingEmail)");
    expect(pendingReadIdx).toBeGreaterThan(-1);
    expect(idempotentIdx).toBeGreaterThan(-1);
    // the pending change must be captured before idempotency can short-circuit
    expect(pendingReadIdx).toBeLessThan(idempotentIdx);
    // the old broken check (verified → return, ignoring pendingEmail) is gone
    expect(emailSource).not.toContain("if (user.emailVerifiedAt) {\n    return { success: true, message: \"Email already verified.\" }");
  });

  it("completeEmailVerification always returns the emailChanged flag", () => {
    expect(emailSource).toContain("emailChanged: boolean");
    const emailChangedCount = (emailSource.match(/emailChanged: (false|Boolean\(pendingEmail\))/g) ?? []).length;
    // every failure/success branch of completeEmailVerification carries it
    expect(emailChangedCount).toBeGreaterThanOrEqual(12);
  });

  it("initiateEmailVerification persists credentials ONLY after a successful send", () => {
    const sendIdx = emailSource.indexOf("const sendResult = await sendEmailWithDiagnostics({");
    const persistIdx = emailSource.indexOf("emailVerificationToken: tokenHash,");
    const failReturnIdx = emailSource.indexOf("Could not send verification email. Please try again later.");
    expect(sendIdx).toBeGreaterThan(-1);
    expect(persistIdx).toBeGreaterThan(-1);
    // send → failure return → persist: nothing is armed before the verdict
    expect(sendIdx).toBeLessThan(failReturnIdx);
    expect(failReturnIdx).toBeLessThan(persistIdx);
    // a PLAIN send (no newEmail) clears any lingering pending change;
    // a CHANGE send arms it normalized to lowercase (owner-report root cure
    // 2026-11-22: confirmed changes land lowercase going forward)
    expect(emailSource).toContain("pendingEmail: newEmail ? newEmail.trim().toLowerCase() : null,");
  });

  it("completeEmailVerification re-checks ownership at completion time and guards the final update", () => {
    const claimedIdx = emailSource.indexOf("const [claimed] = await db");
    expect(claimedIdx).toBeGreaterThan(-1);
    expect(emailSource).toContain("if (claimed && claimed.id !== userId)");
    expect(emailSource).toContain("await db.update(users).set({ pendingEmail: null }).where(eq(users.id, userId))");
    // the final write is wrapped so a unique-index race is a clean failure
    expect(emailSource).toContain("await db.update(users).set(updateData).where(eq(users.id, userId));");
  });

  it("stale pending changes are disarmed wherever credentials are cleared", () => {
    // both credential-clear branches (missing + expired) also clear pendingEmail
    expect(emailSource).toContain("emailOtpCode: null, emailOtpAttempts: 0, pendingEmail: null");
    expect(emailSource).toContain("emailOtpAttempts: 0, pendingEmail: null }).where(eq(users.id, userId))");
  });

  it("updateProfile email-change branch is rate-limited on the sendVerification bucket", () => {
    const changeBranchIdx = localAuthSource.indexOf("input.email.toLowerCase() !== (ctx.user.email || \"\").toLowerCase()");
    const rateLimitIdx = localAuthSource.indexOf('await checkRateLimit(ip, "sendVerification")', changeBranchIdx);
    expect(changeBranchIdx).toBeGreaterThan(-1);
    expect(rateLimitIdx).toBeGreaterThan(-1);
    // the limiter fires INSIDE the change branch, before the provider send
    const sendCallIdx = localAuthSource.indexOf("await initiateEmailVerification(ctx.user.id, input.email, ctx.req.headers)");
    expect(sendCallIdx).toBeGreaterThan(rateLimitIdx);
  });

  it("updateProfile applies name/language in the email-change branch and checks the send result", () => {
    const changeBranchIdx = localAuthSource.indexOf("input.email.toLowerCase() !== (ctx.user.email || \"\").toLowerCase()");
    const nameApplyIdx = localAuthSource.indexOf("input.preferredLanguage !== undefined && { preferredLanguage: input.preferredLanguage }", changeBranchIdx);
    expect(nameApplyIdx).toBeGreaterThan(-1);
    const resultCheckIdx = localAuthSource.indexOf("if (!result.success) {", changeBranchIdx);
    expect(resultCheckIdx).toBeGreaterThan(-1);
    expect(resultCheckIdx).toBeLessThan(localAuthSource.indexOf("return { success: true, emailVerificationRequired: true, message: result.message };"));
    // normalized response shape on every branch
    expect(localAuthSource).toContain('return { success: true, emailVerificationRequired: false, message: "Profile updated." };');
    expect(localAuthSource).toContain("return { success: false, emailVerificationRequired: false, message: safeMessage.message };");
  });

  it("Profile.tsx never reloads the page after profile/verification mutations", () => {
    expect(profileSource).not.toContain("globalThis.location.reload()");
    expect(profileSource).toContain("utils.auth.me.invalidate()");
  });

  it("Profile.tsx branches truthfully on emailVerificationRequired (no blanket success toast)", () => {
    expect(profileSource).toContain("if (data.emailVerificationRequired)");
    expect(profileSource).toContain("sessionStorage.setItem(\"elbaz_email_change_pending\", \"1\")");
    expect(profileSource).toContain("sessionStorage.removeItem(\"elbaz_email_change_pending\")");
  });

  it("Profile.tsx arms the change-confirmation code box for verified users", () => {
    expect(profileSource).toContain("user.emailVerifiedAt && emailChangePending");
    expect(profileSource).toContain("email-change-verification-code");
    expect(profileSource).toContain("data.emailChanged");
  });

  it("Profile.tsx blocks silent email removal and renders a bilingual Account Level card", () => {
    expect(profileSource).toContain("The email cannot be removed");
    // the hardcoded English role text in the stats card is gone
    expect(profileSource).not.toContain('{user.role === "admin" ? "Admin" : "Student"}');
    expect(profileSource).toContain("{roleLabel}");
  });
});
