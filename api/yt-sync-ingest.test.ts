import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

// ── Mocks ──
const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("./lib/logger", () => ({ logger }));

const applyPlaylistSync = vi.hoisted(() => vi.fn());
const getSyncState = vi.hoisted(() => vi.fn());
const getSyncSettings = vi.hoisted(() => vi.fn());
vi.mock("./lib/playlist-sync.js", () => ({
  applyPlaylistSync,
  getSyncState,
  getSyncSettings,
}));

import { ytSyncIngestRoute } from "./yt-sync-ingest";

const SECRET = "unit-test-secret-0123456789abcdef";
const VIDEOS = {
  videos: [
    { videoId: "0l7WBjMF6uo", title: "كورس ETAP المجاني | تعلم ETAP من الصفر وحتى الاحتراف" },
    { videoId: "avugPlx0sXw", title: "تحميل وتسطيب برنامج ETAP 2021 كامل | كورس ايتاب كامل بالعربي #01 | ETAP Course" },
  ],
  source: "gh-actions",
};

function signedBody(payload: unknown, secret: string = SECRET): { body: string; headers: Record<string, string> } {
  const body = JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
  return { body, headers: { "content-type": "application/json", "x-sync-signature": sig } };
}

beforeEach(() => {
  applyPlaylistSync.mockReset();
  getSyncState.mockReset();
  getSyncSettings.mockReset();
  vi.unstubAllEnvs();
});

describe("POST /ingest", () => {
  it("fail-closed with 503 while the secret is unset", async () => {
    const { body, headers } = signedBody(VIDEOS);
    const res = await ytSyncIngestRoute.request("/ingest", { method: "POST", body, headers });
    expect(res.status).toBe(503);
    expect(applyPlaylistSync).not.toHaveBeenCalled();
  });

  it("rejects a bad signature with 401", async () => {
    vi.stubEnv("SYNC_INGEST_SECRET", SECRET);
    const { body } = signedBody(VIDEOS);
    const res = await ytSyncIngestRoute.request("/ingest", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "x-sync-signature": "de".repeat(32) },
    });
    expect(res.status).toBe(401);
    expect(applyPlaylistSync).not.toHaveBeenCalled();
  });

  it("applies the sync for a valid signed payload and returns the summary", async () => {
    vi.stubEnv("SYNC_INGEST_SECRET", SECRET);
    applyPlaylistSync.mockResolvedValue({
      ok: true, videosFound: 2, added: 0, updated: 2, removed: 10, coverUpdated: true,
    });
    const { body, headers } = signedBody(VIDEOS);
    const res = await ytSyncIngestRoute.request("/ingest", { method: "POST", body, headers });
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; summary: { removed: number } };
    expect(json.ok).toBe(true);
    expect(json.summary.removed).toBe(10);
    expect(applyPlaylistSync).toHaveBeenCalledWith(
      VIDEOS.videos.map((v) => ({ videoId: v.videoId, title: v.title })),
      { reason: "ingest:gh-actions" },
    );
  });

  it("rejects payloads with invalid video ids", async () => {
    vi.stubEnv("SYNC_INGEST_SECRET", SECRET);
    const { body, headers } = signedBody({ videos: [{ videoId: "short", title: "x" }] });
    const res = await ytSyncIngestRoute.request("/ingest", { method: "POST", body, headers });
    expect(res.status).toBe(400);
    expect(applyPlaylistSync).not.toHaveBeenCalled();
  });

  it("rejects an empty video list", async () => {
    vi.stubEnv("SYNC_INGEST_SECRET", SECRET);
    const { body, headers } = signedBody({ videos: [] });
    const res = await ytSyncIngestRoute.request("/ingest", { method: "POST", body, headers });
    expect(res.status).toBe(400);
  });

  it("rejects oversized payloads with 413", async () => {
    vi.stubEnv("SYNC_INGEST_SECRET", SECRET);
    const bigTitle = "x".repeat(600);
    const { body, headers } = signedBody({
      videos: Array.from({ length: 30 }, (_, i) => ({ videoId: `0l7WBjMF6u${i % 10}`, title: bigTitle })),
    });
    const res = await ytSyncIngestRoute.request("/ingest", { method: "POST", body, headers });
    expect([400, 413]).toContain(res.status);
    expect(applyPlaylistSync).not.toHaveBeenCalled();
  });
});

describe("GET /state", () => {
  it("fail-closed with 503 while the secret is unset", async () => {
    const res = await ytSyncIngestRoute.request("/state", {
      headers: { "x-sync-signature": "ab".repeat(32) },
    });
    expect(res.status).toBe(503);
  });

  it("returns the sync state for a valid state-probe signature", async () => {
    vi.stubEnv("SYNC_INGEST_SECRET", SECRET);
    getSyncState.mockReturnValue({ lastSyncAt: "2026-11-09T00:00:00Z", videosFound: 2 });
    getSyncSettings.mockReturnValue({ autoImport: true, autoImportFree: true, autoCover: true });
    const sig = crypto.createHmac("sha256", SECRET).update("state-probe", "utf8").digest("hex");
    const res = await ytSyncIngestRoute.request("/state", { headers: { "x-sync-signature": sig } });
    expect(res.status).toBe(200);
    const json = await res.json() as { state: { videosFound: number } };
    expect(json.state.videosFound).toBe(2);
  });
});
