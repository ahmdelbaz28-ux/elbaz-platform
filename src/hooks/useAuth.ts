import { trpc } from "@/providers/trpc";
import { useCallback, useMemo, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { identifyUser } from "@/lib/clarity";
import { hasStoredAuth, removeStoredToken } from "@/lib/auth-storage";


export function useAuth() {
  const utils = trpc.useUtils();
  const clarityIdentified = useRef(false);
  
  const [hasMounted, setHasMounted] = useState(false);
  const [storedAuth, setStoredAuth] = useState(false);

  useEffect(() => {
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
    navigate("/login", { replace: true });
  }, [logoutMutation, navigate]);

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
