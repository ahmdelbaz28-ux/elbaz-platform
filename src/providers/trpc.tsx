import { createTRPCReact } from "@trpc/react-query";
import { httpLink } from "@trpc/client";
import { QueryClient } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { isNativePlatform, getStoredToken } from "@/lib/auth-storage";

// eslint-disable-next-line react-refresh/only-export-components
export const trpc = createTRPCReact<AppRouter>();

const queryClient = new QueryClient({
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
      url: getApiBaseUrl() + "/api/trpc",
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
          if (token) headers["Authorization"] = `Bearer ${token}`;
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
