/** LIVE — v3.9.2 cross-domain suppression on production: a Saudi-DPS load
 *  question must cite the Saudi source and must NOT cite Elsewedy/EgyCode. */
const BASE = "https://ahmdelbaz28-ahmdrtap.hf.space";
const H: Record<string, string> = {
  "X-Forwarded-Host": "ahmedelbaz.qzz.io",
  "X-Forwarded-Proto": "https",
  "Content-Type": "application/json",
};

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
