/**
 * AI ROUTER — dynamic multi-provider gateway (admin-managed, auto-discovery)
 *
 * WHAT THIS SOLVES
 * ────────────────
 * The legacy cascade in chatbot.ts / chatbot-stream.ts is hardcoded to three
 * env-configured providers. This module makes the provider pool DYNAMIC:
 *
 *   1. The admin adds ANY OpenAI-compatible provider (baseUrl + API key) in
 *      the dashboard (tables aiProviders / aiModels — db-init v9).
 *   2. On save, the server calls GET {baseUrl}/models and auto-discovers the
 *      models the key can use, classifying each as chat and/or vision and as
 *      free vs paid, then assigns a routing tier (1 strongest → 3 fastest).
 *   3. At request time, candidates are ordered: provider priority → model
 *      tier (thinking: strongest first; instant: fastest first). The router
 *      walks the list; every failure is CLASSIFIED and remembered:
 *        • 401/403 → key invalid        → whole provider cooldown (10 min)
 *        • 429     → model rate-limited → model cooldown (90s, exponential)
 *        • 404     → dead model id      → hard-skip until re-discovery
 *        • 5xx/net → transient fail     → model cooldown (60s, exponential)
 *   4. Quota exhausted on one model? Next model. Whole provider exhausted?
 *      Next provider with a working key. The user's chat never stalls while
 *      any configured model anywhere still answers.
 *
 * INTEGRATION CONTRACT (with the legacy cascade)
 * ──────────────────────────────────────────────
 * routeChatCompletion / routeChatStream return null when the dynamic pool
 * cannot serve the request (empty pool, all cooling down, budget exhausted).
 * Callers then fall back to the legacy env cascade — the chatbot keeps
 * working even if the DB is unreachable or the admin removed every provider.
 *
 * HEALTH STATE
 * ────────────
 * In-memory circuit breakers (cooldown maps) are authoritative for routing;
 * columns on aiModels/aiProviders mirror them for the admin dashboard. All
 * DB writes are best-effort (never block or throw on the hot path).
 */

import { and, asc, eq } from "drizzle-orm";
import { aiModels, aiProviders, type AiModel, type AiProvider } from "@db/schema";
import { logger } from "./logger.js";
import { sanitizeReplyOutput } from "./chatbot-prompts.js";
import { stripThinkBlocks, ThinkStreamFilter } from "./think-filter.js";

// ── Lazy DB handle ─────────────────────────────────────────────────────────
// ai-router is imported (transitively) by chatbot.ts, whose unit tests load
// it WITHOUT a database environment. A top-level import of
// queries/connection.js would create the MySQL pool at module scope and
// crash those tests. The handle is resolved on first DB use instead — and
// every caller already treats DB unavailability as "dynamic routing
// unavailable → caller falls back to the legacy cascade" (never throws on
// the hot path).
type ConnectionModule = typeof import("../queries/connection.js");
let connectionModule: ConnectionModule | null = null;
async function lazyGetDb(): Promise<ConnectionModule["getDb"]> {
  if (!connectionModule) {
    connectionModule = await import("../queries/connection.js");
  }
  return connectionModule.getDb;
}

// ════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════

export type ChatbotMode = "thinking" | "instant";

/** Minimal generation params the router needs (decoupled from MODE_TUNING). */
export interface RouteGenParams {
  temperature: number;
  maxTokens: number;
  /** Per-attempt upstream timeout. */
  attemptTimeoutMs: number;
  /** Whole routing phase budget — after this we give up and let the caller's fallback chain run. */
  globalBudgetMs: number;
}

/** Content parts (OpenAI vision format) — mirrors chatbot.ts ChatApiMessage. */
export type RouteContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface RouteMessage {
  role: string;
  content: string | RouteContentPart[];
}

export type RoutingOutcome<R> = { ok: true; result: R } | { ok: false };

export interface RoutedReply {
  reply: string;
  /** "providerSlug/modelId" — internal use only, never shown to users. */
  model: string;
  providerId: number;
  aiModelId: number;
}

export interface RoutedStream {
  stream: ReadableStream<Uint8Array>;
  model: string;
  providerId: number;
  aiModelId: number;
}

// ════════════════════════════════════════════════════════════════════════
// PROVIDER CATALOG — known OpenAI-compatible providers (admin dropdown)
// ════════════════════════════════════════════════════════════════════════

export interface CatalogEntry {
  slug: string;
  displayName: string;
  baseUrl: string;
  /** Human hint shown in the admin dialog. */
  hint: string;
}

