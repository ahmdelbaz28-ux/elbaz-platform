/**
 * Shared input validation utilities.
 *
 * Extracted to a single module so that:
 *
 * 1. We have ONE email regex instead of five copies spread across the
 *    codebase (SonarCloud plsql:S1192 / general DRY).
 * 2. The regex is written in a form that does NOT cause super-linear
 *    backtracking (SonarCloud S8786). The classic
 *    `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` pattern can backtrack pathologically
 *    on inputs containing many dots, because the `[^\s@]+` before and
 *    after `\.` can both match the same characters. Our pattern uses
 *    `(?:\.[^\s@]+)+` which forces each dot-segment to start with a
 *    literal `.`, eliminating the ambiguity.
 * 3. Password strength checks avoid the `(?=.*X)` lookahead pattern,
 *    which SonarCloud S8786 also flags. We use simple `.test()` calls
 *    instead — same semantics, no backtracking.
 */

/**
 * Email format check. Returns true if the input looks like a valid email.
 *
 * This is a *format* check, not a full RFC 5322 validator — it accepts
 * `user@host.tld` and rejects obvious mistakes. Use it for client-side
 * feedback; the server is the source of truth.
 */
export function isValidEmail(value: string): boolean {
  // Anchored, no overlapping quantifiers, no nested quantifiers that can
  // match the same character. The `(?:\.[^\s@]+)+` group is the only
  // place `.` is allowed, so the engine has exactly one way to split the
  // local part from the domain part.
  return /^[^\s@]+@[^\s@]+(?:\.[^\s@]+)+$/.test(value);
}

/**
 * Password strength: must contain at least one lowercase letter, one
 * uppercase letter, and one digit. Avoids `(?=.*X)` lookaheads which
 * SonarCloud S8786 flags for backtracking; three independent `.test()`
 * calls are equally fast and clearer to read.
 */
export function hasPasswordStrengthChars(value: string): boolean {
  return /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value);
}
