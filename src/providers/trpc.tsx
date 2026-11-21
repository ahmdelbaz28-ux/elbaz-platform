import { createTRPCReact } from "@trpc/react-query";
import { httpLink, TRPCClientError } from "@trpc/client";
import { QueryCache, QueryClient, MutationCache } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { isNativePlatform, getStoredToken, setStoredToken, removeStoredToken, clearAuthFlagCookie, hasStoredAuth } from "@/lib/auth-storage";

// eslint-disable-next-line react-refresh/only-export-components
export const trpc = createTRPCReact<AppRouter>();

/**
 * ✅ FIX (payment UNAUTHORIZED): global auth-failure safety net.
 *
 * Every AUTHED procedure (payment.create, wishlist, tickets, …) throws
 * UNAUTHORIZED once the session cookie is expired/revoked. Without this net
 * the client kept its stale "logged in" state (persisted React-Query cache +
 * kept-alive SPA), so users saw a raw "UNAUTHORIZED" banner in the payment
 * modal instead of being sent to re-authenticate.
 *
 * On ANY 401 from any query/mutation: drop the stale identity (auth.me) so
 * every isAuthenticated consumer flips to logged-out. Component-level handlers
 * (e.g. the payment modal) add their own friendly message + redirect on top.
 *
 * ✅ ROOT-CURE (2026-11-13, "logged out every time despite Remember this
 * device"): the net used to DESTROY the stored session (flag cookie / native
 * token) on the FIRST UNAUTHORIZED from ANY procedure. A single authed call
 * failing 401 — while auth.me still held a perfectly valid session — wiped a
 * 30-day login. Destruction is now gated on the SESSION ORACLE: only auth.me
 * itself being rejected counts as a confirmed session death. Any other 401
 * triggers exactly ONE silent re-verification of auth.me; if that recheck is
 * also rejected, auth.me's own error path performs the confirmed destruction
 * (no loops — the recheck never triggers another recheck). If the recheck
 * succeeds, the session was alive and stays intact.
 *
 * ✅ FIX (chatbot dead click): park auth.me in a TERMINAL error state instead
 * of queryClient.removeQueries(). removeQueries() inside the cache's onError
 * recreates the query for its still-subscribed observers (enabled has not
 * flipped yet — React hasn't even seen the error) and every recreation
 * auto-refetches → 401 → removeQueries → … an infinite UNAUTHORIZED loop
 * (~60 req/s measured) with authLoading stuck true, which made the ChatBot
 * FAB swallow every click ("no reaction"). setState() parks the query
 * WITHOUT removal → no recreation → no refetch. useAuth's error effect then
 * disables the query (storedAuth=false) so nothing fires again.
 */
function isAuthMeQueryKey(key: unknown): boolean {
  return (
    Array.isArray(key) &&
    Array.isArray(key[0]) &&
    (key[0] as unknown[])[0] === "auth" &&
    (key[0] as unknown[])[1] === "me"
  );
}

function findAuthMeQuery() {
  return queryClient
    .getQueryCache()
    .getAll()
    .find((q) => isAuthMeQueryKey(q.queryKey));
}

function destroyStoredSession(): void {
  removeStoredToken(); // native only
  clearAuthFlagCookie(); // web — drop the flag that outlived the session
  // ✅ SECURITY FIX (audit run-1, auth.query-cache-persist): a revoked session
  // must also purge the persisted tRPC cache — previously only the explicit
  // logout path did, so the next account on the profile rehydrated the
  // previous account's private data for up to 24h.
  try { localStorage.removeItem("ELBAZ_QUERY_CACHE"); } catch { /* ignore */ }
}

