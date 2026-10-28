/**
 * TESTS — unified error envelope + credential scrubbing
 * (Reach-gems: ported from Panniantong/Agent-Reach's test suite, MIT —
 *  tests/test_scrub_credentials.py + the error-code contract discipline).
 */

import { describe, it, expect } from "vitest";

import {
  CHATBOT_ERROR_CATALOG,
  chatbotError,
  logSafeError,
  scrubCredentials,
  type ChatbotErrorCode,
} from "./chatbot-errors";

// ─── Error catalog contract (Agent-Reach's table-style discipline) ──────────

describe("chatbot error catalog contract", () => {
  const ALL_CODES: ChatbotErrorCode[] = [
    "BAD_REQUEST", "BAD_INPUT", "TOO_LARGE", "RATE_LIMITED",
    "QUOTA_EXCEEDED", "UNAUTHORIZED", "UPSTREAM_EXHAUSTED", "INTERNAL",
  ];

  it("every code carries http status + AR + EN message + actionable hint", () => {
    for (const code of ALL_CODES) {
      const info = CHATBOT_ERROR_CATALOG[code];
      expect(info.http).toBeGreaterThanOrEqual(400);
      expect(info.http).toBeLessThan(600);
      expect(info.ar.length).toBeGreaterThan(10);
      expect(info.en.length).toBeGreaterThan(10);
      // Agent-Reach hints say what to do AND what not to do.
      expect(info.hint.length).toBeGreaterThan(20);
    }
  });

  it("envelope shape: success=false, localized error, stable code + hint", () => {
    const { envelope, http } = chatbotError("RATE_LIMITED", { lang: "ar", chatId: "c1" });
    expect(http).toBe(429);
    expect(envelope.success).toBe(false);
    expect(envelope.code).toBe("RATE_LIMITED");
    expect(envelope.error).toMatch(/طلبات كثيرة/);
    expect(envelope.hint).toMatch(/back off|window/i);
    expect(envelope.chatId).toBe("c1");
  });

  it("envelope defaults to Arabic (site primary audience) and omits chatId when absent", () => {
    const { envelope, http } = chatbotError("TOO_LARGE");
    expect(http).toBe(413);
    expect(envelope.error).toMatch(/كبيرة جداً/);
    expect(envelope).not.toHaveProperty("chatId");
  });

  it("English callers get the English message", () => {
    const { envelope } = chatbotError("UPSTREAM_EXHAUSTED", { lang: "en" });
    expect(envelope.error).toMatch(/busy right now/);
    expect(envelope.code).toBe("UPSTREAM_EXHAUSTED");
  });

  it("UPSTREAM_EXHAUSTED must not read like a login/permission problem (Agent-Reach anti-pattern)", () => {
    for (const lang of ["ar", "en"] as const) {
      const { envelope } = chatbotError("UPSTREAM_EXHAUSTED", { lang });
      expect(envelope.error.toLowerCase()).not.toMatch(/login|تسجيل الدخول|صلاحية|permission/);
    }
  });
});

// ─── Credential scrubbing (ported from Agent-Reach scrub tests) ──────────────

describe("scrubCredentials (Agent-Reach scrub_url_credentials port)", () => {
  it("scrubs userinfo in proxy-style URLs", () => {
    const out = scrubCredentials("proxy http://user:pass@proxy.example:8080 failed");
    expect(out).not.toContain("user:pass");
    expect(out).toContain("***@proxy.example:8080");
  });

  it("scrubs sensitive query values but preserves non-sensitive ones", () => {
    const raw = "upstream https://api.example.test/path?access_token=secret&page=2&api_key=another-secret";
    const out = scrubCredentials(raw);
    expect(out).not.toContain("secret");
    expect(out).not.toContain("another-secret");
    expect(out).toContain("access_token=***");
    expect(out).toContain("api_key=***");
    expect(out).toContain("page=2"); // diagnostics stay useful
  });

  it("scrubs fragment tokens and authorization-style headers", () => {
    const out = scrubCredentials("https://example.test/#auth_token=fragment-secret and Bearer eyJhbGciOi.eyJzdWIi.token");
    expect(out).not.toContain("fragment-secret");
    expect(out).not.toContain("eyJhbGciOi");
    expect(out).toMatch(/auth_token=\*\*\*/);
    expect(out).toMatch(/Bearer \*\*\*/);
  });

  it("scrubs multiple schemes in one diagnostic line", () => {
    const out = scrubCredentials("socks5://token@host:1080 then http://a:b@c.d/e?password=x");
    expect(out).not.toContain("token@");
    expect(out).not.toContain("a:b@");
    expect(out).not.toContain("password=x");
    expect(out).toContain("socks5://***@host:1080");
  });

  it("passes through clean diagnostics untouched", () => {
    const clean = "HTTP 502 from provider after 30s; will retry with backoff";
    expect(scrubCredentials(clean)).toBe(clean);
  });

  it("logSafeError scrubs Error messages and caps length", () => {
    const err = new Error("call failed: https://api.provider/v1?key=SUPER-SECRET&timeout=30");
    const out = logSafeError(err);
    expect(out).not.toContain("SUPER-SECRET");
    expect(out).toContain("timeout=30");
    expect(out.length).toBeLessThanOrEqual(500);
  });
});
