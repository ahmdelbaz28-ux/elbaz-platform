import { describe, expect, it } from "vitest";
import {
  authErrorCode,
  isConfirmedAuthRejection,
  authMeRetry,
  authMeRetryDelay,
  authMeRefetchInterval,
  AUTH_RECONNECT_INTERVAL_MS,
  AUTH_VERIFICATION_MAX_QUICK_RETRIES,
} from "./auth-verification";

/**
 * ✅ ROOT-CURE (remember-device round 3) contract tests.
 *
 * The bug this pins: the boot auth check used to treat ANY auth.me failure
 * as a session death and bounced remembered users to /login. Live evidence
 * (2026-11-25/26): the uncontrollable qzz.io edge answers /api/* with 403 +
 * cf-mitigated: challenge, and the HF Space restarts on every deploy — both
 * kill auth.me WITHOUT the server ever judging the session. These tests pin
 * the policy: only UNAUTHORIZED is a confirmed rejection; everything else
 * keeps the stored session and reconnects.
 */

/** A tRPC error as the client sees it (TRPCClientError carries .data.code). */
const unauthorizedError = { data: { code: "UNAUTHORIZED", httpStatus: 401 } };

/** What the edge challenge looks like to the fetch/tRPC layer: an HTML body
 * the JSON parser chokes on — the resulting error has NO tRPC code. */
const edgeChallengeParseError = new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON");

/** A plain 5xx-style failure (Space restart / cold start / network drop). */
const transientNetworkError = new TypeError("Failed to fetch");

describe("authErrorCode", () => {
  it("extracts the tRPC code from a shaped error", () => {
    expect(authErrorCode(unauthorizedError)).toBe("UNAUTHORIZED");
  });

  it("returns null for errors without a tRPC shape (challenge HTML parse, TypeError, null)", () => {
    expect(authErrorCode(edgeChallengeParseError)).toBeNull();
    expect(authErrorCode(transientNetworkError)).toBeNull();
    expect(authErrorCode(null)).toBeNull();
    expect(authErrorCode(undefined)).toBeNull();
    expect(authErrorCode("UNAUTHORIZED")).toBeNull();
  });
});

describe("isConfirmedAuthRejection — the one-way door needs proof", () => {
  it("confirms ONLY a server-issued UNAUTHORIZED", () => {
    expect(isConfirmedAuthRejection(unauthorizedError)).toBe(true);
  });

  it("never confirms edge challenges, 5xx or network failures", () => {
    expect(isConfirmedAuthRejection(edgeChallengeParseError)).toBe(false);
    expect(isConfirmedAuthRejection(transientNetworkError)).toBe(false);
    expect(isConfirmedAuthRejection({ data: { code: "INTERNAL_SERVER_ERROR" } })).toBe(false);
    expect(isConfirmedAuthRejection({ data: { code: "FORBIDDEN" } })).toBe(false);
    expect(isConfirmedAuthRejection(undefined)).toBe(false);
  });
});

describe("authMeRetry — quick bounded retries for transient failures only", () => {
  it("does not retry a confirmed rejection (terminal immediately — destruction must not be delayed)", () => {
    expect(authMeRetry(0, unauthorizedError)).toBe(false);
    expect(authMeRetry(5, unauthorizedError)).toBe(false);
  });

  it("gives transient failures the full quick-retry budget then stops (slow cadence takes over)", () => {
    expect(authMeRetry(0, transientNetworkError)).toBe(true);
    expect(authMeRetry(1, edgeChallengeParseError)).toBe(true);
    expect(authMeRetry(AUTH_VERIFICATION_MAX_QUICK_RETRIES, transientNetworkError)).toBe(false);
    expect(authMeRetry(99, transientNetworkError)).toBe(false);
  });
});

describe("authMeRetryDelay — short backoff (1s, 2s, capped 4s)", () => {
  it("grows exponentially but stays capped", () => {
    expect(authMeRetryDelay(0)).toBe(1000);
    expect(authMeRetryDelay(1)).toBe(2000);
    expect(authMeRetryDelay(5)).toBe(4000);
    expect(authMeRetryDelay(-1)).toBe(1000); // negative attempt guarded
  });
});

describe("authMeRefetchInterval — slow auto-reconnect until the server answers", () => {
  it("disables the interval once the error clears (success state)", () => {
    expect(authMeRefetchInterval({ state: { error: null } })).toBe(false);
    expect(authMeRefetchInterval({ state: {} })).toBe(false);
    expect(authMeRefetchInterval(undefined)).toBe(false);
  });

  it("keeps reconnecting at the slow cadence while a transient failure persists", () => {
    expect(authMeRefetchInterval({ state: { error: transientNetworkError } })).toBe(
      AUTH_RECONNECT_INTERVAL_MS,
    );
    expect(authMeRefetchInterval({ state: { error: edgeChallengeParseError } })).toBe(
      AUTH_RECONNECT_INTERVAL_MS,
    );
  });

  it("stops the cadence on a confirmed rejection — the death is terminal", () => {
    expect(authMeRefetchInterval({ state: { error: unauthorizedError } })).toBe(false);
  });
});
