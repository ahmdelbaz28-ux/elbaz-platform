import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──
const resolveOptionalUser = vi.hoisted(() => vi.fn());
vi.mock("./context", () => ({ resolveOptionalUser }));

const getDb = vi.hoisted(() => vi.fn());
vi.mock("./queries/connection", () => ({ getDb }));

 
const getVapidPublicKey = vi.hoisted(() => vi.fn<() => string | null>(() => "BElbazTestPublicKey__aaaaaaaaaaaaaaaaaa"));
// Scheme-only pass-through in THIS file — the real push-service host
// allowlist is covered against the actual implementation in
// api/security-audit-run1.test.ts.
const isAllowedPushEndpoint = vi.hoisted(() => vi.fn((endpoint: string) => {
  try { return new URL(endpoint).protocol === "https:"; } catch { return false; }
}));
vi.mock("./lib/push-delivery", () => ({ getVapidPublicKey, isAllowedPushEndpoint }));

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("./lib/logger", () => ({ logger }));

import { pushSubscriptionRoute } from "./push-subscription-route";

const USER = { id: 7, username: "student", role: "user" };
const VALID_SUB = {
  endpoint: "https://fcm.googleapis.com/fcm/send/token123",
  keys: { p256dh: "k".repeat(87), auth: "a".repeat(24) },
};

function mockDb(opts: { existingEndpointRows?: unknown[]; countRows?: unknown[] } = {}) {
  const onDuplicateKeyUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onDuplicateKeyUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const del = vi.fn().mockReturnValue({ where: deleteWhere });
  // The subscribe path (audit run-1) first looks up the endpoint row, then
  // counts the user's stored subscriptions. The projection discriminates the
  // two select shapes: { userCount } → count query, else endpoint lookup.
  const select = vi.fn().mockImplementation((projection: Record<string, unknown>) => {
    const result = projection && "userCount" in projection
      ? (opts.countRows ?? [{ userCount: 0 }])
      : (opts.existingEndpointRows ?? []);
    const step: Promise<unknown> & { limit: ReturnType<typeof vi.fn> } = Object.assign(
      Promise.resolve(result),
      { limit: vi.fn().mockResolvedValue(result) },
    );
    return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue(step) }) };
  });
  getDb.mockReturnValue({ insert, delete: del, select });
  return { insert, values, onDuplicateKeyUpdate, del, deleteWhere, select };
}

beforeEach(() => {
  resolveOptionalUser.mockReset();
  getDb.mockReset();
});

describe("GET /public-key", () => {
  it("reports the server VAPID public key", async () => {
    const res = await pushSubscriptionRoute.request("/public-key");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; publicKey: string };
    expect(body.enabled).toBe(true);
    expect(body.publicKey).toBe("BElbazTestPublicKey__aaaaaaaaaaaaaaaaaa");
  });

  it("reports enabled=false when push is not configured", async () => {
    getVapidPublicKey.mockReturnValueOnce(null);
    const res = await pushSubscriptionRoute.request("/public-key");
    const body = (await res.json()) as { enabled: boolean; publicKey: string | null };
    expect(body.enabled).toBe(false);
    expect(body.publicKey).toBeNull();
  });
});

