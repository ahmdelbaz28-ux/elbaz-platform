// FINAL EMAIL PROOF — logs in as admin on production (via origin proxy) and
// fires ALL THREE email paths, printing the server's own delivery verdicts:
//   1. auth.sendVerificationEmail  (profile "تأكيد البريد" button)
//   2. auth.sendEmailSelfTest      (admin one-click provider probe)
//   3. auth.forgotPassword         (reset code + link)
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:4174";
const PASS = fs.readFileSync("/tmp/admin_pass.txt", "utf8").trim();

async function trpc(procedure, input, cookie) {
  const res = await fetch(`${BASE}/api/trpc/${procedure}?batch=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ "0": { json: input ?? null } }),
  });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const text = await res.text();
  return { status: res.status, setCookies, text };
}

const login = await trpc("auth.login", { username: "admin", password: PASS, remember: true });
const authCookie = login.setCookies.map((c) => c.split(";")[0]).filter((c) => c.length > 20).join("; ");
console.log("login:", login.status, authCookie ? "(session established)" : "(NO COOKIE)");
if (login.status !== 200 || !authCookie) { console.log(login.text.slice(0, 300)); process.exit(1); }

const unwrap = (text) => {
  try {
    const j = JSON.parse(text);
    const e = j?.[0]?.error?.json;
    if (e) return { error: e.message };
    return j?.[0]?.result?.data?.json ?? j?.[0]?.result?.data ?? j;
  } catch { return text.slice(0, 200); }
};

console.log("\n── Path 1: auth.sendVerificationEmail (profile confirmation) ──");
const p1 = await trpc("auth.sendVerificationEmail", null, authCookie);
console.log("  status:", p1.status, "| verdict:", JSON.stringify(unwrap(p1.text)).slice(0, 200));

console.log("\n── Path 2: auth.sendEmailSelfTest (admin provider probe) ──");
const p2 = await trpc("auth.sendEmailSelfTest", null, authCookie);
console.log("  status:", p2.status, "| verdict:", JSON.stringify(unwrap(p2.text)).slice(0, 260));

console.log("\n── Path 3: auth.forgotPassword (reset code) ──");
const p3 = await trpc("auth.forgotPassword", { email: "admin@ahmedelbaz.qzz.io" });
console.log("  status:", p3.status, "| verdict:", JSON.stringify(unwrap(p3.text)).slice(0, 200));

console.log("\nAll three email paths have been triggered against the LIVE production server.");
