/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CHATBOT DOCTOR — health check in the spirit of `agent-reach doctor --text`
 *  (Reach-gems: distilled from Panniantong/Agent-Reach, MIT).
 * ───────────────────────────────────────────────────────────────────────────
 *  Read-only. Tells you, in one run, which parts of the chatbot subsystem are
 *  healthy and which worked before but broke since:
 *
 *    1. Prompt version ↔ PROMPTS_CHANGELOG.md sync (drift = hard fail)
 *    2. Prompt size ceilings (thinking 40k chars / instant 22k chars)
 *    3. Prompt integrity gates (no CJK, safety rule, reasoning guard, no leak)
 *    4. Evolution-meter baseline snapshot present
 *    5. Error catalog completeness (every code: AR + EN + hint)
 *    6. The 6 official links declared verbatim in the skills module
 *    7. (--net) Reachability of the 6 official links (soft — network
 *       sandboxing must not fail the doctor)
 *    8. Plan-C readiness keys (TELEGRAM_BOT_TOKEN / VAPID) — reported only
 *
 *  Usage:
 *    npx tsx scripts/chatbot-doctor.ts           # static checks
 *    npx tsx scripts/chatbot-doctor.ts --net     # + link reachability
 *
 *  Exit 0 = healthy; 1 = at least one hard check failed.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSystemPrompt, PROMPT_VERSION } from "../api/lib/chatbot-prompts.js";
import { OFFICIAL_LINKS } from "../api/lib/chatbot-skills.js";
import { CHATBOT_ERROR_CATALOG } from "../api/lib/chatbot-errors.js";

const THINKING_CHAR_CEILING = 40_000;
const INSTANT_CHAR_CEILING = 22_000;

type Verdict = "PASS" | "FAIL" | "WARN" | "SKIP";

interface CheckResult {
  key: string;
  verdict: Verdict;
  detail: string;
}

const results: CheckResult[] = [];
const check = (key: string, verdict: Verdict, detail: string): void => {
  results.push({ key, verdict, detail });
};

// ─── 1. Version ↔ changelog sync (hard) ─────────────────────────────────────

const changelogPath = resolve("PROMPTS_CHANGELOG.md");
const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : "";
check(
  "prompt_version_changelog_sync",
  changelog.includes(`## [${PROMPT_VERSION}]`) ? "PASS" : "FAIL",
  changelog.includes(`## [${PROMPT_VERSION}]`)
    ? `PROMPTS_CHANGELOG.md documents v${PROMPT_VERSION}`
    : `PROMPT_VERSION=${PROMPT_VERSION} has NO entry in PROMPTS_CHANGELOG.md (run: document it, then re-run)`,
);

// ─── 2+3. Prompt sizes + integrity gates (hard) ─────────────────────────────

for (const lang of ["ar", "en"] as const) {
  for (const mode of ["thinking", "instant"] as const) {
    const p = getSystemPrompt(lang, mode);
    const ceiling = mode === "thinking" ? THINKING_CHAR_CEILING : INSTANT_CHAR_CEILING;
    check(
      `size_${lang}:${mode}`,
      p.length <= ceiling ? "PASS" : "FAIL",
      `${p.length.toLocaleString("en-US")} / ${ceiling.toLocaleString("en-US")} chars`,
    );
    const cjk = /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uFF01-\uFF5E\uFF61-\uFF9F]/.test(p);
    const hasSafety = p.includes("السلامة الكهربائية") || p.includes("ELECTRICAL SAFETY RULE");
    const hasGuard = p.includes("OUTPUT RULES");
    const ok = !cjk && hasSafety && hasGuard && !p.includes("__COURSE_CATALOG__");
    check(
      `integrity_${lang}:${mode}`,
      ok ? "PASS" : "FAIL",
      ok ? "no CJK, safety rule, reasoning guard, no placeholder leak"
         : [cjk && "CJK found", !hasSafety && "safety rule missing", !hasGuard && "reasoning guard missing", p.includes("__COURSE_CATALOG__") && "placeholder leak"].filter(Boolean).join("; "),
    );
  }
}

// ─── 4. Baseline snapshot (hard) ─────────────────────────────────────────────

