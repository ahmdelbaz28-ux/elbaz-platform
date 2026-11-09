/**
 * ✅ PRE-LAUNCH AUDIT REGRESSION TESTS — CSRF/origin gate hardening.
 *
 * Proves the two security fixes that unblocked launch:
 *  1. `Origin: null` is NO LONGER allowlisted — a sandboxed <iframe sandbox>
 *     (which sends Origin: null) can no longer drive authenticated mutations
 *     or pass the CORS allowlist while cookies ride along (SameSite=None).
 *  2. The same-origin gate compares ORIGINS EXACTLY — the previous
 *     startsWith() prefix match let sibling domains like
 *     `https://ahmedelbaz.qzz.io.evil.com` bypass the CSRF gate.
 * Plus: the legit first-party origin still passes (no regression for the
 * production site or the Capacitor WebView shells).
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { securityMiddleware } from "./security.js";

function buildApp() {
  const app = new Hono();
  app.use("*", securityMiddleware);
  app.post("/api/trpc/auth.me", (c) => c.json({ ok: true }));
  app.post("/api/paymob/webhook", (c) => c.json({ ok: true }));
  return app;
}

const LEGIT_ORIGIN = "https://ahmedelbaz.qzz.io";

describe("securityMiddleware CSRF gate (pre-launch audit)", () => {
  it("allows a state-changing POST from the legit first-party origin", async () => {
    const res = await buildApp().request("/api/trpc/auth.me", {
      method: "POST",
      headers: { Origin: LEGIT_ORIGIN, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("allows the Capacitor Android WebView origin (https://localhost)", async () => {
    const res = await buildApp().request("/api/trpc/auth.me", {
      method: "POST",
      headers: { Origin: "https://localhost", "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
  });

  it("REJECTS Origin: null (sandboxed-iframe attack surface)", async () => {
    const res = await buildApp().request("/api/trpc/auth.me", {
      method: "POST",
      headers: { Origin: "null", "Content-Type": "application/json" },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Cross-origin request rejected" });
  });

  it("REJECTS sibling-domain prefix tricks (https://ahmedelbaz.qzz.io.evil.com)", async () => {
    const res = await buildApp().request("/api/trpc/auth.me", {
      method: "POST",
      headers: {
        Origin: "https://ahmedelbaz.qzz.io.evil.com",
        "Content-Type": "application/json",
      },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Cross-origin request rejected" });
  });

  it("REJECTS an unrelated origin", async () => {
    const res = await buildApp().request("/api/trpc/auth.me", {
      method: "POST",
      headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
    });
    expect(res.status).toBe(403);
  });

  it("still allows requests WITHOUT Origin/Referer (S2S webhooks, curl)", async () => {
    const res = await buildApp().request("/api/trpc/auth.me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
  });

  it("keeps the Paymob webhook exempt from the origin gate", async () => {
    const res = await buildApp().request("/api/paymob/webhook", {
      method: "POST",
      headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
  });

  it("enforces the same exact-origin rule for Referer-based evidence", async () => {
    // Referer carries a PATH — the parsed origin must still be compared exactly.
    const good = await buildApp().request("/api/trpc/auth.me", {
      method: "POST",
      headers: {
        Referer: `${LEGIT_ORIGIN}/courses?utm=1`,
        "Content-Type": "application/json",
      },
    });
    expect(good.status).toBe(200);

    const evil = await buildApp().request("/api/trpc/auth.me", {
      method: "POST",
      headers: {
        Referer: "https://ahmedelbaz.qzz.io.evil.com/courses",
        "Content-Type": "application/json",
      },
    });
    expect(evil.status).toBe(403);
  });
});