function handleGlobalAuthFailure(err: unknown, failingKey?: unknown): void {
  const code = err instanceof TRPCClientError
    ? (err.data as { code?: string } | null)?.code
    : undefined;
  if (code !== "UNAUTHORIZED") return;

  // ✅ ROOT-CURE: auth.me rejection = CONFIRMED session death (the server
  // verified the token cryptographically AND against the DB). Destroy the
  // stored session and park the query so nothing refires.
  if (failingKey !== undefined && isAuthMeQueryKey(failingKey)) {
    destroyStoredSession();
    const meQuery = findAuthMeQuery();
    meQuery?.setState({
      data: undefined,
      dataUpdatedAt: 0,
      status: "error",
      fetchStatus: "idle",
      error: err instanceof Error ? err : new Error("UNAUTHORIZED"),
    });
    return;
  }

  // ✅ ROOT-CURE: a 401 from ANY OTHER authed procedure (or a mutation) no
  // longer destroys the session outright — one transient/retryable hiccup
  // must never kill a 30-day login. Re-verify the session oracle exactly
  // once; destruction (if the session is really dead) then happens through
  // the confirmed auth.me path above. No session stored → nothing to save.
  if (!hasStoredAuth()) return;
  const meQuery = findAuthMeQuery();
  if (meQuery && meQuery.state.status !== "pending" && meQuery.state.fetchStatus !== "fetching") {
    // fetch() re-runs the oracle even while it sits in an error state. Its
    // failure lands back here with the auth.me key → confirmed path. Its
    // success silently restores confidence — the session was never dead.
    void meQuery.fetch().catch(() => { /* handled by the cache onError */ });
  }
}

const queryClient = new QueryClient({
  // ✅ ROOT-CURE: pass the failing query key into the auth-failure handler so
  // it can distinguish the session oracle (auth.me) from any other procedure.
  queryCache: new QueryCache({
    onError: (err, query) => handleGlobalAuthFailure(err, query?.queryKey),
  }),
  mutationCache: new MutationCache({ onError: handleGlobalAuthFailure }),
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes fresh
      gcTime: 1000 * 60 * 60 * 24, // 24 hours garbage collection
      retry: 2,
      refetchOnWindowFocus: false,
      structuralSharing: true,
    },
  },
});

const persister = createSyncStoragePersister({
  storage: globalThis?.localStorage,
  key: 'ELBAZ_QUERY_CACHE',
});

/**
 * Base URL for API calls.
 * - In browser: uses relative path (same origin)
 * - In Capacitor/mobile: uses VITE_API_URL env variable
 * - Falls back to production URL if env var is not set
 */
function getApiBaseUrl(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const capacitor = (globalThis as any).Capacitor;
  if (capacitor?.isNativePlatform?.()) {
    return import.meta.env.VITE_API_URL || "https://ahmedelbaz.qzz.io";
  }
  return "";
}

/**
 * 🛡️ EDGE-CHALLENGE DETECTOR (root cause of the 2026-11-16 "desktop won't
 * load" incident — see DEPLOYMENT.md §9):
 *
 * The domain's Cloudflare edge (qzz.io provider infra, OUTSIDE our control)
 * answers clients it scores as bots with `403 + cf-mitigated: challenge`.
 * The DOCUMENT challenge auto-solves on navigation, but API XHRs can NEVER
 * solve an interactive challenge — every tRPC call then dies with 403 while
 * the shell still renders, so the site looks permanently broken ("the page
 * won't load") for exactly those visitors, while clean networks (e.g. the
 * owner's mobile) pass untouched.
 *
 * Detection: a 403 with `cf-mitigated: challenge`, or a 403 whose
 * content-type is HTML — tRPC errors are ALWAYS application/json, and legit
 * 403s (e.g. the subscribe gate's SUBSCRIBE_REQUIRED) never come back as
 * HTML, so this cannot misfire on API-level rejections.
 *
 * Reaction: dispatch `elbaz:edge-challenge` ONCE per page load.
 * cache-nuke.js owns the response — one full navigation reload (a solved
 * page challenge mints cf_clearance which API calls then carry); if the
 * challenge persists across that reload, it renders the guidance banner
 * instead of looping. Reloads are capped per session — loops are impossible
 * by construction.
 */
