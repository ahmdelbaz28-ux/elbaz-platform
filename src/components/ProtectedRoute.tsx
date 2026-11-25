import { Navigate, useLocation } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";

interface ProtectedRouteProps {
  readonly children: React.ReactNode;
  readonly requireAdmin?: boolean;
}

/**
 * ✅ SECURITY: Prevents unauthorized users from seeing protected pages in the browser.
 * Note: Backend APIs enforce their own auth — this is UX protection, not a security boundary.
 *
 * ✅ ROOT-CURE (remember-device round 3, 2026-11-26): while isLoading, this
 * route used to be the ONLY gate and any transient auth.me failure (edge
 * challenge 403, Space cold start, network blip) flipped isAuthenticated to
 * false and navigated the user to /login — even though their Remember-
 * this-device cookie was still perfectly valid in the browser. useAuth now
 * keeps isLoading true (verificationPending) while the server's answer about
 * the session is UNAVAILABLE and auto-reconnects in the background, so the
 * bounce below fires ONLY on a server-confirmed rejection. While
 * verification is pending the spinner gains a small bilingual "reconnecting"
 * note — honest feedback instead of an apparently frozen screen.
 */
export default function ProtectedRoute({ children, requireAdmin = false }: ProtectedRouteProps) {
  const { isAuthenticated, isAdmin, isLoading, verificationPending } = useAuth();
  const { lang } = useTranslation();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-transparent">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#1e2d3d] border-t-[#06b6d4]" />
        {verificationPending && (
          <p className="animate-pulse text-sm text-text-muted" role="status">
            {lang === "ar"
              ? "تعذّر التحقق من الجلسة مؤقتاً — جارٍ إعادة الاتصال تلقائياً…"
              : "Session check temporarily unavailable — reconnecting automatically…"}
          </p>
        )}
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
