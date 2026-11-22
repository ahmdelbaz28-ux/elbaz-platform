// Verify admin login on PRODUCTION via tRPC over the origin proxy.
// Uses httpOnly cookie from set-cookie, then probes auth.me.
const BASE = process.env.BASE || "http://localhost:4174";
const USER = process.argv[2] || "admin";
const PASS = process.argv[3] || "";
// Log-injection sanitizer: strip CR/LF from upstream-derived values.
const safe = (v) => String(v ?? "").replace(/[\r\n]+/g, " ");

async function trpcCall(procedure, body, cookie) {
  const res = await fetch(`${BASE}/api/trpc/${procedure}?batch=1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ "0": { json: null, ...body } }),
  });
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const text = await res.text();
  return { status: res.status, setCookies, text };
}

const login = await trpcCall("auth.login", {
  json: { username: USER, password: PASS, remember: true },
});
console.log("login status:", safe(login.status));
// collect the auth cookie
const authCookie = login.setCookies.map((c) => c.split(";")[0]).filter((c) => c.length > 20);
console.log("cookies received:", safe(login.setCookies.length), "| auth-ish:", safe(authCookie.map((c) => c.split("=")[0]).join(",")));

if (login.status !== 200) {
  console.log("login body:", safe(login.text.slice(0, 300)));
  process.exit(1);
}
const data = JSON.parse(login.text);
const result0 = data?.[0]?.result?.data?.json ?? data?.[0]?.result?.data;
console.log("login result:", safe(JSON.stringify(result0)?.slice(0, 220)));

// auth.me with the session cookie
const me = await trpcCall("auth.me", {}, authCookie.join("; "));
console.log("auth.me status:", safe(me.status));
if (me.status === 200) {
  const meData = JSON.parse(me.text);
  console.log("me:", safe(JSON.stringify(meData?.[0]?.result?.data?.json ?? meData?.[0]?.result?.data)?.slice(0, 200)));
}