export const PROVIDER_CATALOG: CatalogEntry[] = [
  { slug: "groq", displayName: "Groq", baseUrl: "https://api.groq.com/openai/v1", hint: "مجاني وسريع جداً — console.groq.com" },
  { slug: "openrouter", displayName: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", hint: "عشرات النماذج المجانية (:free) — openrouter.ai" },
  { slug: "nvidia", displayName: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", hint: "build.nvidia.com — نماذج ضخمة مجاناً" },
  { slug: "cerebras", displayName: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", hint: "الأسرع عالمياً — cloud.cerebras.ai" },
  { slug: "mistral", displayName: "Mistral AI", baseUrl: "https://api.mistral.ai/v1", hint: "خطة مجانية محدودة — console.mistral.ai" },
  { slug: "together", displayName: "Together AI", baseUrl: "https://api.together.xyz/v1", hint: "رصيد مجاني مبدئي — api.together.xyz" },
  { slug: "deepseek", displayName: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", hint: "مدفوع رخيص — platform.deepseek.com" },
  { slug: "custom", displayName: "Custom (OpenAI-compatible)", baseUrl: "", hint: "أدخل رابط الـ API المتوافق مع OpenAI يدوياً" },
];

// ════════════════════════════════════════════════════════════════════════
// MODEL CLASSIFICATION — vision / free / tier heuristics
// ════════════════════════════════════════════════════════════════════════

/**
 * Conservative vision signals in model ids. Used ONLY when the provider's
 * /models payload does not carry explicit modality metadata (OpenRouter
 * provides architecture.input_modalities — authoritative). A model never
 * LOSES vision status through this heuristic: explicit metadata and admin
 * toggles always win.
 */
const VISION_ID_RE =
  /(vision|-vl\b|-vl:|vl-|scout|maverick|omni|pixtral|llava|internvl|glm-4v|gemma-3|gemini|llama-4|gpt-4o|gpt-4\.1|gpt-5|minimax-vl|nemo.*vl|qwen.*vl|doubao.*vision|kimi.*vision|multi ?modal)/i;

const TIER1_RE = /(70b|120b|230b|550b|405b|ultra|super|pro\b|large|scout|maverick|reasoning)/i;
const TIER3_RE = /(nano|mini\b|flash|instant|small|lite|\b[1-8]b\b|a3b|a4b|lfm|preview)/i;

/**
 * Non-chat models (speech-to-text, TTS, music/audio generation, image/video
 * generation, embeddings, guard/moderation).
 * Providers like Groq list them on /models, but they cannot answer
 * chat/completions calls — routing to them would burn an attempt and a
 * cooldown on every message. They stay visible in the dashboard (no Chat
 * badge) but are excluded from both chat and vision lanes.
 *
 * ⚠ Production incident this list now guards against: OpenRouter's
 * `google/lyria-3-pro-preview` (a MUSIC generation model) matched TIER1_RE
 * via the "pro\b" token, got tier 1, was the FIRST thinking-lane candidate,
 * and once pinned by lastWorkingByMode it served every thinking request with
 * truncated nonsense — the "brain icon ON gives dumb fixed replies" bug.
 * Never match loose family tokens here — keep ids precise (word boundaries).
 */
const NON_CHAT_RE = new RegExp([
  "whisper", "orpheus", "playai", "\\btts\\b", "\\bnumina\\b", "embedding", "\\bembed\\b", "guard", "moderation", "rerank", "\\bsafety\\b", "distil-whisper",
  "\\blyria\\b", "\\bmusic\\b", "\\bcanary\\b", "\\baurora\\b", "\\bvoice\\b", "\\bspeech\\b", "\\baudio\\b",
  "\\bimagen\\b", "\\bdall\\b", "\\bflux\\b", "stable-diffusion", "\\bsdxl\\b", "\\bsd3\\b", "\\bmidjourney\\b", "\\brecraft\\b", "\\bideogram\\b", "\\bphoton\\b", "\\bjanus\\b",
  "\\bveo\\b", "\\bsora\\b", "\\bkling\\b", "\\brunway\\b", "\\bhailuo\\b", "\\bseedance\\b", "\\bvideo\\b",
].join("|"), "i");

/**
 * SPECIALIST models — they CAN answer chat/completions, but their tuning
 * targets a DIFFERENT job (code generation, document/note parsing) or their
 * capacity is too small to carry an expert answer. On general (especially
 * Arabic) engineering questions they ignore the language mirror and
 * formatting rules and produce a bad first impression. Excluded from the
 * CHAT lane at routing time (same self-heal pattern as NON_CHAT_RE); they
 * stay visible in the dashboard. Live incidents guarded:
 *   - cohere/north-mini-code served an Arabic instant question (code-tuned)
 *   - dots-studio/dots-3-note-preview (document parser) landed the instant lane
 */
export const SPECIALIST_CHAT_RE = new RegExp([
  // code-tuned families
  "coder", "codestral", "cobuddy", "laguna", "codegeex", "starcoder", "devstral",
  "\\bcode\\b", "\\bcode-", "-code\\b", "\\bdev\\b-",
  // document/note parser families
  "\\bdots\\b", "dots-", "-note\\b", "\\bocr\\b", "\\bdoc\\b", "docmat", "\\bpdf\\b",
  // too-small-for-expert-answers families
  "\\blfm\\b", "minicpm", "moondream", "smolvlm", "\\bphi\\b-",
].join("|"), "i");

export interface ClassifiedModel {
  modelId: string;
  supportsChat: boolean;
  supportsVision: boolean;
  isFree: boolean;
  tier: 1 | 2 | 3;
  contextLength: number;
}

interface RawProviderModel {
  id?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  architecture?: { input_modalities?: unknown; output_modalities?: unknown; modality?: unknown };
  context_length?: unknown;
  max_model_len?: unknown;
  context_window?: unknown;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pricingIsZero(p: RawProviderModel["pricing"]): boolean {
  if (!p) return false;
  const prompt = num(p.prompt);
  const completion = num(p.completion);
  return prompt === 0 && completion === 0;
}

/** Classify one raw /models entry into the router's model shape. */
export function classifyRawModel(raw: RawProviderModel): ClassifiedModel | null {
  const modelId = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!modelId) return null;

  // ── Vision: explicit modality metadata first, id heuristic as fallback ──
  let supportsVision = false;
  const modalities = raw.architecture?.input_modalities;
  if (Array.isArray(modalities)) {
    supportsVision = modalities.some((m) => typeof m === "string" && m.toLowerCase() === "image");
  } else if (typeof raw.architecture?.modality === "string") {
    // OpenRouter legacy "modality": "text+image->text"
    supportsVision = /image/i.test(raw.architecture.modality) && /->|→/.test(raw.architecture.modality);
  }
  if (!supportsVision && VISION_ID_RE.test(modelId)) supportsVision = true;

  // ── Free: OpenRouter pricing (0/0) or ":free" suffix; every other
  //    provider's key tier is treated as free by default ──
  const isFree = modelId.endsWith(":free") || pricingIsZero(raw.pricing) || !raw.pricing;

  // ── Tier: strongest / mid / smallest-fastest ──
  const ctx = num(raw.context_length) || num(raw.max_model_len) || num(raw.context_window);
  let tier: 1 | 2 | 3 = 2;
  if (TIER3_RE.test(modelId) && !TIER1_RE.test(modelId)) tier = 3;
  else if (TIER1_RE.test(modelId) || ctx >= 262144) tier = 1;

  // ── Chat capability: authoritative output-modality metadata first, then
  //    the id heuristic. A model whose declared outputs do not include text
  //    (e.g. google/lyria → ["audio"]) can NEVER answer chat/completions —
  //    this is the signal the id regex exists to back up, not to replace.
  const outMods = raw.architecture?.output_modalities;
  const outputsText = Array.isArray(outMods)
    ? outMods.some((m) => typeof m === "string" && m.toLowerCase() === "text")
    : null; // unknown → fall back to the id heuristic
  const supportsChat = outputsText === null ? !NON_CHAT_RE.test(modelId) : outputsText && !NON_CHAT_RE.test(modelId);

  return { modelId, supportsChat, supportsVision: supportsVision && supportsChat, isFree, tier, contextLength: ctx };
}

// ════════════════════════════════════════════════════════════════════════
// API KEY MASKING — keys are write-only from the dashboard's perspective
// ════════════════════════════════════════════════════════════════════════

export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return key.slice(0, 2) + "…";
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

// ════════════════════════════════════════════════════════════════════════
// DISCOVERY — GET {baseUrl}/models → upsert into aiModels
// ════════════════════════════════════════════════════════════════════════

export interface DiscoveryResult {
  ok: boolean;
  found: number;
  chat: number;
  vision: number;
  free: number;
  error?: string;
}

/** Normalize the many /models payload shapes into a flat model list. */
function extractRawModels(payload: unknown): RawProviderModel[] {
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as { data?: unknown; models?: unknown; body?: unknown };
  const list = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.models) ? obj.models : Array.isArray(obj.body) ? obj.body : [];
  return list.filter((m): m is RawProviderModel => !!m && typeof m === "object");
}

/**
 * Discover models for one provider row: fetch {baseUrl}/models, classify,
 * then upsert. EXISTING rows keep their admin toggles (enabled/supportsChat/
 * supportsVision) — discovery only inserts new models and refreshes
 * free/tier/status. New rows get heuristic defaults.
 */
export async function discoverProviderModels(provider: Pick<AiProvider, "id" | "baseUrl" | "apiKey" | "slug">): Promise<DiscoveryResult> {
  let db: ReturnType<ConnectionModule["getDb"]>;
  try {
    const getDb = await lazyGetDb();
    db = getDb();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("[AiRouter] discovery skipped — DB unavailable", { provider: provider.slug, error: msg });
    return { ok: false, found: 0, chat: 0, vision: 0, free: 0, error: msg };
  }
  try {
    const url = `${provider.baseUrl.replace(/\/+$/, "")}/models`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20_000),
    });

    if (resp.status === 401 || resp.status === 403) {
      await markProviderAuthFail(provider.id);
      return { ok: false, found: 0, chat: 0, vision: 0, free: 0, error: "مفتاح API مرفوض من المزود (401/403) — تأكد من صحة المفتاح" };
    }
    if (!resp.ok) {
      const msg = `HTTP ${resp.status} من ${url}`;
      await updateProviderStatus(provider.id, "degraded", msg);
      return { ok: false, found: 0, chat: 0, vision: 0, free: 0, error: msg };
    }

    const payload = (await resp.json().catch(() => null)) as unknown;
    const rawModels = extractRawModels(payload);
    if (rawModels.length === 0) {
      const msg = "استجابة /models بلا قائمة نماذج — قد لا يدعم المزود الاكتشاف التلقائي";
      await updateProviderStatus(provider.id, "degraded", msg);
      return { ok: false, found: 0, chat: 0, vision: 0, free: 0, error: msg };
    }

    const existing = await db.select({ modelId: aiModels.modelId }).from(aiModels).where(eq(aiModels.providerId, provider.id));
    const existingSet = new Set(existing.map((r) => r.modelId));

    let chat = 0;
    let vision = 0;
    let free = 0;
    let inserted = 0;

    for (const raw of rawModels) {
      const cls = classifyRawModel(raw);
      if (!cls) continue;
      if (existingSet.has(cls.modelId)) {
        // Refresh routing metadata only — admin toggles (enabled /
        // supportsVision) untouched. supportsChat is DERIVED (non-chat ids
        // are a provider fact) so it is always re-applied to heal rows from
        // older discovery runs. contextLength refreshes too (providers
        // upgrade their models) but never clears a stored value on a payload
        // that omits it.
        await db.update(aiModels)
          .set({
            isFree: cls.isFree,
            tier: cls.tier,
            supportsChat: cls.supportsChat,
            ...(cls.contextLength > 0 ? { contextLength: cls.contextLength } : {}),
            status: "unknown",
            failCount: 0,
            lastError: null,
          })
          .where(and(eq(aiModels.providerId, provider.id), eq(aiModels.modelId, cls.modelId)));
      } else {
        await db.insert(aiModels).values({
          providerId: provider.id,
          modelId: cls.modelId,
          supportsChat: cls.supportsChat,
          supportsVision: cls.supportsVision,
          isFree: cls.isFree,
          enabled: true,
          tier: cls.tier,
          ...(cls.contextLength > 0 ? { contextLength: cls.contextLength } : {}),
          status: "unknown",
        });
        inserted++;
      }
      chat++;
      if (cls.supportsVision) vision++;
      if (cls.isFree) free++;
    }

    await updateProviderStatus(provider.id, "healthy", null);
    invalidateAiRouterCache();
    logger.info("[AiRouter] discovery", { provider: provider.slug, listed: chat, inserted, vision, free });
    return { ok: true, found: chat, chat, vision, free };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateProviderStatus(provider.id, "degraded", msg.slice(0, 500));
    logger.warn("[AiRouter] discovery failed", { provider: provider.slug, error: msg });
    return { ok: false, found: 0, chat: 0, vision: 0, free: 0, error: msg };
  }
}

