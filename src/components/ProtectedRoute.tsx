import { Navigate, useLocation } from "react-router";
import { useAuth } from "@/hooks/useAuth";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

/**
 * ✅ SECURITY: Prevents unauthorized users from seeing protected pages in the browser.
 * Note: Backend APIs enforce their own auth — this is UX protection, not a security boundary.
 */
export default function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { isAuthenticated, isAdmin, isLoading } = useAuth();
  const location = useLocation();

  // Show nothing while checking auth state
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#070b12]">
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