const snapshotPath = resolve("scripts/prompt-metrics/baseline-main.json");
check(
  "evolution_baseline_snapshot",
  existsSync(snapshotPath) ? "PASS" : "FAIL",
  existsSync(snapshotPath) ? "scripts/prompt-metrics/baseline-main.json present"
    : "baseline snapshot missing — run: npx tsx scripts/measure-chatbot-evolution.ts --save scripts/prompt-metrics/baseline-main.json",
);

// ─── 5. Error catalog completeness (hard) ───────────────────────────────────

{
  const gaps: string[] = [];
  for (const [code, info] of Object.entries(CHATBOT_ERROR_CATALOG)) {
    if (!info.ar || !info.en || !info.hint) gaps.push(`${code}: missing ar/en/hint`);
  }
  check(
    "error_catalog_completeness",
    gaps.length === 0 ? "PASS" : "FAIL",
    gaps.length === 0 ? `${Object.keys(CHATBOT_ERROR_CATALOG).length} codes, each with AR + EN + hint`
      : gaps.join("; "),
  );
}

// ─── 6. Official links declared (hard) ──────────────────────────────────────

{
  const expected = ["website", "youtubePlaylist", "telegram", "facebook", "instagram", "tiktok"] as const;
  const missing = expected.filter((k) => !OFFICIAL_LINKS[k]?.startsWith("https://"));
  check(
    "official_links_declared",
    missing.length === 0 ? "PASS" : "FAIL",
    missing.length === 0 ? `6/6 links declared (${expected.map((k) => k).join(", ")})`
      : `missing/invalid: ${missing.join(", ")}`,
  );
}

// ─── 7. (--net) Link reachability (SOFT — sandboxing must not fail the doctor)

if (process.argv.includes("--net")) {
  const linkEntries = Object.entries(OFFICIAL_LINKS) as Array<[string, string]>;
  console.error("…checking network reachability of official links (soft)");
  const netResults = await Promise.all(
    linkEntries.map(async ([key, url]) => {
      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 8_000);
        const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
        clearTimeout(t);
        return { key, url, ok: res.status < 500, status: res.status };
      } catch (err) {
        return { key, url, ok: false, status: err instanceof Error && err.name === "AbortError" ? "timeout" : "unreachable" };
      }
    }),
  );
  for (const r of netResults) {
    check(`net_${r.key}`, r.ok ? "PASS" : "WARN", `${r.url} → ${r.status}${r.ok ? "" : " (soft — قد يكون بسبب قيود الشبكة المحلية)"}`);
  }
}

// ─── 8. Plan-C readiness (report only — never a failure) ────────────────────

{
  const telegram = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const vapidPublic = Boolean(process.env.VAPID_PUBLIC_KEY);
  const vapidPrivate = Boolean(process.env.VAPID_PRIVATE_KEY);
  check(
    "plan_c_readiness",
    "SKIP",
    `TELEGRAM_BOT_TOKEN=${telegram ? "set" : "not set (اختياري — يُقدَّم لاحقاً)"}; VAPID_PUBLIC_KEY=${vapidPublic ? "set" : "not set"}; VAPID_PRIVATE_KEY=${vapidPrivate ? "set" : "not set"}`,
  );
}

// ─── Report ─────────────────────────────────────────────────────────────────

const ICON: Record<Verdict, string> = { PASS: "✓", FAIL: "✗", WARN: "⚠", SKIP: "·" };
console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║   CHATBOT DOCTOR — subsystem health report                    ║");
console.log("╚══════════════════════════════════════════════════════════════╝");
let hardFail = false;
for (const r of results) {
  if (r.verdict === "FAIL") hardFail = true;
  console.log(` ${ICON[r.verdict]} [${r.verdict.padEnd(4)}] ${r.key.padEnd(34)} ${r.detail}`);
}
const failed = results.filter((r) => r.verdict === "FAIL").length;
const warned = results.filter((r) => r.verdict === "WARN").length;
console.log("─".repeat(62));
console.log(`Summary: ${results.length - failed - warned} pass / ${warned} warn / ${failed} fail  — prompt v${PROMPT_VERSION}`);
process.exit(hardFail ? 1 : 0);
