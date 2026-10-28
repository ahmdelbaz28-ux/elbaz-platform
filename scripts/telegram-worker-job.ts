/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TELEGRAM BOT WORKER JOB — GitHub Actions home for the polling worker.
 * ───────────────────────────────────────────────────────────────────────────
 *  ROOT-CURE (2026-10-29 outage): the HF Space's shared egress lost
 *  reachability to api.telegram.org (connect timeouts) AND to www.youtube.com,
 *  while every AI provider / DB / R2 / Resend stayed reachable. Polling from
 *  the Space is therefore unreliable — the worker now runs on GitHub Actions
 *  runners, which are PROVEN reachable to api.telegram.org (probe 2026-10-28:
 *  getMe in ~0.5s) and to the Space itself.
 *
 *  Reuses the EXACT supervised worker (api/lib/telegram-bot.ts — boot retry
 *  ladder, self-healing, conflict backoff, join approvals, DM brain) with two
 *  production deps:
 *    • api   → direct Bot API calls from the Actions runner.
 *    • brain → the Space's public POST /api/chatbot (same expert brain as the
 *      site widget, live course catalog, origin-side rate limiting), reached
 *      with the shield-identity headers (direct-origin runs need them or the
 *      EDGE_HOST_ENFORCE shield answers a stealth 404).
 *
 *  LIFECYCLE: the workflow keeps a queued run warm (concurrency group, no
 *  cancel) — when this job's lifetime ends it stops cleanly and the queued
 *  run takes over within seconds. Telegram re-delivers every unconfirmed
 *  update on the next poll, so handoffs and crashes are at-least-once, never
 *  lossy. Known v1 limitation: the DM conversation memory is in-process, so a
 *  handoff boundary resets it (30-min TTL anyway).
 *
 *  Usage (inside Actions):
 *    TELEGRAM_BOT_TOKEN=… TELEGRAM_BRAIN_API_BASE=https://…hf.space \
 *      npx tsx scripts/telegram-worker-job.ts
 * ═══════════════════════════════════════════════════════════════════════════
 */
import {
  beginTelegramSupervision,
  getTelegramBotStatus,
  stopTelegramBot,
  type ChatBrain,
  type TelegramApi,
  type TelegramBotDeps,
} from "../api/lib/telegram-bot.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("[WorkerJob] TELEGRAM_BOT_TOKEN missing — exiting");
  process.exit(1);
}

const brainBase = (process.env.TELEGRAM_BRAIN_API_BASE || "https://ahmdelbaz28-ahmdrtap.hf.space").replace(/\/+$/, "");
/** End before the job timeout so the stop + final report are always clean. */
const lifetimeMs = Number(process.env.WORKER_LIFETIME_MS || 12 * 60_000);

// ─── Direct Bot API from the Actions runner ──────────────────────────────────
const api: TelegramApi = {
  async call(method, payload) {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
      signal: AbortSignal.timeout(35_000), // getUpdates long-polls 25s + margin
    });
    return (await res.json()) as { ok: boolean; result?: unknown; description?: string; parameters?: { retry_after?: number } };
  },
};

// ─── Expert brain via the Space's public chatbot route ───────────────────────
const brain: ChatBrain = async (messages, opts) => {
  try {
    const res = await fetch(`${brainBase}/api/chatbot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Direct-origin runs must present the worker's forwarded-host identity
        // or the shield answers a stealth 404 (same contract as the smoke test).
        "X-Forwarded-Host": "ahmedelbaz.qzz.io",
        "X-Forwarded-Proto": "https",
      },
      body: JSON.stringify({ messages, language: opts.language, mode: opts.mode }),
      signal: AbortSignal.timeout(150_000), // provider walk retries inside the Space
    });
    const data = (await res.json().catch(() => null)) as
      | { success?: boolean; reply?: string; error?: { message?: string } | string }
      | null;
    if (data && data.success === true && typeof data.reply === "string") {
      return { reply: data.reply };
    }
    const detail =
      typeof data?.error === "string"
        ? data.error
        : (data?.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
    return { error: detail.slice(0, 160) };
  } catch (err) {
    return { error: (err instanceof Error ? err.message : String(err)).slice(0, 160) };
  }
};

const deps: TelegramBotDeps = {
  api,
  brain,
  dmMode: process.env.TELEGRAM_DM_MODE === "thinking" ? "thinking" : "instant",
  now: () => Date.now(),
};

const started = beginTelegramSupervision(deps);
console.log(`[WorkerJob] supervision ${started ? "started" : "REFUSED (already running?)"} — lifetime ${Math.round(lifetimeMs / 1000)}s, brain=${brainBase}`);

await new Promise((r) => setTimeout(r, lifetimeMs));

stopTelegramBot();
const deadline = Date.now() + 45_000;
while (getTelegramBotStatus().status !== "stopped" && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 500));
}
const final = getTelegramBotStatus();
console.log(
  `[WorkerJob] final status=${final.status} polls=${final.pollCycles} handled=${final.handledUpdates} ` +
    `conflicts=${final.conflicts} lastError=${final.lastError ?? "none"}`
);
process.exit(0);
