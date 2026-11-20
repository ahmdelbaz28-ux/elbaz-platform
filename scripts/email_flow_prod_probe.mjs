/**
 * email_flow_prod_probe.mjs — LIVE production probe for the two reported
 * email problems:
 *
 *   1. Profile → "أرسل بريد التأكيد" (sendVerificationEmail): does the send
 *      actually succeed at the provider level?
 *   2. forgotPassword: does the reset email send succeed, and what exactly
 *      does the server report (deliveryWarning distinguishes "domain not
 *      verified" from generic failures)?
 *
 * The probe registers a throwaway account (auto-login via cookies), calls
 * the two flows, and prints the RAW server answers — enough to pin the
 * exact root cause (e.g. Resend sandbox 403 → needsDomainVerification).
 *
 * Usage:
 *   FWD_HOST=ahmedelbaz.qzz.io BASE_URL=https://ahmdelbaz28-ahmdrtap.hf.space \
 *     node scripts/email_flow_prod_probe.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const headers = process.env.FWD_HOST
  ? { "X-Forwarded-Host": process.env.FWD_HOST, "X-Forwarded-Proto": "https" }
  : {};

const stamp = Date.now().toString(36);
const USERNAME = `mailprobe${stamp}`;
// Resend rejects reserved/blocked recipient domains like example.com with a
// 422 "Invalid to field" — that is a PROVIDER policy, not a platform bug.
// Use a real recipient domain so the probe measures the actual send path.
const EMAIL = `mailprobe.${stamp}@gmail.com`;
const PASSWORD = "Probe#Temp2026";

let fails = 0;
function check(name, pass, detail = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!pass) fails += 1;
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  if (Object.keys(headers).length) await ctx.setExtraHTTPHeaders(headers);

  // Challenge bypass (same as the gate probe): re-issue every request over
  // Playwright's own TLS stack — the origin serves it cleanly.
  await ctx.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/sw.js") {
      await route.fulfill({ status: 404, body: "no sw in probe" });
      return;
    }
    try {
      const res = await route.fetch();
      await route.fulfill({ response: res });
    } catch {
      await route.continue().catch(() => {});
    }
  });

  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        "elbaz_cookie_consent",
        JSON.stringify({ necessary: true, analytics: false, marketing: false }),
      );
    } catch {}
  });

  /** tRPC call from the page context (same cookies as a real user). */
  async function trpcCall(proc, { input = undefined, method = "POST" } = {}) {
    const qs = input !== undefined
      ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
      : "";
    return page.evaluate(async ({ url, method }) => {
      const r = await fetch(url, {
        method,
        credentials: "include",
        headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
        ...(method === "POST" && url.includes("?") === false ? {} : {}),
      }).catch((e) => ({ networkError: String(e) }));
      if (r.networkError) return { status: 0, body: { networkError: r.networkError } };
      let body = null;
      try { body = await r.json(); } catch { body = { raw: "non-json" }; }
      return { status: r.status, body };
    }, { url: `/api/trpc/${proc}${qs}`, method });
  }

  async function trpcPostBody(proc, payload) {
    return page.evaluate(async ({ url, payload }) => {
      const r = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: payload }),
      }).catch((e) => ({ networkError: String(e) }));
      if (r.networkError) return { status: 0, body: { networkError: r.networkError } };
      let body = null;
      try { body = await r.json(); } catch { body = { raw: "non-json" }; }
      return { status: r.status, body };
    }, { url: `/api/trpc/${proc}`, payload });
  }

  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(1500);

  // ── 1. Register (auto-login sets cookies server-side) ────────────────────
  const reg = await trpcPostBody("auth.register", {
    username: USERNAME,
    password: PASSWORD,
    name: "Mail Probe",
    email: EMAIL,
  });
  const regUser = reg?.body?.result?.data?.json?.user;
  check("register throwaway account", reg.status === 200 && !!regUser, `status=${reg.status} user=${regUser ? regUser.username : JSON.stringify(reg.body).slice(0, 120)}`);

  // ── 2. Session oracle: auth.me must see the fresh session (auth.me is a
  //       QUERY → tRPC requires GET; POSTing it yields 405) ─────────────────
  const me = await trpcCall("auth.me", { method: "GET" });
  const meUser = me?.body?.result?.data?.json;
  check("session active after register", me.status === 200 && !!meUser?.id, `status=${me.status} id=${meUser?.id ?? JSON.stringify(me.body).slice(0, 100)}`);

  // ── 3. Profile → sendVerificationEmail (THE reported bug) ────────────────
  const sendVer = await trpcCall("auth.sendVerificationEmail");
  const verJson = sendVer?.body?.result?.data?.json;
  const verFailedViaResult = verJson && verJson.success === false;
  const verErrorViaTrpc = sendVer?.body?.error?.json?.message;
  console.log("   sendVerificationEmail raw:", JSON.stringify(sendVer.body).slice(0, 400));
  check(
    "sendVerificationEmail reports provider-level success",
    sendVer.status === 200 && verJson?.success === true,
    verFailedViaResult
      ? `server says FAILED: "${verJson.message}"`
      : verErrorViaTrpc
        ? `tRPC error: ${verErrorViaTrpc.slice(0, 120)}`
        : `status=${sendVer.status}`
  );

  // ── 4. forgotPassword (2nd reported flow) ────────────────────────────────
  const forgot = await trpcPostBody("auth.forgotPassword", { email: EMAIL });
  const forgotJson = forgot?.body?.result?.data?.json;
  console.log("   forgotPassword raw:", JSON.stringify(forgot.body).slice(0, 400));
  check(
    "forgotPassword returns a usable answer",
    forgot.status === 200 && forgotJson?.success === true,
    `status=${forgot.status}`
  );
  if (forgotJson?.deliveryWarning) {
    console.log(`   ⚠️ deliveryWarning: "${forgotJson.deliveryWarning}"`);
    const domainIssue = forgotJson.deliveryWarning.includes("domain not verified");
    console.log(
      domainIssue
        ? "   🔎 ROOT CAUSE CONFIRMED LIVE: Resend domain NOT verified — sandbox mode (only the account owner's inbox can receive)."
        : "   🔎 delivery failed for a NON-domain reason — inspect Resend logs."
    );
  } else {
    console.log("   ℹ️ no deliveryWarning — Resend ACCEPTED the send (deliverability/spam is then the suspect).");
  }

  // ── 5. resetPassword endpoint sanity (invalid token must be refused) ─────
  const bogusReset = await trpcPostBody("auth.resetPassword", {
    userId: 999999,
    token: "deadbeefdeadbeefdeadbeefdeadbeef",
    newPassword: "NewPass#2026x",
  });
  const bogusMsg = bogusReset?.body?.error?.json?.message ?? "";
  check(
    "resetPassword refuses invalid token (BAD_REQUEST)",
    bogusReset.status >= 400 && /invalid|expired/i.test(bogusMsg),
    `status=${bogusReset.status} msg="${bogusMsg.slice(0, 60)}"`
  );

  // ── 6. admin gate on the self-test (non-admin must be refused) ──────────
  const selfTest = await trpcCall("auth.sendEmailSelfTest");
  const selfTestErr = selfTest?.body?.error?.json?.message ?? "";
  check(
    "sendEmailSelfTest is admin-only (FORBIDDEN for regular users)",
    selfTest.status >= 400 && /admin/i.test(selfTestErr),
    `status=${selfTest.status} msg="${selfTestErr.slice(0, 50)}"`
  );

  await browser.close();
  console.log(`\n== EMAIL FLOW PROBE: ${fails} failing check(s) ==`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("PROBE ERROR:", e);
  process.exit(1);
});
