import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * ADMIN APPROVAL GATE — source-level contract pins (2026-11-24).
 *
 * A live DB cannot run in vitest, so the DB-touching flows are locked the
 * same way audit-run1-fixes.test.ts locks its invariants: structural pins
 * over the real source. These fail loudly if anyone reorders the gate AFTER
 * session issuance, removes the pending insert, or opens a Google side door:
 *
 * 1. register: inserts approvalStatus 'pending', issues NO token/cookie, and
 *    responds with pendingApproval:true.
 * 2. login: the gate runs AFTER credential+2FA verification and BEFORE the
 *    lastSignInAt update / createToken — pending/rejected NEVER reach a
 *    token; the stable APPROVAL_PENDING / APPROVAL_REJECTED sentinels drive
 *    the localized respectful panels.
 * 3. Google (OAuth callback + GIS): every session-issuance path passes the
 *    gate; new Google sign-ups insert pending and get NO session.
 * 4. The decision machine: reject bumps tokenVersion in the same UPDATE
 *    (live sessions die atomically) and evicts the auth cache.
 * 5. The email action route: HMAC verify → decideApproval(source: "email");
 *    invalid links are inert pages, never leaks.
 * 6. Frontend: Login/Register render the respectful panels on the gate
 *    markers — in the user's language, never styled as a crash.
 */
