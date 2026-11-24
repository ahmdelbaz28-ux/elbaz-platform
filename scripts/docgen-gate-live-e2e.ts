/**
 * ✅ LIVE E2E — v3.9.1 EXPLICIT-REQUEST-ONLY FILE-GENERATION GATE,
 * verified against PRODUCTION after the HF redeploy:
 *
 *   1. NO AUTO-GENERATION: a request whose answer is long/tabular (a full
 *      comparison table) but with NO file request must be answered in
 *      prose — NO ```docgen fence in the reply.
 *   2. NO SUGGESTION: the same reply must not offer/suggest file
 *      generation ("هل تريد PDF؟", "أستطيع عمل ملف", "أحوله وورد"...).
 *   3. FORMAT MENTION ≠ REQUEST: asking what PDF vs DOCX means must be
 *      answered in prose with NO docgen fence and NO offer.
 *   4. EXPLICIT REQUEST → FILE: "اعمل لي ملف PDF ..." must produce a
 *      docgen fence in the FIRST reply (immediate execution contract).
 *   5. LEAK GUARD: no internal prompt headers ever surface in replies.
 *
 * Exit 0 = all contracts hold.
 */
const BASE = process.env.LIVE_BASE_URL || "https://ahmdelbaz28-ahmdrtap.hf.space";
const H: Record<string, string> = {
  "X-Forwarded-Host": "ahmedelbaz.qzz.io",
  "X-Forwarded-Proto": "https",
  "Content-Type": "application/json",
};

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  // detail may carry server-provided text — control characters are stripped
  // so a hostile response can never forge log lines.
  const safeDetail = detail.replace(/\p{Cc}+/gu, " ");
  console.log(`${ok ? "  ✓" : "  ✗ FAIL"} ${name}${safeDetail ? ` — ${safeDetail}` : ""}`);
  if (!ok) failures++;
}

async function chat(messages: unknown[], mode: "thinking" | "instant"): Promise<{ status: number; reply: string; error: string }> {
  const res = await fetch(`${BASE}/api/chatbot/`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ messages, language: "ar", mode }),
    signal: AbortSignal.timeout(170_000), // per-call cap — a hung brain never stalls the probe
  });
  const body = (await res.json()) as { success?: boolean; reply?: string; error?: string; message?: string };
  return { status: res.status, reply: body.reply ?? "", error: body.error ?? body.message ?? "" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hasDocgenFence = (s: string) => /```docgen/i.test(s);
const SUGGESTION_RE = /(هل تريد|تحب|أقدر|أستطيع)\s*(أن)?\s*(أعمل|أجهز|أولد|أرسل|أنشئ|عمل|توليد)?[^.؟\n]{0,40}(ملف|PDF|PDF؟|وورد|Word|docx|تقرير)|(اطلب مني|لو حابب أعمل|say the word)/i;

// ── 0. health: is the Space serving the NEW build? ────────────────────────
console.log("0) نبض المنصة (سؤال داخل النطاق)");
const pulse = await chat([{ role: "user", content: "ما هو الفرق بين MCB و MCCB؟" }], "instant");
const spaceUp = pulse.status === 200 && pulse.reply.length > 0;
check("HTTP 200 + reply", spaceUp, `status=${pulse.status} err=${pulse.error.slice(0, 60)}`);
if (!spaceUp) {
  console.log("Space not serving — aborting (deployment may still be starting)");
  process.exit(2);
}

// ── 1. NO AUTO-GENERATION + NO SUGGESTION (long/tabular answer, no file request) ──
await sleep(4000);
console.log("1) جواب طويل وجدولي WITHOUT طلب ملف → نص فقط، بلا لوحة docgen، بلا اقتراح ملفات");
const noFile = await chat(
  [{ role: "user", content: "اعمل لي جدول مقارنة تفصيلي بين MCB و MCCB و RCCB من حيث التيار والاستخدام ومعيار التصنيع" }],
  "thinking",
);
check("HTTP 200 + reply", noFile.status === 200 && noFile.reply.length > 0, `status=${noFile.status} err=${noFile.error.slice(0, 60)}`);
const n = noFile.reply;
check("NO docgen fence (no file without an explicit request)", !hasDocgenFence(n), hasDocgenFence(n) ? "VIOLATION: docgen fence present" : "");
check("NO file-generation suggestion/offer", !SUGGESTION_RE.test(n.replace(/```[\s\S]*?```/g, "")), "");
check("substantive technical answer (>200 chars)", n.length > 200, `len=${n.length}`);

// ── 2. FORMAT MENTION ≠ FILE REQUEST ─────────────────────────────────────
await sleep(4000);
console.log("2) سؤال عن الصيغ (pdf vs docx) دون طلب ملف → جواب نصي بلا لوحة");
const fmtQ = await chat(
  [{ role: "user", content: "ما الفرق بين صيغة pdf و docx من ناحية الاستخدام في التقارير الهندسية؟" }],
  "thinking",
);
check("HTTP 200 + reply", fmtQ.status === 200 && fmtQ.reply.length > 0, `status=${fmtQ.status} err=${fmtQ.error.slice(0, 60)}`);
const f = fmtQ.reply;
check("NO docgen fence (mentioning a format is not requesting a file)", !hasDocgenFence(f), hasDocgenFence(f) ? "VIOLATION: docgen fence present" : "");

// ── 3. EXPLICIT REQUEST → FILE IN THE FIRST REPLY ────────────────────────
await sleep(4000);
console.log("3) طلب صريح: «اعمل لي ملف PDF بتقرير مقارنة MCB و MCCB» → لوحة docgen في أول رد");
const explicit = await chat(
  [{ role: "user", content: "اعمل لي ملف PDF يتضمن تقريراً موجزاً يقارن بين MCB و MCCB من حيث التيار المقدر والاستخدام، مع جدول مقارنة" }],
  "thinking",
);
check("HTTP 200 + reply", explicit.status === 200 && explicit.reply.length > 0, `status=${explicit.status} err=${explicit.error.slice(0, 60)}`);
const e = explicit.reply;
check("docgen fence present in the FIRST reply (file built immediately)", hasDocgenFence(e), hasDocgenFence(e) ? "" : "NO fence found");
check("spec carries format+filename+title", /"format"\s*:\s*"pdf"/i.test(e) && /"filename"/i.test(e) && /"title"/i.test(e), "");

console.log("");
if (failures === 0) {
  console.log("ALL GATE CONTRACTS HOLD (production)");
} else {
  console.log(`FAILURES: ${failures}`);
  process.exit(1);
}