/** Discover every enabled provider (boot + admin refresh-all). Fire-and-forget safe. */
export async function discoverAllProviders(): Promise<void> {
  try {
    const getDb = await lazyGetDb();
    const db = getDb();
    const providers = await db.select().from(aiProviders).where(eq(aiProviders.enabled, true));
    for (const p of providers) {
      if (!p.apiKey) continue;
      await discoverProviderModels(p);
    }
  } catch (err) {
    logger.warn("[AiRouter] discoverAllProviders failed", { error: String(err) });
  }
}

// ════════════════════════════════════════════════════════════════════════
// CIRCUIT BREAKER — in-memory health, DB mirror (best-effort)
// ════════════════════════════════════════════════════════════════════════

const MODEL_COOLDOWN_BASE_MS = 60_000;
const MODEL_COOLDOWN_MAX_MS = 10 * 60_000;
const MODEL_LIMITED_COOLDOWN_MS = 90_000;
const PROVIDER_AUTH_COOLDOWN_MS = 10 * 60_000;
const PROVIDER_FAIL_COOLDOWN_MS = 3 * 60_000;
const MAX_PROVIDER_CONSEC_FAILS = 4;

const modelCooldownUntil = new Map<string, number>(); // "providerId:modelId" → epoch ms
const modelConsecFails = new Map<string, number>();
const providerCooldownUntil = new Map<number, number>();
const providerConsecFails = new Map<number, number>();
/** Mode-scoped last-working candidate — tried first when still healthy. */
const lastWorkingByMode: Record<ChatbotMode, { key: string; time: number }> = {
  thinking: { key: "", time: 0 },
  instant: { key: "", time: 0 },
};
const LAST_WORKING_TTL_MS = 5 * 60_000;

export interface RouterEvent {
  ts: number;
  provider: string;
  model: string;
  kind: "success" | "rate_limited" | "auth_fail" | "dead_model" | "fail" | "skip";
  detail: string;
}

const recentEvents: RouterEvent[] = [];
const RECENT_EVENTS_MAX = 40;

function pushEvent(ev: RouterEvent): void {
  recentEvents.unshift(ev);
  if (recentEvents.length > RECENT_EVENTS_MAX) recentEvents.length = RECENT_EVENTS_MAX;
}

function modelKey(providerId: number, modelId: string): string {
  return `${providerId}:${modelId}`;
}

function modelIsCooling(providerId: number, modelId: string): boolean {
  const until = modelCooldownUntil.get(modelKey(providerId, modelId));
  return !!until && Date.now() < until;
}

function providerIsCooling(providerId: number): boolean {
  const until = providerCooldownUntil.get(providerId);
  return !!until && Date.now() < until;
}

function setModelCooldown(providerId: number, modelId: string, ms: number): void {
  modelCooldownUntil.set(modelKey(providerId, modelId), Date.now() + ms);
}

/** Best-effort DB health mirror — never throws on the hot path. */
async function mirrorModelHealth(aiModelId: number, patch: Partial<typeof aiModels.$inferInsert>): Promise<void> {
  try {
    const getDb = await lazyGetDb();
    await getDb().update(aiModels).set(patch).where(eq(aiModels.id, aiModelId));
  } catch { /* DB hiccup — in-memory breaker still authoritative */ }
}

async function mirrorProviderHealth(providerId: number, patch: Partial<typeof aiProviders.$inferInsert>): Promise<void> {
  try {
    const getDb = await lazyGetDb();
    await getDb().update(aiProviders).set(patch).where(eq(aiProviders.id, providerId));
  } catch { /* best-effort */ }
}

async function updateProviderStatus(providerId: number, status: string, lastError: string | null): Promise<void> {
  await mirrorProviderHealth(providerId, { status, lastError, lastCheckedAt: new Date() });
}

async function markProviderAuthFail(providerId: number): Promise<void> {
  providerCooldownUntil.set(providerId, Date.now() + PROVIDER_AUTH_COOLDOWN_MS);
  providerConsecFails.set(providerId, MAX_PROVIDER_CONSEC_FAILS);
  await mirrorProviderHealth(providerId, { status: "dead", lastError: "مفتاح API مرفوض (401/403)", lastCheckedAt: new Date() });
}

