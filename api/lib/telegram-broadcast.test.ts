import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock env (mutated per-test to flip configured/unconfigured) ──
const mockEnv = vi.hoisted(() => ({
  TELEGRAM_BOT_TOKEN: undefined as string | undefined,
  TELEGRAM_CHAT_ID: undefined as string | undefined,
}));

vi.mock("./env", () => ({ env: mockEnv }));

import {
  escapeTelegramHtml,
  formatTelegramMessage,
  isTelegramConfigured,
  sendTelegramBroadcast,
} from "./telegram-broadcast";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  mockEnv.TELEGRAM_BOT_TOKEN = undefined;
  mockEnv.TELEGRAM_CHAT_ID = undefined;
});

describe("escapeTelegramHtml", () => {
  it("escapes &, < and > for HTML parse mode", () => {
    expect(escapeTelegramHtml("a<b>&c>d")).toBe("a&lt;b&gt;&amp;c&gt;d");
  });

  it("leaves normal Arabic text untouched", () => {
    expect(escapeTelegramHtml("حلقة جديدة «ETAP»")).toBe("حلقة جديدة «ETAP»");
  });
});

describe("formatTelegramMessage", () => {
  it("bolds the title, includes the message and the site button", () => {
    const parts = formatTelegramMessage({
      type: "lesson",
      title: "درس جديد: Load Flow",
      message: "نزل درس جديد على المنصة.",
      url: "/courses/etap",
    });
    expect(parts.text).toContain("<b>درس جديد: Load Flow</b>");
    expect(parts.text).toContain("نزل درس جديد على المنصة.");
    const flat = parts.inlineKeyboard.flat();
    expect(flat.some((b) => b.url === "/courses/etap")).toBe(true);
    expect(flat.some((b) => b.url === "https://ahmedelbaz.qzz.io")).toBe(true);
  });

  it("YouTube type gets the episode button, channel button and bell CTA", () => {
    const parts = formatTelegramMessage({
      type: "youtube",
      title: "🎬 حلقة جديدة على قناة اليوتيوب",
      message: "«شرح ETAP» نزلت الآن.",
      url: "https://www.youtube.com/watch?v=abc",
      channelUrl: "https://www.youtube.com/channel/UClZy6YZ",
    });
    expect(parts.text).toContain("فعّل الجرس");
    const row = parts.inlineKeyboard[0];
    expect(row.some((b) => b.text.includes("شوف الحلقة") && b.url === "https://www.youtube.com/watch?v=abc")).toBe(true);
    expect(row.some((b) => b.url === "https://www.youtube.com/channel/UClZy6YZ")).toBe(true);
  });

  it("escapes HTML-dangerous characters in title and message", () => {
    const parts = formatTelegramMessage({
      type: "promo",
      title: "<script>alert(1)</script>",
      message: "x < y & z > w",
    });
    expect(parts.text).not.toContain("<script>");
    expect(parts.text).toContain("&lt;script&gt;");
    expect(parts.text).toContain("x &lt; y &amp; z &gt; w");
  });

  it("caps the text below Telegram's 4096-char limit", () => {
    const parts = formatTelegramMessage({
      type: "system",
      title: "طويل",
      message: "ك".repeat(6000),
    });
    expect(parts.text.length).toBeLessThanOrEqual(3900);
  });
});

describe("isTelegramConfigured", () => {
  it("is false without token/chat id", () => {
    expect(isTelegramConfigured()).toBe(false);
  });

  it("is true when both values are set", () => {
    mockEnv.TELEGRAM_BOT_TOKEN = "123:abc";
    mockEnv.TELEGRAM_CHAT_ID = "@engahmedetap";
    expect(isTelegramConfigured()).toBe(true);
  });
});

describe("sendTelegramBroadcast", () => {
  it("skips silently (returns false, no fetch) when unconfigured", async () => {
    const result = await sendTelegramBroadcast({ type: "promo", title: "t", message: "m" });
    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("OWNER POLICY: never posts — suppressed even when fully configured", async () => {
    mockEnv.TELEGRAM_BOT_TOKEN = "123:abc";
    mockEnv.TELEGRAM_CHAT_ID = "@engahmedetap";

    const result = await sendTelegramBroadcast({
      type: "youtube",
      title: "🎬 حلقة",
      message: "نزلت.",
      url: "https://youtube.com/watch?v=1",
      channelUrl: "https://youtube.com/channel/x",
    });

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns false when the API rejects (kept for the day the policy lifts)", async () => {
    mockEnv.TELEGRAM_BOT_TOKEN = "123:bad";
    mockEnv.TELEGRAM_CHAT_ID = "@engahmedetap";
    fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => "Forbidden" });
    expect(await sendTelegramBroadcast({ type: "promo", title: "t", message: "m" })).toBe(false);
  });

  it("never throws — network errors resolve to false", async () => {
    mockEnv.TELEGRAM_BOT_TOKEN = "123:abc";
    mockEnv.TELEGRAM_CHAT_ID = "@engahmedetap";
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      sendTelegramBroadcast({ type: "promo", title: "t", message: "m" })
    ).resolves.toBe(false);
  });
});
