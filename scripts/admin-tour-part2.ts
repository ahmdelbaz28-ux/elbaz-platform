/**
 * LIVE ADMIN DASHBOARD TOUR — PART 2 (continuation after the cookie-jar fix).
 *
 * Separate cookie jars: ADMIN jar (dashboard authority) vs PUBLIC jar
 * (probe browser). Exercises the remaining contracts on the live state:
 *
 *   1. admin login
 *   2. queue state (#271 pending, #270 approved-absent, owner's #5 untouched)
 *   3. register a fresh probe with a KNOWN password (part-1 probe passwords
 *      were random and lost) → approve it from the dashboard
 *   4. APPROVED probe login → 200 + httpOnly session cookie (web contract:
 *      token lives in the cookie, never in the body) + auth.me works
 *   5. admin.rejectUser(approved) → the LIVE session dies instantly
 *      (auth.me 401, tokenVersion bump) + fresh login shows APPROVAL_REJECTED
 *   6. admin.reopenApproval → login shows APPROVAL_PENDING
 *   7. final rejects of ALL probe accounts (#270, #271, probe5)
 *   8. dashboard users tab loads; pending queue reduced to the owner's own
 *      account only (deliberately untouched — owner decides on it)
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
const U5 = `gate_probe5_${STAMP}`;
const P5 = `Tour2${STAMP}eE5${Math.random().toString(36).slice(2, 8)}`;

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  const safeDetail = detail.replace(/\p{Cc}+/gu, " ");
  console.log(`${ok ? "  PASS" : "  FAIL"} ${name}${safeDetail ? ` — ${safeDetail}` : ""}`);
  if (!ok) failures++;
}

function makeJar(): { get(): string; absorb(res: Response): void } {
  let jar = "";
  return {
    get: () => jar,
    absorb(res: Response): void {
      const anyHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
      const set = typeof anyHeaders.getSetCookie === "function"
        ? anyHeaders.getSetCookie()
        : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
      for (const c of set) {
        const pair = c.split(";")[0];
        const name = pair.split("=")[0].trim();
        jar = jar
          .split("; ")
          .filter((p) => p && p.split("=")[0].trim() !== name)
          .concat(pair)
          .join("; ");
      }
    },
  };
}

const adminJar = makeJar();
const probeJar = makeJar();

async function trpc(
  proc: string,
  input?: Record<string, unknown>,
  method: "GET" | "POST" = "POST",
  jar?: ReturnType<typeof makeJar>,
): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = { ...H0 };
  const useJar = jar ?? adminJar;
  if (useJar.get()) headers.Cookie = useJar.get();
  let url = `${BASE}/api/trpc/${proc}`;
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(60_000) };
  if (method === "POST") {
    init.body = JSON.stringify(input === undefined ? { json: null } : { json: input });
  } else if (input !== undefined) {
    url += `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  }
  const res = await fetch(url, init);
  useJar.absorb(res);
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
console.log("1) دخول الأدمن (وعاء منفصل)");
const login = await trpc("auth.login", { username: "admin", password: ADMIN_PASS, remember: false });
check("admin login 200", login.status === 200, `status=${login.status} body=${login.body.slice(0, 120)}`);
if (login.status !== 200) process.exit(2);

// ── 2. queue state + fresh probe with a KNOWN password ───────────────────────
console.log("2) حالة الطابور + حساب فحص جديد");
const q = jsonOf((await trpc("admin.pendingApprovals", undefined, "GET", adminJar)).body) as { items?: { id: number; username: string }[]; total?: number };
console.log(`  pending total=${q.total} — ${(q.items ?? []).map((i) => `#${i.id}:${i.username}`).join(", ") || "none"}`);
check("probe4 (#271) still pending", (q.items ?? []).some((i) => i.id === 271));
check("probe3 (#270) NOT in queue (approved)", !(q.items ?? []).some((i) => i.id === 270));
check("owner's #5 AHMEDBAZ still pending (لا نلمسه)", (q.items ?? []).some((i) => i.id === 5));

const reg5 = await trpc("auth.register", { username: U5, password: P5, name: "Admin Tour Probe 5", email: "" });
check("probe5 registered pending", reg5.status === 200 && (jsonOf(reg5.body) as { pendingApproval?: boolean }).pendingApproval === true, `status=${reg5.status}`);
const q0 = jsonOf((await trpc("admin.pendingApprovals", undefined, "GET", adminJar)).body) as { items?: { id: number; username: string }[] };
const id5 = (q0.items ?? []).find((i) => i.username === U5)?.id ?? 0;
check("probe5 visible in dashboard queue", id5 > 0, `id=${id5}`);

const approve5 = await trpc("admin.approveUser", { userId: id5 }, "POST", adminJar);
check("approveUser(probe5) 200", approve5.status === 200 && /approved/.test(approve5.body), `status=${approve5.status} body=${approve5.body.slice(0, 120)}`);

// ── 3. APPROVED probe logs in — web contract: session cookie only ────────────
console.log("3) الحساب المقبول يدخل فعلاً (الكوكي httpOnly هو الجلسة)");
const login3 = await trpc("auth.login", { username: U5, password: P5, remember: false }, "POST", probeJar);
const l3 = jsonOf(login3.body) as { user?: { id: number; username: string; role: string } };
check("approved probe login 200 + user", login3.status === 200 && l3.user?.username === U5 && l3.user?.id === id5, `status=${login3.status} user=${JSON.stringify(l3.user ?? {})}`);
check("session delivered via httpOnly cookie (no token in body)", probeJar.get().includes("elbaz_auth") && !/token/i.test(login3.body), "cookie-only");

// ── 4. the LIVE session works ────────────────────────────────────────────────
console.log("4) الجلسة الحية للمقبول تعمل (auth.me)");
const me1 = await trpc("auth.me", undefined, "GET", probeJar);
const me1u = jsonOf(me1.body) as { username?: string };
check("auth.me 200 for approved probe", me1.status === 200 && me1u.username === U5, `status=${me1.status} me=${me1u.username ?? "?"}`);

// ── 5. admin REJECTS the approved account → live session dies instantly ─────
console.log("5) رفض الأدمن للحساب المقبول → الجلسة الحية تموت فوراً");
const rej = await trpc("admin.rejectUser", { userId: id5 }, "POST", adminJar);
check("rejectUser(approved probe5) 200", rej.status === 200, `status=${rej.status} body=${rej.body.slice(0, 120)}`);
const me2 = await trpc("auth.me", undefined, "GET", probeJar);
check("live session REVOKED (auth.me 401)", me2.status === 401, `status=${me2.status}`);
const login3b = await trpc("auth.login", { username: U5, password: P5, remember: false }, "POST", probeJar);
check("fresh login → 401 APPROVAL_REJECTED", login3b.status === 401 && /APPROVAL_REJECTED/.test(login3b.body), `status=${login3b.status}`);

// ── 6. reopen → pending again ────────────────────────────────────────────────
console.log("6) إعادة الفتح للطابور");
const reopen = await trpc("admin.reopenApproval", { userId: id5 }, "POST", adminJar);
check("reopenApproval 200", reopen.status === 200, `status=${reopen.status} body=${reopen.body.slice(0, 120)}`);
const login3c = await trpc("auth.login", { username: U5, password: P5, remember: false }, "POST", probeJar);
check("reopened → 401 APPROVAL_PENDING", login3c.status === 401 && /APPROVAL_PENDING/.test(login3c.body), `status=${login3c.status}`);

// ── 7. final cleanup rejects ─────────────────────────────────────────────────
console.log("7) التنظيف النهائي — رفض كل حسابات الفحص");
const fr270 = await trpc("admin.rejectUser", { userId: 270 }, "POST", adminJar); // leftover approved from part 1
const fr271 = await trpc("admin.rejectUser", { userId: 271 }, "POST", adminJar);
const fr272 = await trpc("admin.rejectUser", { userId: id5 }, "POST", adminJar); // probe5 final
check("final reject #270 200", fr270.status === 200, `status=${fr270.status}`);
check("final reject #271 200", fr271.status === 200, `status=${fr271.status}`);
check(`final reject probe5 (#${id5}) 200`, fr272.status === 200, `status=${fr272.status}`);

// ── 8. dashboard state ───────────────────────────────────────────────────────
console.log("8) حالة الداش بورد النهائية");
const usersList = await trpc("admin.users", { page: 1, limit: 100 }, "GET", adminJar);
const udata = jsonOf(usersList.body) as { items?: { username: string }[] };
check("dashboard users tab loads", usersList.status === 200 && (udata.items ?? []).length > 0, `count=${(udata.items ?? []).length}`);
const qf = jsonOf((await trpc("admin.pendingApprovals", undefined, "GET", adminJar)).body) as { items?: { id: number; username: string }[]; total?: number };
console.log(`  pending final total=${qf.total} — ${(qf.items ?? []).map((i) => `#${i.id}:${i.username}`).join(", ") || "none"}`);
check("only the owner's own account (#5) remains pending", qf.total === 1 && (qf.items ?? []).every((i) => i.id === 5), `total=${qf.total}`);

// ── summary ──────────────────────────────────────────────────────────────────
console.log("");
if (failures === 0) {
  console.log("ADMIN TOUR PART 2 COMPLETE — كل عقود الداش بورد والبوابة والجلسة ثابتة على الإنتاج");
  process.exit(0);
} else {
  console.log(`${failures} FAILURES`);
  process.exit(1);
}
