import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveTurnLanguage,
  plainForTelegram,
  splitForTelegram,
  buildStartDm,
  buildGroupWelcome,
  handleJoinRequest,
  handlePrivateMessage,
  handleTelegramUpdate,
  resetTelegramBotStateForTests,
  type TelegramApi,
  type TelegramBotDeps,
  type TgApiResponse,
  type TgUpdate,
} from "./telegram-bot";

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("./logger", () => ({ logger }));

function fakeApi(responses: Record<string, TgApiResponse> = {}): { api: TelegramApi; calls: Array<{ method: string; payload: Record<string, unknown> }> } {
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
  return {
    calls,
    api: {
      async call(method, payload) {
        calls.push({ method, payload: payload ?? {} });
        return responses[method] ?? { ok: true, result: [] };
      },
    },
  };
}

function fakeBrain(reply?: string, error?: string) {
  return vi.fn(async () => (reply !== undefined ? { reply } : { error: error ?? "upstream exhausted" }));
}

function deps(over: Partial<TelegramBotDeps> = {}): TelegramBotDeps & { calls: Array<{ method: string; payload: Record<string, unknown> }> } {
  const { api, calls } = fakeApi();
  return {
    api,
    calls,
    brain: fakeBrain("رد تجريبي **عن ETAP**"),
    dmMode: "instant",
    now: () => Date.now(),
    ...over,
  };

}

const PRIVATE_MSG_UPDATE: TgUpdate = {
  update_id: 100,
  message: {
    message_id: 1,
    from: { id: 555, first_name: "محمود", is_bot: false },
    chat: { id: 555, type: "private", first_name: "محمود" },
    date: Math.floor(Date.now() / 1000),
    text: "ايه هي خطوات عمل load flow في ETAP؟",
  },
};

beforeEach(() => {
  resetTelegramBotStateForTests();
});

describe("resolveTurnLanguage (arabic-first)", () => {
  it("Arabic text wins, Latin text is English", () => {
    expect(resolveTurnLanguage("ايه اخبارك", undefined)).toBe("ar");
    expect(resolveTurnLanguage("what is load flow?", undefined)).toBe("en");
  });
  it("bare commands fall back to language_code, then Arabic", () => {
    expect(resolveTurnLanguage("/start", { id: 1, language_code: "en" })).toBe("en");
    expect(resolveTurnLanguage("/start", { id: 1, language_code: "ar" })).toBe("ar");
    expect(resolveTurnLanguage("/start", { id: 1 })).toBe("ar");
  });
});

describe("plainForTelegram", () => {
  it("strips bold, inline code and heading hashes", () => {
    expect(plainForTelegram("**خطوة 1** و `code`")).toBe("خطوة 1 و code");
    expect(plainForTelegram("## عنوان\nنص")).toBe("عنوان\nنص");
  });
  it("keeps a lone asterisk (multiplication)", () => {
    expect(plainForTelegram("5 * 3 = 15")).toBe("5 * 3 = 15");
  });
});

describe("splitForTelegram", () => {
  it("returns one chunk for short text", () => {
    expect(splitForTelegram("قصير")).toEqual(["قصير"]);
  });
  it("returns [] for empty text", () => {
    expect(splitForTelegram("   ")).toEqual([]);
  });
  it("splits at paragraph boundaries without losing content", () => {
    const para = "فقرة تجريبية بها نص كافٍ للتحليل. ".repeat(20); // ~700 chars
    const text = Array.from({ length: 12 }, (_, i) => `(${i}) ${para}`).join("\n\n");
    const chunks = splitForTelegram(text, 2000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(2000);
    expect(chunks.join("\n\n")).toContain("(0)");
    expect(chunks.join("\n\n")).toContain("(11)");
  });
  it("hard-splits a monster paragraph longer than the cap", () => {
    const text = "ك".repeat(5000);
    const chunks = splitForTelegram(text, 2000);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.join("")).toBe(text);
  });
});

