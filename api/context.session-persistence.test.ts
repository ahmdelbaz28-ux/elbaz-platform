import { describe, it, expect, beforeAll, vi } from "vitest";
import { SignJWT } from "jose";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";

/**
 * ROOT-CURE REGRESSION GUARD (2026-11-13) —
 * "Logged out every time despite Remember this device".
 *
 * Three chained defects used to destroy a perfectly valid 30-day session:
 *
 *  1. FALSE-401 ON DB HICCUP: a transient MySQL failure inside the auth
 *     pipeline was swallowed by createContext's blanket catch → the request
 *     looked like a GUEST → requireAuth threw UNAUTHORIZED → the client's
 *     auth-failure handler destroyed the stored session. One brief DB outage
 *     (HF Space wake-up, free-tier connection reset) = permanent logout.
 *     PINNED HERE: a DB failure during user loading must surface as a
 *     retryable INTERNAL_SERVER_ERROR (5xx), never as a guest context.
 *
 *  2. GRACE WINDOW SMALLER THAN THE PROMISE: expired-but-signature-valid
 *     tokens were renewed only within 24h of expiry while the "Remember this
 *     device" cookie lasts 30 days — any idle gap beyond ~8 days forced a
 *     fresh login. PINNED HERE: a token expired within the 30-day window is
 *     transparently renewed (fresh cookie pair minted) and authenticates the
 *     request; REST optional-auth resolves it too.
 *
 *  3. REVOCATION STILL WORKS: tokenVersion mismatch (logout / password reset)
 *     and tokens expired beyond the window stay rejected. Security is not
 *     traded away for persistence.
 */

// ── Switchable DB mock ────────────────────────────────────────────────────
type SelectChain = {
  select: () => { from: () => { where: () => { limit: () => Promise<unknown[]> } } };
};
const dbBehavior: { impl: () => SelectChain } = {
  impl: () => {
    throw new Error("dbBehavior not configured");
  },
};

vi.mock("./queries/connection", () => ({
  getDb: () => dbBehavior.impl(),
}));

// env mock — must satisfy every importer of ./lib/env reachable from
// context.ts (currently jwt.ts). Values are consistent between signing and
// verification because both go through the same mocked module.
vi.mock("./lib/env", () => ({
  env: {
    APP_SECRET: "test-secret-key-that-is-32-characters!",
    JWT_ACCESS_EXPIRY: "30d",
    JWT_REFRESH_EXPIRY: "30d",
    FRONTEND_URL: "https://test.example",
  },
  getPublicEnvKeys: () => ({}),
  getActiveFrontendUrl: () => "https://test.example",
  isProduction: false,
}));

const TEST_USER = {
  id: 42,
  username: "testengineer",
  name: "Test Engineer",
  email: "test@example.com",
  role: "user",
  avatar: null,
  tokenVersion: 7,
  passwordHash: "$2a$12$dummy-hash-not-a-real-hash-at-all",
};

function dbReturning(rows: unknown[]): SelectChain {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => rows,
        }),
      }),
    }),
  };
}

function dbBroken(): SelectChain {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            throw new Error("ECONNRESET: transient MySQL failure (simulated)");
          },
        }),
      }),
    }),
  };
}

beforeAll(() => {
  dbBehavior.impl = () => dbReturning([TEST_USER]);
});

// ── Helpers ───────────────────────────────────────────────────────────────
const nowS = () => Math.floor(Date.now() / 1000);

async function mintToken(opts: {
  expiredSecondsAgo?: number | null; // null → not expired
  tokenVersion?: number;
}): Promise<string> {
  const { expiredSecondsAgo = null, tokenVersion = TEST_USER.tokenVersion } = opts;
  const payload = {
    userId: TEST_USER.id,
    username: TEST_USER.username,
    role: TEST_USER.role,
    tokenVersion,
  };
  const jwt = new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(expiredSecondsAgo === null ? nowS() : nowS() - 3600)
    .setIssuer("elbaz-platform")
    .setAudience("elbaz-platform-users")
    .setSubject(`user:${TEST_USER.id}`);
  jwt.setExpirationTime(expiredSecondsAgo === null ? nowS() + 3600 : nowS() - expiredSecondsAgo);
  return jwt.sign(new TextEncoder().encode("test-secret-key-that-is-32-characters!"));
}

function makeOpts(token: string | null): FetchCreateContextFnOptions {
  const headers = new Headers(token ? { cookie: `elbaz_auth=${token}` } : {});
  const req = new Request("https://test.example/api/trpc/auth.me", { headers });
  return { req, resHeaders: new Headers() } as unknown as FetchCreateContextFnOptions;
}

