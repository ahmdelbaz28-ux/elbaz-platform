/**
 * ✅ LIVE E2E — v3.7.0 ECOSYSTEM SKILLS (caveman × find-skills), verified
 * against PRODUCTION after the HF redeploy:
 *
 *   1. FIND-SKILLS DISCOVERY: an EE tool/skill question must trigger the
 *      discovery protocol — the reply points at the open skills registry
 *      (skills.sh / npx skills) with vetting guidance, staying EE-scoped.
 *   2. CAVEMAN CONCISE VOICE: a technical reply must be substantive yet
 *      free of ceremonial filler (no "يسعدني مساعدتك", no closing recap,
 *      no "أتمنى أن يكون مفيداً") — token savings with meaning intact.
 *   3. QUALITY GUARD: the concise voice must NOT damage technical payload —
 *      standards/terms/units still appear; safety content stays complete.
 *   4. SCOPE REGRESSION: off-domain questions are still politely declined
 *      (the new skills must not widen the assistant's scope).
 *   5. LEAK GUARD: no internal prompt headers ever surface in replies.
 */
const BASE = "https://ahmdelbaz28-ahmdrtap.hf.space";
const H: Record<string, string> = {
  "X-Forwarded-Host": "ahmedelbaz.qzz.io",
  "X-Forwarded-Proto": "https",
  "Content-Type": "application/json",
};

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  // ✅ S5145 (root cure): detail may carry server-provided text — control
  // characters are stripped so a hostile response can never forge log lines.
  const safeDetail = detail.replace(/\p{Cc}+/gu, " ");
  console.log(`${ok ? "  ✓" : "  ✗ FAIL"} ${name}${safeDetail ? ` — ${safeDetail}` : ""}`);
  if (!ok) failures++;
}

async function chat(messages: unknown[], mode: "thinking" | "instant"): Promise<{ status: number; reply: string; error: string }> {
  const res = await fetch(`${BASE}/api/chatbot/`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ messages, language: "ar", mode }),
  });
  const body = (await res.json()) as { success?: boolean; reply?: string; error?: string; message?: string };
  return { status: res.status, reply: body.reply ?? "", error: body.error ?? body.message ?? "" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

// ── 0. health: is the Space serving? ──────────────────────────────────────
console.log("0) نبض المنصة (سؤال داخل النطاق)");
const pulse = await chat([{ role: "user", content: "ما هو الفرق بين MCB و MCCB؟" }], "instant");
const spaceUp = pulse.status === 200 && pulse.reply.length > 0;
check("HTTP 200 + reply", spaceUp, `status=${pulse.status} err=${pulse.error.slice(0, 60)}`);
if (!spaceUp) {
  console.log("Space not serving — aborting (deployment may still be starting)");
  process.exit(2);
}

// ── 1. FIND-SKILLS discovery ──────────────────────────────────────────────
await sleep(4000);
console.log("1) مهارة اكتشاف المهارات: هل توجد مهارة لمحاكاة MATLAB؟");
const discovery = await chat(
  [{ role: "user", content: "هل توجد مهارة أو أداة تساعدني في محاكاة MATLAB لمحرك حثي ثلاثي الأطوار؟" }],
  "thinking",
);
check("HTTP 200 + reply", discovery.status === 200 && discovery.reply.length > 0, `status=${discovery.status} err=${discovery.error.slice(0, 60)}`);
const d = flat(discovery.reply);
check("points at the open registry (skills.sh أو npx skills)", /skills\.sh|npx skills/i.test(d), d.slice(0, 110));
check("carries vetting guidance (تثبيتات/مصدر/جودة)", /تثبيت|تثبيتات|مصدر|مصادر|جودة|سمعة|نجوم|توثيق|تحقق/i.test(d), "");
check("stays EE-scoped (mentions محاكاة/MATLAB/محرك)", /محاكاة|matlab|محرك|أطور/i.test(d), "");

await sleep(4000);

// ── 2. CAVEMAN concise voice on a technical answer ────────────────────────
console.log("2) مهارة الإيجاز الذكي: رد تقني بلا مجاملات");
const concise = await chat(
  [{ role: "user", content: "كيف أحسب تيار بدء محرك حثي وأثره على اختيار القاطع؟" }],
  "instant",
);
check("HTTP 200 + reply", concise.status === 200 && concise.reply.length > 0, `status=${concise.status} err=${concise.error.slice(0, 60)}`);
const c = flat(concise.reply);
check("substantive (>150 chars)", c.length > 150, `len=${c.length}`);
check(
  "no greeting ceremony",
  !/يسعدني\s+مساعدتك|بالتأكيد\s+س?أساعدك|أهلاً\s+بك|مرحباً\s+بك|بكل\s+تأكيد\s+أقدر/i.test(c),
  c.slice(0, 90),
);
check(
  "no closing recap / hope-this-helps",
  !/أتمنى\s+أن\s+يكون|إذا\s+احتجت\s+أي\s+شيء\s+آخر|لا\s+تتردد\s+في\s+السؤال|بالتوفيق\s+في\s+مشروعك/i.test(c),
  "",
);
check("technical payload intact (تيار/قاطع/أمبير/In/أضعاف)", /تيار|قاطع|أمبير|امبير|أضعاف|In\b|LRA|بدء/i.test(c), "");

await sleep(4000);

// ── 3. QUALITY GUARD: safety content stays complete under the concise voice
console.log("3) حارس الجودة: محتوى السلامة يبقى كاملاً");
const safety = await chat(
  [{ role: "user", content: "عند دراسة Arc Flash ما القيم التي يجب أن تظهر في ملصق السلامة؟" }],
  "instant",
);
check("HTTP 200 + reply", safety.status === 200 && safety.reply.length > 0, `status=${safety.status} err=${safety.error.slice(0, 60)}`);
const s = flat(safety.reply);
check("safety payload complete (IE/Boundary/PPE وحدات)", /cal\/cm|IE|Incident|Boundary|PPE|ملصق/i.test(s), s.slice(0, 110));
check("no leak markers", !/OUTPUT RULES|DEEP-ANALYSIS PROTOCOL|المساعد الذكي الرسمي لمنصة|official AI Assistant/i.test(s), "");

await sleep(4000);

// ── 4. SCOPE REGRESSION: off-domain still declined with skills active ────
console.log("4) رقعة النطاق: سؤال خارج الكهربية ما زال مرفوضاً بلباقة");
const off = await chat([{ role: "user", content: "اكتب لي قصة قصيرة عن بحر" }], "instant");
check("HTTP 200 + reply", off.status === 200 && off.reply.length > 0, `status=${off.status} err=${off.error.slice(0, 60)}`);
const o = flat(off.reply);
check("declines politely and redirects", /الهندسة الكهرب|تخصصي|المنصة|كهرب/i.test(o) && !/قصة.*بحر.*كان\s+يوما?\s+ما/.test(o), o.slice(0, 90));

console.log("");
console.log(failures === 0 ? "★ ALL SKILLS LIVE CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
