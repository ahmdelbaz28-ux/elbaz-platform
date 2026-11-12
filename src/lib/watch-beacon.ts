/**
 * WATCH-HEARTBEAT BEACON — the final progress save fired from
 * `beforeunload` via `navigator.sendBeacon` (reliable during page unload,
 * unlike fetch which the browser may cancel).
 *
 * ✅ ROOT-CURE (2026-11-13): both call sites used to POST the RAW progress
 * JSON, but the tRPC endpoint (superjson transformer, httpLink) only parses
 * the envelope `{"json": <input>}` — the raw body failed input parsing and
 * the final save was silently discarded on EVERY tab close (the last ≤60s of
 * position/watch-time lost). The blob is now the exact envelope the tRPC
 * client itself sends for a mutation POST.
 */

export interface HeartbeatBeaconInput {
  lessonId: number;
  watchedSeconds: number;
  lastPosition: number;
}

/** Serialize a heartbeat as the superjson envelope tRPC expects. */
export function buildHeartbeatBeaconBlob(input: HeartbeatBeaconInput): Blob {
  return new Blob([JSON.stringify({ json: input })], { type: "application/json" });
}

/** API origin for the beacon — native builds hit the absolute production URL. */
export function heartbeatBeaconUrl(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isNative = (globalThis as any).Capacitor?.isNativePlatform?.();
  return isNative
    ? (import.meta.env.VITE_API_URL || "https://ahmedelbaz.qzz.io")
    : "";
}

/** Fire-and-forget final save. Never throws. */
export function sendHeartbeatBeacon(input: HeartbeatBeaconInput): void {
  try {
    navigator.sendBeacon?.(
      `${heartbeatBeaconUrl()}/api/trpc/course.heartbeat`,
      buildHeartbeatBeaconBlob(input),
    );
  } catch {
    // unload best-effort — the periodic in-play heartbeats already saved
  }
}