async function createContextFor(opts: FetchCreateContextFnOptions) {
  const mod = await import("./context");
  const ctx = await mod.createContext(opts);
  return ctx;
}

// ── Tests ─────────────────────────────────────────────────────────────────
describe("auth context — session persistence root-cure", () => {
  it("DEFECT 1: a transient DB failure NEVER produces a guest/401 — it fails as a retryable 5xx", async () => {
    dbBehavior.impl = () => dbBroken();
    const token = await mintToken({}); // perfectly valid token
    try {
      await createContextFor(makeOpts(token));
      // Reaching here means the context silently degraded to guest — the exact
      // bug that destroyed real sessions. Fail loudly.
      expect.fail("createContext swallowed a DB outage and degraded a valid session to guest");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("INTERNAL_SERVER_ERROR");
    }
  }, 15000);

  it("DEFECT 1: after the DB recovers, the SAME session authenticates normally", async () => {
    dbBehavior.impl = () => dbReturning([TEST_USER]);
    const token = await mintToken({});
    const ctx = await createContextFor(makeOpts(token));
    expect(ctx.user?.id).toBe(TEST_USER.id);
    expect(ctx.user?.username).toBe(TEST_USER.username);
  });

  it("DEFECT 2: a token expired 10 days ago (within the 30-day remember window) is transparently renewed", async () => {
    dbBehavior.impl = () => dbReturning([TEST_USER]);
    const token = await mintToken({ expiredSecondsAgo: 10 * 24 * 3600 });
    const opts = makeOpts(token);
    const ctx = await createContextFor(opts);
    // Session restored — NOT a guest.
    expect(ctx.user?.id).toBe(TEST_USER.id);
    // Fresh 30-day cookie pair minted so the next visit needs no login.
    const cookies = opts.resHeaders.getSetCookie().join("\n");
    expect(cookies).toContain("elbaz_auth=");
    expect(cookies).toContain("elbaz_auth_flag=1");
    expect(cookies).toContain("Max-Age=");
  }, 15000);

  it("DEFECT 2: the REST optional-auth path resolves the same expired-within-window token", async () => {
    dbBehavior.impl = () => dbReturning([TEST_USER]);
    const { resolveOptionalUser } = await import("./context");
    const token = await mintToken({ expiredSecondsAgo: 20 * 24 * 3600 });
    const headers = new Headers({ cookie: `elbaz_auth=${token}` });
    const req = new Request("https://test.example/api/chatbot/chat", { headers });
    const user = await resolveOptionalUser(req);
    expect(user?.id).toBe(TEST_USER.id);
  }, 15000);

  it("SECURITY: a token expired BEYOND the 30-day window is rejected (hard logout)", async () => {
    dbBehavior.impl = () => dbReturning([TEST_USER]);
    const token = await mintToken({ expiredSecondsAgo: 40 * 24 * 3600 });
    const ctx = await createContextFor(makeOpts(token));
    expect(ctx.user).toBeUndefined();
  }, 15000);

  it("SECURITY: revoked session (tokenVersion bumped server-side) stays rejected even within the window", async () => {
    // User logged out / password changed → DB tokenVersion is now 8.
    dbBehavior.impl = () => dbReturning([{ ...TEST_USER, tokenVersion: 8 }]);
    const token = await mintToken({ expiredSecondsAgo: 3600, tokenVersion: 7 });
    const ctx = await createContextFor(makeOpts(token));
    expect(ctx.user).toBeUndefined();
  });

  it("SECURITY: a forged token (wrong secret) is rejected even within the window", async () => {
    dbBehavior.impl = () => dbReturning([TEST_USER]);
    const forged = await new SignJWT({
      userId: TEST_USER.id,
      username: TEST_USER.username,
      role: "admin",
      tokenVersion: TEST_USER.tokenVersion,
    } as unknown as Record<string, unknown>)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(nowS() - 3600)
      .setIssuer("elbaz-platform")
      .setAudience("elbaz-platform-users")
      .setSubject(`user:${TEST_USER.id}`)
      .setExpirationTime(nowS() - 60)
      .sign(new TextEncoder().encode("attacker-secret-key-exactly-32-chars!!"));
    const ctx = await createContextFor(makeOpts(forged));
    expect(ctx.user).toBeUndefined();
  });

  it("BASELINE: requests without any token stay guests (public browsing unaffected)", async () => {
    dbBehavior.impl = () => dbReturning([TEST_USER]);
    const ctx = await createContextFor(makeOpts(null));
    expect(ctx.user).toBeUndefined();
  });
});
