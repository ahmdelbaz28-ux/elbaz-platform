import { describe, expect, it } from "vitest";

/**
 * BEHAVIORAL GUARD — audit run-1, fp.promo-validate-rate-cost-vs-window-cap.
 *
 * Pins the semantics of rateLimitPerWindow: the intended per-window cap is the
 * limiter's BUCKET CAPACITY and the consume cost is always 1 — so with cap=1
 * the FIRST call in a window resolves and the SECOND rejects, regardless of
 * the shared bucket's capacity (the exact inversion of the audited defect,
 * where cost=1 against a 300-capacity bucket allowed ~300 probes/min).
 */
describe("rateLimitPerWindow (per-window cap semantics)", () => {
  it("cap=1: first call resolves, second call within the window rejects", async () => {
    const { rateLimitPerWindow } = await import("./rate-limiter.js");
    const key = `qa:${Date.now()}`;
    const first = await rateLimitPerWindow("qa-window-test", key, 1, 60);
    expect(first.residualPoints ?? first.remainingPoints ?? 0).toBeLessThanOrEqual(1);
    await expect(rateLimitPerWindow("qa-window-test", key, 1, 60)).rejects.toThrow();
  });

  it("cap=3: three calls resolve, the fourth rejects", async () => {
    const { rateLimitPerWindow } = await import("./rate-limiter.js");
    const key = `qa3:${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      await expect(rateLimitPerWindow("qa-window-test-3", key, 3, 60)).resolves.toBeDefined();
    }
    await expect(rateLimitPerWindow("qa-window-test-3", key, 3, 60)).rejects.toThrow();
  });

  it("distinct keys do not share a bucket", async () => {
    const { rateLimitPerWindow } = await import("./rate-limiter.js");
    const stamp = Date.now();
    await rateLimitPerWindow("qa-window-test-iso", `a:${stamp}`, 1, 60);
    await expect(rateLimitPerWindow("qa-window-test-iso", `b:${stamp}`, 1, 60)).resolves.toBeDefined();
  });
});
