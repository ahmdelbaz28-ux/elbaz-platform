/**
 * ✅ LIVE E2E — the Smart Assistant chatbot's TWO owner-required capabilities,
 * verified against PRODUCTION:
 *   1. LIVE SCREEN READING: a synthetic engineering-program screenshot
 *      (data URL, tagged source:"screen_capture") must be READ — the reply
 *      must quote labels that exist in the frame (Bus-1, CB-1, TR-1, 2.5 MVA,
 *      11 kV, 630 A, 78%…). Zero guessing.
 *   2. ELECTRICAL-ONLY SCOPE: an in-domain question gets a substantive
 *      electrical answer; an off-domain question is politely declined and
 *      redirected to electrical engineering (no recipe, ever).
 */
const BASE = "https://ahmdelbaz28-ahmdrtap.hf.space";
const H: Record<string, string> = {
  "X-Forwarded-Host": "ahmedelbaz.qzz.io",
  "X-Forwarded-Proto": "https",
  "Content-Type": "application/json",
};

import { readFileSync } from "node:fs";

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

// ── 1. IN-DOMAIN question ────────────────────────────────────────────────
console.log("1) سؤال داخل النطاق: الفرق بين MCB و MCCB");
const inDomain = await chat(
  [{ role: "user", content: "ما هو الفرق بين القاطع الكهربي MCB وقاطع MCCB؟ وأيهم يناسب حماية محرك؟" }],
  "instant",
);
check("HTTP 200 + success", inDomain.status === 200 && inDomain.reply.length > 0, `status=${inDomain.status} err=${inDomain.error.slice(0, 60)}`);
const id = inDomain.reply;
check("substantive electrical answer (>150 chars)", id.length > 150, `len=${id.length}`);
check(
  "mentions MCB/MCCB + electrical terms",
  /mcb|mccb/i.test(id) && /أمبير|امبير|حمل|محرك|التيار|جهد|كلفين|حماية|أمب|A\b/.test(id),
  id.slice(0, 80).replace(/\s+/g, " "),
);

await sleep(4000);

// ── 2. OFF-DOMAIN question ──────────────────────────────────────────────
console.log("2) سؤال خارج النطاق: وصفة كيك (يجب الرفض اللبق + التحويل للكهربية)");
const offDomain = await chat([{ role: "user", content: "أعطني وصفة كيك الشوكولاتة بالخطوات خطوة بخطوة" }], "instant");
check("HTTP 200 + success", offDomain.status === 200 && offDomain.reply.length > 0, `status=${offDomain.status} err=${offDomain.error.slice(0, 60)}`);
const od = offDomain.reply;
const declined = /(الهندسة الكهربي[ةي]|هندسة كهربي[ةي]|تخصصي|المهندس|الكهربي[ةي]|electrical)/i.test(od);
const noRecipe = !/(الفرن|وقود الغاز|بيكينج|كريم شانتيه|الخليط حتى|سخني الفرن)/i.test(od);
check("politely declined + electrical identity shown", declined, od.slice(0, 80).replace(/\s+/g, " "));
check("NO actual recipe steps given", noRecipe, od.slice(0, 80).replace(/\s+/g, " "));

await sleep(4000);

// ── 3. LIVE SCREEN READING ──────────────────────────────────────────────
console.log("3) قراءة الشاشة الحية: صورة برنامج هندسي (screen_capture)");
const b64 = readFileSync("/home/z/my-project/elbaz-platform/scripts/screen-frame-e2e.png").toString("base64");
const dataUrl = `data:image/png;base64,${b64}`;
const screen = await chat(
  [
    {
      role: "user",
      content: [
        { type: "text", text: "هذه لقطة حية من شاشتي داخل برنامج هندسي. اقرأ ما هو مكتوب على الشاشة بالضبط وقل لي ما تشير إليه الأرقام المهمة." },
        { type: "image_url", image_url: { url: dataUrl, source: "screen_capture" } },
      ],
    },
  ],
  "thinking",
);
check("HTTP 200 + success", screen.status === 200 && screen.reply.length > 0, `status=${screen.status} err=${screen.error.slice(0, 60)}`);
const sr = screen.reply;
// Labels that EXIST in the synthetic frame — the bot must have READ them:
const labels = ["Bus-1", "CB-1", "TR-1", "11", "2.5", "630", "400", "78", "0.4"];
const found = labels.filter((l) => sr.includes(l));
check("read ≥5 real labels from the frame", found.length >= 5, `found=[${found.join(", ")}] of [${labels.join(", ")}]`);
check("no denial of ability to see the screen", !/(لا أستطيع|لا يمكنني رؤية|لم أستطع رؤية|لا أرى)/i.test(sr), sr.slice(0, 80).replace(/\s+/g, " "));

console.log("\n──── replies (first 220 chars) ────");
console.log("in-domain :", id.slice(0, 220).replace(/\s+/g, " "));
console.log("off-domain:", od.slice(0, 220).replace(/\s+/g, " "));
console.log("screen    :", sr.slice(0, 220).replace(/\s+/g, " "));

console.log("\n════════════════════════════════════════");
console.log(failures === 0 ? "RESULT: CHATBOT LIVE CHECKS PASSED ✓" : `RESULT: ${failures} CHECK(S) FAILED ✗`);
process.exit(failures === 0 ? 0 : 1);
