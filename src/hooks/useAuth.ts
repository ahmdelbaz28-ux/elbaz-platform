import { trpc } from "@/providers/trpc";
import { useCallback, useMemo, useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { identifyUser } from "@/lib/clarity";
import { hasStoredAuth, removeStoredToken, clearAuthFlagCookie } from "@/lib/auth-storage";


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

  const location = useLocation();

  // ✅ FIX (chatbot dead click): re-sync the stored-auth flag on route
  // changes. Login/Register complete with an SPA navigate() (no reload) and
  // the login response sets the flag cookie — without this re-sync a query
  // disabled by a previous 401 cleanup would stay disabled forever and the
  // UI would keep showing logged-out after a successful login.
  useEffect(() => {
    if (!hasMounted) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStoredAuth(hasStoredAuth());
  }, [location.pathname, hasMounted]);

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
      // ✅ FIX (chatbot dead click): the non-HttpOnly flag cookie outlives the
      // real session (30-day maxAge vs expired/revoked JWT) and kept
      // hasStoredAuth() true, so the query kept refetching a dead session.
      // Disable the query (storedAuth=false) + drop the stale flag cookie.
      // ⚠️ Do NOT queryClient.removeQueries() here: the global auth-failure
      // handler (trpc.tsx) has already parked auth.me in a terminal error
      // state — removing it would recreate the query for the still-subscribed
      // observers and auto-refetch → 401 → recreate → an infinite loop
      // (~60 req/s measured) that kept authLoading stuck true and swallowed
      // every ChatBot FAB click ("no reaction" bug).
      removeStoredToken(); // native only — web session lives in an HttpOnly cookie
      clearAuthFlagCookie(); // web — drop the flag that outlived the session
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStoredAuth(false); // disable the auth.me query — nothing fires again
    }
  }, [error, hasMounted]);

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
