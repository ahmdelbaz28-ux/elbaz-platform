import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SignJWT } from "jose";

// Mock env BEFORE jwt.ts is imported (vi.mock is hoisted)
vi.mock("./env", () => ({
  env: {
    appSecret: "test-secret-key-that-is-32-characters!",
    isProduction: false,
    JWT_ACCESS_EXPIRY: "30d",
  },
}));

vi.stubEnv("APP_SECRET", "test-secret-key-that-is-32-characters!");
vi.stubEnv("NODE_ENV", "test");

import {
  createToken,
  verifyToken,
  verifyExpiredToken,
  getSecret,
  getTokenRemainingSeconds,
  type TokenPayload,
} from "./jwt";

const TEST_PAYLOAD: TokenPayload = {
  userId: 42,
  username: "testengineer",
  role: "admin",
  tokenVersion: 3,
};

describe("JWT Module", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── createToken ───────────────────────────────────────────────────────

  describe("createToken()", () => {
    it("creates a valid JWT string with 3 dot-separated parts", async () => {
      const token = await createToken(TEST_PAYLOAD);
      expect(token).toBeTruthy();
      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3);
    });

    it("creates a token that can be decoded to the original payload", async () => {
      const token = await createToken(TEST_PAYLOAD);
      // Decode manually to check payload without verification
      const parts = token.split(".");
      const payload = JSON.parse(atob(parts[1].replaceAll("-", "+").replaceAll("_", "/")));
      expect(payload.userId).toBe(42);
      expect(payload.username).toBe("testengineer");
      expect(payload.role).toBe("admin");
      expect(payload.tokenVersion).toBe(3);
    });

    it("sets issuer and audience claims", async () => {
      const token = await createToken(TEST_PAYLOAD);
      const parts = token.split(".");
      const payload = JSON.parse(atob(parts[1].replaceAll("-", "+").replaceAll("_", "/")));
      expect(payload.iss).toBe("elbaz-platform");
      expect(payload.aud).toBe("elbaz-platform-users");
    });

    it("sets expiration claim (30 days from now)", async () => {
      const now = Date.now() / 1000;
      const token = await createToken(TEST_PAYLOAD);
      const parts = token.split(".");
      const payload = JSON.parse(atob(parts[1].replaceAll("-", "+").replaceAll("_", "/")));
      expect(payload.exp).toBeDefined();
      expect(typeof payload.exp).toBe("number");
      // Should expire ~30 days from now (30 * 24 * 3600 = 2592000 seconds)
      expect(payload.exp).toBeGreaterThan(now + 29 * 24 * 60 * 60);
      expect(payload.exp).toBeLessThanOrEqual(now + 30 * 24 * 60 * 60 + 5);
    });

    it("sets issued-at claim", async () => {
      const now = Date.now() / 1000;
      const token = await createToken(TEST_PAYLOAD);
      const parts = token.split(".");
      const payload = JSON.parse(atob(parts[1].replaceAll("-", "+").replaceAll("_", "/")));
      expect(payload.iat).toBeDefined();
      expect(payload.iat).toBeLessThanOrEqual(now + 1);
    });
  });

  // ─── verifyToken ──────────────────────────────────────────────────────

  describe("verifyToken()", () => {
    it("successfully verifies a valid token and returns payload", async () => {
      const token = await createToken(TEST_PAYLOAD);
      const payload = await verifyToken(token);
      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe(42);
      expect(payload!.username).toBe("testengineer");
      expect(payload!.role).toBe("admin");
      expect(payload!.tokenVersion).toBe(3);
    });

    it("returns null for tampered tokens (modified payload)", async () => {
      const token = await createToken(TEST_PAYLOAD);
      const parts = token.split(".");
      // Tamper with the payload by flipping a character
      parts[1] = parts[1].slice(0, -1) + (parts[1].slice(-1) === "A" ? "B" : "A");
      const tamperedToken = parts.join(".");
      const payload = await verifyToken(tamperedToken);
      expect(payload).toBeNull();
    });

    it("returns null for tokens with wrong signature", async () => {
      const token = await createToken(TEST_PAYLOAD);
      // Replace the signature with garbage
      const parts = token.split(".");
      parts[2] = "aW52YWxpZC1zaWduYXR1cmU";
      const invalidToken = parts.join(".");
      const payload = await verifyToken(invalidToken);
      expect(payload).toBeNull();
    });

    it("returns null for expired tokens", async () => {
      // Create a token that's already expired (exp set to 1 hour ago)
      // by using jose directly with a past expiration timestamp
      const secret = new TextEncoder().encode(
        "test-secret-key-that-is-32-characters!"
      );
      const expiredToken = await new SignJWT(
        TEST_PAYLOAD as unknown as Record<string, unknown>
      )
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setIssuer("elbaz-platform")
        .setAudience("elbaz-platform-users")
        .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // expired 1h ago
        .sign(secret);

      const payload = await verifyToken(expiredToken);
      expect(payload).toBeNull();
    });

    it("returns null for tokens signed with a different secret", async () => {
      // Create a token with a DIFFERENT secret using jose directly
      const wrongSecret = new TextEncoder().encode(
        "different-secret-key-exactly-32-chars!!"
      );
      const foreignToken = await new SignJWT(
        TEST_PAYLOAD as unknown as Record<string, unknown>
      )
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setIssuer("elbaz-platform")
        .setAudience("elbaz-platform-users")
        .setExpirationTime("24h")
        .sign(wrongSecret);

      const payload = await verifyToken(foreignToken);
      expect(payload).toBeNull();
    });

    it("returns null for tokens with wrong issuer", async () => {
      const secret = new TextEncoder().encode(
        "test-secret-key-that-is-32-characters!"
      );
      const wrongIssuerToken = await new SignJWT(
        TEST_PAYLOAD as unknown as Record<string, unknown>
      )
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setIssuer("attacker-platform") // wrong issuer
        .setAudience("elbaz-platform-users")
        .setExpirationTime("24h")
        .sign(secret);

      const payload = await verifyToken(wrongIssuerToken);
      expect(payload).toBeNull();
    });

    it("returns null for tokens with wrong audience", async () => {
      const secret = new TextEncoder().encode(
        "test-secret-key-that-is-32-characters!"
      );
      const wrongAudienceToken = await new SignJWT(
        TEST_PAYLOAD as unknown as Record<string, unknown>
      )
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setIssuer("elbaz-platform")
        .setAudience("wrong-audience") // wrong audience
        .setExpirationTime("24h")
        .sign(secret);

      const payload = await verifyToken(wrongAudienceToken);
      expect(payload).toBeNull();
    });

    it("returns null for completely invalid strings", async () => {
      expect(await verifyToken("")).toBeNull();
      expect(await verifyToken("not-a-jwt")).toBeNull();
      expect(await verifyToken("a.b")).toBeNull();
    });
  });

  // ─── getTokenRemainingSeconds ──────────────────────────────────────────

  describe("getTokenRemainingSeconds()", () => {
    it("returns correct remaining seconds for a fresh token", async () => {
      const token = await createToken(TEST_PAYLOAD);
      const payload = await verifyToken(token);
      expect(payload).not.toBeNull();

      const remaining = getTokenRemainingSeconds(payload!);
      // Token should have ~30 days remaining
      expect(remaining).toBeGreaterThan(29 * 24 * 60 * 60);
      expect(remaining).toBeLessThanOrEqual(30 * 24 * 60 * 60 + 5);
    });

    it("returns 0 for already-expired tokens", () => {
      const expiredPayload = {
        ...TEST_PAYLOAD,
        exp: Math.floor(Date.now() / 1000) - 100,
      } as unknown as TokenPayload;

      expect(getTokenRemainingSeconds(expiredPayload)).toBe(0);
    });

    it("returns 0 for payloads without exp claim", () => {
      // TokenPayload type doesn't include exp, so a payload without it
      // (e.g., one that wasn't decoded from a JWT) should return 0
      expect(getTokenRemainingSeconds(TEST_PAYLOAD)).toBe(0);
    });

    it("decreases over time (monotonic check)", async () => {
      vi.useFakeTimers();
      const baseTime = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(baseTime);

      const token = await createToken(TEST_PAYLOAD);
      const payload = await verifyToken(token);
      expect(payload).not.toBeNull();

      const remaining1 = getTokenRemainingSeconds(payload!);

      // Advance 60 seconds
      vi.spyOn(Date, "now").mockReturnValue(baseTime + 60_000);
      const remaining2 = getTokenRemainingSeconds(payload!);

      expect(remaining2).toBeLessThan(remaining1);
      expect(remaining2).toBe(remaining1 - 60);
    });
  });

  // ─── verifyExpiredToken (session-persistence grace path) ─────────────
  // The auth context renews signature-valid tokens that merely expired, so a
  // user returning after the short access-TTL is not hard-logged-out. These
  // tests pin down that ONLY expired-but-authentic tokens pass.
  describe("verifyExpiredToken()", () => {
    const nowS = () => Math.floor(Date.now() / 1000);

    async function mintExpired(secondsAgo: number): Promise<string> {
      return new SignJWT(TEST_PAYLOAD as unknown as Record<string, unknown>)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt(nowS() - 3600)
        .setIssuer("elbaz-platform")
        .setAudience("elbaz-platform-users")
        .setSubject("user:42")
        .setExpirationTime(nowS() - secondsAgo)
        .sign(getSecret());
    }

    it("accepts a recently expired token with a valid signature + issuer + audience", async () => {
      const payload = await verifyExpiredToken(await mintExpired(60));
      expect(payload).not.toBeNull();
      expect(payload!.userId).toBe(42);
      expect(payload!.username).toBe("testengineer");
      expect(payload!.tokenVersion).toBe(3);
      // exp must survive so the context can measure the grace window
      expect(typeof (payload as unknown as { exp?: number }).exp).toBe("number");
    });

    it("also accepts a NON-expired token (harmless — context prefers verifyToken)", async () => {
      const token = await new SignJWT(TEST_PAYLOAD as unknown as Record<string, unknown>)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt(nowS())
        .setIssuer("elbaz-platform")
        .setAudience("elbaz-platform-users")
        .setSubject("user:42")
        .setExpirationTime(nowS() + 600)
        .sign(getSecret());
      const payload = await verifyExpiredToken(token);
      expect(payload?.userId).toBe(42);
    });

    it("rejects a forged token signed with a different secret", async () => {
      const forged = await new SignJWT(TEST_PAYLOAD as unknown as Record<string, unknown>)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt(nowS() - 3600)
        .setIssuer("elbaz-platform")
        .setAudience("elbaz-platform-users")
        .setSubject("user:42")
        .setExpirationTime(nowS() - 60)
        .sign(new TextEncoder().encode("different-secret-key-exactly-32-chars!!"));
      expect(await verifyExpiredToken(forged)).toBeNull();
    });

    it("rejects a valid-signature token with a wrong issuer", async () => {
      const foreign = await new SignJWT(TEST_PAYLOAD as unknown as Record<string, unknown>)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt(nowS() - 3600)
        .setIssuer("attacker-platform")
        .setAudience("elbaz-platform-users")
        .setSubject("user:42")
        .setExpirationTime(nowS() - 60)
        .sign(getSecret());
      expect(await verifyExpiredToken(foreign)).toBeNull();
    });

    it("rejects a valid-signature token with a wrong audience", async () => {
      const foreign = await new SignJWT(TEST_PAYLOAD as unknown as Record<string, unknown>)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt(nowS() - 3600)
        .setIssuer("elbaz-platform")
        .setAudience("wrong-audience")
        .setSubject("user:42")
        .setExpirationTime(nowS() - 60)
        .sign(getSecret());
      expect(await verifyExpiredToken(foreign)).toBeNull();
    });

    it("rejects garbage input", async () => {
      expect(await verifyExpiredToken("")).toBeNull();
      expect(await verifyExpiredToken("not-a-jwt")).toBeNull();
    });
  });

  // ─── tokenVersion preservation ─────────────────────────────────────────

  describe("tokenVersion preservation", () => {
    it("preserves tokenVersion=0 in payload", async () => {
      const payload = { ...TEST_PAYLOAD, tokenVersion: 0 };
      const token = await createToken(payload);
      const verified = await verifyToken(token);
      expect(verified).not.toBeNull();
      expect(verified!.tokenVersion).toBe(0);
    });

    it("preserves tokenVersion=999 in payload", async () => {
      const payload = { ...TEST_PAYLOAD, tokenVersion: 999 };
      const token = await createToken(payload);
      const verified = await verifyToken(token);
      expect(verified).not.toBeNull();
      expect(verified!.tokenVersion).toBe(999);
    });
  });
});