let edgeChallengeSeen = false;
function detectEdgeChallenge(response: Response): void {
  if (response.status !== 403 || edgeChallengeSeen) return;
  let challenged = false;
  try {
    const mitigated = response.headers.get("cf-mitigated");
    const contentType = response.headers.get("content-type") ?? "";
    challenged = mitigated === "challenge" || contentType.includes("text/html");
  } catch {
    return; // headers unreadable — never guess
  }
  if (!challenged) return;
  edgeChallengeSeen = true;
  console.error(
    "[Edge] provider challenge is blocking API calls — dispatching recovery (elbaz:edge-challenge)"
  );
  window.dispatchEvent(new CustomEvent("elbaz:edge-challenge"));
}

/**
 * FIX: Changed from httpBatchLink to httpLink
 *
 * Root cause: httpBatchLink sends ALL requests as POST, including queries.
 * The Hono + tRPC fetchRequestHandler rejects POST for query procedures
 * with 405 Method Not Supported. This caused ALL frontend data fetching
 * to fail silently — components received undefined instead of arrays,
 * leading to "r.map is not a function" crash on every page.
 *
 * httpLink sends GET for queries and POST for mutations, which matches
 * tRPC's default HTTP method enforcement. This is the correct approach
 * for a Hono-based tRPC server.
 */
const trpcClient = trpc.createClient({
  links: [
    httpLink({
      url: `${getApiBaseUrl()}/api/trpc`,
      transformer: superjson,
      fetch(input, init) {
          const token = getStoredToken();
          const isNative = isNativePlatform();
          const platformHeader: Record<string, string> = isNative
            ? { "x-capacitor-platform": (globalThis as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() ?? "capacitor" }
            : {};
          // Build headers as a plain Record<string, string> so fetch's overload
          // resolution picks a single HeadersInit signature (TS2769 was firing
          // because the previous inline object produced a complex union type).
          const headers: Record<string, string> = {
            ...(init?.headers as Record<string, string> | undefined),
            ...platformHeader,
          };
          if (token) headers.Authorization = `Bearer ${token}`;
          const request = globalThis.fetch(input, {
            ...(init ?? {}), // NOSONAR — ?? {} provides runtime fallback for spread; type-only fix would change semantics
            credentials: isNative ? "omit" : "include",
            headers,
          });
          if (!isNative) {
            return request.then((response) => {
              detectEdgeChallenge(response);
              return response;
            });
          }
          // ✅ SESSION PERSISTENCE FIX (native sliding sessions): native clients
          // authenticate via the localStorage JWT (credentials "omit"), so the
          // server's cookie-based renewal never reached them — the stored token
          // stayed expired forever and the app asked for a fresh login on every
          // restart. The server now mirrors each renewed token in the
          // `x-renewed-token` response header (Bearer requests only); storing
          // it here keeps the native session sliding indefinitely: as long as
          // the user keeps using the app, the token never dies, and after an
          // idle period the grace window renews it on the first request.
          // Web keeps the HttpOnly cookie as its only token channel (XSS).
          return request.then((response) => {
            detectEdgeChallenge(response);
            const renewed = response.headers.get("x-renewed-token");
            if (renewed) setStoredToken(renewed);
            return response;
          });
        },
    }),
  ],
});

export function TRPCProvider({ children }: { readonly children: ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <PersistQueryClientProvider 
        client={queryClient}
        persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 }}
        // ✅ SECURITY FIX (audit run-2, identity-flip purge): belt-and-braces —
        // if the boot pre-render purge ran (Google OAuth redirect identity
        // flip), also drop anything the restore still merged into memory so
        // no previous-account row can serve before refetches resolve.
        // (onSuccess is a PersistQueryClientProvider prop, called once
        // restoring finishes even when nothing was restored.)
        onSuccess={() => {
          const w = window as unknown as { __elbazIdentitySwitchPurged?: boolean };
          if (w.__elbazIdentitySwitchPurged) queryClient.clear();
        }}
      >
        {children}
      </PersistQueryClientProvider>
    </trpc.Provider>
  );
}
