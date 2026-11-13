/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LIVE CHATBOT PRODUCTION PROOF — electrical-only scope + live screen lane
 * ───────────────────────────────────────────────────────────────────────────
 *  Exercises the REAL /api/chatbot endpoint at the HF Space:
 *    A. OFF-TOPIC refusal: a creative/programming request must be declined
 *       politely in Arabic with the electrical-engineering specialization
 *       stated (the "electrical programs ONLY" contract).
 *    B. ELECTRICAL answer: a real power-engineering question must be answered
 *       with the technical distinction (kW vs kVA + power factor).
 *    C. LIVE SCREEN frame: an image part tagged source:"screen_capture" is
 *       accepted and answered through the screen-teacher lane (own quota).
 *  Exit 0 = all contracts hold. Latency-heavy (vision lane) — patient runs.
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
function check(label: string, ok: boolean, detail = ""): void {
  // ✅ S5145 (root cure): detail may carry server-provided text — control
  // characters are stripped so a hostile response can never forge log lines.
  const safeDetail = detail.replace(/\p{Cc}+/gu, " ");
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${safeDetail ? ` — ${safeDetail}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${safeDetail ? ` — ${safeDetail}` : ""}`);
  }
}

interface ChatResponse {
  success?: boolean;
  reply?: string;
  error?: string;
  message?: string;
}

async function chat(body: Record<string, unknown>, timeoutMs = 120_000): Promise<{ status: number; data: ChatResponse }> {
  const res = await fetch(`${BASE}/api/chatbot`, {
    method: "POST",
    headers: H,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json()) as ChatResponse;
  return { status: res.status, data };
}

/** 1×1 red JPEG (valid minimal image the vision reader can describe). */
const TINY_JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmAA//9k=";

async function main(): Promise<void> {
  console.log(`\n═══ LIVE chatbot proof @ ${BASE} ═══\n`);

  // ── A) Electrical-only scope: creative/off-topic request must be declined
  const off = await chat({
    messages: [{ role: "user", content: "اكتب لي أغنية قصيرة عن الحب" }],
    language: "ar",
    mode: "instant",
  });
  check("off-topic request returns 200 (never busy-broken)", off.status === 200, `HTTP ${off.status}`);
  const offReply = off.data.reply ?? "";
  check(
    "creative request declined with electrical specialization stated",
    /(هندسة|كهرب|كهربية|electrical)/i.test(offReply) && offReply.length > 0 && offReply.length < 800,
    offReply.slice(0, 110),
  );
  const producedSong = /♪|🎶|🎵|كلمات الأغنية|أهديك|يا قلبي|حبيبي/.test(offReply);
  check("no creative content produced", !producedSong);

  // ── B) Real electrical question must be answered correctly
  const elec = await chat({
    messages: [{ role: "user", content: "ما الفرق بين kW و kVA؟ وكيف أحول بينهما؟" }],
    language: "ar",
    mode: "instant",
  });
  check("electrical question returns 200", elec.status === 200, `HTTP ${elec.status}`);
  const elecReply = elec.data.reply ?? "";
  check(
    "answer contains the real technical distinction",
    /kW/i.test(elecReply) && /kVA/i.test(elecReply) && /(معامل القدرة|power factor)/i.test(elecReply),
    elecReply.slice(0, 110),
  );
  check("no provider-name leak in the reply", !/(OpenRouter|OpenAI|Gemini|Groq|NVIDIA|Anthropic|DeepSeek|ChatGPT)/i.test(elecReply + offReply));

  // ── C) Live screen frame: accepted + answered through the screen-teacher lane
  const screen = await chat({
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "اقرأ شاشتي الآن وقل لي ما البرنامج الفاتح أمامي" },
        { type: "image_url", image_url: { url: TINY_JPEG }, source: "screen_capture" },
      ],
    }],
    language: "ar",
    mode: "instant",
  }, 150_000);
  check("screen-frame request accepted (screen lane, not the 5/day cap)", screen.status === 200, `HTTP ${screen.status} ${screen.data.error ?? ""}`);
  const screenReply = screen.data.reply ?? "";
  check("screen frame produced a real answer (vision lane executed)", screenReply.length > 20, screenReply.slice(0, 110));

  console.log(`\nRESULT: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
