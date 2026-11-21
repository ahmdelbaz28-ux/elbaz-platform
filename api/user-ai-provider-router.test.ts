import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (same hoisted pattern as chatbot-feedback-route.test.ts) ──
const resolveOptionalUser = vi.hoisted(() => vi.fn());
vi.mock("./context", () => ({ resolveOptionalUser }));

const getDb = vi.hoisted(() => vi.fn());
vi.mock("./queries/connection", () => ({ getDb }));

const getUserByokConfig = vi.hoisted(() => vi.fn());
const testByokProvider = vi.hoisted(() => vi.fn());
// Keep the REAL catalog + isKnownUserProvider; mock only the network/db lane.
vi.mock("./lib/chatbot-byok", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/chatbot-byok")>();
  return {
    ...actual,
    getUserByokConfig,
    testByokProvider,
  };
});

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("./lib/logger", () => ({ logger }));

import { userAiProviderRouter } from "./user-ai-provider-router";
import { encryptByokKey } from "./lib/byok-crypto";

const VALID_BODY = {
  provider: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  modelId: "deepseek/deepseek-chat",
  apiKey: "sk-or-v1-user-owned-key-1234567890",
};

// Real AES-256-GCM ciphertext so the mask pipeline (decrypt → last-4) works
// end-to-end inside the fake rows.
const REAL_ENC = encryptByokKey("sk-or-v1-user-owned-key-1234567890");

// Row returned by the fake db select chains.
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    userId: 42,
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    modelId: "deepseek/deepseek-chat",
    apiKeyEnc: REAL_ENC,
    enabled: true,
    lastTestOk: null,
    lastTestError: null,
    lastTestedAt: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// Flexible fake db: selectResults is consumed in order (one array per select);
// affectedRows configures the PATCH update result.
function fakeDb(selectResults: unknown[][], affectedRows = 1) {
  const captured = { insertValues: null as unknown, dupUpdateSet: null as Record<string, unknown> | null, updateWhere: null as unknown, deleteWhere: null as unknown };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectResults.length ? (selectResults.shift() as unknown[]) : [],
        }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => ({
        onDuplicateKeyUpdate: (arg: { set: Record<string, unknown> }) => {
          captured.insertValues = v;
          captured.dupUpdateSet = arg.set;
          return Promise.resolve([{}]);
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: (w: unknown) => {
          captured.updateWhere = w;
          return Promise.resolve([{ affectedRows }]);
        },
      }),
    }),
    delete: () => ({
      where: (w: unknown) => {
        captured.deleteWhere = w;
        return Promise.resolve([{}]);
      },
    }),
    captured,
  };
  getDb.mockReturnValue(db);
  return db;
}

beforeEach(() => {
  resolveOptionalUser.mockReset().mockResolvedValue(null);
  getUserByokConfig.mockReset();
  testByokProvider.mockReset();
});