/** Record a success — resets breaker state and remembers the mode shortcut. */
function recordSuccess(provider: AiProvider, model: AiModel, latencyMs: number, mode: ChatbotMode): void {
  const key = modelKey(provider.id, model.modelId);
  modelCooldownUntil.delete(key);
  modelConsecFails.set(key, 0);
  providerCooldownUntil.delete(provider.id);
  providerConsecFails.set(provider.id, 0);
  lastWorkingByMode[mode] = { key, time: Date.now() };
  pushEvent({ ts: Date.now(), provider: provider.slug, model: model.modelId, kind: "success", detail: `${Math.round(latencyMs)}ms` });
  void mirrorModelHealth(model.id, {
    status: "ok",
    failCount: 0,
    lastError: null,
    lastSuccessAt: new Date(),
    lastUsedAt: new Date(),
    latencyMs: Math.round(latencyMs),
  });
  void mirrorProviderHealth(provider.id, { status: "healthy", lastError: null, lastCheckedAt: new Date() });
}

/** Record a classified failure and arm the appropriate cooldown. */
function recordFailure(provider: AiProvider, model: AiModel, kind: Exclude<RouterEvent["kind"], "success" | "skip">, detail: string): void {
  const key = modelKey(provider.id, model.modelId);
  const fails = (modelConsecFails.get(key) || 0) + 1;
  modelConsecFails.set(key, fails);
  pushEvent({ ts: Date.now(), provider: provider.slug, model: model.modelId, kind, detail: detail.slice(0, 160) });

  // A failing model must never keep the lastWorking shortcut — the pin only
  // ever points at models whose streams actually completed (honest pinning).
  // recordFailure is mode-agnostic, so clear the key from both mode pins.
  if (lastWorkingByMode.thinking.key === key) lastWorkingByMode.thinking = { key: "", time: 0 };
  if (lastWorkingByMode.instant.key === key) lastWorkingByMode.instant = { key: "", time: 0 };

  switch (kind) {
    case "auth_fail":
      void markProviderAuthFail(provider.id);
      void mirrorModelHealth(model.id, { status: "dead", failCount: fails, lastError: detail.slice(0, 500) });
      break;
    case "rate_limited": {
      // Exponential backoff per consecutive 429s: 90s → 3m → 6m → 10m (cap)
      const ms = Math.min(MODEL_LIMITED_COOLDOWN_MS * Math.pow(2, fails - 1), MODEL_COOLDOWN_MAX_MS);
      setModelCooldown(provider.id, model.modelId, ms);
      void mirrorModelHealth(model.id, { status: "limited", failCount: fails, lastError: detail.slice(0, 500) });
      break;
    }
    case "dead_model":
      setModelCooldown(provider.id, model.modelId, MODEL_COOLDOWN_MAX_MS);
      void mirrorModelHealth(model.id, { status: "dead", failCount: fails, lastError: detail.slice(0, 500) });
      break;
    default: {
      const ms = Math.min(MODEL_COOLDOWN_BASE_MS * Math.pow(2, fails - 1), MODEL_COOLDOWN_MAX_MS);
      setModelCooldown(provider.id, model.modelId, ms);
      const pFails = (providerConsecFails.get(provider.id) || 0) + 1;
      providerConsecFails.set(provider.id, pFails);
      if (pFails >= MAX_PROVIDER_CONSEC_FAILS) {
        providerCooldownUntil.set(provider.id, Date.now() + PROVIDER_FAIL_COOLDOWN_MS);
      }
      void mirrorModelHealth(model.id, { status: "limited", failCount: fails, lastError: detail.slice(0, 500) });
      break;
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
// CANDIDATE POOL — cached providers + models (30s TTL)
// ════════════════════════════════════════════════════════════════════════

let poolCache: { providers: AiProvider[]; models: Map<number, AiModel[]>; loadedAt: number } | null = null;
const POOL_CACHE_TTL_MS = 30_000;

/** Drop the cached pool (admin mutations call this). */
export function invalidateAiRouterCache(): void {
  poolCache = null;
}

async function loadPool(): Promise<{ providers: AiProvider[]; models: Map<number, AiModel[]> } | null> {
  if (poolCache && Date.now() - poolCache.loadedAt < POOL_CACHE_TTL_MS) {
    return { providers: poolCache.providers, models: poolCache.models };
  }
  try {
    const getDb = await lazyGetDb();
    const db = getDb();
    const providers = await db.select().from(aiProviders).orderBy(asc(aiProviders.priority), asc(aiProviders.id));
    const models = await db.select().from(aiModels).orderBy(asc(aiModels.tier), asc(aiModels.modelId));
    const byProvider = new Map<number, AiModel[]>();
    for (const m of models) {
      const list = byProvider.get(m.providerId) || [];
      list.push(m);
      byProvider.set(m.providerId, list);
    }
    poolCache = { providers, models: byProvider, loadedAt: Date.now() };
    return { providers, models: byProvider };
  } catch (err) {
    logger.warn("[AiRouter] pool load failed — dynamic routing unavailable this round", { error: String(err) });
    return null;
  }
}

export interface RouteCandidate {
  provider: AiProvider;
  model: AiModel;
}

/**
 * Build the ordered failover candidate list:
 *   providers by priority (admin-controlled) → models by tier
 *   (thinking: 1 strongest first / instant: 3 fastest first), skipping
 *   disabled rows, capability mismatches and cooled-down breakers.
 *   `preferredModelId` (instant lane) hoists a specific general-purpose
 *   fast model above the tier sort so instant never lands first on a
 *   code-specialized model that ignores language/format instructions.
 */
export async function buildCandidates(opts: { vision: boolean; mode: ChatbotMode; onlyFree: boolean; exclude?: Set<string>; preferredModelId?: string }): Promise<RouteCandidate[]> {
  const pool = await loadPool();
  if (!pool) return [];

  const candidates: RouteCandidate[] = [];
  for (const provider of pool.providers) {
    if (!provider.enabled || !provider.apiKey) continue;
    if (providerIsCooling(provider.id)) continue;
    const rows = pool.models.get(provider.id) || [];
    const usable = rows
      .filter((m) => m.enabled && (opts.vision ? m.supportsVision : m.supportsChat))
      // Runtime non-chat guard — re-derive the capability from the model id
      // at routing time so rows poisoned by an older classifier (e.g. the
      // lyria music model stored as supportsChat=true) are excluded
      // IMMEDIATELY on deploy, without waiting for an admin re-discovery.
      .filter((m) => !NON_CHAT_RE.test(m.modelId))
      // Specialist models (code/document/tiny) never serve the GENERAL chat
      // lane (they can still appear in the dashboard). Vision lane — no overlap.
      .filter((m) => opts.vision || !SPECIALIST_CHAT_RE.test(m.modelId))
      .filter((m) => !opts.onlyFree || m.isFree)
      .filter((m) => !modelIsCooling(provider.id, m.modelId))
      .filter((m) => !opts.exclude?.has(modelKey(provider.id, m.modelId)));
    usable.sort((a, b) => (opts.mode === "instant" ? b.tier - a.tier : a.tier - b.tier));
    for (const m of usable) candidates.push({ provider, model: m });
  }

  // Mode-scoped last-working shortcut: hop straight to what worked recently.
  // (Order: tier sort → preferred model → lastWorking pin — the pin still
  // wins because it is only set by streams that actually completed.)
  if (opts.preferredModelId) {
    const idx = candidates.findIndex((c) => c.model.modelId === opts.preferredModelId);
    if (idx > 0) {
      const [first] = candidates.splice(idx, 1);
      candidates.unshift(first);
    }
  }
  const lw = lastWorkingByMode[opts.mode];
  if (lw.key && !opts.exclude?.has(lw.key) && Date.now() - lw.time < LAST_WORKING_TTL_MS) {
    const idx = candidates.findIndex((c) => modelKey(c.provider.id, c.model.modelId) === lw.key);
    if (idx > 0) {
      const [first] = candidates.splice(idx, 1);
      candidates.unshift(first);
    }
  }
  return candidates;
}

// ════════════════════════════════════════════════════════════════════════
// UPSTREAM CALLS — generic OpenAI-compatible (stream + non-stream)
// ════════════════════════════════════════════════════════════════════════

interface AttemptParams {
  provider: AiProvider;
  model: AiModel;
  systemPrompt: string;
  messages: RouteMessage[];
  gen: RouteGenParams;
  stream: boolean;
  /** Web-grounding (OpenRouter web plugin) requested for this attempt. */
  webSearch?: boolean;
}

interface AttemptFailure {
  kind: Exclude<RouterEvent["kind"], "success" | "skip">;
  detail: string;
  /** HTTP status when the failure came from a response (plugin-breaker input). */
  status?: number;
}

// ── WEB GROUNDING (OpenRouter web plugin) ────────────────────────────────
// The bot must answer with DOCUMENTED facts. OpenRouter exposes live web
// search as a server-side plugin: it runs the search and injects the results
// into the model's context. Only OpenRouter understands the `plugins` field —
// attaching it to Groq/NVIDIA/strict custom providers would 400 them.

export const WEB_PLUGIN_BODY = { id: "web", max_results: 3 } as const;

/** True only for providers whose API supports the web plugin field. */
export function isOpenRouterProvider(p: { slug?: string | null; baseUrl: string }): boolean {
  return p.slug === "openrouter" || /openrouter\.ai/i.test(p.baseUrl);
}

// Circuit breaker: when OpenRouter rejects the plugin (402 — the key has no
// credits for web results, or 400 — plugin field refused), stop attaching it
// for a while instead of paying one wasted round-trip on every request.
// Grounding may degrade gracefully (the prompt-level accuracy contract still
// forbids guessing) but chat availability must NEVER drop because of it.
let webPluginDisabledUntil = 0;
export function isWebPluginDisabled(): boolean {
  return Date.now() < webPluginDisabledUntil;
}
export function disableWebPluginFor(ms = 10 * 60_000): void {
  if (ms <= 0) {
    // Full reset (used by tests and future admin re-enable paths).
    webPluginDisabledUntil = 0;
    return;
  }
  webPluginDisabledUntil = Math.max(webPluginDisabledUntil, Date.now() + ms);
}

export function buildUpstreamBody(p: AttemptParams, stream: boolean): string {
  const wantsWeb = p.webSearch === true && !isWebPluginDisabled() && isOpenRouterProvider(p.provider);
  // MAX_TOKENS CLAMP — small-context models (e.g. groq allam-2-7b, ctx 4096)
  // reject thinking's 8192 max_tokens with a 400, which used to take out the
  // whole tier-3 safety net during free-tier 429 storms. Clamp to a third of
  // the model's context when that is smaller than the requested budget; big
  // models are unaffected (ctx/3 ≥ 8192 for anything ≥ 24k context).
  const requested = p.gen.maxTokens;
  const ctx = p.model.contextLength ?? 0;
  const maxTokens = ctx > 0
    ? Math.min(requested, Math.max(512, Math.floor(ctx / 3)))
    : requested;
  return JSON.stringify({
    model: p.model.modelId,
    messages: [{ role: "system", content: p.systemPrompt }, ...p.messages],
    temperature: p.gen.temperature,
    max_tokens: maxTokens,
    ...(stream ? { stream: true } : {}),
    ...(wantsWeb ? { plugins: [WEB_PLUGIN_BODY] } : {}),
  });
}

async function rawUpstreamFetch(p: AttemptParams): Promise<{ ok: true; response: Response; latencyMs: number } | { ok: false; failure: AttemptFailure }> {
  const started = Date.now();
  const url = `${p.provider.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  // WEB ATTEMPTS GET A TIGHT BUDGET: the plugin runs the search server-side
  // BEFORE generation, so its TTFT is search + queue. A plugin'd candidate
  // that cannot even start inside 8s is a bad candidate regardless of model —
  // letting it hold the full 20s timeout burns the walk's global budget before
  // the next providers are ever tried (live-verified 503 storm). 2 × 8s still
  // fits the thinking walk's 22s budget.
  const attemptTimeoutMs = p.webSearch ? Math.min(p.gen.attemptTimeoutMs, 8_000) : p.gen.attemptTimeoutMs;
  try {
    // For STREAM requests the timeout must bound only the HEADER wait.
    // AbortSignal.timeout() stays attached to the body and would kill any
    // generation longer than attemptTimeoutMs mid-stream (a silent truncation
    // source for long, detailed answers). A manual controller aborted by a
    // timer that is cleared once headers arrive keeps the body unbounded —
    // stall/death detection is the gated stream's job, not the fetch's.
    let response: Response;
    if (p.stream) {
      const ctrl = new AbortController();
      const headerTimer = setTimeout(() => ctrl.abort(new Error("upstream header timeout")), attemptTimeoutMs);
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${p.provider.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://ahmedelbaz.qzz.io",
            "X-Title": "Elbaz Platform Chatbot",
          },
          body: buildUpstreamBody(p, p.stream),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(headerTimer);
      }
    } else {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${p.provider.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://ahmedelbaz.qzz.io",
          "X-Title": "Elbaz Platform Chatbot",
        },
        body: buildUpstreamBody(p, p.stream),
        signal: AbortSignal.timeout(attemptTimeoutMs),
      });
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, failure: { kind: "auth_fail", status: response.status, detail: `HTTP ${response.status} — key rejected by ${p.provider.slug}` } };
    }
    if (response.status === 429) {
      return { ok: false, failure: { kind: "rate_limited", status: 429, detail: `HTTP 429 — ${p.provider.slug}/${p.model.modelId} quota/rate exhausted` } };
    }
    if (response.status === 404) {
      return { ok: false, failure: { kind: "dead_model", status: 404, detail: `HTTP 404 — model id not found on ${p.provider.slug}` } };
    }
    if (!response.ok) {
      return { ok: false, failure: { kind: "fail", status: response.status, detail: `HTTP ${response.status} from ${p.provider.slug}` } };
    }
    return { ok: true, response, latencyMs: Date.now() - started };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, failure: { kind: "fail", detail: msg } };
  }
}

/**
 * attemptUpstream = rawUpstreamFetch + the web-plugin breaker.
 * A 402/400 received while the plugin was attached is a BILLING/COMPAT
 * problem, not a model problem: the model is not blamed (no cooldown), the
 * plugin is disabled for a while and the SAME candidate is retried once
 * without it. Grounding can never cost availability.
 */
export async function attemptUpstream(p: AttemptParams): Promise<{ ok: true; response: Response; latencyMs: number } | { ok: false; failure: AttemptFailure }> {
  const first = await rawUpstreamFetch(p);
  if (
    !first.ok &&
    p.webSearch === true &&
    !isWebPluginDisabled() &&
    isOpenRouterProvider(p.provider) &&
    (first.failure.status === 402 || first.failure.status === 400)
  ) {
    disableWebPluginFor();
    logger.warn(`[AiRouter] web plugin rejected (HTTP ${first.failure.status}) — disabled 10 min, retrying without it`, { provider: p.provider.slug, model: p.model.modelId });
    return rawUpstreamFetch(p);
  }
  return first;
}

async function readNonStreamReply(response: Response): Promise<{ ok: true; reply: string } | { ok: false; detail: string }> {
  try {
    const data = (await response.json()) as { error?: unknown; choices?: { message?: { content?: string | null } }[] };
    if (data.error) {
      const detail = typeof data.error === "string" ? data.error : JSON.stringify(data.error);
      return { ok: false, detail: detail.slice(0, 200) };
    }
    // stripThinkBlocks: hard zero-gap guarantee — a model that embeds
    // <think>/<reasoning> blocks in content never leaks them. An empty
    // after-strip reply counts as a failure (the walk continues).
    const reply = stripThinkBlocks(data.choices?.[0]?.message?.content ?? "");
    if (!reply || !reply.trim()) return { ok: false, detail: "empty completion" };
    return { ok: true, reply: reply.trim() };
  } catch (err) {
    return { ok: false, detail: `bad JSON payload: ${String(err).slice(0, 120)}` };
  }
}

/**
 * Transform an upstream OpenAI SSE stream into our lightweight
 * `data: {"text": "…"}` protocol (same wire format as chatbot-stream.ts).
 */
export function buildUpstreamSSETransform(encoder: TextEncoder): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  // Reasoning-guard: <think>/<reasoning> blocks embedded in delta.content are
  // stripped even when their tags arrive split across chunks.
  const think = new ThinkStreamFilter();
  let buffer = "";
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]" || !trimmed.startsWith("data: ")) continue;
        try {
          const parsed = JSON.parse(trimmed.slice(6)) as { choices?: { delta?: { content?: string } }[] };
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            const safe = think.push(content);
            if (safe) {
              try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: sanitizeReplyOutput(safe) })}\n\n`)); } catch { /* closed */ }
            }
          }
        } catch { /* skip malformed chunk */ }
      }
    },
    flush(controller) {
      const rest = buffer.trim();
      if (rest.startsWith("data: ") && rest.slice(6).trim() !== "[DONE]") {
        try {
          const parsed = JSON.parse(rest.slice(6)) as { choices?: { delta?: { content?: string } }[] };
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            const safe = think.push(content);
            if (safe) {
              try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: sanitizeReplyOutput(safe) })}\n\n`)); } catch { /* closed */ }
            }
          }
        } catch { /* skip */ }
      }
      // Emit any tail the filter held back; an unclosed <think> flushes "".
      const tail = think.flush();
      if (tail) {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: sanitizeReplyOutput(tail) })}\n\n`)); } catch { /* closed */ }
      }
      try { controller.enqueue(encoder.encode("data: [DONE]\n\n")); } catch { /* closed */ }
      try { controller.terminate(); } catch { /* terminated */ }
    },
  });
}

