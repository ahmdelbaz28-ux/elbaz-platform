/**
 * Unit tests — augmentAdminEmailMessage (api/lib/email.ts).
 *
 * Contract (2026-11-16 "verification email never arrives"):
 *   - the ADMIN's failure message carries the exact, safe provider reason
 *     (so the owner can fix delivery from their own UI)
 *   - regular users' message stays the generic base — no operational intel
 *   - no reason → base message untouched
 */
import { describe, it, expect } from "vitest";
import { augmentAdminEmailMessage } from "../../api/lib/email";

const BASE = "Could not send verification email. Please try again later.";

describe("augmentAdminEmailMessage — admin-only provider diagnostics", () => {
  it("appends the provider reason inside a [provider: …] tag", () => {
    expect(augmentAdminEmailMessage(BASE, "Resend API error 401")).toBe(
      `${BASE} [provider: Resend API error 401]`,
    );
  });

  it("appends the domain-verification reason verbatim", () => {
    const reason =
      "Resend domain not verified — sandbox mode only allows sending to the account owner's email.";
    expect(augmentAdminEmailMessage(BASE, reason)).toBe(`${BASE} [provider: ${reason}]`);
  });

  it("returns the base message untouched when there is no reason", () => {
    expect(augmentAdminEmailMessage(BASE, undefined)).toBe(BASE);
    expect(augmentAdminEmailMessage(BASE, "")).toBe(BASE); // empty = no reason
  });
});
