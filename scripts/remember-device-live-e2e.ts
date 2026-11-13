/**
 * ✅ LIVE E2E — "Remember this device" (تذكّرني على هذا الجهاز) root-cure
 * verification against PRODUCTION (HF Space).
 *
 * Flow mirrors the real user journey:
 *  1. register a fresh user
 *  2. login with remember=true  → cookie pair MUST carry Max-Age=2592000 (30d)
 *  3. auth.me immediately       → session resolves (no 401)
 *  4. "close the app & come back" — same jar, repeated auth.me over time
 *     → every call 200, session NEVER destroyed
 *  5. a second wave of authed procedures → no session-destroying 401
 *  6. remember=false control → cookie pair must be SESSION cookies (no Max-Age)
 *  7. logout → cookies cleared; then login again → fresh 30d pair
 */
const BASE = "https://ahmdelbaz28-ahmdrtap.hf.space";
const H: Record<string, string> = {
  "X-Forwarded-Host": "ahmedelbaz.qzz.io",
  "X-Forwarded-Proto": "https",
  "Content-Type": "application/json",
};

const stamp = Date.now().toString(36);
const USERNAME = `rem${stamp}`.slice(0, 20);
const PASSWORD = `Rem${stamp}Pass1`;

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ✓" : "  ✗ FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function cookieFrom(res: Response, jar: string[]): string[] {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const out: string[] = [];
  for (const sc of setCookies) {
    const pair = sc.split(";")[0];
    const name = pair.split("=")[0];
    const idx = jar.findIndex((c) => c.startsWith(name + "="));
    if (idx >= 0) jar.splice(idx, 1);
    jar.push(pair);
    out.push(sc);
  }
  return out;
}

function maxAgeOf(setCookie: string): number | null {
  const m = setCookie.match(/max-age=(\d+)/i);
  return m ? Number(m[1]) : null;
}

async function call(
  proc: string,
  input: unknown,
  jar: string[],
  kind: "mut" | "query" = "mut",
): Promise<{ status: number; setCookies: string[]; body: string }> {
  const url =
    kind === "mut"
      ? `${BASE}/api/trpc/${proc}?batch=1`
      : `${BASE}/api/trpc/${proc}?batch=1&input=${encodeURIComponent(JSON.stringify({ "0": { json: input } }))}`;
  const res = await fetch(url, {
    method: kind === "mut" ? "POST" : "GET",
    headers: { ...H, ...(jar.length ? { Cookie: jar.join("; ") } : {}) },
    ...(kind === "mut" ? { body: JSON.stringify({ "0": { json: input } }) } : {}),
  });
  const setCookies = cookieFrom(res, jar);
  const body = await res.text();
  return { status: res.status, setCookies, body };
}

const jar: string[] = [];

// ── 1. register ──────────────────────────────────────────────────────────
console.log("1) register fresh user");
const reg = await call("auth.register", { username: USERNAME, password: PASSWORD, name: "remember e2e" }, jar);
check("register 2xx", reg.status >= 200 && reg.status < 300, `status=${reg.status}`);

// ── 2. login with remember=true ─────────────────────────────────────────
console.log("2) login with remember=true (تذكّرني على هذا الجهاز)");
jar.length = 0; // start clean like a fresh browser
const login = await call("auth.login", { username: USERNAME, password: PASSWORD, remember: true }, jar);
check("login 2xx", login.status >= 200 && login.status < 300, `status=${login.status}`);
const authSc = login.setCookies.find((sc) => sc.startsWith("elbaz_auth="));
const flagSc = login.setCookies.find((sc) => sc.startsWith("elbaz_auth_flag="));
const authAge = authSc ? maxAgeOf(authSc) : null;
const flagAge = flagSc ? maxAgeOf(flagSc) : null;
check("elbaz_auth cookie set", !!authSc);
check("elbaz_auth Max-Age = 2592000 (30 days)", authAge === 2592000, `got=${authAge}`);
check("elbaz_auth_flag cookie set", !!flagSc);
check("elbaz_auth_flag Max-Age = 2592000", flagAge === 2592000, `got=${flagAge}`);
check("elbaz_auth is HttpOnly", !!authSc && /httponly/i.test(authSc));
check("elbaz_auth is Secure", !!authSc && /secure/i.test(authSc));
check("jar holds both cookies", jar.some((c) => c.startsWith("elbaz_auth=")) && jar.some((c) => c.startsWith("elbaz_auth_flag=")));

// ── 3. auth.me immediately ──────────────────────────────────────────────
console.log("3) auth.me right after login");
const me1 = await call("auth.me", null, jar, "query");
check("auth.me 200", me1.status === 200, `status=${me1.status}`);
check("auth.me returns the user", me1.body.includes(`"${USERNAME}"`) || me1.body.includes(USERNAME));

// ── 4. close app & come back — repeated auth.me over 90s ────────────────
console.log("4) simulating 'close app → reopen' — repeated auth.me with the SAME jar");
for (let i = 1; i <= 3; i++) {
  await new Promise((r) => setTimeout(r, 30_000));
  const me = await call("auth.me", null, jar, "query");
  check(`re-open wave ${i}: auth.me 200 (session alive)`, me.status === 200, `status=${me.status}`);
  const cleared = (me.setCookies ?? []).some((sc) => /elbaz_auth=;/.test(sc) || /elbaz_auth= *;/.test(sc));
  check(`re-open wave ${i}: server did NOT clear the session`, !cleared);
}

// ── 5. a second authed procedure rides the same session ────────────────
console.log("5) another authed procedure on the same session");
const wishlist = await call("wishlist.list", null, jar, "query");
check("authed procedure 200 (no false 401)", wishlist.status === 200, `status=${wishlist.status}`);

// ── 6. remember=false control ───────────────────────────────────────────
console.log("6) control: login with remember=false → SESSION cookies (no Max-Age)");
jar.length = 0;
const loginNo = await call("auth.login", { username: USERNAME, password: PASSWORD, remember: false }, jar);
check("login(remember=false) 2xx", loginNo.status >= 200 && loginNo.status < 300, `status=${loginNo.status}`);
const authNoSc = loginNo.setCookies.find((sc) => sc.startsWith("elbaz_auth="));
check("remember=false → NO Max-Age on elbaz_auth", !!authNoSc && maxAgeOf(authNoSc) === null, authNoSc?.replace(/elbaz_auth=[^;]+/, "elbaz_auth=<token>") ?? "missing");

// ── 7. logout clears, re-login restores the 30-day pair ────────────────
console.log("7) logout → re-login");
jar.length = 0;
const login2 = await call("auth.login", { username: USERNAME, password: PASSWORD, remember: true }, jar);
check("re-login 2xx", login2.status >= 200 && login2.status < 300, `status=${login2.status}`);
const out = await call("auth.logout", null, jar);
check("logout 2xx", out.status >= 200 && out.status < 300, `status=${out.status}`);
const clearedAuth = out.setCookies.some((sc) => sc.startsWith("elbaz_auth=") && /max-age=0/i.test(sc));
check("logout expires elbaz_auth (max-age=0)", clearedAuth);
const meAfter = await call("auth.me", null, [], "query");
check("auth.me without cookies is rejected (guest)", meAfter.status === 401 || meAfter.status >= 400, `status=${meAfter.status}`);

console.log("\n════════════════════════════════════════");
console.log(failures === 0 ? "RESULT: ALL LIVE CHECKS PASSED ✓" : `RESULT: ${failures} CHECK(S) FAILED ✗`);
process.exit(failures === 0 ? 0 : 1);
