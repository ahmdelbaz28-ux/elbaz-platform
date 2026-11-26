/**
 * Shared module-scope cache for the public-env fallback fetch.
 *
 * ✅ PERF (react-best-practices client-*): Login.tsx and Register.tsx both
 * fall back to `/api/env` when the build-time `__ENV__` injection is absent —
 * previously EVERY page mount re-fetched the identical endpoint (two auth
 * pages, repeated revisits in one SPA session). The promise is cached at
 * module scope so one fetch per page load serves every consumer; a failed
 * fetch resets the cache so the next mount retries (same resilience the
 * per-mount fetch had).
 *
 * The normal path never reaches this module: `globalThis.__ENV__` is injected
 * at build time and both auth pages short-circuit before calling it.
 */
let envPromise: Promise<Record<string, string> | null> | null = null;

export function fetchPublicEnv(): Promise<Record<string, string> | null> {
  envPromise ??= fetch("/api/env", { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<Record<string, string>>;
    })
    .catch((err: Error) => {
      console.warn("[GoogleAuth] Could not fetch /api/env:", err.message);
      envPromise = null; // transient failure — allow the next mount to retry
      return null;
    });
  return envPromise;
}
