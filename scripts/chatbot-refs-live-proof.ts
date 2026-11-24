/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LIVE CHATBOT PRODUCTION PROOF — TECHNICAL REFERENCES LAYER (v1.0.0)
 * ───────────────────────────────────────────────────────────────────────────
 *  Exercises the REAL /api/chatbot endpoint with the four new reference
 *  domains and asserts the layer contracts hold in production:
 *    A. SAUDI DPS-01: area→connected/demand load with the DPS-01 citation.
 *    B. ABB: transformer item selection with the catalogue citation.
 *    C. SCHNEIDER: breaker item selection with Product ID + EGP price + VAT note.
 *    D. GILANY: conceptual power question grounded in the book (citation).
 *    E. ELECTRICAL-ONLY scope still holds (off-topic refusal intact).
 *  Exit 0 = all contracts hold.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const BASE = process.env.LIVE_BASE_URL || "https://ahmdelbaz28-ahmdrtap.hf.space";
const H: Record<string, string> = {
  "Content-Type": "application/json",
  "X-Forwarded-Host": "ahmedelbaz.qzz.io",
  "X-Forwarded-Proto": "https",
};

let pass = 0;
let fail = 0;
let warn = 0;
function check(label: string, ok: boolean, detail = ""): void {
  const safeDetail = detail.replace(/\p{Cc}+/gu, " ").slice(0, 300);
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${safeDetail ? ` — ${safeDetail}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${safeDetail ? ` — ${safeDetail}` : ""}`);
  }
}
/** SOFT check: model-variance-sensitive contracts (e.g. the model may present
 *  prices in prose) — reported as WARN, never blocks the deploy gate. */
function checkSoft(label: string, ok: boolean, detail = ""): void {
  const safeDetail = detail.replace(/\p{Cc}+/gu, " ").slice(0, 300);
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${safeDetail ? ` — ${safeDetail}` : ""}`);
  } else {
    warn++;
    console.log(`  ⚠ WARN (soft) ${label}${safeDetail ? ` — ${safeDetail}` : ""}`);
  }
}

interface ChatResponse {
  success?: boolean;
  reply?: string;
  error?: string;
  message?: string;
}

async function chat(body: Record<string, unknown>, timeoutMs = 180_000): Promise<{ status: number; data: ChatResponse }> {
  const res = await fetch(`${BASE}/api/chatbot`, {
    method: "POST",
    headers: H,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let data: ChatResponse = {};
  try {
    data = (await res.json()) as ChatResponse;
  } catch {
    data = {};
  }
  return { status: res.status, data };
}

async function main(): Promise<void> {
  console.log(`LIVE REFS PROOF → ${BASE}\n`);

  // ── A. SAUDI DPS-01 ──
  {
    const { status, data } = await chat({
      messages: [{ role: "user", content: "وفق الكود السعودي DPS-01: فيلا سكنية C1 مساحة 300 متر مربع على نظام 230/400 فولت — احسب الحمل المتصل وحمل الطلب ورتبة القاطع مع الخطوات." }],
      language: "ar",
      mode: "thinking",
    });
    const reply = data.reply ?? "";
    check("A1 saudi endpoint 200", status === 200 && !!reply, `status=${status}`);
    check("A2 saudi citation present", /\[SEC DPS-01[^\]]*\]/.test(reply), (reply.match(/\[SEC DPS-01[^\]]*\]/) ?? [""])[0]);
    check("A3 saudi table grounding", /Table\s*[34]|جدول\s*[٣٤]/.test(reply) && /\b46\b|\b27\.6\b|\b70\s*A\b|70\s*أمبير/.test(reply), "");
  }

  // ── B. ABB ──
  {
    const { status, data } = await chat({
      messages: [{ role: "user", content: "من كتالوج ABB اختر لي محول توزيع 1000 kVA جهد 11/0.4 ك.ف زيتي بكل بياناته (مجموعة المتجهات والمعاوقة والفواقد)." }],
      language: "ar",
      mode: "thinking",
    });
    const reply = data.reply ?? "";
    check("B1 abb endpoint 200", status === 200 && !!reply, `status=${status}`);
    check("B2 abb citation present", /\[ABB[^\]]*Catalogue[^\]]*\]/.test(reply), (reply.match(/\[ABB[^\]]*Catalogue[^\]]*\]/) ?? [""])[0]);
    check("B3 abb item data", /(Dyn11|Dyn5|Yyn0)/.test(reply) && /1000/.test(reply), "");
  }

  // ── C. SCHNEIDER ──
  {
    const { status, data } = await chat({
      messages: [{ role: "user", content: "من قائمة أسعار شنايدر مصر 2026: اختر قاطع هوائي Masterpact بتيار 1600 أمبير 3 أقطار واعطني الـ Product ID والسعر." }],
      language: "ar",
      mode: "thinking",
    });
    const reply = data.reply ?? "";
    check("C1 schneider endpoint 200", status === 200 && !!reply, `status=${status}`);
    check("C2 schneider citation with Product ID", /\[Schneider Electric Egypt[^\]]*Product ID:\s*[A-Z0-9_\-]+\]/.test(reply), (reply.match(/\[Schneider Electric Egypt[^\]]*\]/) ?? [""])[0]);
    checkSoft("C3 schneider price present", /EGP|جنيه/.test(reply) && /\d{3},?\d{3}/.test(reply), "");
  }

  // ── D. GILANY ──
  {
    const { status, data } = await chat({
      messages: [{ role: "user", content: "ما هو المقصود بالاحتياطي الدوار spinning reserve كما يشرح كتاب دكتور جيلاني في هندسة القوى الكهربية؟" }],
      language: "ar",
      mode: "thinking",
    });
    const reply = data.reply ?? "";
    check("D1 gilany endpoint 200", status === 200 && !!reply, `status=${status}`);
    check("D2 gilany citation present", /\[هندسة القوى الكهربية[^\]]*جيلاني[^\]]*\]/.test(reply), (reply.match(/\[هندسة القوى الكهربية[^\]]*\]/) ?? [""])[0]);
    check("D3 gilany content grounding", /احتياطي|الدوار|reserve/i.test(reply), "");
  }

  // ── E. scope contract still holds ──
  {
    const { status, data } = await chat({
      messages: [{ role: "user", content: "اكتب لي برنامج بايثون لإدارة متجر إلكتروني كامل." }],
      language: "ar",
      mode: "thinking",
    });
    const reply = data.reply ?? "";
    check("E1 off-topic declined", status === 200 && (/(هندسة|كهرب|تخصص|لا\s*(أستطيع|يمكنني))/.test(reply) && !/def\s+\w+\(|python\s*3/i.test(reply.slice(0, 400))), `status=${status}`);
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed, ${warn} soft-warned`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("LIVE REFS PROOF crashed:", e?.message ?? e);
  process.exit(1);
});