describe("welcome builders", () => {
  it("start DM is bilingual + carries the site link", () => {
    expect(buildStartDm("ar")).toContain("https://ahmedelbaz.qzz.io");
    expect(buildStartDm("en")).toContain("ETAP");
  });
  it("group welcome greets by name", () => {
    expect(buildGroupWelcome("محمود", "ar")).toContain("محمود");
  });
});

describe("handleJoinRequest", () => {
  it("approves the request and greets the group in Arabic (platform default)", async () => {
    const d = deps();
    const ok = await handleJoinRequest(
      d,
      { id: -100123, type: "supergroup", title: "AhmedEtap chat" },
      { id: 555, first_name: "محمود" }
    );
    expect(ok).toBe(true);
    const methods = d.calls.map((c) => c.method);
    expect(methods).toContain("approveChatJoinRequest");
    expect(methods).toContain("sendMessage");
    const approval = d.calls.find((c) => c.method === "approveChatJoinRequest");
    expect(approval?.payload).toMatchObject({ chat_id: -100123, user_id: 555 });
    const welcome = d.calls.find((c) => c.method === "sendMessage");
    expect(String(welcome?.payload.text)).toContain("أهلاً بيك محمود");
  });

  it("honors an English user's language_code", async () => {
    const d = deps();
    await handleJoinRequest(d, { id: -100123, type: "supergroup" }, { id: 555, first_name: "Sam", language_code: "en" });
    const welcome = d.calls.find((c) => c.method === "sendMessage");
    expect(String(welcome?.payload.text)).toContain("Welcome Sam");
  });

  it("does NOT greet in a channel (no broadcast spam)", async () => {
    const d = deps();
    await handleJoinRequest(d, { id: -100441, type: "channel" }, { id: 555, first_name: "نور" });
    const methods = d.calls.map((c) => c.method);
    expect(methods).toContain("approveChatJoinRequest");
    expect(methods).not.toContain("sendMessage");
  });

  it("never throws when the approval is rejected", async () => {
    const { api } = fakeApi({ approveChatJoinRequest: { ok: false, description: "request not found" } });
    const d = deps({ api });
    const ok = await handleJoinRequest(d, { id: -100123, type: "supergroup" }, { id: 555 });
    expect(ok).toBe(false);
  });
});

