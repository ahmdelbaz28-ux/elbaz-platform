import { describe, it, expect, vi, afterEach } from "vitest";
import { telegramApiBase, telegramRelayHeaders } from "./telegram-transport";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("telegramApiBase", () => {
  it("defaults to the direct Bot API host", () => {
    vi.stubEnv("TELEGRAM_API_BASE", "");
    expect(telegramApiBase()).toBe("https://api.telegram.org");
  });

  it("returns the relay base when configured", () => {
    vi.stubEnv("TELEGRAM_API_BASE", "https://ahmedelbaz.ahmdelbaz28.workers.dev/tg");
    expect(telegramApiBase()).toBe("https://ahmedelbaz.ahmdelbaz28.workers.dev/tg");
  });

  it("strips trailing slashes so path joining stays whole", () => {
    vi.stubEnv("TELEGRAM_API_BASE", "https://relay.example.dev/tg///");
    expect(telegramApiBase()).toBe("https://relay.example.dev/tg");
  });
});

describe("telegramRelayHeaders", () => {
  it("is empty in direct mode", () => {
    vi.stubEnv("TELEGRAM_API_RELAY_SECRET", "");
    expect(telegramRelayHeaders()).toEqual({});
  });

  it("carries the shared secret in relay mode", () => {
    vi.stubEnv("TELEGRAM_API_RELAY_SECRET", "s3cret-value");
    expect(telegramRelayHeaders()).toEqual({ "X-Relay-Secret": "s3cret-value" });
  });
});
