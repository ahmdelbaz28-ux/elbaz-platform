import { trpc } from "@/providers/trpc";
import { getQueryKey } from "@trpc/react-query";
import { useCallback, useMemo, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { identifyUser } from "@/lib/clarity";
import { hasStoredAuth, removeStoredToken } from "@/lib/auth-storage";


export function useAuth() {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const clarityIdentified = useRef(false);
  
  const [hasMounted, setHasMounted] = useState(false);
  const [storedAuth, setStoredAuth] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStoredAuth(hasStoredAuth());
    setHasMounted(true);
  }, []);

  const {
    data: user,
    isLoading: queryLoading,
    error,
    refetch,
  } = trpc.auth.me.useQuery(undefined, {
    enabled: hasMounted && storedAuth,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.invalidate();
    },
    onError: () => {
      // Still invalidate even if error to clean state
      utils.invalidate();
    },
  });

  // ✅ FIX (payment UNAUTHORIZED): auth.me is an AUTHED procedure — it throws
  // UNAUTHORIZED when the session cookie is expired/revoked. React Query keeps
  // the last good user data on refetch errors (and the persisted cache can
  // rehydrate a user for up to 24h), so the UI stayed "logged in" while the
  // server rejected every authed call (e.g. payment.create → raw
  // "UNAUTHORIZED" banner in the payment modal). On a 401 from auth.me we
  // now drop the stale user immediately so the app flips to logged-out.
  useEffect(() => {
    if (!error || !hasMounted) return;
    const code = (error as { data?: { code?: string } } | null)?.data?.code;
    if (code === "UNAUTHORIZED") {
      removeStoredToken(); // native only — web session lives in an HttpOnly cookie
      queryClient.removeQueries({ queryKey: getQueryKey(trpc.auth.me) });
    }
  }, [error, hasMounted, queryClient]);

  // Auto-identify user in Clarity — only ONCE per session
  useEffect(() => {
    if (user?.id && user?.username && !clarityIdentified.current) {
      clarityIdentified.current = true;
      identifyUser(user.id, user.username, {
        role: user.role || "user",
      });
    }
  }, [user?.id, user?.username, user?.role]);

  const navigate = useNavigate();

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // Ignore errors — still proceed to clear local auth
    }
    removeStoredToken();
    // ✅ SECURITY FIX (audit run-1): purge the persisted React-Query cache.
    // The whole authenticated tRPC cache (identity, payments, tickets,
    // enrollments) is persisted to localStorage under ELBAZ_QUERY_CACHE with a
    // 24h maxAge and was never removed on logout — the next account on a
    // shared browser rehydrated the previous account's private data.
    try {
      localStorage.removeItem("ELBAZ_QUERY_CACHE");
    } catch { /* ignore */ }
    queryClient.clear();
    navigate("/login", { replace: true });
  }, [logoutMutation, navigate, queryClient]);

  const isLoading = !hasMounted || queryLoading;

  return useMemo(
    () => ({
      user: user ?? null,
      isAuthenticated: !!user,
      isAdmin: user?.role === "admin",
      isLoading,
      error,
      logout,
      refresh: refetch,
    }),
    [user, isLoading, error, logout, refetch]
  );
}
