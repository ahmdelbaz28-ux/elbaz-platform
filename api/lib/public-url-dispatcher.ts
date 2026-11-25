/**
 * PUBLIC-URL DISPATCHER — DNS-pinned egress for user-supplied baseUrl targets
 * (audit run-1 hardening of needs_validation fp `ai.chatbot.byok-dns-rebind-ssrf`).
 *
 * The threat: `isPublicProviderUrl` validates the TARGET STRING (fail-closed
 * SSRF guard), but the connection re-resolves DNS at connect time. A user
 * controls the DNS for their own hostname, so they can make it rebind between
 * validation and connect — pointing the server's key-bearing request at an
 * internal address (loopback / RFC1918 / metadata).
 *
 * The mitigation here (standard anti-rebinding): EVERY fetch through
 * `pinnedPublicFetch` resolves the hostname exactly once per request inside a
 * custom `lookup` hook, classifies EVERY returned address (A + AAAA — a mixed
 * public/private answer is rejected wholesale), and the socket connects to the
 * validated address only. TLS still validates the certificate against the
 * original hostname (SNI unchanged), so https keeps working and a pinned
 * connection cannot be MITM'd. The /test echo remains a blind oracle only —
 * it can no longer be aimed at internal targets at all.
 *
 * Used for the BYOK lanes (chat + stream + test). The platform's own provider
 * cascade fetches admin-configured baseUrls and keeps its existing guard.
 */

import dns from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";
import { logger } from "./logger.js";

export const DNS_REBIND_BLOCKED = "DNS_REBIND_BLOCKED";

/** Sentinel error thrown by the pinned lookup when any record is non-public. */
export class DnsRebindError extends Error {
  constructor(address: string) {
    super(`${DNS_REBIND_BLOCKED}: resolved address is not a public IP (${address})`);
    this.name = "DnsRebindError";
  }
}

function parseV4(ip: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return parts as [number, number, number, number];
}

function v4IsPublic([a, b]: [number, number, number, number]): boolean {
  // Same range policy as isPublicProviderUrl (ai-router.ts), with the RFC1918
  // boundaries stated exactly: loopback/this-network, RFC1918 (10/8, 172.16/12,
  // 192.168/16), CGNAT 100.64/10, link-local 169.254/16, benchmarking 198.18/15,
  // special 192.0.0.0/24 are non-public — everything else public.
  if (a === 127 || a === 10 || a === 0) return false;
  if (a === 169) return b !== 254;
  if (a === 172) return b < 16 || b > 31; // public outside 172.16.0.0/12
  if (a === 192) return b !== 168 && b !== 0; // 192.0.0.0/24 special + 192.168/16 private
  if (a === 100) return b < 64 || b > 127;
  if (a === 198) return b < 18 || b > 19;
  return true;
}

/** Expanded IPv6 string → 8 hextets (or null when unparseable). */
function parseV6(ip: string): number[] | null {
  const addr = ip.replace(/^\[|\]$/g, "").toLowerCase();
  const doubleColon = addr.split("::");
  if (doubleColon.length > 2) return null;
  const expand = (s: string): number[] | null => {
    if (s === "") return [];
    const parts = s.split(":");
    const hextets: number[] = [];
    for (const part of parts) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      hextets.push(parseInt(part, 16));
    }
    return hextets;
  };
  let head: number[] = [];
  let tail: number[] = [];
  if (doubleColon.length === 2) {
    const h = expand(doubleColon[0]);
    const t = expand(doubleColon[1]);
    if (h === null || t === null) return null;
    head = h;
    tail = t;
    if (head.length + tail.length > 7) return null;
  } else {
    const all = expand(addr);
    if (all === null || all.length !== 8) return null;
    head = all;
  }
  const groups = new Array(8).fill(0);
  for (let i = 0; i < head.length; i++) groups[i] = head[i];
  for (let i = 0; i < tail.length; i++) groups[8 - tail.length + i] = tail[i];
  return groups;
}

