import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * REGRESSION GUARD — sessions.revoke.broken-sql (pre-launch audit run-2).
 *
 * History: `sessions.revoke` used to bump tokenVersion with the template
 * `sql`${"$"}{users.tokenVersion} + 1`` — the escaped `${"$"}` made drizzle
 * emit the literal string `$` as a bound parameter and `{users.tokenVersion}`
 * as raw SQL text, producing invalid MySQL (`` tokenVersion = '$'{users.
 * tokenVersion} + 1 ``). The update threw, the JWT stayed valid, and the
 * "SECURITY FIX" comment above it was enforcement-free.
 *
 * A unit test cannot invoke the tRPC procedure without a live DB, so this
 * guard pins the SOURCE: the malformed escaped-template pattern must never
 * reappear, and every tokenVersion bump in this file must use the correct
 * column-interpolation form (verified against drizzle's emitter — the same
 * form already used by revokeAll, changePassword, logout and the reset flow).
 */
describe("sessions-router tokenVersion SQL (regression guard)", () => {
  // Strip comment lines: the explanatory comment quotes the broken pattern on
  // purpose; only executable code is pinned here.
  const source = readFileSync(fileURLToPath(new URL("./sessions-router.ts", import.meta.url)), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  it("never uses the escaped ${\"$\"} template pattern (broken SQL)", () => {
    expect(source).not.toContain('${"$"}');
    expect(source).not.toContain('${"$"}{users.tokenVersion}');
  });

  it("bumps tokenVersion with the correct column interpolation in revoke AND revokeAll", () => {
    const correct = "tokenVersion: sql`${users.tokenVersion} + 1`";
    const count = source.split(correct).length - 1;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("evicts the auth cache at every tokenVersion bump (instant revocation)", () => {
    const bumps = source.split("tokenVersion: sql`${users.tokenVersion} + 1`").length - 1;
    const evictions = source.split("evictUserAuthCache(").length - 1; // 2 call sites (import excluded by name form)
    expect(evictions).toBeGreaterThanOrEqual(bumps);
  });
});