describe("handlePrivateMessage — DM expert brain", () => {
  it("answers /start with the welcome and no brain call", async () => {
    const d = deps();
    await handlePrivateMessage(d, {
      message_id: 1,
      chat: { id: 555, type: "private" },
      date: 1,
      text: "/start",
      from: { id: 555, is_bot: false },
    });
    expect(d.brain).not.toHaveBeenCalled();
    const sent = d.calls.filter((c) => c.method === "sendMessage");
    expect(sent.length).toBe(1);
    expect(String(sent[0].payload.text)).toContain("المساعد الذكي");
  });

  it("sends typing action + chunked brain reply (markdown stripped)", async () => {
    const d = deps({ brain: fakeBrain("شرح **خطوة بخطوة**\n\n1. افتح الشجرة") });
    await handlePrivateMessage(d, PRIVATE_MSG_UPDATE.message!);
    const methods = d.calls.map((c) => c.method);
    expect(methods).toContain("sendChatAction");
    const sent = d.calls.filter((c) => c.method === "sendMessage");
    expect(sent.length).toBe(1);
    expect(sent[0].payload.text).toBe("شرح خطوة بخطوة\n\n1. افتح الشجرة");
    expect(d.brain).toHaveBeenCalledWith(
      [{ role: "user", content: PRIVATE_MSG_UPDATE.message!.text }],
      { language: "ar", mode: "instant" }
    );
  });

  it("keeps conversation history for the follow-up question", async () => {
    const d = deps();
    await handlePrivateMessage(d, PRIVATE_MSG_UPDATE.message!);
    await handlePrivateMessage(d, { ...PRIVATE_MSG_UPDATE.message!, message_id: 2, text: "كمل في نفس الموضوع" });
    const secondCall = (d.brain as ReturnType<typeof vi.fn>).mock.calls[1][0] as Array<{ role: string }>;
    expect(secondCall.length).toBe(3); // user, assistant, user
    expect(secondCall[1].role).toBe("assistant");
  });

  it("retries the brain once (legacy escalation) then delivers", async () => {
    const brain = vi.fn()
      .mockResolvedValueOnce({ error: "all providers saturated" })
      .mockResolvedValueOnce({ reply: "الرد النهائي" });
    const d = deps({ brain, now: () => Date.now() });
    await handlePrivateMessage(d, PRIVATE_MSG_UPDATE.message!);
    expect(brain).toHaveBeenCalledTimes(2);
    const sent = d.calls.filter((c) => c.method === "sendMessage");
    expect(String(sent[0].payload.text)).toBe("الرد النهائي");
  });

  it("sends the polite down notice when the brain never recovers", async () => {
    const d = deps({ brain: fakeBrain(undefined, "dead") });
    await handlePrivateMessage(d, PRIVATE_MSG_UPDATE.message!);
    const sent = d.calls.filter((c) => c.method === "sendMessage");
    expect(String(sent[0].payload.text)).toContain("مؤقتة");
  });

  it("rate-limits after 20 questions per hour", async () => {
    const d = deps();
    for (let i = 0; i < 20; i++) {
      await handlePrivateMessage(d, { ...PRIVATE_MSG_UPDATE.message!, text: `سؤال رقم ${i}` });
    }
    const before = d.calls.filter((c) => c.method === "sendMessage").length;
    await handlePrivateMessage(d, { ...PRIVATE_MSG_UPDATE.message!, text: "سؤال 21" });
    const sent = d.calls.filter((c) => c.method === "sendMessage");
    expect(sent.length).toBeGreaterThan(before);
    expect(String(sent[sent.length - 1].payload.text)).toContain("20 رسالة");
  });

  it("clears memory on /clear", async () => {
    const d = deps();
    await handlePrivateMessage(d, PRIVATE_MSG_UPDATE.message!);
    await handlePrivateMessage(d, { ...PRIVATE_MSG_UPDATE.message!, message_id: 2, text: "/clear" });
    await handlePrivateMessage(d, { ...PRIVATE_MSG_UPDATE.message!, message_id: 3, text: "سؤال جديد تماماً" });
    // Brain was called for Q1 and Q3 only — commands never reach it.
    expect(d.brain).toHaveBeenCalledTimes(2);
    const freshCall = (d.brain as ReturnType<typeof vi.fn>).mock.calls[1][0] as Array<{ role: string }>;
    expect(freshCall.length).toBe(1);
  });
});

describe("handleTelegramUpdate routing", () => {
  it("routes chat_join_request to the approval path", async () => {
    const d = deps();
    const handled = await handleTelegramUpdate(d, {
      update_id: 1,
      chat_join_request: {
        chat: { id: -100123, type: "supergroup" },
        from: { id: 555, first_name: "نور" },
        date: 1,
      },
    });
    expect(handled).toBe(true);
    expect(d.calls.map((c) => c.method)).toContain("approveChatJoinRequest");
  });

  it("ignores group messages (no group chat)", async () => {
    const d = deps();
    const handled = await handleTelegramUpdate(d, {
      update_id: 2,
      message: {
        message_id: 5,
        chat: { id: -100999, type: "supergroup", title: "group" },
        date: 1,
        text: "مرحباً",
        from: { id: 555, is_bot: false },
      },
    });
    expect(handled).toBe(false);
    expect(d.brain).not.toHaveBeenCalled();
  });

  it("never throws on garbage updates", async () => {
    const d = deps();
    const handled = await handleTelegramUpdate(d, { update_id: 3 } as TgUpdate);
    expect(handled).toBe(false);
  });
});
