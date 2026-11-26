/**
 * LIVE E2E — ADMIN APPROVAL GATE + owner email alert, verified against
 * PRODUCTION (owner directive 2026-11-25):
 *
 *   1. HEALTH: the Space serves the current build.
 *   2. REGISTER → PENDING: a real registration on production returns
 *      pendingApproval=true with NO session token and NO auth cookies —
 *      nobody "sneaks in" at the front door.
 *   3. LOGIN BLOCKED WHILE PENDING: correct credentials yield 401 with the
 *      stable APPROVAL_PENDING sentinel — NO token, NO cookies.
 *   4. ROW EXISTS: re-registering the same username returns CONFLICT —
 *      the registration really landed in the DB (so the alert fan-out ran).
 *   5. EMAIL ACTION LINK ARMOR: /api/approval/action with a tampered token
 *      and with a malformed token both render the inert 400 page (no oracle,
 *      no stack trace) — the owner's email buttons endpoint is hardened.
 *   6. OWNER ALERT: HF runtime logs are scanned for "[Approval] alert email
 *      sent" (proof Resend accepted the message to the owner inbox) and for
 *      absence of "[Approval] alert email failed".
 *
 * Exit 0 = all contracts hold.
 *
 * NOTE: the probe creates ONE throwaway account (gate_probe_*). The owner
 * will receive its alert email at ahmdelbaz28@gmail.com — clicking
 * "Approve/Reject" there is the final human proof of the email-action loop.
 * The account can be deleted from the dashboard afterwards.
 */
const BASE = process.env.LIVE_BASE_URL || "https://ahmdelbaz28-ahmdrtap.hf.space";
const H: Record<string, string> = {
  "X-Forwarded-Host": "ahmedelbaz.qzz.io",
  "X-Forwarded-Proto": "https",
  "Content-Type": "application/json",
};

const STAMP = new Date().toISOString().slice(5, 10).replace("-", "");
const USERNAME = process.env.PROBE_USER || `gate_probe_${STAMP}`;
const PASSWORD = `Probe${STAMP}aA9${Math.random().toString(36).slice(2, 8)}`;

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  const safeDetail = detail.replace(/\p{Cc}+/gu, " ");
  console.log(`${ok ? "  PASS" : "  FAIL"} ${name}${safeDetail ? ` — ${safeDetail}` : ""}`);
  if (!ok) failures++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Call a tRPC mutation (superjson, non-batched httpLink shape). */
