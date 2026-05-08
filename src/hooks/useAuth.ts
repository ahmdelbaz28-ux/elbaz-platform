import { trpc } from "@/providers/trpc";
import { useCallback, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { identifyUser } from "@/lib/clarity";

export function useAuth() {
  const utils = trpc.useUtils();
  const clarityIdentified = useRef(false);

  const {
    data: user,
    isLoading,
    error,
    refetch,
  } = trpc.auth.me.useQuery(undefined, {
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