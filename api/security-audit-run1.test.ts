/**
 * Security audit run-1 regression tests.
 * Each block pins the exact fix that shipped with the audit:
 *   - ai-router.isPublicProviderUrl: IPv4-mapped IPv6 + NAT64 + embedded-IPv4 rejection
 *   - push-delivery.isAllowedPushEndpoint: push-service host allowlist
 *   - ai-diagnostics: sanitized, truncated, credential-free egress payload
 *   - client-ip: trust-ordered derivation (the promo throttles now use it)
 *   - chatbot-prompts.containsPromptLeak: the gate now also guards the Telegram brain
 */
import { describe, it, expect } from "vitest";
import { isPublicProviderUrl } from "./lib/ai-router.js";
import { isAllowedPushEndpoint } from "./lib/push-delivery.js";
import { sanitizeDiagnosticMessage, sanitizeDiagnosticContext, diagnosticSignature } from "./lib/ai-diagnostics.js";
import { getClientIpFromHeaders } from "./lib/client-ip.js";
import { containsPromptLeak, promptLeakRefusal } from "./lib/chatbot-prompts.js";

describe("audit run-1: isPublicProviderUrl (SSRF guard)", () => {
  it("rejects hex IPv4-mapped IPv6 loopback and link-local literals", () => {
    expect(isPublicProviderUrl("http://[::ffff:7f00:1]:8080/v1")).toBe(false); // 127.0.0.1
    expect(isPublicProviderUrl("http://[::ffff:a9fe:a9fe]/v1")).toBe(false); // 169.254.169.254
    expect(isPublicProviderUrl("http://[::ffff:c0a8:101]/v1")).toBe(false); // 192.168.1.1
    expect(isPublicProviderUrl("http://[::ffff:a00:1]/v1")).toBe(false); // 10.0.0.1
  });

  it("rejects dotted IPv4-mapped IPv6 literals and loopback IPv4", () => {
    expect(isPublicProviderUrl("http://[::ffff:127.0.0.1]/v1")).toBe(false);
    expect(isPublicProviderUrl("http://127.0.0.1:8080/v1")).toBe(false);
    expect(isPublicProviderUrl("http://169.254.169.254/v1")).toBe(false);
    expect(isPublicProviderUrl("http://10.1.2.3/v1")).toBe(false);
  });

  it("rejects NAT64 translation prefixes and embedded-IPv4 IPv6 tails", () => {
    expect(isPublicProviderUrl("http://[64:ff9b::7f00:1]/v1")).toBe(false);
    expect(isPublicProviderUrl("http://[::1]/v1")).toBe(false);
    expect(isPublicProviderUrl("http://[fe80::1]/v1")).toBe(false);
    expect(isPublicProviderUrl("http://[fd00::1]/v1")).toBe(false);
    expect(isPublicProviderUrl("http://[::ffff:10.0.0.1]/v1")).toBe(false);
  });

  it("still accepts real public providers", () => {
    expect(isPublicProviderUrl("https://openrouter.ai/api/v1")).toBe(true);
    expect(isPublicProviderUrl("https://api.groq.com/openai/v1")).toBe(true);
    expect(isPublicProviderUrl("https://integrate.api.nvidia.com/v1")).toBe(true);
    expect(isPublicProviderUrl("https://[2606:4700::6810:85e5]/v1")).toBe(true);
  });

  it("fails closed on garbage", () => {
    expect(isPublicProviderUrl("not a url")).toBe(false);
    expect(isPublicProviderUrl("ftp://example.com")).toBe(false);
  });
});

describe("audit run-1: isAllowedPushEndpoint (push SSRF allowlist)", () => {
  it("accepts real push-service endpoints", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/gcm")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.microsoft.com/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://xx.push.apple.com/abc")).toBe(true);
  });

  it("rejects loopback, metadata and arbitrary https hosts", () => {
    expect(isAllowedPushEndpoint("https://127.0.0.1:9200/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isAllowedPushEndpoint("https://[::ffff:7f00:1]/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://attacker.example.org/flood")).toBe(false);
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/x")).toBe(false); // https only
  });

  it("rejects suffix-lookalikes", () => {
    expect(isAllowedPushEndpoint("https://evil-fcm.googleapis.com.example.com/x")).toBe(false);
  });
});

describe("audit run-1: ai-diagnostics egress sanitization", () => {
  it("redacts bearer tokens and credential-shaped assignments", () => {
    const msg = "upstream 401 for Bearer sk-live-abcdef123456 and api_key=supersecretvalue failed";
    const clean = sanitizeDiagnosticMessage(msg);
    expect(clean).not.toContain("sk-live-abcdef123456");
    expect(clean).not.toContain("supersecretvalue");
    expect(clean).toContain("[REDACTED]");
  });

  it("truncates long messages to the egress budget", () => {
    const clean = sanitizeDiagnosticMessage("x".repeat(5000));
    expect(clean.length).toBeLessThanOrEqual(240);
  });

  it("sanitizes context and produces stable signatures", () => {
    const ctx = sanitizeDiagnosticContext("Bearer abcdef123456789 | POST /api/trpc/payment.create");
    expect(ctx).not.toContain("abcdef123456789");
    expect(diagnosticSignature("same-message")).toBe(diagnosticSignature("same-message"));
    expect(diagnosticSignature("same-message")).not.toBe(diagnosticSignature("other-message"));
  });
});

describe("audit run-1: client-ip trust-ordered derivation (promo throttle key baseline)", () => {
  const H = (init: Record<string, string>) => new Headers(init);

  it("prefers cf-connecting-ip over x-real-ip over the rightmost XFF entry", () => {
    expect(getClientIpFromHeaders(H({ "cf-connecting-ip": "1.1.1.1", "x-real-ip": "2.2.2.2", "x-forwarded-for": "9.9.9.9, 3.3.3.3" }))).toBe("1.1.1.1");
    expect(getClientIpFromHeaders(H({ "x-real-ip": "2.2.2.2", "x-forwarded-for": "9.9.9.9, 3.3.3.3" }))).toBe("2.2.2.2");
    expect(getClientIpFromHeaders(H({ "x-forwarded-for": "9.9.9.9, 3.3.3.3" }))).toBe("3.3.3.3");
  });

  it("never keys on the client-chosen leftmost XFF entry", () => {
    // The promo-router regression: a spoofed leftmost entry must not become the key.
    expect(getClientIpFromHeaders(H({ "x-forwarded-for": "6.6.6.6, 7.7.7.7" }))).not.toBe("6.6.6.6");
  });
});

describe("audit run-1: prompt-leak gate (now shared with the Telegram brain)", () => {
  it("detects verbatim system-prompt markers and offers a refusal", () => {
    expect(containsPromptLeak("DEEP-ANALYSIS PROTOCOL (internal only) — step 1")).toBe(true);
    expect(containsPromptLeak("المساعد الذكي الرسمي لمنصة")).toBe(true);
    expect(containsPromptLeak("سؤال هندسي عادي عن إعداد الحماية")).toBe(false);
    expect(promptLeakRefusal("ar")).toContain("تعليماتي الداخلية");
  });
});
