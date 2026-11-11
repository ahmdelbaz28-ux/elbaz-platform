/**
 * Regression tests — security audit run-2 (Cloudflare security-audit-skill,
 * additive run over run-1). Every test here pins a fix or a revalidated
 * invariant so a silent revert turns the suite red.
 *
 * Pinned invariants:
 *   1. Token-source binding (run-1 fix, unpinned until now): a cookie-
 *      authenticated request with a forged authorization header must resolve
 *      to the COOKIE source — no JS-readable renewal channel may fire.
 *   2. Native body-token gate (run-1 fix): JWT-in-body requires the
 *      capacitor header AND no auth cookie.
 *   3. Cross-site notification poll starvation (run-2): third-party GETs
 *      never reach the per-user throttle bucket.
 *   4. Opaque model key on every persisted/wire path (run-2): raw
 *      provider/model tags never round-trip to the client.
 *   5. Feedback votes accept only opaque model keys (run-2).
 *   6. CI supply chain: every actions/* ref in every workflow is pinned to a
 *      full commit SHA (run-2 fix-gap closure).
 *   7. TOTP verify: length-gated, roundtrip-correct (constant-time compare).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { extractAuthToken } from "./context.js";
import { isNativeTokenRequest } from "./local-auth-router.js";
import { isCrossSitePoll } from "./notification-route.js";
import { feedbackSchema } from "./chatbot-feedback-route.js";
import { toOpaqueWireModel } from "./lib/finalize-reply.js";
import { verifyTotp, generateTotpCode } from "./twofa-router.js";

const WORKFLOWS_DIR = join(import.meta.dirname ?? ".", "..", ".github", "workflows");

function reqWith(headers: Record<string, string>): Request {
  return new Request("https://ahmedelbaz.qzz.io/api/test", { headers });
}

describe("token-source binding (run-1 fix pin)", () => {
  it("cookie wins over a forged authorization header — source must be cookie", () => {
    const r = reqWith({
      cookie: "elbaz_auth=forged-or-stolen-cookie-value",
      authorization: "Bearer attacker-forged-header-token",
    });
    const extracted = extractAuthToken(r);
    expect(extracted).toBeDefined();
    expect(extracted!.source).toBe("cookie");
    expect(extracted!.token).toBe("forged-or-stolen-cookie-value");
  });

  it("a garbage cookie fully shadows the header channel", () => {
    const r = reqWith({ cookie: "elbaz_auth=x", authorization: "Bearer valid-expired-token" });
    expect(extractAuthToken(r)!.source).toBe("cookie");
  });

  it("header-sourced tokens are still supported (native shells)", () => {
    const r = reqWith({ authorization: "Bearer native-shell-token" });
    const extracted = extractAuthToken(r);
    expect(extracted!.source).toBe("header");
    expect(extracted!.token).toBe("native-shell-token");
  });

  it("x-auth-token counts as a header source", () => {
    const r = reqWith({ "x-auth-token": "legacy-header-token" });
    expect(extractAuthToken(r)!.source).toBe("header");
  });

  it("no credential → undefined", () => {
    expect(extractAuthToken(reqWith({}))).toBeUndefined();
  });
});

describe("native body-token gate (run-1 fix pin)", () => {
  it("capacitor header + NO auth cookie → native request (body token allowed)", () => {
    expect(isNativeTokenRequest(reqWith({ "x-capacitor-platform": "android" }))).toBe(true);
  });

  it("capacitor header + auth cookie → NOT native (body token refused)", () => {
    expect(
      isNativeTokenRequest(reqWith({ "x-capacitor-platform": "android", cookie: "elbaz_auth=session-token" })),
    ).toBe(false);
  });

  it("no capacitor header → never native (web session only)", () => {
    expect(isNativeTokenRequest(reqWith({}))).toBe(false);
    expect(isNativeTokenRequest(reqWith({ cookie: "elbaz_auth=session-token" }))).toBe(false);
  });
});

describe("cross-site notification poll starvation (run-2)", () => {
  const ctxLike = (headers: Record<string, string>, url = "https://ahmedelbaz.qzz.io/api/notifications/poll") =>
    ({ req: { header: (k: string) => headers[k.toLowerCase()], url } }) as unknown as Parameters<typeof isCrossSitePoll>[0];

  it("sec-fetch-site: cross-site → true (never touches the throttle bucket)", () => {
    expect(isCrossSitePoll(ctxLike({ "sec-fetch-site": "cross-site" }))).toBe(true);
  });

  it("same-origin SPA polls → false", () => {
    expect(isCrossSitePoll(ctxLike({ "sec-fetch-site": "same-origin" }))).toBe(false);
  });

  it("native shell (sec-fetch-site: none) → false", () => {
    expect(isCrossSitePoll(ctxLike({ "sec-fetch-site": "none" }))).toBe(false);
  });

  it("legacy browser with a foreign Origin → true", () => {
    expect(isCrossSitePoll(ctxLike({ origin: "https://evil.example" }))).toBe(true);
  });

  it("no Sec-Fetch header and no Origin → false (server-to-server/native)", () => {
    expect(isCrossSitePoll(ctxLike({}))).toBe(false);
  });
});

describe("opaque model key on persistence + wire (run-2)", () => {
  it("raw provider tags are converted, never echoed", () => {
    const key = toOpaqueWireModel("groq/llama-3.3-70b-versatile");
    expect(key).toMatch(/^m_[0-9a-f]{10}$/);
    expect(key).not.toContain("groq");
    expect(key).not.toContain("llama");
  });

  it("already-opaque keys pass through unchanged", () => {
    expect(toOpaqueWireModel("m_0123456789")).toBe("m_0123456789");
  });

  it("empty/undefined → undefined", () => {
    expect(toOpaqueWireModel(undefined)).toBeUndefined();
    expect(toOpaqueWireModel(null)).toBeUndefined();
  });

  it("deterministic across calls", () => {
    expect(toOpaqueWireModel("openrouter/meta-llama/llama-3.3-70b-instruct:free")).toBe(
      toOpaqueWireModel("openrouter/meta-llama/llama-3.3-70b-instruct:free"),
    );
  });
});

describe("feedback votes accept only opaque model keys (run-2)", () => {
  it("a valid opaque key passes through", () => {
    const parsed = feedbackSchema.parse({ chatId: "abcd1234", rating: "up", question: "سؤال", answer: "جواب", model: "m_0123456789" });
    expect(parsed.model).toBe("m_0123456789");
  });

  it("a raw provider tag is DROPPED, never stored", () => {
    const parsed = feedbackSchema.parse({
      chatId: "abcd1234",
      rating: "down",
      question: "سؤال",
      answer: "جواب",
      model: "openrouter/meta-llama/llama-3.3-70b-instruct:free",
    });
    expect(parsed.model).toBeUndefined();
  });
});

describe("CI supply chain: every action ref is SHA-pinned (run-2 fix-gap)", () => {
  it("no workflow uses a floating tag or branch ref", () => {
    const files = readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    expect(files.length).toBeGreaterThan(0);
    const floating: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(WORKFLOWS_DIR, file), "utf8");
      for (const m of text.matchAll(/uses:\s*(\S+)/g)) {
        // A pinned ref is owner/repo@<40-hex SHA> (comment suffix allowed).
        if (!/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/.test(m[1])) {
          floating.push(`${file}: ${m[1]}`);
        }
      }
    }
    expect(floating).toEqual([]);
  });
});

describe("TOTP verify (constant-time + length gate, run-2)", () => {
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"; // classic test secret, 100+ bits

  it("accepts the correct current-window code", () => {
    const timeStep = Math.floor(Date.now() / 30000);
    const code = generateTotpCode(secret, timeStep);
    expect(verifyTotp(secret, code)).toBe(true);
  });

  it("accepts ±1 window drift", () => {
    const timeStep = Math.floor(Date.now() / 30000);
    const code = generateTotpCode(secret, timeStep - 1);
    expect(verifyTotp(secret, code)).toBe(true);
  });

  it("rejects a wrong code", () => {
    const timeStep = Math.floor(Date.now() / 30000);
    const code = generateTotpCode(secret, timeStep);
    const wrong = code === "000000" ? "000001" : "000000";
    expect(verifyTotp(secret, wrong)).toBe(false);
  });

  it("rejects wrong-length tokens (8-hex backup codes are NOT TOTP)", () => {
    expect(verifyTotp(secret, "abcd1234")).toBe(false);
    expect(verifyTotp(secret, "12345")).toBe(false);
  });
});
