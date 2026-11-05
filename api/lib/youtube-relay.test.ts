/**
 * YouTube relay client tests — the Space-side counterpart of the worker's
 * /yt/* routes (harness-tested in scripts/youtube_relay_worker_test.mjs).
 *
 * Pins the three contracts that keep the owner's verbatim-title rule intact:
 *   1. Unconfigured relay = a NO-OP: null returned, ZERO fetch calls — the
 *      watcher's direct sources behave exactly as before this module existed.
 *   2. The derived token matches the worker's documented gate value
 *      hex(HMAC-SHA256(secret, "yt-relay-v1")) — one byte of drift and the
 *      worker stealth-404s every call.
 *   3. Titles pass through VERBATIM — no trimming, no normalization, no
 *      paraphrasing, ever.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("./notification-broadcast.js", () => ({
  pushNotification: vi.fn(async () => null),
  pruneOldNotifications: vi.fn(async () => undefined),
}));

import { fetchRelayOembedVerdict, fetchRelayPlaylist, youtubeRelayOrigin, youtubeRelayToken } from "./youtube-relay";
import { fetchPlaylistVideosForImport } from "./youtube-watcher";

const SECRET = "relay-secret-for-tests-1234567890";
const TOKEN = createHmac("sha256", SECRET).update("yt-relay-v1").digest("hex");
const WORKER = "https://ahmedelbaz.ahmdelbaz28.workers.dev";
const VERBATIM_TITLE = "كورس ETAP المجاني | تعلم ETAP من الصفر وحتى الاحتراف #01";

function stubRelayEnv(): void {
  vi.stubEnv("TELEGRAM_API_BASE", `${WORKER}/tg`);
  vi.stubEnv("TELEGRAM_API_RELAY_SECRET", SECRET);
  vi.stubEnv("YOUTUBE_RELAY_URL", "");
}

type Route = { status: number; json?: unknown; text?: string } | "fail";

function makeFetchRouter(routes: Array<[needle: string, route: Route]>) {
  const spy = vi.fn(async (input: unknown) => {
    const url = String(input);
    for (const [needle, route] of routes) {
      if (!url.includes(needle)) continue;
      if (route === "fail") throw new Error("network down");
      return new Response(route.text ?? JSON.stringify(route.json ?? {}), { status: route.status });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("youtubeRelayOrigin", () => {
  it("explicit YOUTUBE_RELAY_URL wins over the derivation", () => {
    vi.stubEnv("YOUTUBE_RELAY_URL", "https://yt-proxy.example.workers.dev/");
    vi.stubEnv("TELEGRAM_API_BASE", `${WORKER}/tg`);
    expect(youtubeRelayOrigin()).toBe("https://yt-proxy.example.workers.dev");
  });

  it("derives the worker origin from TELEGRAM_API_BASE (strips /tg)", () => {
    vi.stubEnv("YOUTUBE_RELAY_URL", "");
    vi.stubEnv("TELEGRAM_API_BASE", `${WORKER}/tg///`);
    expect(youtubeRelayOrigin()).toBe(WORKER);
  });

  it("never tunnels through a non-workers.dev base — falls back to OUR worker", () => {
    vi.stubEnv("YOUTUBE_RELAY_URL", "");
    vi.stubEnv("TELEGRAM_API_BASE", "https://someone-else.example.com/tg");
    const origin = youtubeRelayOrigin();
    expect(origin).toBe(WORKER);
    expect(origin).not.toContain("someone-else");
  });

  it("falls back to the platform's own worker origin when nothing is configured", () => {
    vi.stubEnv("YOUTUBE_RELAY_URL", "");
    vi.stubEnv("TELEGRAM_API_BASE", "");
    expect(youtubeRelayOrigin()).toBe(WORKER);
  });
});

describe("youtubeRelayToken — the worker's gate value", () => {
  it("equals hex(HMAC-SHA256(secret, 'yt-relay-v1'))", () => {
    vi.stubEnv("TELEGRAM_API_RELAY_SECRET", SECRET);
    expect(youtubeRelayToken()).toBe(TOKEN);
  });

  it("null without a usable secret", () => {
    vi.stubEnv("TELEGRAM_API_RELAY_SECRET", "");
    expect(youtubeRelayToken()).toBeNull();
    vi.stubEnv("TELEGRAM_API_RELAY_SECRET", "short");
    expect(youtubeRelayToken()).toBeNull();
  });
});

describe("fetchRelayPlaylist", () => {
  it("unconfigured → null WITHOUT a single fetch call", async () => {
    vi.stubEnv("YOUTUBE_RELAY_URL", "");
    vi.stubEnv("TELEGRAM_API_BASE", "");
    vi.stubEnv("TELEGRAM_API_RELAY_SECRET", "");
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(fetchRelayPlaylist("PLeeb5_Qjhcgc")).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns items with titles VERBATIM (no trim, no normalize)", async () => {
    stubRelayEnv();
    const spy = makeFetchRouter([
      ["/yt/playlist", { status: 200, json: { ok: true, playlistId: "PLx", items: [{ videoId: "0l7WBjMF6uo", title: ` ${VERBATIM_TITLE} ` }] } }],
    ]);
    const items = await fetchRelayPlaylist("PLx");
    expect(items).toEqual([{ videoId: "0l7WBjMF6uo", title: ` ${VERBATIM_TITLE} ` }]);
    expect(spy).toHaveBeenCalledExactlyOnceWith(
      `${WORKER}/yt/playlist?list=PLx`,
      expect.objectContaining({ headers: { "X-Yt-Relay-Token": TOKEN } }),
    );
  });

  it("drops malformed entries but keeps valid ones", async () => {
    stubRelayEnv();
    makeFetchRouter([
      ["/yt/playlist", { status: 200, json: { ok: true, items: [
        { videoId: "bad-id", title: "x" },
        { videoId: "0l7WBjMF6uo", title: VERBATIM_TITLE },
        { videoId: "avugPlx0sXw" },
      ] } }],
    ]);
    await expect(fetchRelayPlaylist("PLx")).resolves.toEqual([
      { videoId: "0l7WBjMF6uo", title: VERBATIM_TITLE },
      { videoId: "avugPlx0sXw", title: "" },
    ]);
  });

  it("non-ok payload / HTTP error / transport failure → null (fail-open)", async () => {
    stubRelayEnv();
    makeFetchRouter([["/yt/playlist", { status: 200, json: { ok: false } }]]);
    await expect(fetchRelayPlaylist("PLx")).resolves.toBeNull();
    makeFetchRouter([["/yt/playlist", { status: 502, json: { ok: false } }]]);
    await expect(fetchRelayPlaylist("PLx")).resolves.toBeNull();
    makeFetchRouter([["/yt/playlist", "fail"]]);
    await expect(fetchRelayPlaylist("PLx")).resolves.toBeNull();
  });
});

describe("fetchRelayOembedVerdict", () => {
  it("maps exists:true + title → ok verdict (verbatim)", async () => {
    stubRelayEnv();
    makeFetchRouter([["/yt/oembed", { status: 200, json: { ok: true, exists: true, videoId: "0l7WBjMF6uo", title: VERBATIM_TITLE } }]]);
    await expect(fetchRelayOembedVerdict("0l7WBjMF6uo")).resolves.toEqual({ status: "ok", title: VERBATIM_TITLE });
  });

  it("maps exists:false → gone", async () => {
    stubRelayEnv();
    makeFetchRouter([["/yt/oembed", { status: 200, json: { ok: true, exists: false } }]]);
    await expect(fetchRelayOembedVerdict("avugPlx0sXw")).resolves.toEqual({ status: "gone" });
  });

  it("relay 502-unknown / unconfigured → null (caller falls back to direct)", async () => {
    stubRelayEnv();
    makeFetchRouter([["/yt/oembed", { status: 502, json: { ok: false } }]]);
    await expect(fetchRelayOembedVerdict("0l7WBjMF6uo")).resolves.toBeNull();
    vi.stubEnv("TELEGRAM_API_RELAY_SECRET", "");
    makeFetchRouter([["/yt/oembed", { status: 200, json: { ok: true, exists: true, title: "x" } }]]);
    await expect(fetchRelayOembedVerdict("0l7WBjMF6uo")).resolves.toBeNull();
  });
});

describe("integration — the import pipeline rides the relay when configured", () => {
  it("relay answers playlist + oEmbed; the pipeline succeeds even when direct sources fail", async () => {
    stubRelayEnv();
    const spy = makeFetchRouter([
      ["/yt/playlist", { status: 200, json: { ok: true, items: [{ videoId: "0l7WBjMF6uo", title: VERBATIM_TITLE }] } }],
      ["/yt/oembed", { status: 200, json: { ok: true, exists: true, title: VERBATIM_TITLE } }],
      // Direct youtube.com upstreams are attempted concurrently as the
      // fallback and deliberately fail here — the relay must carry the day.
      ["youtube.com", "fail"],
    ]);

    const { items, verified } = await fetchPlaylistVideosForImport();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ videoId: "0l7WBjMF6uo", title: VERBATIM_TITLE });
    expect(verified).toBe(true);
    expect(spy.mock.calls.some(([url]) => String(url).includes("/yt/playlist"))).toBe(true);
    expect(spy.mock.calls.some(([url]) => String(url).includes("/yt/oembed"))).toBe(true);
  });
});