// ════════════════════════════════════════════════════════════════════════
// MAIN ROUTERS — walk candidates until one answers (model ↔ provider failover)
// ════════════════════════════════════════════════════════════════════════

export interface RouteRequest {
  messages: RouteMessage[];
  systemPrompt: string;
  mode: ChatbotMode;
  vision: boolean;
  gen: RouteGenParams;
  /** Reply language hint (ar/en) — used by the mid-stream continuation rescue. */
  language?: string;
  /** modelKeys to skip — e.g. the model whose stream just died mid-way. */
  exclude?: Set<string>;
  /** Hoist this exact model id to the front (instant lane preference). */
  preferredModelId?: string;
  /** Attach the OpenRouter web plugin (documented-answer grounding). */
  webSearch?: boolean;
}

/**
 * Non-streaming failover walk. Returns null when the dynamic pool cannot
 * serve the request — callers MUST fall back to the legacy cascade.
 */
export async function routeChatCompletion(req: RouteRequest): Promise<RoutingOutcome<RoutedReply>> {
  const candidates = await buildCandidates({ vision: req.vision, mode: req.mode, onlyFree: true, exclude: req.exclude, preferredModelId: req.preferredModelId });
  if (candidates.length === 0) return { ok: false };

  const deadline = Date.now() + req.gen.globalBudgetMs;
  let attempted = 0;
  // WEB BUDGET: at most TWO plugin'd attempts per request (the first one, plus
  // one spare for a fast-fail like 429). The rest of the walk runs plugin-free
  // so search latency can never stack across candidates — grounding rides the
  // best candidate, it never slows the failover walk.
  let webBudget = req.webSearch ? 2 : 0;

  for (const { provider, model } of candidates) {
    if (Date.now() > deadline) break;
    attempted++;

    const useWeb = webBudget > 0 && isOpenRouterProvider(provider);
    if (useWeb) webBudget--;
    const attempt = await attemptUpstream({ provider, model, systemPrompt: req.systemPrompt, messages: req.messages, gen: req.gen, stream: false, webSearch: useWeb });
    if (!attempt.ok) {
      recordFailure(provider, model, attempt.failure.kind, attempt.failure.detail);
      continue;
    }
    const reply = await readNonStreamReply(attempt.response);
    if (!reply.ok) {
      recordFailure(provider, model, "fail", reply.detail);
      continue;
    }

    recordSuccess(provider, model, attempt.latencyMs, req.mode);
    logger.info(`[AiRouter] served by ${provider.slug}/${model.modelId} (attempt ${attempted}, ${Math.round(attempt.latencyMs)}ms)`);
    return {
      ok: true,
      result: { reply: reply.reply, model: `${provider.slug}/${model.modelId}`, providerId: provider.id, aiModelId: model.id },
    };
  }

  logger.info(`[AiRouter] no dynamic candidate answered (${attempted} tried) — caller falls back to legacy cascade`);
  return { ok: false };
}

