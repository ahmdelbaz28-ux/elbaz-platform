/**
 * LIVE ADMIN DASHBOARD TOUR — production (owner directive 2026-11-25).
 *
 * Logs in as the seeded `admin` account (password delivered via the
 * ADMIN_RECOVERY lever, restored right after by the operator) and exercises
 * the EXACT tRPC procedures the dashboard buttons call:
 *
 *   1. auth.login as admin
 *   2. admin.pendingApprovals — the live queue (2 earlier probes expected)
 *   3. cleanup-reject the two earlier probes (password-unknown leftovers)
 *   4. register 2 fresh probes with KNOWN passwords (they enter the queue)
 *   5. admin.resendApprovalEmail — re-fires the owner alert email (Resend)
 *   6. admin.approveUser → the approved probe CAN log in (full loop proof)
 *   7. admin.rejectUser → the rejected probe gets APPROVAL_REJECTED
 *   8. reject the APPROVED probe — the owner's "pull access at any time" power
 *   9. admin.reopenApproval → back in queue → APPROVAL_PENDING → final reject
 *  10. admin.users + final empty pending queue
 *
 * Exit 0 = every contract held.
 */
const BASE = "https://ahmdelbaz28-ahmdrtap.hf.space";
const H0: Record<string, string> = {
  "X-Forwarded-Host": "ahmedelbaz.qzz.io",
  "X-Forwarded-Proto": "https",
  "Content-Type": "application/json",
};

const ADMIN_PASS = process.env.ADMIN_PASS || "";
if (!ADMIN_PASS) {
  console.log("ADMIN_PASS env required");
  process.exit(2);
}
const STAMP = new Date().toISOString().slice(5, 10).replace("-", "");
const U3 = `gate_probe3_${STAMP}`;
const U4 = `gate_probe4_${STAMP}`;
const P3 = `Tour${STAMP}cC7${Math.random().toString(36).slice(2, 8)}`;
const P4 = `Tour${STAMP}dD6${Math.random().toString(36).slice(2, 8)}`;

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  const safeDetail = detail.replace(/\p{Cc}+/gu, " ");
  console.log(`${ok ? "  PASS" : "  FAIL"} ${name}${safeDetail ? ` — ${safeDetail}` : ""}`);
  if (!ok) failures++;
}

let cookieJar = "";
function absorbCookies(res: Response): void {
  const anyHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  const set = typeof anyHeaders.getSetCookie === "function" ? anyHeaders.getSetCookie() : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
  for (const c of set) {
    const pair = c.split(";")[0];
    const name = pair.split("=")[0].trim();
    cookieJar = cookieJar
      .split("; ")
      .filter((p) => p && p.split("=")[0].trim() !== name)
      .concat(pair)
      .join("; ");
  }
}