describe("auth gate", () => {
  it("GET / without a user → 401", async () => {
    const res = await userAiProviderRouter.request("/");
    expect(res.status).toBe(401);
  });

  it("PUT / without a user → 401", async () => {
    const res = await userAiProviderRouter.request("/", {
      method: "PUT",
      body: JSON.stringify(VALID_BODY),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("DELETE / without a user → 401", async () => {
    const res = await userAiProviderRouter.request("/", { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("POST /test without a user → 401", async () => {
    const res = await userAiProviderRouter.request("/test", { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("GET /", () => {
  it("returns no config + the provider catalog for a fresh user", async () => {
    resolveOptionalUser.mockResolvedValue({ id: 42, role: "user" });
    fakeDb([]);
    const res = await userAiProviderRouter.request("/");
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; config: unknown; catalog: { id: string }[] };
    expect(body.success).toBe(true);
    expect(body.config).toBeNull();
    expect(body.catalog.length).toBeGreaterThanOrEqual(6);
    expect(body.catalog.some((p) => p.id === "custom")).toBe(true);
  });

  it("returns the masked key preview — never the plaintext key", async () => {
    resolveOptionalUser.mockResolvedValue({ id: 42, role: "user" });
    fakeDb([[makeRow()]]);
    const res = await userAiProviderRouter.request("/");
    const body = await res.json() as { config: { keyPreview: string; modelId: string; baseUrl: string; enabled: boolean } };
    expect(body.config.modelId).toBe("deepseek/deepseek-chat");
    expect(body.config.enabled).toBe(true);
    // maskApiKey contract: first 3 + ellipsis + last 4.
    expect(body.config.keyPreview).toBe("sk-…7890");
    expect(body.config.keyPreview!.length).toBeLessThan(10);
    expect(JSON.stringify(body)).not.toContain("sk-or-v1-user-owned");
  });
});

describe("PUT /", () => {
  beforeEach(() => {
    resolveOptionalUser.mockResolvedValue({ id: 42, role: "user" });
  });

  it("rejects a non-https / internal baseUrl (SSRF guard)", async () => {
    const res = await userAiProviderRouter.request("/", {
      method: "PUT",
      body: JSON.stringify({ ...VALID_BODY, baseUrl: "http://169.254.169.254/v1" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown provider slug", async () => {
    const res = await userAiProviderRouter.request("/", {
      method: "PUT",
      body: JSON.stringify({ ...VALID_BODY, provider: "not-in-catalog" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("creates a config (key encrypted at rest, masked preview returned)", async () => {
    const db = fakeDb([[], [makeRow()]]);
    const res = await userAiProviderRouter.request("/", {
      method: "PUT",
      body: JSON.stringify(VALID_BODY),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; config: { keyPreview: string } };
    expect(body.success).toBe(true);
    expect(body.config.keyPreview).toBe("sk-…7890");
    // Insert carried an ENCRYPTED value, not the plaintext.
    expect(JSON.stringify(db.captured.insertValues)).not.toContain("sk-or-v1-user-owned");
  });

  it("update WITHOUT a key keeps the stored ciphertext (write-only contract)", async () => {
    const storedRow = makeRow();
    const db = fakeDb([[storedRow], [storedRow]]);
    const res = await userAiProviderRouter.request("/", {
      method: "PUT",
      body: JSON.stringify({ provider: "groq", baseUrl: "https://api.groq.com/openai/v1", modelId: "llama-3.3-70b-versatile" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    // The upsert patch must NOT touch apiKeyEnc.
    expect(db.captured.dupUpdateSet).not.toBeNull();
    expect(db.captured.dupUpdateSet!.apiKeyEnc).toBeUndefined();
    expect(db.captured.dupUpdateSet!.modelId).toBe("llama-3.3-70b-versatile");
  });

  it("requires an API key when no config exists yet", async () => {
    fakeDb([[]]);
    const res = await userAiProviderRouter.request("/", {
      method: "PUT",
      body: JSON.stringify({ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", modelId: "m" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("مفتاح API");
  });

  it("rejects malformed JSON", async () => {
    const res = await userAiProviderRouter.request("/", {
      method: "PUT",
      body: "not-json",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH / (kill switch)", () => {
  it("returns 404 when no config is stored", async () => {
    resolveOptionalUser.mockResolvedValue({ id: 42, role: "user" });
    fakeDb([], 0); // update affects 0 rows → 404
    const res = await userAiProviderRouter.request("/", {
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(404);
  });

  it("toggles enabled and returns the masked config", async () => {
    resolveOptionalUser.mockResolvedValue({ id: 42, role: "user" });
    fakeDb([[makeRow({ enabled: false })]]);
    const res = await userAiProviderRouter.request("/", {
      method: "PATCH",
      body: JSON.stringify({ enabled: true }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; config: { enabled: boolean } };
    expect(body.success).toBe(true);
  });
});

describe("DELETE /", () => {
  it("removes the stored config", async () => {
    resolveOptionalUser.mockResolvedValue({ id: 42, role: "user" });
    const db = fakeDb([]);
    const res = await userAiProviderRouter.request("/", { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; config: null };
    expect(body.success).toBe(true);
    expect(body.config).toBeNull();
    expect(db.captured.deleteWhere).not.toBeNull();
  });
});

describe("POST /test", () => {
  beforeEach(() => {
    resolveOptionalUser.mockResolvedValue({ id: 42, role: "user" });
  });

  it("tests an UNSAVED inline config without persisting anything", async () => {
    const db = fakeDb([]);
    testByokProvider.mockResolvedValue({ ok: true, latencyMs: 340 });
    const res = await userAiProviderRouter.request("/test", {
      method: "POST",
      body: JSON.stringify({ baseUrl: "https://openrouter.ai/api/v1", modelId: "deepseek/deepseek-chat", apiKey: "sk-inline-test-key-000" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; test: { ok: boolean; latencyMs: number } };
    expect(body.test.ok).toBe(true);
    expect(testByokProvider).toHaveBeenCalledWith(expect.objectContaining({ modelId: "deepseek/deepseek-chat" }));
    // Nothing persisted.
    expect(db.captured.updateWhere).toBeNull();
    expect(db.captured.insertValues).toBeNull();
  });

  it("tests the SAVED config and records lastTest state", async () => {
    getUserByokConfig.mockResolvedValue({ provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: "decrypted", modelId: "m" });
    const db = fakeDb([]);
    testByokProvider.mockResolvedValue({ ok: false, latencyMs: 90, error: "المفتاح غير صالح أو غير مصرح به (401/403)" });
    const res = await userAiProviderRouter.request("/test", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; test: { ok: boolean } };
    expect(body.test.ok).toBe(false);
    expect(db.captured.updateWhere).not.toBeNull();
    expect(getUserByokConfig).toHaveBeenCalledWith(42);
  });

  it("returns 404 when testing with no saved config and no body", async () => {
    getUserByokConfig.mockResolvedValue(null);
    const res = await userAiProviderRouter.request("/test", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("rejects an internal baseUrl in the inline test (SSRF guard)", async () => {
    const res = await userAiProviderRouter.request("/test", {
      method: "POST",
      body: JSON.stringify({ baseUrl: "http://localhost:8080/v1", modelId: "m", apiKey: "sk-local-123456" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });
});