describe("admin approval gate — source contract pins", () => {
  const src = (rel: string): string =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");

  const localAuth = src("./local-auth-router.ts");
  const googleAuth = src("./google-auth-router.ts");
  const approvalLib = src("./lib/approval.ts");
  const adminUsers = src("./admin-users.ts");
  const actionRoute = src("./approval-action-route.ts");
  const loginPage = src("../src/pages/Login.tsx");
  const registerPage = src("../src/pages/Register.tsx");
  const bridge = src("../src/components/NotificationPollerBridge.tsx");

  // ── 1. Registration lands pending with NO session ──
  it("register inserts approvalStatus 'pending' explicitly", () => {
    expect(localAuth).toContain('approvalStatus: "pending"');
  });

  it("register issues NO token and NO cookies for the pending account", () => {
    const registerBody = localAuth.slice(localAuth.indexOf("register: publicQuery"), localAuth.indexOf("login: publicQuery"));
    expect(registerBody).toContain("pendingApproval: true");
    // the OLD flow minted a token inside register — must be gone
    expect(registerBody).not.toContain("createToken(");
    expect(registerBody).not.toContain("serializeAuthCookie(");
    expect(registerBody).not.toContain("responseData.token");
  });

  it("register alerts the owner (in-app admin stream + email) best-effort", () => {
    expect(localAuth).toContain("notifyAdminsOfRegistration({");
    // fire-and-forget: void + .catch — a failed alert never fails the registration
    expect(localAuth).toMatch(/void notifyAdminsOfRegistration\(\{[\s\S]*?\}\)\.catch/);
  });

  it("the educational welcome drip is DEFERRED out of register (lands on approval)", () => {
    expect(localAuth).not.toContain("maybeSendWelcomeEmail(");
    expect(adminUsers).toContain("maybeSendWelcomeEmail(");
  });

  // ── 2. Login gate order ──
  it("login gate sits AFTER credential+2FA verification and BEFORE any session issuance", () => {
    const gateIdx = localAuth.indexOf("APPROVAL_PENDING");
    const totpIdx = localAuth.indexOf("if (user.totpEnabled) {", localAuth.indexOf("login: publicQuery"));
    const sessionIdx = localAuth.indexOf("lastSignInAt: new Date(),", localAuth.indexOf("login: publicQuery"));
    expect(gateIdx).toBeGreaterThan(-1);
    expect(totpIdx).toBeGreaterThan(-1);
    expect(sessionIdx).toBeGreaterThan(totpIdx);
    expect(gateIdx).toBeGreaterThan(totpIdx);
    expect(gateIdx).toBeLessThan(sessionIdx);
  });

  it("login gate uses the stable sentinels and never burns the failure throttle", () => {
    const gateBlock = localAuth.slice(localAuth.indexOf("const gate = approvalGateVerdict(user);"), localAuth.indexOf("const gate = approvalGateVerdict(user);") + 700);
    expect(gateBlock).toContain('message: gate.gate === "pending" ? "APPROVAL_PENDING" : "APPROVAL_REJECTED"');
    expect(gateBlock).not.toContain("recordAccountLoginFailure");
  });

  // ── 3. Google flows are gated too ──
  it("issueSessionForUser fails closed on the gate BEFORE TOTP/token work", () => {
    const fnIdx = googleAuth.indexOf("async function issueSessionForUser");
    const fnBody = googleAuth.slice(fnIdx, fnIdx + 1200);
    const gateIdx = fnBody.indexOf("approvalGateVerdict(user as GateUser)");
    const totpIdx = fnBody.indexOf("totpEnrolledFor(user.id)");
    const tokenIdx = fnBody.indexOf("createToken({");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(totpIdx);
    expect(totpIdx).toBeLessThan(tokenIdx);
  });

  it("GIS returns approval_pending/approval_rejected codes on every session path", () => {
    const gisCount = (googleAuth.match(/error: err\.gate === "pending" \? "approval_pending" : "approval_rejected"/g) ?? []).length;
    // by-googleId + by-email (issueSessionForUser callers) — both catch the gate error
    expect(gisCount).toBe(2);
  });

  it("OAuth callback gates BEFORE createToken and redirects with the marker", () => {
    const gateIdx = googleAuth.indexOf("const gate = approvalGateVerdict({ id: userId, username, role: userRole, approvalStatus: approvalStatusForGate });");
    const tokenIdx = googleAuth.indexOf("const token = await createToken({ userId, username, role: userRole, tokenVersion: tokenVersionForSession })");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(tokenIdx);
    expect(googleAuth).toContain("c.redirect(`/?approval=${gate.gate}`)");
  });

  it("Google sign-ups insert pending and alert the owner in BOTH flows", () => {
    const pendingInserts = (googleAuth.match(/approvalStatus: "pending"/g) ?? []).length;
    expect(pendingInserts).toBe(2);
    const notifyCalls = (googleAuth.match(/notifyAdminsOfRegistration\(\{/g) ?? []).length;
    expect(notifyCalls).toBe(2);
  });

  // ── 4. Decision machine ──
  it("reject bumps tokenVersion in the SAME update (atomic session revocation)", () => {
    const setBlock = approvalLib.slice(approvalLib.indexOf("await db\n      .update(users)"), approvalLib.indexOf("await db\n      .update(users)") + 400);
    expect(setBlock).toContain('"rejected"');
    expect(setBlock).toContain("tokenVersion: row.tokenVersion + 1");
    expect(setBlock).toContain("approvalDecidedAt: now");
    expect(setBlock).toContain("approvalDecidedByUserId: params.adminUserId");
  });

  it("reject also evicts the in-memory auth cache immediately", () => {
    const decideBody = approvalLib.slice(approvalLib.indexOf("export async function decideApproval"), approvalLib.indexOf("export async function decideApproval") + 3000);
    expect(decideBody).toContain("evictUserAuthCache(params.userId)");
  });

  it("admins can never be rejected and approve only applies to pending", () => {
    const decideBody = approvalLib.slice(approvalLib.indexOf("export async function decideApproval"), approvalLib.indexOf("export async function decideApproval") + 2500);
    expect(decideBody).toContain('if (row.role === "admin") return { ok: false, reason: "not_pending" };');
    expect(decideBody).toContain('if (row.approvalStatus !== "pending") return { ok: false, reason: "not_pending" };');
    expect(decideBody).toContain('if (row.approvalStatus === "rejected") return { ok: false, reason: "not_pending" };');
  });

  // ── 5. Admin endpoints + email action route ──
  it("approval admin procedures run through adminQuery/adminMutation (auth + audit)", () => {
    for (const proc of ["pendingApprovals: adminQuery", "approveUser: adminMutation", "rejectUser: adminMutation", "resendApprovalEmail: adminMutation"]) {
      expect(adminUsers).toContain(proc);
    }
    // the dashboard decisions stamp the admin's id and the provenance
    expect(adminUsers).toContain('source: "dashboard"');
  });

  it("email action route verifies the HMAC then decides with source=email", () => {
    const handlerIdx = actionRoute.indexOf('approvalActionRoute.get("/action"');
    const handler = actionRoute.slice(handlerIdx);
    expect(handler.indexOf("verifyApprovalActionToken(token)")).toBeGreaterThan(-1);
    expect(handler.indexOf("verifyApprovalActionToken(token)")).toBeLessThan(handler.indexOf("decideApproval({ userId, action, adminUserId: null, source: \"email\" })"));
    // invalid links are inert HTML pages with an error status — never JSON leaks
    expect(handler).toContain("الرابط غير صالح");
    expect(handler).toContain("400");
    // no-cache on the decision responses
    expect(handler).toContain("no-store");
    // per-IP rate limit guards the HMAC oracle
    expect(handler).toContain("allow(ip)");
  });

  it("the alert email signs BOTH actions with the server secret", () => {
    const notifyBody = approvalLib.slice(approvalLib.indexOf("export async function notifyAdminsOfRegistration"));
    expect(notifyBody).toContain('signApprovalActionToken(userId, "approve")');
    expect(notifyBody).toContain('signApprovalActionToken(userId, "reject")');
    expect(notifyBody).toContain("/api/approval/action?token=");
  });

  it("the admin fan-out targets admin streams only and never leaks to users", () => {
    const loadAdmins = approvalLib.slice(approvalLib.indexOf("async function loadAdminIds"), approvalLib.indexOf("async function loadAdminIds") + 500);
    expect(loadAdmins).toContain('eq(users.role, "admin")');
    const fanoutBody = approvalLib.slice(approvalLib.indexOf("export async function notifyAdminsOfRegistration"));
    expect(fanoutBody).toContain("for (const adminId of adminIds)");
    expect(fanoutBody).toContain("pushNotificationEvent(");
  });

  // ── 6. Frontend respectful panels ──
  it("Login renders the pending/rejected panels on the gate markers (bilingual)", () => {
    expect(loginPage).toContain("APPROVAL_PENDING");
    expect(loginPage).toContain("APPROVAL_REJECTED");
    // the OAuth redirect marker is consumed by the lazy state initializer
    expect(loginPage).toContain('.get("approval")');
    expect(loginPage).toContain('"approval_pending"');
    expect(loginPage).toContain("المهندس أحمد الباز سيراجع طلبك");
    expect(loginPage).toContain("approval-pending-panel");
    expect(loginPage).toContain("approval-rejected-panel");
  });

  it("Register swaps the form for the welcome panel — the pending branch returns before any navigation", () => {
    const onSuccessIdx = registerPage.indexOf("onSuccess: (data) => {");
    const onSuccess = registerPage.slice(onSuccessIdx, registerPage.indexOf("onError: (err) => {"));
    expect(onSuccess).toContain("data?.pendingApproval");
    expect(onSuccess).toContain("setPendingApproval(true)");
    // the pending branch MUST return before the legacy fallback can navigate
    const pendingIdx = onSuccess.indexOf("data?.pendingApproval");
    const returnIdx = onSuccess.indexOf("return;", pendingIdx);
    const navigateIdx = onSuccess.indexOf('navigate("/", { replace: true })');
    expect(returnIdx).toBeGreaterThan(pendingIdx);
    expect(navigateIdx).toBeGreaterThan(returnIdx);
    expect(registerPage).toContain("register-pending-panel");
    expect(registerPage).toContain("سيراجع طلبك وسيتم الموافقة عليه في أقرب وقت");
    // GIS sign-up mirrors the panel
    expect(registerPage).toContain('"approval_pending"');
  });

  it("the poller bridge turns approval events into chime + buzz + device notification", () => {
    expect(bridge).toContain("playApprovalChime()");
    expect(bridge).toContain("vibrateApproval()");
    expect(bridge).toContain("showDeviceNotification(");
    expect(bridge).toContain("approvalRequest");
  });

  it("the Admin dashboard queue wires approve/reject/resend with data-testids", () => {
    const adminPage = src("../src/pages/Admin.tsx");
    expect(adminPage).toContain("trpc.admin.pendingApprovals.useQuery");
    expect(adminPage).toContain("approveUserMutation.mutate({ userId: u.id })");
    expect(adminPage).toContain("rejectUserMutation.mutate({ userId: u.id })");
    expect(adminPage).toContain("resendApprovalEmailMutation.mutate({ userId: u.id })");
    expect(adminPage).toContain("approvals-card");
    expect(adminPage).toContain("enable-approval-notifications");
    // reject carries a destructive-action confirm (owner authority is irreversible)
    expect(adminPage).toContain("window.confirm");
  });
});
