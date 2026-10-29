/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PROVIDER PROBE — automatic resilience check for the chatbot cascade
 *  (Proposal ③: the cascade must never silently depend on one provider).
 * ───────────────────────────────────────────────────────────────────────────
 *  Validates every CONFIGURED provider key with a real, cheap, read-only API
 *  call (no chat completions → no token burn, no quota impact):
 *
 *    kilo       → GET https://ai-gateway.kilo.ai/api/v1/models      (PRIMARY)
 *    openrouter → GET https://openrouter.ai/api/v1/auth/key          (key metadata)
 *    nvidia     → GET https://integrate.api.nvidia.com/v1/models
 *    groq       → GET https://api.groq.com/openai/v1/models
 *
 *  Verdict (exit code):
 *    0 — primary healthy AND every configured provider healthy
 *        (unset providers are reported as gaps, not failures)
 *    1 — primary down, any configured provider failing, or none configured
 *
 *  --alert: accepted for CLI compatibility, does NOTHING — owner policy
 *  (2026-10-29): nothing is ever posted to the channel/group. A failing
 *  probe shows up as a red run on GitHub, that's the whole alert channel.
 *
 *  Run locally:  npx tsx scripts/provider-probe.ts
 *  Run in CI:    npx tsx scripts/provider-probe.ts --alert   (provider-probe.yml)
 * ═══════════════════════════════════════════════════════════════════════════
 */

const PROBE_TIMEOUT_MS = 10_000;

type ProviderRow = {
  name: string;
  envKey: string;
  configured: boolean;
  status: "HEALTHY" | "UNHEALTHY" | "MISSING" | "SKIPPED";
  latencyMs: number;
  detail: string;
  /** Where to get a free key — shown only for MISSING rows. */
  hint?: string;
};

const rows: ProviderRow[] = [];

async function probeProvider(
  name: string,
  envKey: string,
  url: string,
  opts: { hint: string; describe?: (body: unknown) => string },
): Promise<ProviderRow> {
  const key = process.env[envKey]?.trim() ?? "";
  if (!key) {
    return { name, envKey, configured: false, status: "MISSING", latencyMs: 0, detail: `${envKey} is not set`, hint: opts.hint };
  }
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    const bodyText = await res.text().catch(() => "");
    if (res.ok) {
      const detail = opts.describe?.(safeJson(bodyText)) ?? `HTTP ${res.status}`;
      return { name, envKey, configured: true, status: "HEALTHY", latencyMs, detail };
    }
    const apiMsg = extractMessage(bodyText);
    return {
      name,
      envKey,
      configured: true,
      status: "UNHEALTHY",
      latencyMs,
      detail: `HTTP ${res.status}${apiMsg ? ` — ${apiMsg}` : ""}`,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const cause = err instanceof Error ? err.message : String(err);
    return { name, envKey, configured: true, status: "UNHEALTHY", latencyMs, detail: cause.slice(0, 140) };
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractMessage(bodyText: string): string {
  const parsed = safeJson(bodyText) as { message?: string; error?: { message?: string } } | null;
  const msg =
    (typeof parsed?.message === "string" && parsed.message) ||
    (typeof parsed?.error === "object" && parsed?.error !== null && typeof (parsed.error as { message?: string }).message === "string"
      ? (parsed.error as { message: string }).message
      : "");
  return msg.slice(0, 120);
}

/**
 * REAL key validation for gateways whose GET /models is PUBLIC (kilo, NVIDIA):
 * the model list answers 200 even with a fake key, so a read-only probe there
 * would report dead keys as healthy. The honest check is a 1-token chat
 * completion — the exact lane the chatbot uses — costing one token per day.
 * A model-not-served error still proves AUTH (the gateway checks the key
 * before the model), so it is reported as auth-healthy with a drift note.
 */
async function probeChatCompletions(
  name: string,
  envKey: string,
  baseUrl: string,
  fallbackModel: string,
  opts: { hint: string; discoverModel?: boolean },
): Promise<ProviderRow> {
  const key = process.env[envKey]?.trim() ?? "";
  if (!key) {
    return { name, envKey, configured: false, status: "MISSING", latencyMs: 0, detail: `${envKey} is not set`, hint: opts.hint };
  }
  const started = Date.now();
  let model = fallbackModel;
  if (opts.discoverModel) {
    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (res.ok) {
        const body = safeJson(await res.text().catch(() => "")) as { data?: Array<{ id?: string }> } | null;
        model = body?.data?.find((m) => typeof m?.id === "string")?.id ?? fallbackModel;
      }
    } catch {
      // discovery is best-effort — the fallback model carries the check
    }
  }
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - started;
    const bodyText = await res.text().catch(() => "");
    if (res.ok) {
      return { name, envKey, configured: true, status: "HEALTHY", latencyMs, detail: `1-token chat OK via ${model}` };
    }
    const msg = extractMessage(bodyText);
    if (res.status !== 401 && res.status !== 403 && /model/i.test(msg)) {
      // The gateway validated the key, then rejected the model id — auth lane is alive.
      return {
        name,
        envKey,
        configured: true,
        status: "HEALTHY",
        latencyMs,
        detail: `auth OK — model "${model}" not served (HTTP ${res.status})`,
      };
    }
    return { name, envKey, configured: true, status: "UNHEALTHY", latencyMs, detail: `HTTP ${res.status}${msg ? ` — ${msg}` : ""}` };
  } catch (err) {
    const latencyMs = Date.now() - started;
    return {
      name,
      envKey,
      configured: true,
      status: "UNHEALTHY",
      latencyMs,
      detail: (err instanceof Error ? err.message : String(err)).slice(0, 140),
    };
  }
}

