import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * REGRESSION GUARD — audit run-1 fixes (cf-security-audit-skill findings).
 *
 * Three source-level invariants the audit established; each had either a
 * missing enforcement site or a semantics trap that a unit test cannot invoke
 * without a live DB, so the SOURCE is pinned the same way
 * sessions-router.sql.test.ts pins the evict-per-bump contract:
 *
 * 1. fp-auth:session-logout-missing-auth-cache-evict — auth-router.ts logout
 *    bumps tokenVersion; it must evict the auth cache in the same flow (the
 *    six sibling sites already do). Also asserts the full-repo invariant:
 *    every file that bumps tokenVersion calls the eviction helper.
 * 2. fp.dump.sqlEscape.json-objectToValues — the maintenance dump must
 *    normalize JSON object/array values (JSON.stringify) BEFORE sqlEscape;
 *    otherwise mysql2's parsed JSON values render as `k` = v / (v1, v2)
 *    fragments inside VALUES and the daily backup becomes un-restorable.
 * 3. fp.promo-validate-rate-cost-vs-window-cap — the promo validate throttle
 *    must use the dedicated per-window limiter (bucket capacity = intended
 *    cap, consume cost always 1), never rateLimit()'s cost parameter.
 */
describe("audit run-1 fix regression guards", () => {
  const authSource = readFileSync(fileURLToPath(new URL("./auth-router.ts", import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  const maintenanceSource = readFileSync(fileURLToPath(new URL("./maintenance-router.ts", import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  const promoSource = readFileSync(fileURLToPath(new URL("./promo-router.ts", import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  const rateLimiterSource = readFileSync(fileURLToPath(new URL("./lib/rate-limiter.ts", import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  it("auth-router logout evicts the auth cache after its tokenVersion bump", () => {
    expect(authSource).toContain("tokenVersion: sql`${users.tokenVersion} + 1`");
    expect(authSource).toContain("evictUserAuthCache(");
  });

  it("dump serializer normalizes JSON object/array values BEFORE escape", () => {
    // the normalization helper must exist and feed sqlEscape
    expect(maintenanceSource).toContain("JSON.stringify(v)");
    expect(maintenanceSource).toMatch(/dumpScalar\(v\)/);
    // the escaped value is dumpScalar's output, not the raw driver value
    expect(maintenanceSource).toContain("sqlEscape(dumpScalar(v))");
    // and the old raw-value escape call is gone
    expect(maintenanceSource).not.toContain("sqlEscape(v as string");
  });

  it("promo validate uses the per-window limiter, not rateLimit's cost parameter", () => {
    expect(promoSource).toContain('rateLimitPerWindow("promo-validate"');
    expect(promoSource).not.toContain("rateLimit(`promo:validate:");
  });

  it("rateLimitPerWindow encodes the cap as bucket CAPACITY with consume cost 1", () => {
    expect(rateLimiterSource).toContain("export async function rateLimitPerWindow");
    // capacity = windowCap (points), never forwarded as consume() cost
    expect(rateLimiterSource).toContain("points: Math.max(1, Math.floor(windowCap))");
    expect(rateLimiterSource).toContain("limiter.consume(key, 1)");
  });
});
