/**
 * ✅ PROD BROWSER E2E — remember-device self-heal probe on the REAL deployed
 * client bundle (ahmedelbaz.qzz.io via HF Space + forwarded-host bypass).
 *
 * Scenario W7-live: the browser holds ONLY the HttpOnly session cookie — the
 * JS-readable elbaz_auth_flag cookie is gone (privacy tools / past false-401s).
 * The OLD client never asked the server again → permanent login wall. The NEW
 * client fires the one-time boot probe → the server restores the session and
 * re-sets the flag → the user lands on /dashboard WITHOUT seeing /login.
 *
 * Checks:
 *  P1  /dashboard with a flag-less HttpOnly session NEVER bounces to /login
 *  P2  the boot probe restored elbaz_auth_flag in document.cookie (self-heal)
 *  P3  the HttpOnly session cookie is still present after the heal
 *  P4  a guest (no cookies) still lands on /login (probe rejects exactly once)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://ahmdelbaz28-ahmdrtap.hf.space";
const FWD = process.env.FWD_HOST
  ? { "X-Forwarded-Host": process.env.FWD_HOST, "X-Forwarded-Proto": "https" }
  : undefined;
const HOSTNAME = new URL(BASE).hostname;

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗ FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// ── 1. create a real session on prod via tRPC (register + login remember=true)
async function trpcCall(proc, input, jar, kind = "mut") {
  const url =
    kind === "mut"
      ? `${BASE}/api/trpc/${proc}?batch=1`
      : `${BASE}/api/trpc/${proc}?batch=1&input=${encodeURIComponent(JSON.stringify({ "0": { json: input } }))}`;
  const res = await fetch(url, {
    method: kind === "mut" ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...(FWD || {}), ...(jar.length ? { Cookie: jar.join("; ") } : {}) },
    ...(kind === "mut" ? { body: JSON.stringify({ "0": { json: input } }) } : {}),
  });
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const pair = sc.split(";")[0];
    const name = pair.split("=")[0];
    const idx = jar.findIndex((c) => c.startsWith(name + "="));
    if (idx >= 0) jar.splice(idx, 1);
    jar.push(pair);
  }
  return { status: res.status, setCookies: res.headers.getSetCookie?.() ?? [] };
}

const stamp = Date.now().toString(36);
const USERNAME = `rm${stamp}`.slice(0, 20);
const PASSWORD = `Rm${stamp}Pass1`;
const jar = [];
const reg = await trpcCall("auth.register", { username: USERNAME, password: PASSWORD, name: "remember prod" }, jar);
const login = await trpcCall("auth.login", { username: USERNAME, password: PASSWORD, remember: true }, jar);
check("prod login 2xx (pre-condition)", login.status >= 200 && login.status < 300, `status=${login.status} (register=${reg.status})`);

const authCookie = jar.find((c) => c.startsWith("elbaz_auth="));
check("session cookie captured (pre-condition)", !!authCookie && !authCookie.endsWith("="), "elbaz_auth present");
if (!authCookie || authCookie.endsWith("=")) {
  console.log("\nRESULT: pre-conditions failed — aborting ✗");
  process.exit(1);
}

// ── 2. browser with ONLY the HttpOnly session cookie (flag REMOVED on purpose)
const browser = await chromium.launch({ headless: true });

const zombie = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  extraHTTPHeaders: FWD,
});
await zombie.addCookies([
  { name: "elbaz_auth", value: authCookie.split("=")[1], domain: HOSTNAME, path: "/", httpOnly: true, secure: true, sameSite: "None" },
  // ⚠️ NO elbaz_auth_flag — that's the whole scenario
]);
const zpage = await zombie.newPage();
await zpage.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 60000 });
await zpage.waitForSelector("#main-content", { timeout: 60000 }).catch(() => {});
// give the boot probe + ProtectedRoute verdict time to settle
await zpage.waitForTimeout(6000);
const zurl = zpage.url();
check("P1 zombie session NOT bounced to /login", !zurl.includes("/login"), zurl);
const zdoc = await zpage.evaluate(() => document.cookie);
check("P2 probe restored elbaz_auth_flag (self-heal)", zdoc.includes("elbaz_auth_flag=1"), zdoc.slice(0, 120) || "(empty)");
const zcookies = await zombie.cookies(`${BASE}/dashboard`);
check("P3 HttpOnly session cookie still alive", zcookies.some((c) => c.name === "elbaz_auth" && c.value), "elbaz_auth present");
try { await zpage.screenshot({ path: "scripts/shots_session/prod_W7_zombie_heal.png" }); } catch { /* ignore */ }
await zombie.close();

// ── 3. guest control: no cookies → /login (probe rejects exactly once)
const guest = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: FWD });
const gpage = await guest.newPage();
await gpage.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 60000 });
await gpage.waitForSelector("#main-content", { timeout: 60000 }).catch(() => {});
await gpage.waitForTimeout(6000);
check("P4 guest lands on /login", gpage.url().includes("/login"), gpage.url());
try { await gpage.screenshot({ path: "scripts/shots_session/prod_W8_guest.png" }); } catch { /* ignore */ }
await guest.close();

await browser.close();

console.log("\n════════════════════════════════════════");
console.log(failures === 0 ? "RESULT: ALL PROD BROWSER CHECKS PASSED ✓" : `RESULT: ${failures} CHECK(S) FAILED ✗`);
process.exit(failures === 0 ? 0 : 1);