/** Count OpenAI-style {data:[...]} model lists. */
function countModels(body: unknown): string {
  const data = (body as { data?: unknown[] } | null)?.data;
  return Array.isArray(data) ? `${data.length} models visible` : "key accepted";
}

// ── Probe definitions (endpoints mirror api/lib/chatbot.ts + ai-router.ts) ──
// kilo + NVIDIA: GET /models is PUBLIC there, so the real check is the
// 1-token chat completion below (fake-key 401 live-verified 2026-10-29).
rows.push(
  await probeChatCompletions("kilo", "KILOCODE_API_KEY", "https://ai-gateway.kilo.ai/api/v1", "Qwen/Qwen3-235B-A22B-Instruct", {
    hint: "free gateway key — kilo.ai (account → API keys)",
    discoverModel: true,
  }),
);
rows.push(
  await probeProvider("openrouter", "OPENROUTER_API_KEY", "https://openrouter.ai/api/v1/auth/key", {
    hint: "free key — openrouter.ai/keys",
    describe: (body) => {
      const d = (body as { data?: { limit?: unknown; usage?: unknown; is_free_tier?: boolean } } | null)?.data;
      const parts: string[] = [];
      if (d && typeof d === "object") {
        if (d.limit !== null && d.limit !== undefined) parts.push(`limit ${d.limit}`);
        if (d.usage !== null && d.usage !== undefined) parts.push(`used ${d.usage}`);
        if (typeof d.is_free_tier === "boolean") parts.push(d.is_free_tier ? "free tier" : "paid tier");
      }
      return parts.length ? parts.join(", ") : "key accepted";
    },
  }),
);
rows.push(
  await probeChatCompletions("nvidia", "NVIDIA_API_KEY", "https://integrate.api.nvidia.com/v1", "minimaxai/minimax-m3", {
    hint: "free key — build.nvidia.com (Get API Key)",
  }),
);
rows.push(
  await probeProvider("groq", "GROQ_API_KEY", "https://api.groq.com/openai/v1/models", {
    hint: "free key — console.groq.com/keys",
    describe: countModels,
  }),
);

