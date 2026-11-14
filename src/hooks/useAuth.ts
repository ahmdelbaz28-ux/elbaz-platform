import { trpc } from "@/providers/trpc";
import { useCallback, useMemo, useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { identifyUser } from "@/lib/clarity";
import {
  hasStoredAuth,
  removeStoredToken,
  clearAuthFlagCookie,
  markSessionProbeDone,
  isSessionProbeDone,
  isNativePlatform,
} from "@/lib/auth-storage";

/**
 * ✅ ROOT-CURE (remember-device): the boot probe phase, SHARED by every
 * useAuth instance in the tab (ProtectedRoute, Navbar, Dashboard, ChatBot…).
 *
 * Why module-level: several components call useAuth() simultaneously. If the
 * probe decision were per-instance state, an instance mounting a moment AFTER
 * the probe started would see "probe attempted" and conclude "no session" —
 * its ProtectedRoute would bounce to /login WHILE another instance was still
 * restoring the session (the exact race the first cut hit in W7).
 *
 * Decision table (web only):
 *   flag cookie present        → "idle"   (normal flag-gated flow)
 *   native platform            → "idle"   (localStorage token, own renewal)
 *   flag missing, no mark      → "active" (join/lead the ONE shared probe)
 *   flag missing, mark present → "done"   (probe already concluded — dead end)
 *
 * The mark is written ONLY when the probe CONCLUDES (success or UNAUTHORIZED
 * rejection), never when it starts — that is what lets late joiners mount
 * into "active" and ride the same shared auth.me fetch. React-Query
 * deduplicates the shared key, so all instances observe ONE request; the
 * conclusion effects below (success → done, 401 → done) write the mark.
 */
type ProbePhase = "idle" | "active" | "done";

function computeProbePhase(): ProbePhase {
  if (hasStoredAuth()) return "idle";
  if (isNativePlatform()) return "idle";
  if (isSessionProbeDone()) return "done";
  return "active";
}


export function useAuth() {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const clarityIdentified = useRef(false);
  
  const [hasMounted, setHasMounted] = useState(false);
  const [storedAuth, setStoredAuth] = useState(false);
  // ✅ ROOT-CURE (remember-device): shared boot probe — see computeProbePhase().
  // While ANY instance is in "active", the auth.me query stays enabled for ALL
  // of them and protected routes keep showing the spinner — never a login-page
  // flash, never a mid-probe bounce.
  const [probePhase, setProbePhase] = useState<ProbePhase>(computeProbePhase);

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: location.pathname is an intentional re-sync trigger, not a read value
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
    enabled: hasMounted && (storedAuth || probePhase === "active"),
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
      // ✅ ROOT-CURE: the probe came back rejected too — the session is really
      // dead. Record the conclusion so nothing probes again in this tab, and
      // stop probing so the query gate falls back to storedAuth only.
      markSessionProbeDone();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProbePhase("done");
      // ✅ ROOT-CURE (2026-11-13): purge the persisted React-Query cache here
      // too (the global auth-failure net does the same on the auth.me path) —
      // idempotent belt-and-braces so the next account can never rehydrate
      // this account's private data from localStorage.
      try {
        localStorage.removeItem("ELBAZ_QUERY_CACHE");
      } catch { /* ignore */ }
       
      setStoredAuth(false); // disable the auth.me query — nothing fires again
    } else if (hasMounted && probePhase === "active") {
      // ✅ ROOT-CURE: a NON-auth error (network hiccup, HF Space cold start,
      // 5xx) is NOT a definitive answer about the session. Conclude the probe
      // for THIS load (no infinite spinner) but do NOT write the conclusion
      // mark — the next full load probes again and self-heals if the session
      // was alive all along. The stored session is never touched on 5xx.
       
      setProbePhase("done");
    }
  }, [error, hasMounted, probePhase]);

  // ✅ ROOT-CURE: the probe resolved successfully — the session was alive all
  // along and the server re-set the flag cookie on this very response. Record
  // the conclusion, re-read the flag (now present) so the query gate falls
  // back to the normal storedAuth path, and stop probing.
  useEffect(() => {
    if (user && probePhase === "active") {
      markSessionProbeDone();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProbePhase("done");
       
      setStoredAuth(hasStoredAuth());
    }
  }, [user, probePhase]);

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
    // ✅ SECURITY FIX (audit run-1, chatbot.localstorage-history): purge every
    // per-identity chat-history key so the next account cannot hydrate the
    // previous account's conversation from a shared browser profile.
    try {
      const doomed: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("elbaz_chat_history:")) doomed.push(k);
      }
      for (const k of doomed) localStorage.removeItem(k);
      localStorage.removeItem("elbaz_chat_history"); // pre-fix global key
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