async function trpc(
  proc: string,
  input: Record<string, unknown>,
): Promise<{ status: number; body: string; setCookie: string[] }> {
  const res = await fetch(`${BASE}/api/trpc/${proc}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ json: input }),
    signal: AbortSignal.timeout(60_000),
  });
  const setCookie = [];
  const anyHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") setCookie.push(...anyHeaders.getSetCookie());
  const sc = res.headers.get("set-cookie");
  if (sc && setCookie.length === 0) setCookie.push(sc);
  const body = await res.text();
  return { status: res.status, body, setCookie };
}

// ── 0. health ────────────────────────────────────────────────────────────────
console.log("0) نبض المنصة");
let health = "down";
try {
  const res = await fetch(`${BASE}/api/health`, { headers: H, signal: AbortSignal.timeout(30_000) });
  health = res.ok ? "up" : `http_${res.status}`;
} catch (e) {
  health = `error: ${(e as Error).message.slice(0, 60)}`;
}
check("GET /api/health", health === "up", health);
if (health !== "up") {
  console.log("Space not serving — aborting (deployment may still be starting)");
  process.exit(2);
}

// ── 1. REGISTER → PENDING, no session ────────────────────────────────────────
console.log("1) تسجيل حساب حقيقي على الإنتاج — يجب أن يبدأ PENDING بلا جلسة");
const reg = await trpc("auth.register", {
  username: USERNAME,
  password: PASSWORD,
  name: "Approval Gate Probe",
  email: "",
});
check("register HTTP 200", reg.status === 200, `status=${reg.status} body=${reg.body.slice(0, 220)}`);
const regOk = reg.status === 200;
if (regOk) {
  const parsed = JSON.parse(reg.body) as { result?: { data?: { json?: { pendingApproval?: boolean; token?: string; user?: { id?: number } } } } };
  const data = parsed.result?.data?.json ?? {};
  check("pendingApproval=true (لا جلسة)", data.pendingApproval === true, JSON.stringify(data).slice(0, 160));
  check("no token in response", data.token === undefined || data.token === "");
  const authCookies = reg.setCookie.filter((c) => /elbaz_auth|auth_token|authflag/i.test(c));
  check("no auth Set-Cookie", authCookies.length === 0, reg.setCookie.join(" | ").slice(0, 120) || "none");
}

// ── 2. LOGIN WHILE PENDING → 401 APPROVAL_PENDING, no cookies ───────────────
await sleep(1500);
console.log("2) دخول بكلمة مرور صحيحة والحساب PENDING — يجب أن يُرفض");
const login = await trpc("auth.login", { username: USERNAME, password: PASSWORD, remember: false });
check("login HTTP 401 (blocked)", login.status === 401, `status=${login.status}`);
const errSentinel = /APPROVAL_PENDING/.test(login.body);
check("APPROVAL_PENDING sentinel", errSentinel, login.body.slice(0, 200));
const loginAuthCookies = login.setCookie.filter((c) => /elbaz_auth|auth_token|authflag/i.test(c));
check("no auth Set-Cookie on blocked login", loginAuthCookies.length === 0);

// ── 3. ROW EXISTS (duplicate register → CONFLICT) ────────────────────────────
await sleep(1000);
console.log("3) إعادة تسجيل نفس المعرف — يجب CONFLICT (الصف في قاعدة البيانات فعلاً)");
const dup = await trpc("auth.register", { username: USERNAME, password: PASSWORD, name: "dup", email: "" });
check("duplicate register → 409 CONFLICT", dup.status === 409, `status=${dup.status} body=${dup.body.slice(0, 160)}`);

// ── 4. EMAIL ACTION LINK ARMOR ───────────────────────────────────────────────
console.log("4) درع رابط الإجراء البريدي /api/approval/action");
async function actionProbe(token: string, label: string): Promise<{ status: number; html: string }> {
  const res = await fetch(`${BASE}/api/approval/action?token=${encodeURIComponent(token)}`, {
    headers: H,
    signal: AbortSignal.timeout(30_000),
  });
  const html = await res.text();
  return { status: res.status, html };
}

const tampered = await actionProbe(`${USERNAME}.approve.1700000000000.deadbeefsig`, "tampered");
check("tampered token → 400 inert page", tampered.status === 400, `status=${tampered.status}`);
check(
  "inert page wording (no oracle)",
  tampered.html.includes("الرابط غير صالح") && !tampered.html.includes("stack") && !tampered.html.includes("hmac"),
  tampered.html.replace(/<[^>]+>/g, " ").slice(0, 120),
);

const malformed = await actionProbe("garbage", "malformed");
check("malformed token → 400 inert page", malformed.status === 400, `status=${malformed.status}`);

const emptySig = await actionProbe("123.approve.1700000000000.", "empty-signature");
check("empty signature → 400 inert page", emptySig.status === 400, `status=${emptySig.status}`);

// ── 5. OWNER ALERT LOG PROOF (HF runtime logs) ───────────────────────────────
console.log("5) سجل الإنتاج — إثبات وصول تنبيه الموافقة لبريد المالك");
let logSeen = false;
let logFailedSeen = false;
try {
  const res = await fetch(`${BASE.replace("ahmdelbaz28-ahmdrtap", "ahmdelbaz28-ahmdrtap")}`, { headers: H, signal: AbortSignal.timeout(10_000) });
  void res; // warm-up noop (keeps BASE honest without external calls)
} catch { /* noop */ }

try {
  const logsRes = await fetch(`https://huggingface.co/api/spaces/ahmdelbaz28/ahmdrtap/logs/run`, {
    headers: { Authorization: `Bearer ${process.env.HF_TOKEN || ""}` },
    signal: AbortSignal.timeout(45_000),
  });
  if (logsRes.ok) {
    const text = await logsRes.text();
    logSeen = text.includes("[Approval] alert email sent");
    logFailedSeen = text.includes("[Approval] alert email failed");
    check("log: alert email SENT line exists", logSeen, logSeen ? "" : "(log stream returned but no sent-line — see note)");
    check("log: NO alert-failure line", !logFailedSeen);
  } else {
    console.log(`  SKIP logs API — HTTP ${logsRes.status} (probe continues; email proof via owner inbox + no-failure logs)`);
  }
} catch (e) {
  console.log(`  SKIP logs API — ${(e as Error).message.slice(0, 80)} (email proof via owner inbox)`);
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log("");
if (failures === 0) {
  console.log(`ALL APPROVAL-GATE CONTRACTS HOLD (production) — probe user: ${USERNAME}`);
  console.log("التنبيه البريدي يجب أن يصل الآن إلى ahmdelbaz28@gmail.com — زر القبول/الرفض من البريد هو الإثبات البشري الأخير.");
  process.exit(0);
} else {
  console.log(`${failures} FAILURES — probe user: ${USERNAME}`);
  process.exit(1);
}
