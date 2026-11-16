/**
 * Subscribe-gate tickets — unit tests (server-side enforcement core).
 *
 * The owner contract: NO lesson video opens until the subscribe flow is
 * done. lessonVideo/previewVideo trust NOTHING but this signature — every
 * property verified here is a direct anti-bypass guarantee:
 *   1. issue → verify happy path (account + device subjects)
 *   2. tampered payload / signature / wrong key ⇒ rejected
 *   3. expiry ⇒ rejected (the unlock window is real, not cosmetic)
 *   4. far-future iat (pre-minted long-lived tokens) ⇒ rejected
 *   5. over-long lifetime (self-extended expiry) ⇒ rejected
 *   6. account tickets are user-bound: u<other-id> never unlocks u<me>
 *   7. malformed garbage can never crash the gate (fail-closed)
 */
import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("./env", () => ({
  env: { APP_SECRET: "unit-test-signing-secret-0123456789abcdef" },
}));

import {
  clampGateDays,
  issueSubscribeTicket,
  isValidTicketSubject,
  verifySubscribeTicket,
} from "./subscribe-ticket";

const DAY_MS = 86_400_000;
const DAY_SEC = 86_400;
const NOW = 1_700_000_000_000; // fixed epoch ms

describe("clampGateDays", () => {
  it("clamps into the 1..60 window", () => {
    expect(clampGateDays(0)).toBe(1);
    expect(clampGateDays(-5)).toBe(1);
    expect(clampGateDays(400)).toBe(60);
    expect(clampGateDays(30)).toBe(30);
    expect(clampGateDays(Number.NaN)).toBe(1);
  });
});

describe("isValidTicketSubject", () => {
  it("accepts account and device subjects, rejects garbage", () => {
    expect(isValidTicketSubject("u7")).toBe(true);
    expect(isValidTicketSubject("u123456")).toBe(true);
    expect(isValidTicketSubject("d018f2a1-6c3e-4c3b-9b2a-1f2e3d4c5b6a")).toBe(true);
    expect(isValidTicketSubject("dfallback-ab12cd34ef56")).toBe(true);
    expect(isValidTicketSubject("")).toBe(false);
    expect(isValidTicketSubject("u")).toBe(false);
    expect(isValidTicketSubject("d")).toBe(false);
    expect(isValidTicketSubject("x7")).toBe(false);
    expect(isValidTicketSubject("u7; DROP TABLE")).toBe(false);
    expect(isValidTicketSubject("u99999999999")).toBe(false); // > 10 digits
  });
});

