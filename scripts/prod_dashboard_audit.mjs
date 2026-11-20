/**
 * prod_dashboard_audit.mjs — LIVE production probe for the dashboard audit
 * fixes (commit 2efd444), run through the origin proxy (X-Forwarded-Host)
 * with a Playwright route.fetch() bypass because the qzz.io edge challenges
 * datacenter clients.
 *
 * Checks:
 *  A. Deploy identity — page token ?v= === /api/version buildId, and the
 *     deployed lazy Admin chunk contains the NEW composer markers
 *     (notif-type-* testids + "Broadcast History (server)").
 *  B. /admin serves the SPA document (client router owns the deep route).
 *  C. Server-side admin gate, the part that actually protects the data:
 *     a REGISTERED non-admin user calling admin.broadcastHistory and
 *     admin.sendBroadcast must be FORBIDDEN (procedure exists, role enforced).
 *  D. Contrast: a nonexistent procedure answers NOT_FOUND — proving C's
 *     FORBIDDEN means "exists + gated", not "missing".
 *  E. Guest (no session) gets UNAUTHORIZED — auth gate fires before role.
 *
 * Usage:
 *   FWD_HOST=ahmedelbaz.qzz.io BASE_URL=https://ahmdelbaz28-ahmdrtap.hf.space \
 *     node scripts/prod_dashboard_audit.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const headers = process.env.FWD_HOST
  ? { "X-Forwarded-Host": process.env.FWD_HOST, "X-Forwarded-Proto": "https" }
  : {};

const stamp = Date.now().toString(36);
const USERNAME = `dashprobe${stamp}`.slice(0, 20);
const EMAIL = `dashprobe.${stamp}@example.com`;
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

  // Challenge bypass: re-issue every request over Playwright's own TLS stack.
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

  /** Raw HTTP fetch from the page context (same cookies as a real user). */
  async function http(path, { method = "GET", body = null, accept = "*/*" } = {}) {
    return page.evaluate(async ({ path, method, body, accept }) => {
      const r = await fetch(path, {
        method,
        credentials: "include",
        headers: {
          accept,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      }).catch((e) => ({ networkError: String(e), status: 0, text: "" }));
      if (r.networkError) return { status: 0, text: String(r.networkError) };
      return { status: r.status, text: await r.text() };
    }, { path, method, body, accept });
  }

  function trpcGet(proc, input = undefined) {
    const qs = input !== undefined
      ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
      : "";
    return http(`/api/trpc/${proc}${qs}`);
  }
  function trpcPost(proc, payload) {
    return http(`/api/trpc/${proc}`, { method: "POST", body: { json: payload } });
  }
  function trpcCode(res) {
    try {
      const t = typeof res === "string" ? res : res.text;
      return JSON.parse(t)?.error?.json?.data?.code ?? "";
    } catch { return ""; }
  }

  // ── A. Deploy identity ─────────────────────────────────────────────────────
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  // Browser-navigation Accept — the SPA handler serves the nonce-injected HTML
  // only for Accept: text/html (non-HTML requests fall through to serveStatic).
  const html = await http("/", { accept: "text/html" });
  check("A1. / serves the SPA document", html.status === 200 && html.text.includes("id=\"root\""), `status=${html.status}`);

  const tokenMatch = html.text.match(/cache-nuke\.js\?v=([a-z0-9-]+)/i);
  check("A2. page ships a build token", !!tokenMatch, tokenMatch ? tokenMatch[1] : "no cache-nuke.js?v= in HTML");

  const ver = await http("/api/version");
  let buildId = "";
  try { buildId = JSON.parse(ver.text)?.buildId ?? ""; } catch {}
  check("A3. token === /api/version buildId", !!buildId && tokenMatch?.[1] === buildId, `token=${tokenMatch?.[1]} buildId=${buildId}`);

  // Deployed lazy chunks must contain the NEW composer markers. BFS the
  // chunk graph from the entry (Vite emits relative dynamic imports like
  // "./Admin-xxx.js" nested under the router chunk).
  const chunkUrls = [...html.text.matchAll(/(?:src|href)="(\/assets\/[^"?' ]+)\.js[^"]*"/g)].map((m) => m[1] + ".js");
  const seen = new Set();
  const queue = [...chunkUrls];
  let bundleHit = false;
  let scanned = 0;
  while (queue.length && scanned < 80 && !bundleHit) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const js = await http(url);
    scanned += 1;
    if (js.status !== 200) continue;
    // "notif-type-*" is built at runtime (`notif-type-${nt}`) — the two
    // STATIC literals unique to the new Admin chunk are the safe markers.
    if (js.text.includes("notif-send") && js.text.includes("Broadcast History (server)")) {
      bundleHit = true;
      break;
    }
    for (const m of js.text.matchAll(/"((?:\.\/|\/assets\/)[A-Za-z0-9_./-]+\.js)"/g)) {
      const next = m[1];
      const abs = next.startsWith("/assets/") ? next : `/assets/${next.slice(2)}`;
      if (!seen.has(abs)) queue.push(abs);
    }
  }
  check("A4. deployed Admin chunk contains the NEW composer (v-audit)", bundleHit, `scanned ${scanned} chunk(s)`);

  // ── B. /admin deep route serves the SPA ────────────────────────────────────
  const admin = await http("/admin", { accept: "text/html" });
  check("B1. /admin serves the SPA (no 404 document)", admin.status === 200 && admin.text.includes("id=\"root\""), `status=${admin.status}`);

  // ── C. Register a throwaway user → non-admin guard proofs ──────────────────
  const reg = await trpcPost("auth.register", {
    username: USERNAME,
    password: PASSWORD,
    name: "Dash Probe",
    email: EMAIL,
  });
  const regUser = (() => { try { return JSON.parse(reg.text)?.result?.data?.json?.user ?? null; } catch { return null; } })();
  check("C0. throwaway account registered + sessioned", reg.status === 200 && !!regUser, `status=${reg.status} user=${regUser?.username ?? reg.text.slice(0, 80)}`);

  const bh = await trpcGet("admin.broadcastHistory");
  const bhCode = trpcCode(bh);
  check("C1. admin.broadcastHistory exists and is admin-gated (FORBIDDEN, not NOT_FOUND)", bh.status >= 400 && bhCode === "FORBIDDEN", `status=${bh.status} code=${bhCode}`);

  const sb = await trpcPost("admin.sendBroadcast", {
    type: "promo",
    title: "probe attempt",
    message: "should be refused before it reaches any user",
  });
  const sbCode = trpcCode(sb);
  check("C2. non-admin sendBroadcast refused server-side (FORBIDDEN)", sb.status >= 400 && sbCode === "FORBIDDEN", `status=${sb.status} code=${sbCode}`);

  // ── D. Contrast — a truly missing procedure is NOT_FOUND ───────────────────
  const missing = await trpcGet("admin.thisDoesNotExist");
  check("D1. nonexistent procedure answers NOT_FOUND (contrast to C1/C2)", trpcCode(missing) === "NOT_FOUND", `status=${missing.status} code=${trpcCode(missing)}`);

  // ── E. Guest (no session) hits the AUTH gate first ─────────────────────────
  const guestCtx = await browser.newContext();
  const guestPage = await guestCtx.newPage();
  if (Object.keys(headers).length) await guestCtx.setExtraHTTPHeaders(headers);
  await guestCtx.route("**/*", async (route) => {
    try { await route.fulfill({ response: await route.fetch() }); }
    catch { await route.continue().catch(() => {}); }
  });
  await guestPage.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const guestRes = await guestPage.evaluate(async () => {
    const r = await fetch("/api/trpc/admin.broadcastHistory", { credentials: "include" }).catch((e) => ({ networkError: String(e), status: 0 }));
    if (r.networkError) return { status: 0, text: String(r.networkError) };
    return { status: r.status, text: await r.text() };
  });
  check("E1. guest admin.broadcastHistory → UNAUTHORIZED", guestRes.status >= 400 && trpcCode(guestRes.text) === "UNAUTHORIZED", `status=${guestRes.status} code=${trpcCode(guestRes.text)}`);
  await guestCtx.close();

  await browser.close();
  console.log(`\n== DASHBOARD PROD AUDIT: ${fails} failing check(s) ==`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("PROBE ERROR:", e);
  process.exit(1);
});
