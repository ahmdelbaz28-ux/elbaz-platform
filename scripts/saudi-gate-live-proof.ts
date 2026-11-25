/** LIVE — v3.9.2 cross-domain suppression on production: a Saudi-DPS load
 *  question must cite the Saudi source and must NOT cite Elsewedy/EgyCode. */
export {}; // module marker — top-level await below

const BASE = "https://ahmdelbaz28-ahmdrtap.hf.space";
const H: Record<string, string> = {
  "X-Forwarded-Host": "ahmedelbaz.qzz.io",
  "X-Forwarded-Proto": "https",
  "Content-Type": "application/json",
};

// Manual ad-hoc tool: set PROBE_USER/PROBE_PASSWORD in the environment
// (the chatbot now requires a session — owner directive 2026-11-25).
const USER = process.env.PROBE_USER || "";
const PASS = process.env.PROBE_PASSWORD || "";
if (!USER || !PASS) {
  console.error("set PROBE_USER/PROBE_PASSWORD first (the chatbot requires a session)");
  process.exit(2);
}
const login = await fetch(`${BASE}/api/trpc/auth.login`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ json: { username: USER, password: PASS, remember: false } }),
  signal: AbortSignal.timeout(60_000),
});
if (login.status !== 200) {
  console.error(`probe login failed: HTTP ${login.status}`);
  process.exit(1);
}
const jar: string[] = [];
const anyHeaders = login.headers as unknown as { getSetCookie?: () => string[] };
if (typeof anyHeaders.getSetCookie === "function") jar.push(...anyHeaders.getSetCookie());
H["Cookie"] = jar.map((c) => c.split(";")[0]).join("; ");

const res = await fetch(`${BASE}/api/chatbot/`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    messages: [{ role: "user", content: "احسب الأحمال حسب الكود السعودي DPS لمصنع به محركات 50 كيلووات وإنارة 10 كيلووات" }],
    language: "ar",
    mode: "thinking",
  }),
  signal: AbortSignal.timeout(170_000),
});
const body = (await res.json()) as { success?: boolean; reply?: string };
const reply = (body.reply ?? "").replace(/\s+/g, " ");
console.log(`status=${res.status} len=${reply.length}`);
console.log(`saudi/DPS citation present: ${/DPS|السعودي/i.test(reply)}`);
console.log(`no elsewedy citation: ${!/السويدي|Elsewedy/i.test(reply)}`);
console.log(`no egy-code citation: ${!/الكود المصري|الدليل الإرشادي/i.test(reply)}`);
console.log(`no file offer: ${!/(هل تريد|أستطيع)\s*(أن)?\s*(أعمل|أجهز)?[^.؟]{0,30}(ملف|PDF|تقرير)/i.test(reply)}`);
console.log(`reply: ${reply.slice(0, 400)}`);
