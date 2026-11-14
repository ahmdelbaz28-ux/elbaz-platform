/**
 * ADMIN AUDIT MIDDLEWARE — unit tests (dashboard audit tour 2026-11-15).
 * Covers the auditInputSummary redaction/truncation contract: sensitive keys
 * (password/token/secret/apiKey/hash/credential) must be redacted BEFORE the
 * value reaches the audit table, and the stored summary must be bounded.
 */
import { describe, it, expect } from "vitest";
import { auditInputSummary } from "./middleware";

describe("auditInputSummary", () => {
  it("returns null for empty input", () => {
    expect(auditInputSummary(undefined)).toBeNull();
    expect(auditInputSummary(null)).toBeNull();
    expect(auditInputSummary({})).toBeNull();
  });

  it("keeps harmless values verbatim", () => {
    const out = auditInputSummary({ userId: 7, role: "admin" });
    expect(out).toBe('{"userId":7,"role":"admin"}');
  });

  it("redacts password values", () => {
    const out = auditInputSummary({ username: "admin", password: "SuperSecret123" });
    expect(out).not.toContain("SuperSecret123");
    expect(out).toContain('"***"');
    expect(out).toContain("admin");
  });

  it("redacts token/secret/apiKey/hash/credential keys case-insensitively", () => {
    const input = { AUTH_TOKEN: "t1", clientSecret: "s2", apiKey: "k3", passwordHash: "h4", MY_CREDENTIAL: "c5" };
    const out = auditInputSummary(input);
    for (const v of ["t1", "s2", "k3", "h4", "c5"]) {
      expect(out).not.toContain(v);
    }
  });

  it("does NOT redact keys merely containing the word inside a longer safe name", () => {
    // "monkey" contains "key" — the regex anchors on sensitive words; only
    // whole-word-ish sensitive names are redacted. We accept "monkey" exposed.
    const out = auditInputSummary({ monkey: "safe" });
    expect(out).toContain("safe");
  });

  it("truncates long input to 400 chars with an ellipsis", () => {
    const long = { text: "x".repeat(1000) };
    const out = auditInputSummary(long);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(400);
    expect(out!.endsWith("...")).toBe(true);
  });

  it("returns null for non-serializable input", () => {
    expect(auditInputSummary(BigInt(5) as unknown as object)).toBeNull();
  });
});
