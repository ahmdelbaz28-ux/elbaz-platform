/**
 * SHIELD host-gate hardening tests (v1.1.3)
 * ────────────────────────────────────────────────────────────────────────
 * Live origin E2E (2026-11-20) measured that HF's space router passes a
 * client-supplied x-forwarded-host through UNCHANGED, so the
 * EDGE_HOST_ENFORCE disguise is spoofable via that header. The hardening
 * shipped is zero-breakage: an EDGE_ORIGIN_SECRET operator lane (timing-safe)
 * + throttled spoof-detection logging. These tests pin ALL of it:
 *   1. HAPPY: spoofed xfh passes the gate (documented router behavior) AND
 *      fires the detection warn; operator Bearer passes cleanly (no warn).
 *   2. EDGE: non-API browser navigation still 302-redirects (UX contract).
 *   3. FAILURE MODE: raw space host without spoof → disguised 404; wrong
 *      operator secret → disguised 404; flag unset → gate fully disabled.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

import { shieldMiddleware, isOperatorBearer } from "./shield";
import { logger } from "../lib/logger";

function buildApp() {
  const app = new Hono();
  app.use("*", shieldMiddleware);
  app.get("/api/health", (c) => c.json({ status: "ok" }));
  app.get("/courses", (c) => c.json({ page: "courses" }));
  return app;
}

const RAW_HOST = "ahmdelbaz28-ahmdrtap.hf.space";
const CANON = "ahmedelbaz.qzz.io";
const OPERATOR_SECRET = "test-edge-origin-secret-min-32-chars-x";

describe("shield host gate (EDGE_HOST_ENFORCE=1) — v1.1.3 hardening", () => {
  beforeEach(() => {
    vi.stubEnv("EDGE_HOST_ENFORCE", "1");
    vi.stubEnv("EDGE_ORIGIN_SECRET", OPERATOR_SECRET);
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("raw space host + no headers → disguised 404 (disguise intact)", async () => {
    const res = await buildApp().request("/api/health", {
      headers: { host: RAW_HOST },
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Not Found");
  });

  it("spoofed x-forwarded-host passes (measured router behavior) AND fires the detection warn", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const res = await buildApp().request("/api/health", {
      headers: { host: RAW_HOST, "x-forwarded-host": CANON },
    });
    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(
      "[Shield] x-forwarded-host spoof probe on raw origin",
      expect.objectContaining({ claimed: CANON, actualHost: RAW_HOST, hasCfRay: false }),
    );
  });

  it("spoofed xfh WITH a Cloudflare fingerprint (real CF traffic shape) does NOT warn", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const res = await buildApp().request("/api/health", {
      headers: { host: RAW_HOST, "x-forwarded-host": CANON, "cf-ray": "8f2a3b-real-ray-hkg" },
    });
    expect(res.status).toBe(200);
    const spoofWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes("spoof probe"));
    expect(spoofWarns).toHaveLength(0);
  });

  it("operator Bearer (timing-safe secret) bypasses the disguise WITHOUT a spoof warn", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const res = await buildApp().request("/api/health", {
      headers: { host: RAW_HOST, authorization: `Bearer ${OPERATOR_SECRET}` },
    });
    expect(res.status).toBe(200);
    const spoofWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes("spoof probe"));
    expect(spoofWarns).toHaveLength(0);
  });

  it("wrong operator secret → disguised 404 (fail-closed, no lane leak)", async () => {
    const res = await buildApp().request("/api/health", {
      headers: { host: RAW_HOST, authorization: "Bearer wrong-secret-min-32-chars-aaaaaaaaaaaaaaaa" },
    });
    expect(res.status).toBe(404);
  });

  it("canonical host via x-forwarded-host without spoof (legit chain) → 200, no warn", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const res = await buildApp().request("/api/health", {
      headers: { host: CANON },
    });
    expect(res.status).toBe(200);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("browser navigation on the raw host still 302-redirects (UX contract intact)", async () => {
    const res = await buildApp().request("/courses", {
      headers: { host: RAW_HOST },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://ahmedelbaz.qzz.io/courses`);
  });

  it("flag unset → gate fully disabled (default rollout safety)", async () => {
    vi.stubEnv("EDGE_HOST_ENFORCE", "");
    const res = await buildApp().request("/api/health", {
      headers: { host: RAW_HOST },
    });
    expect(res.status).toBe(200);
  });

  it("isOperatorBearer: unset/short secret never opens the lane", () => {
    vi.stubEnv("EDGE_ORIGIN_SECRET", "");
    expect(isOperatorBearer(`Bearer ${OPERATOR_SECRET}`)).toBe(false);
    vi.stubEnv("EDGE_ORIGIN_SECRET", "short");
    expect(isOperatorBearer("Bearer short")).toBe(false);
    vi.stubEnv("EDGE_ORIGIN_SECRET", OPERATOR_SECRET);
    expect(isOperatorBearer(undefined)).toBe(false);
    expect(isOperatorBearer(`Bearer ${OPERATOR_SECRET}`)).toBe(true);
  });
});