describe("POST /subscribe", () => {
  it("requires authentication", async () => {
    resolveOptionalUser.mockResolvedValue(null);
    const res = await pushSubscriptionRoute.request("/subscribe", {
      method: "POST",
      body: JSON.stringify(VALID_SUB),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects non-https endpoints (SSRF/abuse guard)", async () => {
    resolveOptionalUser.mockResolvedValue(USER);
    const res = await pushSubscriptionRoute.request("/subscribe", {
      method: "POST",
      body: JSON.stringify({ ...VALID_SUB, endpoint: "http://intranet.local/push" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects missing keys", async () => {
    resolveOptionalUser.mockResolvedValue(USER);
    const res = await pushSubscriptionRoute.request("/subscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint: VALID_SUB.endpoint }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("stores the subscription for the logged-in user (upsert)", async () => {
    resolveOptionalUser.mockResolvedValue(USER);
    const db = mockDb();
    const res = await pushSubscriptionRoute.request("/subscribe", {
      method: "POST",
      body: JSON.stringify(VALID_SUB),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(db.values).toHaveBeenCalledWith(expect.objectContaining({ endpoint: VALID_SUB.endpoint, userId: 7 }));
    expect(db.onDuplicateKeyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ set: expect.objectContaining({ userId: 7 }) })
    );
  });

  it("maps a DB failure to a clean 500 (never throws)", async () => {
    resolveOptionalUser.mockResolvedValue(USER);
    getDb.mockImplementation(() => {
      throw new Error("db down");
    });
    const res = await pushSubscriptionRoute.request("/subscribe", {
      method: "POST",
      body: JSON.stringify(VALID_SUB),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(500);
  });

  it("enforces the per-user subscription cap (audit run-1 amplification bound)", async () => {
    resolveOptionalUser.mockResolvedValue(USER);
    mockDb({ countRows: [{ userCount: 10 }] });
    const res = await pushSubscriptionRoute.request("/subscribe", {
      method: "POST",
      body: JSON.stringify(VALID_SUB),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(429);
  });

  it("allows re-subscribing an existing endpoint beyond the cap (upsert update)", async () => {
    resolveOptionalUser.mockResolvedValue(USER);
    const db = mockDb({ existingEndpointRows: [{ userId: 7 }], countRows: [{ userCount: 10 }] });
    const res = await pushSubscriptionRoute.request("/subscribe", {
      method: "POST",
      body: JSON.stringify(VALID_SUB),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(db.onDuplicateKeyUpdate).toHaveBeenCalled();
  });
})

describe("POST /unsubscribe", () => {
  it("deletes the exact endpoint", async () => {
    const db = mockDb();
    const res = await pushSubscriptionRoute.request("/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint: VALID_SUB.endpoint }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(db.deleteWhere).toHaveBeenCalled();
  });

  it("rejects malformed payloads", async () => {
    const res = await pushSubscriptionRoute.request("/unsubscribe", {
      method: "POST",
      body: "not-json",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /failure-report — persistent-refusal telemetry (log-only)", () => {
  it("accepts a report anonymously (session may have expired) and logs it", async () => {
    resolveOptionalUser.mockResolvedValue(null);
    const res = await pushSubscriptionRoute.request("/failure-report", {
      method: "POST",
      body: JSON.stringify({
        code: "PUSH_SERVICE_UNAVAILABLE",
        detail: "AbortError: Registration failed - push service error",
      }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      "[Push] client reported persistent subscribe refusal",
      expect.objectContaining({ userId: null, code: "PUSH_SERVICE_UNAVAILABLE" }),
    );
  });

  it("attaches the userId when a session exists", async () => {
    resolveOptionalUser.mockResolvedValue(USER);
    const res = await pushSubscriptionRoute.request("/failure-report", {
      method: "POST",
      body: JSON.stringify({ code: "PUSH_SERVICE_UNAVAILABLE" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(logger.warn).toHaveBeenCalledWith(
      "[Push] client reported persistent subscribe refusal",
      expect.objectContaining({ userId: 7, detail: null }),
    );
  });

  it("rejects oversized / malformed payloads", async () => {
    resolveOptionalUser.mockResolvedValue(USER);
    const res = await pushSubscriptionRoute.request("/failure-report", {
      method: "POST",
      body: JSON.stringify({ code: "x".repeat(100) }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);

    const bad = await pushSubscriptionRoute.request("/failure-report", {
      method: "POST",
      body: "not-json",
      headers: { "Content-Type": "application/json" },
    });
    expect(bad.status).toBe(400);
  });

  it("never fails the client even if identity resolution throws", async () => {
    resolveOptionalUser.mockRejectedValue(new Error("auth backend down"));
    const res = await pushSubscriptionRoute.request("/failure-report", {
      method: "POST",
      body: JSON.stringify({ code: "PUSH_SERVICE_UNAVAILABLE" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
  });
});
