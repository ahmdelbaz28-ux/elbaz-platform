/**
 * WEB GROUNDING + ACCURACY CONTRACT — zero-gap test suite (Task 13)
 *
 * Covers the three product policies added on top of the Task-12 routing
 * guard:
 *   1. WEB REACH — the OpenRouter web plugin is attached ONLY to OpenRouter
 *      candidates, ONLY when requested, and a 402/400 plugin rejection
 *      triggers the breaker + a same-model retry WITHOUT the plugin
 *      (grounding must never cost availability or blame a healthy model).
 *   2. ACCURACY CONTRACT — the system prompt carries the no-guess contract +
 *      clarification gate (both languages, thinking lane), instant keeps the
 *      condensed rules and never receives the heavy blocks.
 *   3. Prompt composition order — research → accuracy contract → expert core
 *      → catalog-last is preserved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildUpstreamBody,
  attemptUpstream,
  isOpenRouterProvider,
  isWebPluginDisabled,
  disableWebPluginFor,
  WEB_PLUGIN_BODY,
  type RouteGenParams,
} from "./ai-router.js";
import { getSystemPrompt } from "./chatbot-prompts.js";
import type { AiModel, AiProvider } from "@db/schema";

// ── Fixtures ───────────────────────────────────────────────────────────────

const GEN: RouteGenParams = { temperature: 0.3, maxTokens: 512, attemptTimeoutMs: 5_000, globalBudgetMs: 10_000 };

const openrouterProvider = {
  id: 1,
  slug: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "sk-or-test",
  enabled: true,
  priority: 1,
  status: "active",
  displayName: "OpenRouter",
} as unknown as AiProvider;

const groqProvider = {
  id: 2,
  slug: "groq",
  baseUrl: "https://api.groq.com/openai/v1",
  apiKey: "gsk-test",
  enabled: true,
  priority: 2,
  status: "active",
  displayName: "Groq",
} as unknown as AiProvider;

const model = {
  id: 11,
  providerId: 1,
  modelId: "test/free-model",
  supportsChat: true,
  supportsVision: false,
  isFree: true,
  tier: 1,
  enabled: true,
  contextLength: 8192,
} as unknown as AiModel;

const MESSAGES = [{ role: "user", content: "ما آخر إصدار من ETAP؟" }];

// ── isOpenRouterProvider / buildUpstreamBody ───────────────────────────────

describe("web plugin attach rules (buildUpstreamBody)", () => {
  it("detects OpenRouter by slug or baseUrl and rejects other providers", () => {
    expect(isOpenRouterProvider(openrouterProvider)).toBe(true);
    expect(isOpenRouterProvider({ slug: "custom", baseUrl: "https://openrouter.ai/api/v1" })).toBe(true);
    expect(isOpenRouterProvider(groqProvider)).toBe(false);
    expect(isOpenRouterProvider({ slug: "nvidia", baseUrl: "https://integrate.api.nvidia.com/v1" })).toBe(false);
  });

  beforeEach(() => {
    disableWebPluginFor(0); // reset the shared breaker
  });

  afterEach(() => {
    disableWebPluginFor(0);
    vi.restoreAllMocks();
  });

  it("attaches the plugin only when webSearch=true AND provider is OpenRouter", () => {
    const withWeb = JSON.parse(buildUpstreamBody({ provider: openrouterProvider, model, systemPrompt: "s", messages: MESSAGES, gen: GEN, stream: false, webSearch: true }, false));
    expect(withWeb.plugins).toEqual([WEB_PLUGIN_BODY]);

    const noFlag = JSON.parse(buildUpstreamBody({ provider: openrouterProvider, model, systemPrompt: "s", messages: MESSAGES, gen: GEN, stream: false }, false));
    expect(noFlag.plugins).toBeUndefined();

    const otherProvider = JSON.parse(buildUpstreamBody({ provider: groqProvider, model, systemPrompt: "s", messages: MESSAGES, gen: GEN, stream: false, webSearch: true }, false));
    expect(otherProvider.plugins).toBeUndefined(); // never sent to Groq/NVIDIA/custom

    const streamBody = JSON.parse(buildUpstreamBody({ provider: openrouterProvider, model, systemPrompt: "s", messages: MESSAGES, gen: GEN, stream: true, webSearch: true }, true));
    expect(streamBody.plugins).toEqual([WEB_PLUGIN_BODY]);
    expect(streamBody.stream).toBe(true);
  });

  it("honors the circuit breaker: no plugin while disabled, and the breaker resets", () => {
    disableWebPluginFor(60_000);
    expect(isWebPluginDisabled()).toBe(true);
    const body = JSON.parse(buildUpstreamBody({ provider: openrouterProvider, model, systemPrompt: "s", messages: MESSAGES, gen: GEN, stream: false, webSearch: true }, false));
    expect(body.plugins).toBeUndefined();
    disableWebPluginFor(0);
    expect(isWebPluginDisabled()).toBe(false);
  });
});

// ── attemptUpstream — 402 breaker + same-model retry ──────────────────────

describe("attemptUpstream web-plugin breaker", () => {
  beforeEach(() => {
    disableWebPluginFor(0);
  });
  afterEach(() => {
    disableWebPluginFor(0);
    vi.restoreAllMocks();
  });

  function okReply() {
    return new Response(JSON.stringify({ choices: [{ message: { content: "رد موثق" } }] }), { status: 200 });
  }

  it("retries the SAME model WITHOUT the plugin on 402 and engages the breaker", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 402, message: "Not enough credits" } }), { status: 402 }))
      .mockResolvedValueOnce(okReply());
    vi.stubGlobal("fetch", fetchMock);

    const res = await attemptUpstream({ provider: openrouterProvider, model, systemPrompt: "s", messages: MESSAGES, gen: GEN, stream: false, webSearch: true });
    expect(res.ok).toBe(true); // the retry saved the attempt
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(firstBody.plugins).toEqual([WEB_PLUGIN_BODY]);
    expect(secondBody.plugins).toBeUndefined(); // retried clean
    expect(isWebPluginDisabled()).toBe(true);   // breaker engaged for the pool
  });

  it("blames the model (fail, no retry) on 402 when webSearch was NOT requested", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "boom" }), { status: 402 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await attemptUpstream({ provider: openrouterProvider, model, systemPrompt: "s", messages: MESSAGES, gen: GEN, stream: false });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure.status).toBe(402);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isWebPluginDisabled()).toBe(false);
  });

  it("does NOT retry non-plugin failures (429 stays a plain rate-limit skip)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "rate" }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await attemptUpstream({ provider: openrouterProvider, model, systemPrompt: "s", messages: MESSAGES, gen: GEN, stream: false, webSearch: true });
    expect(res.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never attaches the plugin to a non-OpenRouter provider even when requested", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okReply());
    vi.stubGlobal("fetch", fetchMock);

    const res = await attemptUpstream({ provider: groqProvider, model: { ...model, modelId: "llama-3.3-70b" } as unknown as AiModel, systemPrompt: "s", messages: MESSAGES, gen: GEN, stream: false, webSearch: true });
    expect(res.ok).toBe(true);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.plugins).toBeUndefined();
  });
});

// ── System prompt composition (accuracy contract + web block) ─────────────

describe("getSystemPrompt — accuracy contract + web grounding (v3)", () => {
  it("Arabic thinking prompt carries the no-guess contract, clarification gate, web block, flow rule and guide-don't-operate", () => {
    const p = getSystemPrompt("ar", "thinking");
    expect(p).toContain("عقد الدقة المطلق");
    expect(p).toContain("بوابة الاستيضاح");
    expect(p).toContain("ممنوع التخمين نهائياً");
    expect(p).toContain("وصول الإنترنت");
    expect(p).toContain("مخطط تدفق نصياً");
    expect(p).toContain("لا تدّعي أبداً أنك نفّذت شيئاً");
    expect(p).toContain("لا تستخدم جداول Markdown");
    expect(p).toContain("ETAP EXPERT SYSTEM"); // expert core still present
  });

  it("English thinking prompt carries the contract, gate, web block and flow rule", () => {
    const p = getSystemPrompt("en", "thinking");
    expect(p).toContain("ABSOLUTE ACCURACY CONTRACT");
    expect(p).toContain("CLARIFICATION GATE");
    expect(p).toContain("WEB REACH");
    expect(p).toContain("PROFESSIONAL FLOW-DIAGRAM RULE");
    expect(p).toContain("NEVER claim you executed anything");
    expect(p).toContain("NEVER use Markdown tables");
  });

  it("instant mode keeps the condensed accuracy rules but never gets the heavy/web blocks", () => {
    const pAr = getSystemPrompt("ar", "instant");
    expect(pAr).toContain("عقد الدقة");              // condensed line
    expect(pAr).toContain("أسئلة استيضاح مرقمة");     // clarification line
    expect(pAr).not.toContain("وصول الإنترنت");        // web block is thinking-only
    expect(pAr).not.toContain("بوابة الاستيضاح");      // full gate is thinking-only
    expect(pAr).not.toContain("DEEP-ANALYSIS PROTOCOL");

    const pEn = getSystemPrompt("en", "instant");
    expect(pEn).toContain("Accuracy contract");
    expect(pEn).not.toContain("WEB REACH");
  });

  it("preserves composition order: research → accuracy contract → expert core → catalog last", () => {
    const p = getSystemPrompt("ar", "thinking", "ETAP من الصفر إلى الاحتراف — 1,999 EGP");
    const research = p.indexOf("بروتوكول البحث والتوجيه للمصادر");
    const contract = p.indexOf("عقد الدقة المطلق");
    const expert = p.indexOf("ETAP EXPERT SYSTEM");
    const catalog = p.indexOf("كتالوج كورسات المنصة");
    expect(research).toBeGreaterThan(-1);
    expect(contract).toBeGreaterThan(research);
    expect(expert).toBeGreaterThan(contract);
    expect(catalog).toBeGreaterThan(expert);
  });

  it("no prompt contains CJK characters (CJK-leak regression guard still holds)", () => {
    for (const mode of ["thinking", "instant"] as const) {
      for (const lang of ["ar", "en"] as const) {
        expect(getSystemPrompt(lang, mode)).not.toMatch(/[\u4E00-\u9FFF]/);
      }
    }
  });
});