async function trpc(
  proc: string,
  input?: Record<string, unknown>,
  method: "GET" | "POST" = "POST",
): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = { ...H0 };
  if (cookieJar) headers.Cookie = cookieJar;
  let url = `${BASE}/api/trpc/${proc}`;
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(60_000) };
  if (method === "POST") {
    init.body = JSON.stringify(input === undefined ? { json: null } : { json: input });
  } else if (input !== undefined) {
    url += `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  }
  const res = await fetch(url, init);
  absorbCookies(res);
  const body = await res.text();
  return { status: res.status, body };
}

const jsonOf = (body: string): Record<string, unknown> => {
  try {
    return (JSON.parse(body) as { result?: { data?: { json?: Record<string, unknown> } } }).result?.data?.json ?? {};
  } catch {
    return {};
  }
};

// ── 1. admin login ───────────────────────────────────────────────────────────
console.log("1) دخول الأدمن على الإنتاج");
const login = await trpc("auth.login", { username: "admin", password: ADMIN_PASS, remember: false });
check("admin login 200 + user payload", login.status === 200 && /"username":"admin"/.test(login.body), `status=${login.status} body=${login.body.slice(0, 140)}`);
if (login.status !== 200) process.exit(2);
check("auth cookie jar has elbaz_auth", cookieJar.includes("elbaz_auth"));

// ── 2. the live pending queue ────────────────────────────────────────────────
console.log("2) طابور الموافقات (الداش بورد)");
const q1 = jsonOf((await trpc("admin.pendingApprovals", undefined, "GET")).body) as { items?: { id: number; username: string }[]; total?: number };
console.log(`  pending total=${q1.total} — ${(q1.items ?? []).map((i) => `#${i.id}:${i.username}`).join(", ") || "none"}`);
const findId = (u: string) => (q1.items ?? []).find((i) => i.username === u)?.id;
check("earlier probe gate_probe_1124 (#268) in queue", findId("gate_probe_1124") === 268);
check("earlier probe gate_probe2_1124 (#269) in queue", findId("gate_probe2_1124") === 269);

// ── 3. cleanup: reject the two earlier probes ────────────────────────────────
console.log("3) تنظيف الحسابين القدامى (رفض نهائي)");
const r268 = await trpc("admin.rejectUser", { userId: 268 });
const r269 = await trpc("admin.rejectUser", { userId: 269 });
check("reject #268 200", r268.status === 200, `status=${r268.status}`);
check("reject #269 200", r269.status === 200, `status=${r269.status}`);

// ── 4. two fresh probes with KNOWN passwords join the queue ──────────────────
console.log("4) تسجيل حسابين جديدين بكلمات مرور معروفة");
const reg3 = await trpc("auth.register", { username: U3, password: P3, name: "Admin Tour Probe 3", email: "" });
const reg4 = await trpc("auth.register", { username: U4, password: P4, name: "Admin Tour Probe 4", email: "" });
check(`${U3} registered pending`, reg3.status === 200 && (jsonOf(reg3.body) as { pendingApproval?: boolean }).pendingApproval === true, `status=${reg3.status}`);
check(`${U4} registered pending`, reg4.status === 200 && (jsonOf(reg4.body) as { pendingApproval?: boolean }).pendingApproval === true, `status=${reg4.status}`);
const q2 = jsonOf((await trpc("admin.pendingApprovals", undefined, "GET")).body) as { items?: { id: number; username: string }[] };
const id3 = (q2.items ?? []).find((i) => i.username === U3)?.id ?? 0;
const id4 = (q2.items ?? []).find((i) => i.username === U4)?.id ?? 0;
check("both fresh probes visible in dashboard queue", id3 > 0 && id4 > 0, `id3=${id3} id4=${id4}`);
check("no session on register (no cookies)", !cookieJar.includes("elbaz_auth"), cookieJar ? cookieJar.slice(0, 60) : "clean");

// ── 5. resend the owner alert email ──────────────────────────────────────────
console.log("5) إعادة إرسال بريد التنبيه للمالك");
const resend = await trpc("admin.resendApprovalEmail", { userId: id4 });
check("resendApprovalEmail 200", resend.status === 200, `status=${resend.status} body=${resend.body.slice(0, 140)}`);

// ── 6. APPROVE probe3 → it CAN log in now ────────────────────────────────────
console.log("6) قبول الحساب الجديد من الداش بورد ثم الدخول به");
const approve = await trpc("admin.approveUser", { userId: id3 });
check("approveUser 200", approve.status === 200 && /approved/.test(approve.body), `status=${approve.status} body=${approve.body.slice(0, 140)}`);
const login3 = await trpc("auth.login", { username: U3, password: P3, remember: false });
check("APPROVED probe CAN login (200 + session)", login3.status === 200 && /"token"/.test(login3.body), `status=${login3.status}`);

// ── 7. REJECT probe4 → APPROVAL_REJECTED sentinel ────────────────────────────
console.log("7) رفض الحساب الآخر ثم الدخول به");
const reject4 = await trpc("admin.rejectUser", { userId: id4 });
check("rejectUser 200", reject4.status === 200, `status=${reject4.status}`);
const login4 = await trpc("auth.login", { username: U4, password: P4, remember: false });
check("REJECTED probe blocked (401 APPROVAL_REJECTED)", login4.status === 401 && /APPROVAL_REJECTED/.test(login4.body), `status=${login4.status}`);

// ── 8. pull access from the APPROVED probe (reject an approved account) ──────
console.log("8) سحب الوصول من الحساب المقبول (الرفض بعد القبول)");
const rejectApproved = await trpc("admin.rejectUser", { userId: id3 });
check("rejectUser(approved) 200", rejectApproved.status === 200, `status=${rejectApproved.status}`);
const login3b = await trpc("auth.login", { username: U3, password: P3, remember: false });
check("pulled-access probe blocked (401 APPROVAL_REJECTED)", login3b.status === 401 && /APPROVAL_REJECTED/.test(login3b.body), `status=${login3b.status}`);

// ── 9. reopen → pending again → final reject ─────────────────────────────────
console.log("9) إعادة الفتح للطابور ثم الرفض النهائي");
const reopen = await trpc("admin.reopenApproval", { userId: id3 });
check("reopenApproval 200", reopen.status === 200, `status=${reopen.status}`);
const login3c = await trpc("auth.login", { username: U3, password: P3, remember: false });
check("REOPENED probe blocked (401 APPROVAL_PENDING)", login3c.status === 401 && /APPROVAL_PENDING/.test(login3c.body), `status=${login3c.status}`);
const finalReject = await trpc("admin.rejectUser", { userId: id3 });
check("final reject 200", finalReject.status === 200, `status=${finalReject.status}`);

// ── 10. final state: users list loads, pending queue is EMPTY ────────────────
console.log("10) الحالة النهائية — الطابور فارغ وسجل المستخدمين يعمل");
const usersList = await trpc("admin.users", { page: 1, limit: 100 }, "GET");
const udata = jsonOf(usersList.body) as { items?: { username: string }[] };
check("dashboard users tab loads", usersList.status === 200 && (udata.items ?? []).length > 0, `count=${(udata.items ?? []).length}`);
const qf = jsonOf((await trpc("admin.pendingApprovals", undefined, "GET")).body) as { items?: unknown[]; total?: number };
check("pending queue EMPTY (كل الطلبات انحسمت)", qf.total === 0 && (qf.items ?? []).length === 0, `total=${qf.total}`);

// ── summary ──────────────────────────────────────────────────────────────────
console.log("");
if (failures === 0) {
  console.log("ADMIN TOUR COMPLETE — كل عقود الداش بورد والبوابة ثابتة على الإنتاج");
  process.exit(0);
} else {
  console.log(`${failures} FAILURES`);
  process.exit(1);
}
