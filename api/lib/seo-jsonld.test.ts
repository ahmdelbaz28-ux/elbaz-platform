/**
 * REGRESSION TESTS — audit run-1 fix (seo-meta.jsonld.*)
 *
 * JSON.stringify does not escape '<' and the HTML parser closes <script> at
 * the first literal '</script' — stored DB titles used to be able to break
 * out of the JSON-LD element (and the nonce stamper re-armed the injected
 * script). The fix serializes script-context-safely.
 */
import { describe, it, expect } from "vitest";

import { jsonLdSafeStringify } from "./seo-meta";

describe("jsonLdSafeStringify — script-context safety (audit run-1)", () => {
  it("neutralizes a '</script><script>' breakout in a stored title", () => {
    const out = jsonLdSafeStringify({ name: 'Evil</script><script>alert(1)</script>' });
    expect(out).not.toContain("</script");
    expect(out).toContain("\\u003c/script\\u003e");
  });

  it("escapes bare '<' and '>' so no markup can leave the script element", () => {
    const out = jsonLdSafeStringify({ a: "<b>x</b>" });
    expect(out).not.toContain("<b>");
    expect(out).toContain("\\u003cb\\u003e");
  });

  it("escapes U+2028/U+2029 line separators", () => {
    const out = jsonLdSafeStringify({ a: "x\u2028y\u2029z" });
    expect(out).not.toContain("\u2028");
    expect(out).not.toContain("\u2029");
  });

  it("keeps ordinary JSON valid", () => {
    const out = jsonLdSafeStringify({ name: "ETAP من الصفر", n: 3, ok: true });
    const parsed = JSON.parse(out) as { name: string; n: number; ok: boolean };
    expect(parsed.name).toBe("ETAP من الصفر");
    expect(parsed.n).toBe(3);
    expect(parsed.ok).toBe(true);
  });
});
