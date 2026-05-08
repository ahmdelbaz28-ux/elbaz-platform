import { trpc } from "@/providers/trpc";
import { useCallback, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { identifyUser } from "@/lib/clarity";

/**
 * Check if the auth flag cookie exists (non-HttpOnly companion to elbaz_auth).
 * This cookie is set on login/register and cleared on logout.
 * It allows the frontend to skip the auth.me call entirely for unauthenticated users,
 * avoiding unnecessary network requests and UNAUTHORIZED error logs on every page load.
 */
function hasAuthFlagCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some(
    (c) => c.trim().startsWith("elbaz_auth_flag=")
  );
}

export function useAuth() {
  const utils = trpc.useUtils();
  const clarityIdentified = useRef(false);

  const {
    data: user,
    isLoading,
    error,
    refetch,
  } = trpc.auth.me.useQuery(undefined, {
    // ✅ FIX: Only call auth.me if the auth flag cookie exists
    // This prevents unnecessary requests for unauthenticated visitors
    enabled: hasAuthFlagCookie(),
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

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
      await utils.client.mutation.auth.logout.mutate();
    } catch {
      // Fallback — cookie may already be cleared
    }
    utils.invalidate();
    navigate("/login", { replace: true });
  }, [utils, navigate]);

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