// ════════════════════════════════════════════════════════════════════════
// GATED STREAMING — first-event liveness gate + honest pinning + mid-stream
// rescue. Root-cause fix for the "brain icon ON gives dumb fixed replies"
// production incident: routeChatStream used to recordSuccess the moment the
// upstream ACCEPTED the request (headers only), so a model that accepted and
// then streamed nothing/garbage/truncated text was pinned as
// lastWorkingByMode[mode] and kept serving every request in that mode.
// ════════════════════════════════════════════════════════════════════════

interface UpstreamEvent {
  text?: string;
  /** reasoning_content delta — proof of liveness, never forwarded. */
  reasoning?: boolean;
  finish?: string;
  done?: boolean;
  error?: string;
}

/** Parse one upstream SSE line into a typed event (null when ignorable). */
export function parseUpstreamSseLine(line: string): UpstreamEvent | null {
  const s = line.trim();
  if (!s.startsWith("data: ")) return null;
  const raw = s.slice(6).trim();
  if (raw === "[DONE]") return { done: true };
  if (!raw || raw.startsWith(":")) return null; // keep-alive comment
  try {
    const parsed = JSON.parse(raw) as {
      error?: unknown;
      choices?: { delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown }; finish_reason?: unknown }[];
    };
    if (parsed.error) {
      return { error: typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed.error).slice(0, 200) };
    }
    const choice = parsed.choices?.[0];
    if (!choice) return null;
    const ev: UpstreamEvent = {};
    const content = choice.delta?.content;
    if (typeof content === "string" && content) ev.text = content;
    const rs = choice.delta?.reasoning_content ?? choice.delta?.reasoning;
    if (typeof rs === "string" && rs) ev.reasoning = true;
    if (typeof choice.finish_reason === "string" && choice.finish_reason) ev.finish = choice.finish_reason;
    if (!ev.text && !ev.reasoning && !ev.finish) return null;
    return ev;
  } catch {
    return null;
  }
}

