/**
 * PUBLIC-URL DISPATCHER — audit run-1 hardening tests for the needs_validation
 * lead `ai.chatbot.byok-dns-rebind-ssrf`.
 *
 * The pinned lookup must: resolve ONCE per request, reject when ANY resolved
 * record is non-public (mixed answers included), and pin the validated
 * address so the socket cannot re-resolve. `isPublicResolvedIp` must classify
 * the same ranges the SSRF guard rejects for URL strings.
 */
import { describe, it, expect, vi } from "vitest";

const { lookupStub } = vi.hoisted(() => ({ lookupStub: vi.fn() }));

vi.mock("node:dns", () => ({
  default: { promises: { lookup: lookupStub } },
  promises: { lookup: lookupStub },
}));
vi.mock("./logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { pinnedLookup, isPublicResolvedIp, DnsRebindError } from "./public-url-dispatcher.js";

type LookupCb = (err: unknown, addr?: { address: string; family: number } | { address: string; family: number }[]) => void;

const call = (hostname: string, options: { family?: number } = {}) =>
  new Promise<{ err: unknown; addr?: { address: string; family: number } }>((resolve) => {
    void pinnedLookup(hostname, options, ((err: unknown, addr?: { address: string; family: number }) =>
      resolve({ err, addr })) as unknown as LookupCb);
  });

describe("audit run-1 hardening: isPublicResolvedIp range table", () => {
  const publicV4 = ["203.0.113.10", "8.8.8.8", "172.32.0.1", "100.63.0.1", "198.20.0.1", "1.1.1.1"];
  const privateV4 = [
    "127.0.0.1", "10.0.0.1", "0.0.0.0", "192.168.1.1", "172.16.0.1", "172.31.255.255",
    "169.254.169.254", "100.64.0.1", "198.18.0.1", "192.0.0.5", "192.0.1.5",
  ];
  const publicV6 = ["2001:4860:4860::8888", "2606:4700::1111", "2620:fe::fe"];
  const privateV6 = [
    "::1", "::", "fe80::1", "fc00::1", "fd00::1", "64:ff9b::7f00:1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "2002:7f00:1::",
  ];

  it.each(publicV4)("classifies %s as public", (ip) => expect(isPublicResolvedIp(ip)).toBe(true));
  it.each(privateV4)("classifies %s as non-public", (ip) => expect(isPublicResolvedIp(ip)).toBe(false));
  it.each(publicV6)("classifies %s as public (v6)", (ip) => expect(isPublicResolvedIp(ip)).toBe(true));
  it.each(privateV6)("classifies %s as non-public (v6)", (ip) => expect(isPublicResolvedIp(ip)).toBe(false));

  it("fails closed on unparseable inputs", () => {
    expect(isPublicResolvedIp("not-an-ip")).toBe(false);
    expect(isPublicResolvedIp("")).toBe(false);
    expect(isPublicResolvedIp("999.999.999.999")).toBe(false);
  });
});

describe("audit run-1 hardening: pinnedLookup (DNS rebinding neutralizer)", () => {
  // NOTE: no mockReset() here — Vitest 4's mockReset on this stub breaks the
  // framework's async-throw tracking (the test fails with the phantom raw
  // error even when the assertion succeeds). Every test below sets its own
  // stub implementation explicitly, so ordering stays deterministic.

  it("rejects a private resolution BEFORE any socket is opened", async () => {
    lookupStub.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const { err } = await call("rebind.example.test");
    expect(err).toBeInstanceOf(DnsRebindError);
    expect((err as Error).message).toContain("DNS_REBIND_BLOCKED");
  });

  it("rejects MIXED public+private answers wholesale (no partial admission)", async () => {
    lookupStub.mockResolvedValue([
      { address: "203.0.113.10", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    const { err } = await call("mixed.example.test");
    expect(err).toBeInstanceOf(DnsRebindError);
  });

  it("pins a fully public resolution to the validated address", async () => {
    lookupStub.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
    const { err, addr } = await call("provider.example.test");
    expect(err).toBeNull();
    expect(addr).toEqual({ address: "203.0.113.10", family: 4 });
  });

  it("enotfound fails closed", async () => {
    lookupStub.mockResolvedValue([]);
    const { err } = await call("void.example.test");
    expect((err as NodeJS.ErrnoException).code).toBe("ENOTFOUND");
  });

  it("family filtering keeps a usable public address of the requested family", async () => {
    lookupStub.mockResolvedValue([
      { address: "2001:4860:4860::8888", family: 6 },
      { address: "8.8.8.8", family: 4 },
    ]);
    const v4 = await call("dual.example.test", { family: 4 });
    expect(v4.addr?.address).toBe("8.8.8.8");
    const v6 = await call("dual.example.test", { family: 6 });
    expect(v6.addr?.address).toBe("2001:4860:4860::8888");
  });

  it("lookup errors propagate (no silent fallback to an unvalidated address)", async () => {
    lookupStub.mockRejectedValue(new Error("resolver gone"));
    const { err } = await call("broken.example.test");
    expect((err as Error).message).toBe("resolver gone");
  });
});
