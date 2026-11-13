/**
 * LIVE TOKEN-OPTIMIZATION SMOKE TEST — runs against the DEPLOYED HF Space.
 *
 * Verifies the v3.6.0 optimization layer did not break the chat product:
 *   1. A pure TECHNICAL thinking question answers 200 (stream) — this path
 *      now rides the LITE catalog + stable cached prefix + no web plugin.
 *   2. A COURSE question answers 200 — full catalog path + web intent off.
 *   3. An INSTANT technical question answers 200 (fast lane unchanged).
 *   4. A WEB-INTENT question answers 200 — plugin path still attaches.
 *   5. Multi-turn stickiness: course history + "طيب والأخيرة دي؟" follow-up
 *      answers 200 (sticky full-catalog + trimmed history path).
 *
 * Run: npx tsx scripts/token-optimization-live.ts
 */

const BASE = "https://ahmdelbaz28-ahmdrtap.hf.space";
const HEADERS: Record<string, string> = {
  "X-Forwarded-Host": "ahmedelbaz.qzz.io",
  "X-Forwarded-Proto": "https",
  "Content-Type": "application/json",
};

interface Case {
  name: string;
  body: Record<string, unknown>;
}

const cases: Case[] = [
  {
    name: "TECHNICAL thinking (lite catalog + cached prefix + no web)",
    body: {
      messages: [{ role: "user", content: "اشرح لي الفرق بين دراسة Short Circuit ودراسة Load Flow في ETAP بوضوح" }],
      language: "ar",
      mode: "thinking",
    },
  },
  {
    name: "COURSE thinking (full catalog path)",
    body: {
      messages: [{ role: "user", content: "إيه كورسات المنصة في التصميم الكهربي وكم أسعارها؟" }],
      language: "ar",
      mode: "thinking",
    },
  },
  {
    name: "INSTANT technical (fast lane)",
    body: {
      messages: [{ role: "user", content: "جهد اللمس وخطوة معناه إيه بسرعة؟" }],
      language: "ar",
      mode: "instant",
    },
  },
  {
    name: "WEB-INTENT thinking (plugin path still arms)",
    body: {
      messages: [{ role: "user", content: "ما هو أحدث إصدار من برنامج ETAP في 2026؟" }],
      language: "ar",
      mode: "thinking",
    },
  },
  {
    name: "STICKY course follow-up (trimmed history + full catalog)",
    body: {
      messages: [
        { role: "user", content: "عايز أعرف تفاصيل كورسات ETAP المتاحة" },
        { role: "assistant", content: "لدينا كورسات ETAP عملية على المنصة…" },
        { role: "user", content: "طيب والأخيرة دي أسعارها كام؟" },
      ],
      language: "ar",
      mode: "thinking",
    },
  },
];

async function runStream(c: Case): Promise<{ ok: boolean; status: number; chars: number; ms: number; head: string }> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chatbot/stream`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(c.body),
    signal: AbortSignal.timeout(150_000),
  });
  if (!res.ok || !res.body) {
    return { ok: false, status: res.status, chars: 0, ms: Date.now() - t0, head: "" };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let carry = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    const lines = carry.split("\n");
    carry = lines.pop() || "";
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data: ") || s === "data: [DONE]") continue;
      try {
        const j = JSON.parse(s.slice(6)) as { text?: string };
        if (typeof j.text === "string") text += j.text;
      } catch { /* keepalive or partial */ }
    }
  }
  return { ok: text.trim().length > 0, status: res.status, chars: text.trim().length, ms: Date.now() - t0, head: text.trim().slice(0, 110).replace(/\s+/g, " ") };
}

let pass = 0;
let fail = 0;
console.log("═".repeat(72));
console.log(" LIVE SMOKE — token-optimization v3.6.0 on the deployed Space");
console.log("═".repeat(72));
for (const c of cases) {
  const r = await runStream(c);
  const verdict = r.ok ? "PASS" : "FAIL";
  if (r.ok) pass++; else fail++;
  console.log(`${verdict}  [HTTP ${r.status}] ${c.name}`);
  console.log(`      ${(r.ms / 1000).toFixed(1)}s, ${r.chars} chars — «${r.head}…»`);
}
console.log("─".repeat(72));
console.log(`${pass}/${cases.length} passed${fail ? ` — ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