interface PeekOk {
  ok: true;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  /** Same decoder the peek used — its multibyte state must survive. */
  decoder: TextDecoder;
  /** Unparsed partial line carried over from the peek. */
  buffer: string;
  /** Content captured during the peek ("" when liveness came from reasoning). */
  headText: string;
}

/**
 * Read the upstream just past its FIRST meaningful SSE event (content or
 * reasoning delta). A candidate that cannot produce one within the timeout
 * is recorded as a failure and the walk continues — accepting it is what
 * poisoned the pin. The reader/decoder/buffer are returned so the winner's
 * wrapper can continue streaming without losing bytes.
 */
async function peekUpstreamLiveness(body: ReadableStream<Uint8Array>, timeoutMs: number): Promise<PeekOk | { ok: false; detail: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let headText = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let chunk: Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const readPromise = reader.read();
    readPromise.catch(() => { /* settled via cancel below — never unhandled */ });
    try {
      chunk = await Promise.race([
        readPromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("no first SSE event before timeout")), Math.max(250, deadline - Date.now()));
        }),
      ]);
    } catch (err) {
      try { await reader.cancel(); } catch { /* already dead */ }
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }

    if (chunk.done) {
      return { ok: false, detail: "upstream closed before any SSE event" };
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const ev = parseUpstreamSseLine(line);
      if (!ev) continue;
      if (ev.error) {
        try { await reader.cancel(); } catch { /* already dead */ }
        return { ok: false, detail: `upstream error event: ${ev.error}` };
      }
      if (ev.text) {
        headText += ev.text;
        return { ok: true, reader, decoder, buffer, headText };
      }
      if (ev.reasoning) {
        // Model is alive and thinking — accept; the wrapper's rescue covers
        // the rare case where it finishes without ever emitting content.
        return { ok: true, reader, decoder, buffer, headText: "" };
      }
      if (ev.finish || ev.done) {
        try { await reader.cancel(); } catch { /* already dead */ }
        return { ok: false, detail: "upstream finished without any content" };
      }
    }
  }
  try { await reader.cancel(); } catch { /* already dead */ }
  return { ok: false, detail: "no first SSE event before timeout" };
}

const SENTENCE_END_RE = /[.!?…:؛،"'”’）)\]】»*]\s*$/;

/** Heuristic: the text ends like a finished sentence (not cut mid-thought). */
export function looksComplete(text: string): boolean {
  const t = text.trimEnd();
  if (!t) return false;
  return SENTENCE_END_RE.test(t);
}

function continuationInstruction(language?: string): string {
  return language === "en"
    ? "Continue your previous answer EXACTLY from where it stopped — no repetition of anything already written, no preamble, no apologies. Resume mid-sentence if needed."
    : "أكمل إجابتك السابقة من حيث توقفت تماماً — دون تكرار أي كلمة سبق كتابتها، ودون مقدمات أو اعتذارات. تابع من منتصف الجملة إن لزم.";
}

/**
 * One-shot in-flight rescue for a stream that died prematurely: continue the
 * partial answer on the NEXT healthy candidate (assistant prefill + explicit
 * continuation instruction), or regenerate from scratch when nothing usable
 * arrived. Returns the rescue text or null.
 */
async function rescueRound(req: RouteRequest, deadKey: string, partial: string): Promise<string | null> {
  const messages: RouteMessage[] = partial
    ? [...req.messages, { role: "assistant", content: partial }, { role: "user", content: continuationInstruction(req.language) }]
    : req.messages;
  const rescued = await routeChatCompletion({ ...req, messages, exclude: new Set([deadKey]) });
  if (!rescued.ok) return null;
  const reply = rescued.result.reply?.trim();
  if (!reply) return null;
  if (partial) {
    // Degenerate-restart guard: the rescue model repeated the answer from
    // the beginning instead of continuing — emitting it would duplicate text.
    const head = partial.trim().slice(0, 40);
    if (reply.startsWith(head)) return null;
  }
  return reply;
}

/**
 * The winner's public stream: re-emits the peeked head, pumps the rest of
 * the upstream, and — when the upstream dies WITHOUT a finish marker —
 * repairs the answer in-flight via rescueRound instead of leaving the user
 * with a truncated reply. Success is recorded only when the stream actually
 * completed, so the lastWorking pin never points at a broken model.
 */
function buildResilientUpstreamStream(params: {
  winner: { provider: AiProvider; model: AiModel; key: string; latencyMs: number };
  reader: ReadableStreamDefaultReader<Uint8Array>;
  decoder: TextDecoder;
  buffer: string;
  headText: string;
  req: RouteRequest;
  encoder: TextEncoder;
  /** Mid-stream idle watchdog — a stalled upstream counts as premature death. */
  idleTimeoutMs: number;
}): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        const { provider, model, key, latencyMs } = params.winner;
        // Reasoning-guard: every emitted delta passes the think filter, so
        // <think> blocks never reach the client and `total` (used for the
        // completion heuristics + rescue prefill) is the VISIBLE text only.
        const think = new ThinkStreamFilter();
        let buffer = params.buffer;
        let total = "";
        let finish: string | null = null;
        let sawDone = false;
        let streamError: string | null = null;

        const emit = (text: string) => {
          if (!text) return;
          const safe = think.push(text);
          if (!safe) return;
          total += safe;
          try { controller.enqueue(params.encoder.encode(`data: ${JSON.stringify({ text: sanitizeReplyOutput(safe) })}\n\n`)); } catch { /* client gone */ }
        };
        emit(params.headText);

        try {
          while (true) {
            let chunk: Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const readPromise = params.reader.read();
            readPromise.catch(() => { /* settled via cancel — never unhandled */ });
            try {
              chunk = await Promise.race([
                readPromise,
                new Promise<never>((_, reject) => {
                  timer = setTimeout(() => reject(new Error("upstream stalled mid-stream")), params.idleTimeoutMs);
                }),
              ]);
            } finally {
              clearTimeout(timer);
            }
            if (chunk.done) break;
            buffer += params.decoder.decode(chunk.value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            let fatal = false;
            for (const line of lines) {
              const ev = parseUpstreamSseLine(line);
              if (!ev) continue;
              if (ev.error) { streamError = ev.error; fatal = true; break; }
              if (ev.text) { total += ev.text; emit(ev.text); }
              if (ev.finish) finish = ev.finish;
              if (ev.done) sawDone = true;
            }
            if (fatal) break;
          }
        } catch (err) {
          streamError = err instanceof Error ? err.message : String(err);
        } finally {
          try { params.reader.releaseLock(); } catch { /* already released */ }
        }

        const premature = !finish && !sawDone;

        // Flush the think filter tail before judging completeness — held-back
        // text (partial tags) is real content the user must receive.
        const tail = think.flush();
        if (tail) {
          total += tail;
          try { controller.enqueue(params.encoder.encode(`data: ${JSON.stringify({ text: sanitizeReplyOutput(tail) })}\n\n`)); } catch { /* client gone */ }
        }
        const visible = total.trim();

        if (!premature && visible) {
          recordSuccess(provider, model, latencyMs, params.req.mode);
        } else if (visible && looksComplete(visible)) {
          // Clean prose ending without a finish marker — some providers omit
          // [DONE]; accept the answer instead of risking a junk continuation.
          recordSuccess(provider, model, latencyMs, params.req.mode);
        } else {
          // Content-then-death / stall / reasoning-only death / finished with
          // ZERO visible content (reasoning burn) — repair live.
          recordFailure(provider, model, "fail", `midstream death: ${String(streamError || "no finish marker").slice(0, 120)}`);
          try {
            const rescued = await rescueRound(params.req, key, visible);
            if (rescued) {
              total += rescued;
              emit(rescued);
            }
          } catch { /* rescue failed — emit what we have (never worse than before) */ }
        }

        try { controller.enqueue(params.encoder.encode("data: [DONE]\n\n")); } catch { /* client gone */ }
        try { controller.close(); } catch { /* already closed */ }
      })();
    },
    cancel() {
      try { params.reader.cancel(); } catch { /* already dead */ }
    },
  });
}

