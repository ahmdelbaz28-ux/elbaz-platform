/** Inspect the live reply for the Elsewedy mention context (v3.9.2 check). */
const BASE = "https://ahmdelbaz28-ahmdrtap.hf.space";
const res = await fetch(`${BASE}/api/chatbot/`, {
  method: "POST",
  headers: { "X-Forwarded-Host": "ahmedelbaz.qzz.io", "X-Forwarded-Proto": "https", "Content-Type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", content: "احسب الأحمال حسب الكود السعودي DPS لمصنع به محركات 50 كيلووات وإنارة 10 كيلووات" }], language: "ar", mode: "thinking" }),
  signal: AbortSignal.timeout(170_000),
});
const body = (await res.json()) as { reply?: string };
const reply = body.reply ?? "";
const idx = reply.search(/السويدي|Elsewedy/i);
console.log("match at:", idx);
console.log("context:", idx >= 0 ? reply.slice(Math.max(0, idx - 120), idx + 160).replace(/\n/g, " ") : "—");
console.log("mandatory citation line present:", /\[[^\]]+DPS/i.test(reply));
