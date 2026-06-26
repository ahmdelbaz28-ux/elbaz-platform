import { Navigate, useLocation } from "react-router";
import { useAuth } from "@/hooks/useAuth";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

/**
 * ✅ SECURITY: Prevents unauthorized users from seeing protected pages in the browser.
 * Note: Backend APIs enforce their own auth — this is UX protection, not a security boundary.
 * 
 * Hydration fix: Always show loading state during initial render to avoid
 * server/client mismatch. The auth check happens asynchronously after mount.
 */
export default function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { isAuthenticated, isAdmin, isLoading } = useAuth();
  const location = useLocation();

  // Always show loading during SSR and first hydration to prevent mismatch
  // After hydration completes, isLoading will be false and proper auth check runs
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: 'transparent' }}>
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#1e2d3d] border-t-[#06b6d4]" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