/**
 * Streaming failover walk — now GATED: a candidate wins only after proving
 * liveness with a real first SSE event, and its success is recorded only
 * when the stream actually completes. Mid-stream deaths are repaired
 * in-flight instead of surfacing truncated replies.
 */
export async function routeChatStream(req: RouteRequest): Promise<RoutingOutcome<RoutedStream>> {
  const candidates = await buildCandidates({ vision: req.vision, mode: req.mode, onlyFree: true, exclude: req.exclude, preferredModelId: req.preferredModelId });
  if (candidates.length === 0) return { ok: false };

  const deadline = Date.now() + req.gen.globalBudgetMs;
  // Reasoning models may emit thinking deltas for a while before content —
  // the gate accepts ANY meaningful event, so these budgets are generous.
  const firstEventTimeoutMs = req.mode === "instant" ? 8_000 : 20_000;
  const idleTimeoutMs = req.mode === "instant" ? 15_000 : 30_000;
  let attempted = 0;
  // WEB BUDGET — same two-attempt policy as routeChatCompletion.
  let webBudget = req.webSearch ? 2 : 0;

  for (const { provider, model } of candidates) {
    if (Date.now() > deadline) break;
    attempted++;

    const useWeb = webBudget > 0 && isOpenRouterProvider(provider);
    if (useWeb) webBudget--;
    const attempt = await attemptUpstream({ provider, model, systemPrompt: req.systemPrompt, messages: req.messages, gen: req.gen, stream: true, webSearch: useWeb });
    if (!attempt.ok) {
      recordFailure(provider, model, attempt.failure.kind, attempt.failure.detail);
      continue;
    }
    if (!attempt.response.body) {
      recordFailure(provider, model, "fail", "empty stream body");
      continue;
    }

    const peekBudget = Math.min(firstEventTimeoutMs, Math.max(2_000, deadline - Date.now()));
    const peek = await peekUpstreamLiveness(attempt.response.body, peekBudget);
    if (!peek.ok) {
      recordFailure(provider, model, "fail", peek.detail);
      continue;
    }

    const modelTag = `${provider.slug}/${model.modelId}`;
    logger.info(`[AiRouter] streaming via ${modelTag} (attempt ${attempted}, first event peeked)`);
    return {
      ok: true,
      result: {
        stream: buildResilientUpstreamStream({
          winner: { provider, model, key: modelKey(provider.id, model.modelId), latencyMs: attempt.latencyMs },
          reader: peek.reader,
          decoder: peek.decoder,
          buffer: peek.buffer,
          headText: peek.headText,
          req,
          encoder: new TextEncoder(),
          idleTimeoutMs,
        }),
        model: modelTag,
        providerId: provider.id,
        aiModelId: model.id,
      },
    };
  }

  logger.info(`[AiRouter] no dynamic streaming candidate answered (${attempted} tried) — caller falls back to legacy cascade`);
  return { ok: false };
}

// ════════════════════════════════════════════════════════════════════════
// ADMIN SUPPORT — health snapshot + connectivity test
// ════════════════════════════════════════════════════════════════════════

export interface RouterHealthSnapshot {
  providers: { slug: string; displayName: string; status: string; coolingForMs: number; models: number; enabledModels: number }[];
  lastWorking: { thinking: string; instant: string };
  events: RouterEvent[];
  poolSize: number;
}

export async function getRouterHealthSnapshot(): Promise<RouterHealthSnapshot> {
  const pool = await loadPool();
  const providers = (pool?.providers || []).map((p) => {
    const rows = pool?.models.get(p.id) || [];
    return {
      slug: p.slug,
      displayName: p.displayName,
      status: p.status,
      coolingForMs: Math.max(0, (providerCooldownUntil.get(p.id) || 0) - Date.now()),
      models: rows.length,
      enabledModels: rows.filter((m) => m.enabled).length,
    };
  });
  const fmt = (e: { key: string; time: number }) => (e.key && Date.now() - e.time < LAST_WORKING_TTL_MS ? e.key : "");
  return {
    providers,
    lastWorking: { thinking: fmt(lastWorkingByMode.thinking), instant: fmt(lastWorkingByMode.instant) },
    events: recentEvents.slice(0, 25),
    poolSize: candidatesPoolSize(),
  };
}

function candidatesPoolSize(): number {
  if (!poolCache) return 0;
  let n = 0;
  for (const rows of poolCache.models.values()) n += rows.length;
  return n;
}

/**
 * Tiny connectivity test used by the admin "اختبار" button: asks the best
 * enabled chat model to say OK. Bounded at 15s.
 */
export async function testProvider(provider: AiProvider): Promise<{ ok: boolean; latencyMs: number; model?: string; error?: string }> {
  const getDb = await lazyGetDb();
  const db = getDb();
  const rows = await db.select().from(aiModels)
    .where(and(eq(aiModels.providerId, provider.id), eq(aiModels.enabled, true), eq(aiModels.supportsChat, true)))
    .orderBy(asc(aiModels.tier), asc(aiModels.modelId));
  const candidates = rows.filter((m) => !modelIsCooling(provider.id, m.modelId));
  const pool = candidates.length > 0 ? candidates : rows;
  if (pool.length === 0) return { ok: false, latencyMs: 0, error: "لا توجد نماذج مكتشفة — شغّل فحص النماذج أولاً" };

  const started = Date.now();
  for (const m of pool.slice(0, 4)) {
    const attempt = await attemptUpstream({
      provider,
      model: m,
      systemPrompt: "You are a connectivity probe. Reply with exactly: OK",
      messages: [{ role: "user", content: "ping" }],
      gen: { temperature: 0, maxTokens: 16, attemptTimeoutMs: 15_000, globalBudgetMs: 15_000 },
      stream: false,
    });
    if (!attempt.ok) continue;
    const reply = await readNonStreamReply(attempt.response);
    if (reply.ok) {
      const latencyMs = Date.now() - started;
      recordSuccess(provider, m, latencyMs, "thinking");
      return { ok: true, latencyMs, model: m.modelId };
    }
  }
  return { ok: false, latencyMs: Date.now() - started, error: "فشلت كل محاولات الاختبار — راجع حالة المزود والنماذج" };
}