describe("issueSubscribeTicket + verifySubscribeTicket", () => {
  it("issues and verifies an account-bound ticket", () => {
    const ticket = issueSubscribeTicket("u7", 30, NOW);
    expect(ticket).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(verifySubscribeTicket(ticket, { userId: 7 }, NOW)).toBe(true);
    // device-level acceptance (guest endpoints verify without binding)
    expect(verifySubscribeTicket(ticket, {}, NOW)).toBe(true);
  });

  it("issues and verifies a device-bound ticket", () => {
    const ticket = issueSubscribeTicket("d018f2a1-6c3e-4c3b-9b2a-1f2e3d4c5b6a", 30, NOW);
    expect(verifySubscribeTicket(ticket, {}, NOW)).toBe(true);
    // device tickets pass even when a userId binding is requested
    expect(verifySubscribeTicket(ticket, { userId: 42 }, NOW)).toBe(true);
  });

  it("rejects an account ticket presented by a DIFFERENT user", () => {
    const ticket = issueSubscribeTicket("u7", 30, NOW);
    expect(verifySubscribeTicket(ticket, { userId: 99 }, NOW)).toBe(false);
  });

  it("rejects a tampered payload (signature mismatch)", () => {
    const ticket = issueSubscribeTicket("u7", 30, NOW);
    const [body, sig] = ticket.split(".");
    // re-encode the payload with a longer expiry but keep the old signature
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    payload.exp = payload.exp + 100 * DAY_SEC;
    const forged = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${sig}`;
    expect(verifySubscribeTicket(forged, { userId: 7 }, NOW)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const ticket = issueSubscribeTicket("u7", 30, NOW);
    const [body] = ticket.split(".");
    const badSig = "A".repeat(43); // same length, different bytes
    expect(verifySubscribeTicket(`${body}.${badSig}`, { userId: 7 }, NOW)).toBe(false);
  });

  it("rejects an EXPIRED ticket — the unlock window is real", () => {
    const ticket = issueSubscribeTicket("u7", 30, NOW);
    expect(verifySubscribeTicket(ticket, { userId: 7 }, NOW + 30 * DAY_MS - 60_000)).toBe(true);
    expect(verifySubscribeTicket(ticket, { userId: 7 }, NOW + 30 * DAY_MS + 1_000)).toBe(false);
  });

  it("rejects a far-future issued-at (pre-minted token attack)", () => {
    const ticket = issueSubscribeTicket("u7", 30, NOW + 10 * 60_000);
    expect(verifySubscribeTicket(ticket, { userId: 7 }, NOW)).toBe(false);
    // inside the skew window is fine
    const okTicket = issueSubscribeTicket("u7", 30, NOW + 30_000);
    expect(verifySubscribeTicket(okTicket, { userId: 7 }, NOW)).toBe(true);
  });

  it("rejects an over-long lifetime (self-extended expiry)", () => {
    // Craft a validly-SIGNED ticket with a 100-day lifetime using the real
    // signer internals — then prove the verifier independently refuses
    // >60d lifetimes (issueSubscribeTicket clamps, the verifier double-checks).
    const payload = {
      v: 1,
      sub: "u7",
      iat: Math.floor(NOW / 1000),
      exp: Math.floor(NOW / 1000) + 100 * DAY_SEC,
    };
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", "unit-test-signing-secret-0123456789abcdef")
      .update(body)
      .digest("base64url");
    expect(verifySubscribeTicket(`${body}.${sig}`, { userId: 7 }, NOW)).toBe(false);
  });

  it("rejects malformed garbage without throwing (fail-closed)", () => {
    expect(verifySubscribeTicket(null, { userId: 7 }, NOW)).toBe(false);
    expect(verifySubscribeTicket(undefined, { userId: 7 }, NOW)).toBe(false);
    expect(verifySubscribeTicket("", { userId: 7 }, NOW)).toBe(false);
    expect(verifySubscribeTicket("not-a-ticket", { userId: 7 }, NOW)).toBe(false);
    expect(verifySubscribeTicket("a.b", { userId: 7 }, NOW)).toBe(false);
    expect(verifySubscribeTicket("!!!=.???=", { userId: 7 }, NOW)).toBe(false);
    expect(verifySubscribeTicket("eyJhIjoxfQ.QUJD", { userId: 7 }, NOW)).toBe(false);
    expect(verifySubscribeTicket(12345 as unknown as string, { userId: 7 }, NOW)).toBe(false);
  });

  it("rejects tickets signed with a DIFFERENT secret (key rotation)", () => {
    const payload = { v: 1, sub: "u7", iat: Math.floor(NOW / 1000), exp: Math.floor(NOW / 1000) + 30 * DAY_SEC };
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const rogueSig = createHmac("sha256", "a-completely-different-secret-0123456789")
      .update(body)
      .digest("base64url");
    expect(verifySubscribeTicket(`${body}.${rogueSig}`, { userId: 7 }, NOW)).toBe(false);
  });

  it("clamps the issued lifetime into 1..60 days", () => {
    const short = issueSubscribeTicket("u7", 0, NOW);
    expect(verifySubscribeTicket(short, { userId: 7 }, NOW + 12 * 60 * 60_000)).toBe(true); // 12h: valid
    expect(verifySubscribeTicket(short, { userId: 7 }, NOW + 1 * DAY_MS + 60_000)).toBe(false); // 1d+1min: expired

    const long = issueSubscribeTicket("u7", 365, NOW);
    expect(verifySubscribeTicket(long, { userId: 7 }, NOW + 60 * DAY_MS - 60_000)).toBe(true);
    expect(verifySubscribeTicket(long, { userId: 7 }, NOW + 61 * DAY_MS)).toBe(false);
  });
});
