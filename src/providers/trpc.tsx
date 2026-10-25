import { createTRPCReact } from "@trpc/react-query";
import { httpLink, TRPCClientError } from "@trpc/client";
import { QueryCache, QueryClient, MutationCache } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { isNativePlatform, getStoredToken, removeStoredToken, clearAuthFlagCookie } from "@/lib/auth-storage";

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
function handleGlobalAuthFailure(err: unknown): void {
  const code = err instanceof TRPCClientError
    ? (err.data as { code?: string } | null)?.code
    : undefined;
  if (code !== "UNAUTHORIZED") return;
  removeStoredToken(); // native only
  clearAuthFlagCookie(); // web — drop the flag that outlived the session
  // ✅ SECURITY FIX (audit run-1, auth.query-cache-persist): a revoked session
  // must also purge the persisted tRPC cache — previously only the explicit
  // logout path did, so the next account on the profile rehydrated the
  // previous account's private data for up to 24h.
  try { localStorage.removeItem("ELBAZ_QUERY_CACHE"); } catch { /* ignore */ }
  const meQuery = queryClient
    .getQueryCache()
    .getAll()
    .find((q) => {
      const k = q.queryKey as unknown[];
      return Array.isArray(k?.[0]) && k[0][0] === "auth" && k[0][1] === "me";
    });
  meQuery?.setState({
    data: undefined,
    dataUpdatedAt: 0,
    status: "error",
    fetchStatus: "idle",
    error: err instanceof Error ? err : new Error("UNAUTHORIZED"),
  });
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleGlobalAuthFailure }),
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
          return globalThis.fetch(input, {
            ...(init ?? {}), // NOSONAR — ?? {} provides runtime fallback for spread; type-only fix would change semantics
            credentials: isNative ? "omit" : "include",
            headers,
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
      >
        {children}
      </PersistQueryClientProvider>
    </trpc.Provider>
  );
}
