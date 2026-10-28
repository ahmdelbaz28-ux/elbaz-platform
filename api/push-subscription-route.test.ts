import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──
const resolveOptionalUser = vi.hoisted(() => vi.fn());
vi.mock("./context", () => ({ resolveOptionalUser }));

const getDb = vi.hoisted(() => vi.fn());
vi.mock("./queries/connection", () => ({ getDb }));

 
const getVapidPublicKey = vi.hoisted(() => vi.fn<() => string | null>(() => "BElbazTestPublicKey__aaaaaaaaaaaaaaaaaa"));
vi.mock("./lib/push-delivery", () => ({ getVapidPublicKey }));

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

function mockDb() {
  const onDuplicateKeyUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onDuplicateKeyUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const del = vi.fn().mockReturnValue({ where: deleteWhere });
  getDb.mockReturnValue({ insert, delete: del });
  return { insert, values, onDuplicateKeyUpdate, del, deleteWhere };
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
});

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