function v6IsPublic(g: number[]): boolean {
  const allZero = g.every((x) => x === 0);
  if (allZero) return false; // :: unspecified
  const loopback = g.slice(0, 7).every((x) => x === 0) && g[7] === 1;
  if (loopback) return false; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) → classify the
  // embedded IPv4 tail with the same v4 policy.
  const mapped = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff;
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0);
  if (mapped || nat64) {
    return v4IsPublic([(g[6] >> 8) & 0xff, g[6] & 0xff, (g[7] >> 8) & 0xff, g[7] & 0xff]);
  }
  if ((g[0] & 0xfe00) === 0xfe00) return false; // fe80::/10 link-local
  if ((g[0] & 0xfc00) === 0xfc00) return false; // fc00::/7 unique-local
  if (g[0] === 0x2002) {
    // 6to4 (2002::/16) — the next 32 bits embed an IPv4 address.
    return v4IsPublic([(g[1] >> 8) & 0xff, g[1] & 0xff, (g[2] >> 8) & 0xff, g[2] & 0xff]);
  }
  return true;
}

/**
 * Classify a RESOLVED address (not a URL string). Testable + shared by the
 * pinned lookup. Unknown/parseable-only-as-hostname forms are rejected
 * (fail-closed).
 */
export function isPublicResolvedIp(ip: string): boolean {
  const v4 = parseV4(ip);
  if (v4) return v4IsPublic(v4);
  const v6 = parseV6(ip);
  if (v6) return v6IsPublic(v6);
  return false;
}

/** Lookup result shape accepted by undici/net connect (subset). */
interface LookupResult {
  address: string;
  family: number;
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: LookupResult | LookupResult[],
) => void;

interface LookupOptions {
  family?: number;
  hints?: number;
  all?: boolean;
}

/**
 * Custom connect-time lookup: resolve once, require EVERY record to be a
 * public IP, and hand undici ONLY the validated address (pinning — the socket
 * cannot re-resolve or fall through to a rebinding record).
 */
export async function pinnedLookup(
  hostname: string,
  options: LookupOptions,
  callback: LookupCallback,
): Promise<void> {
  try {
    const addrs = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    if (addrs.length === 0) {
      const err: NodeJS.ErrnoException = new Error(`no DNS records for ${hostname}`);
      err.code = "ENOTFOUND";
      callback(err);
      return;
    }
    const bad = addrs.find((a) => !isPublicResolvedIp(a.address));
    if (bad) {
      logger.warn("[PublicUrlDispatcher] DNS rebinding blocked — non-public record", {
        hostname,
        family: bad.family,
      });
      callback(new DnsRebindError(bad.address) as unknown as NodeJS.ErrnoException);
      return;
    }
    const wantFamily = options.family === 4 || options.family === 6 ? options.family : 0;
    const candidates = wantFamily === 0 ? addrs : addrs.filter((a) => a.family === wantFamily);
    const chosen = candidates[0] ?? addrs[0];
    if (!chosen || (wantFamily !== 0 && chosen.family !== wantFamily)) {
      const err: NodeJS.ErrnoException = new Error(`no usable public ${wantFamily || ""} address for ${hostname}`);
      err.code = "EAI_AGAIN";
      callback(err);
      return;
    }
    // all:false → net expects a single { address, family } object.
    callback(null, { address: chosen.address, family: chosen.family });
  } catch (err) {
    callback(err as NodeJS.ErrnoException);
  }
}

let pinnedAgent: Agent | null = null;

function getPinnedAgent(): Agent {
  if (!pinnedAgent) {
    pinnedAgent = new Agent({
      connect: {
        // undici's connect options accept a net-style lookup hook; the pinned
        // signature matches at runtime — typed loosely to avoid coupling to
        // undici's internal option types (they differ across undici majors).
        lookup: pinnedLookup as never,
      },
    });
  }
  return pinnedAgent;
}

/**
 * fetch() for user-supplied provider targets: same contract as the global
 * fetch the BYOK lanes already use (ok/status/json/text/body/headers), with
 * the DNS-pinned dispatcher in force. Response is undici's spec-compliant
 * Response — cast at the boundary for the shared call sites.
 */
export async function pinnedPublicFetch(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
    redirect?: "error" | "follow" | "manual";
  },
): Promise<Response> {
  const response = await undiciFetch(url, {
    ...init,
    dispatcher: getPinnedAgent(),
  } as Parameters<typeof undiciFetch>[1]);
  return response as unknown as Response;
}