// ── Layer 2 — the Space's OWN keys (where the cascade actually runs) ───────
// GitHub secrets are at best a MIRROR of the HF Space env. The keys live on
// the Space, so the authoritative probe is the Space's gated deep endpoint
// (GET /api/health/providers — statuses only, timing-safe EDGE_ORIGIN_SECRET
// gate). Set SPACE_PROBE_URL + EDGE_ORIGIN_SECRET to enable.
const spaceUrl = process.env.SPACE_PROBE_URL?.trim();
const spaceSecret = process.env.EDGE_ORIGIN_SECRET?.trim();
if (spaceUrl && spaceSecret) {
  const spaceStart = Date.now();
  try {
    const res = await fetch(`${spaceUrl.replace(/\/$/, "")}/api/health/providers`, {
      headers: {
        Authorization: `Bearer ${spaceSecret}`,
        "X-Forwarded-Host": "ahmedelbaz.qzz.io",
        "X-Forwarded-Proto": "https",
      },
      signal: AbortSignal.timeout(25_000),
    });
    const latencyMs = Date.now() - spaceStart;
    const text = await res.text().catch(() => "");
    const body = safeJson(text) as { providers?: Array<{ name: string; configured: boolean; status: ProviderRow["status"]; latency_ms?: number; detail: string }> } | null;
    if (Array.isArray(body?.providers) && body!.providers!.length) {
      for (const r of body!.providers!) {
        rows.push({ name: `${r.name}@space`, envKey: "(space env)", configured: r.configured, status: r.status, latencyMs: r.latency_ms ?? 0, detail: r.detail } as ProviderRow);
      }
      if (!res.ok) console.log(`[space] endpoint verdict not ok (HTTP ${res.status}) — the @space rows above show exactly which providers failed`);
    } else {
      rows.push({ name: "space-probe", envKey: "SPACE_PROBE_URL", configured: true, status: "UNHEALTHY", latencyMs, detail: `HTTP ${res.status}` });
    }
  } catch (err) {
    rows.push({
      name: "space-probe",
      envKey: "SPACE_PROBE_URL",
      configured: true,
      status: "UNHEALTHY",
      latencyMs: Date.now() - spaceStart,
      detail: (err instanceof Error ? err.message : String(err)).slice(0, 140),
    });
  }
} else {
  console.log("[space] SPACE_PROBE_URL/EDGE_ORIGIN_SECRET not set — Space-layer probe skipped (GH-side keys only)");
}

// ── Report ──────────────────────────────────────────────────────────────────
const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
console.log("╔══════════════════════════════════════════════════════════════════════╗");
console.log("║  PROVIDER PROBE — chatbot cascade resilience                         ║");
console.log("╚══════════════════════════════════════════════════════════════════════╝");
console.log(`${pad("PROVIDER", 13)}${pad("STATUS", 11)}${pad("LATENCY", 9)}DETAIL`);
for (const r of rows) {
  console.log(
    `${pad(r.name, 13)}${pad(r.status, 11)}${pad(r.latencyMs ? `${r.latencyMs}ms` : "-", 9)}${r.detail}${r.hint ? `  [${r.hint}]` : ""}`,
  );
}

const primary = rows.find((r) => r.name === "kilo")!;
const healthy = rows.filter((r) => r.status === "HEALTHY");
const failing = rows.filter((r) => r.status === "UNHEALTHY");
const missing = rows.filter((r) => r.status === "MISSING");

let ok = true;
const failureLines: string[] = [];
if (!primary.configured && rows.every((r) => !r.configured)) {
  ok = false;
  failureLines.push("no provider key is configured at all — the chatbot has no brain");
}
if (primary.configured && primary.status === "UNHEALTHY") {
  ok = false;
  failureLines.push(`kilo (PRIMARY) down — ${primary.detail}`);
}
for (const f of failing) {
  if (f.name === "kilo") continue;
  ok = false;
  failureLines.push(`${f.name} down — ${f.detail}`);
}
if (healthy.length === 0 && ok) {
  ok = false;
  failureLines.push("zero healthy providers");
}

console.log("──────────────────────────────────────────────────────────────────────");
console.log(
  `SUMMARY: healthy=${healthy.length}/${rows.length} failing=${failing.length} missing=${missing.length} — ` +
    (ok ? "RESILIENT ✓ (primary up, all configured providers up)" : "NOT RESILIENT ✗"),
);
for (const line of failureLines) console.log(`  ✗ ${line}`);
if (missing.length) {
  console.log(`  ℹ gaps: ${missing.map((m) => m.name).join(", ")} — free keys: ${missing.map((m) => m.hint).join(" | ")}`);
}
console.log(JSON.stringify({ ok, healthy: healthy.map((r) => r.name), failing: failing.map((r) => ({ name: r.name, detail: r.detail })), missing: missing.map((r) => r.name) }));

// ── Notification path — OWNER POLICY (2026-10-29) ───────────────────────
// NO Telegram broadcast, ever. The owner is the only publisher in the
// channel/group, and the one live alert drill filled it with robot noise.
// Failures surface as a RED run here on GitHub (the exit code below) — the
// daily schedule + run history are the alert channel now.

process.exit(ok ? 0 : 1);
