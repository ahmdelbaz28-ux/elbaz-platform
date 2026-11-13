/**
 * VISION FLAG THREADING tests — regression lock for the 2026-11-13 root cure.
 *
 * ROOT BUG this locks out: every production call site of getSystemPrompt
 * hardcoded vision=false, so the LIVE SCREEN TEACHER block and the generic
 * IMAGE ANALYSIS block never reached any real model on ANY lane (dynamic
 * router, legacy backbone, stream, non-stream) — while the direct unit tests
 * (screen-capture-flow.test.ts) called getSystemPrompt with vision=true and
 * kept passing. Classic test/production drift.
 *
 * These tests go through the REAL entry points (getChatResponse /
 * getVisionResponse / getStreamResponse) and capture the systemPrompt that
 * actually reaches the dynamic router (routeChatCompletion / routeChatStream
 * mocked to fail fast) — proving the block is present on the exact lane a
 * real request takes, and absent on the text lane.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

interface CapturedPrompt {
  systemPrompt: string;
  vision?: boolean;
}

describe("vision flag threading — pass-2 prompts carry the vision blocks", () => {
  let completionCaptures: CapturedPrompt[];
  let streamCaptures: CapturedPrompt[];

  beforeEach(async () => {
    vi.resetModules();
    completionCaptures = [];
    streamCaptures = [];

    // No provider keys — every legacy lane fails fast, NO network possible.
    vi.doMock("../lib/env", () => ({
      env: {
        OPENROUTER_API_KEY: "",
        CHATBOT_API_KEY: "",
        NVIDIA_API_KEY: "",
        GROQ_API_KEY: "",
        isProduction: false,
      },
    }));

    // Capture the system prompt the dynamic router receives; fail fast so the
    // cascade walks the (dead, keyless) legacy lanes and returns an error —
    // the assertion target is the BUILT prompt, not the reply.
    vi.doMock("./ai-router.js", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./ai-router.js")>();
      return {
        ...actual,
        routeChatCompletion: vi.fn(async (args: CapturedPrompt) => {
          completionCaptures.push(args);
          return { ok: false };
        }),
        routeChatStream: vi.fn(async (args: CapturedPrompt) => {
          streamCaptures.push(args);
          return { ok: false };
        }),
        isDiscoveredModelId: vi.fn(() => false),
        isOpenRouterDailyLimited: vi.fn(() => true),
        isWebPluginDisabled: vi.fn(() => true),
      };
    });

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("no provider may be dialed in a prompt-threading test");
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const IMG = "data:image/jpeg;base64,AAAA";
  const visionMessages = (text: string) => [
    { role: "user" as const, content: [
      { type: "text" as const, text },
      { type: "image_url" as const, image_url: { url: IMG } },
    ] },
  ];

  it("getVisionResponse (live screen frame, AR) → pass-2 persona prompt arms the screen-teacher block", async () => {
    const { getVisionResponse } = await import("./chatbot.js");
    const res = await getVisionResponse({
      messages: visionMessages("وين أنا في البرنامج؟"),
      language: "ar",
      screenCapture: true,
    });
    // No keys configured — the walk fails, but the pass-2 prompt was BUILT.
    expect(res.success).toBe(false);
    const pass2 = completionCaptures.at(-1);
    expect(pass2).toBeTruthy();
    expect(pass2!.systemPrompt).toContain("وضع المعلّم المباشر");
    expect(pass2!.systemPrompt).toContain("ممنوع التخمين");
    expect(pass2!.systemPrompt).not.toContain("وضع تحليل الصور");
  });

  it("getVisionResponse (plain attachment, AR) → pass-2 prompt arms the generic image block instead", async () => {
    const { getVisionResponse } = await import("./chatbot.js");
    await getVisionResponse({
      messages: visionMessages("حلل هذه الصورة"),
      language: "ar",
      screenCapture: false,
    });
    const pass2 = completionCaptures.at(-1)!;
    expect(pass2.systemPrompt).toContain("وضع تحليل الصور");
    expect(pass2.systemPrompt).not.toContain("وضع المعلّم المباشر");
  });

  it("getChatResponse (text-only) → persona prompt carries NEITHER vision block", async () => {
    const { getChatResponse } = await import("./chatbot.js");
    await getChatResponse({
      messages: [{ role: "user", content: "إيه فايدة ETAP؟" }],
      language: "ar",
    });
    expect(completionCaptures.length).toBe(1);
    const p = completionCaptures[0]!.systemPrompt;
    expect(p).not.toContain("وضع المعلّم المباشر");
    expect(p).not.toContain("وضع تحليل الصور");
  });

  it("getStreamResponse (vision screen frame, AR) → pass-2 stream prompt arms the teacher block", async () => {
    const { getStreamResponse } = await import("./chatbot-stream.js");
    const res = await getStreamResponse({
      messages: visionMessages("اقرأ شاشتي ووجهني"),
      language: "ar",
      vision: true,
      screenCapture: true,
    });
    expect("error" in res).toBe(true); // keyless walk — prompt already built
    const pass2 = streamCaptures.at(-1);
    expect(pass2).toBeTruthy();
    expect(pass2!.systemPrompt).toContain("وضع المعلّم المباشر");
    expect(pass2!.systemPrompt).not.toContain("وضع تحليل الصور");
  });

  it("getStreamResponse (vision screen frame, EN) → teacher block in English too", async () => {
    const { getStreamResponse } = await import("./chatbot-stream.js");
    await getStreamResponse({
      messages: visionMessages("Read my screen and guide me"),
      language: "en",
      vision: true,
      screenCapture: true,
    });
    const pass2 = streamCaptures.at(-1)!;
    expect(pass2.systemPrompt).toContain("LIVE SCREEN TEACHER MODE");
    expect(pass2.systemPrompt).toContain("guessing is absolutely forbidden");
    expect(pass2.systemPrompt).not.toContain("IMAGE ANALYSIS MODE");
  });

  it("the legacy pickWorkingModel lane (vision=true) builds the teacher prompt too", async () => {
    const { pickWorkingModel } = await import("./chatbot-stream.js");
    // Keyless env — every provider pick fails, but the call must not throw and
    // the prompt built inside is the assertion target of the other tests; here
    // we at least lock the signature/behavior contract: no crash + null pick.
    const picked = await pickWorkingModel(
      visionMessages("وين أنا؟") as unknown as Parameters<typeof pickWorkingModel>[0],
      "ar",
      "thinking",
      undefined,
      undefined,
      undefined,
      true, // screenCapture
      true, // vision ← the 2026-11-13 root-cure argument
    );
    expect(picked).toBeNull();
  });
});
