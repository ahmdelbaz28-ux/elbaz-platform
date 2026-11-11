import { Routes, Route, useLocation, useNavigationType } from "react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { Toaster } from "sonner";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import WhatsAppButton from "@/components/WhatsAppButton";
import CookieConsent from "@/components/CookieConsent";
import ScrollToTop from "@/components/ScrollToTop";
import ProtectedRoute from "@/components/ProtectedRoute";
import ErrorBoundary from "@/components/ErrorBoundary";
import StarfieldBackground from "@/components/StarfieldBackground";
import { NotificationProvider } from "@/components/NotificationToast";
import NotificationPollerBridge from "@/components/NotificationPollerBridge";
import ThemeProvider from "@/components/ThemeProvider";
import { EngineeringModeProvider } from "@/components/ui/EngineeringMode";
import AmbientOrbs from "@/components/ui/AmbientOrbs";
import FloatingIconsBg from "@/components/FloatingIconsBg";
import { useTranslation } from "@/hooks/useTranslation";
import "@/engineering-mode.css";

// 🚀 PERFORMANCE (Task ID 7): Lazy-load ChatBot (~50KB compressed).
// It's rendered on every page but only ~5% of users open it. Loading it
// on-demand saves ~50KB from the initial bundle on every page load.
const ChatBot = lazy(() => import("@/components/ChatBot").then(m => ({ default: m.default })));

/**
 * 🚀 PERFORMANCE (root-cause audit, F4): defer the ChatBot chunk until idle.
 * The lazy() boundary above only makes the chunk SEPARATE — this component
 * used to be mounted immediately, so its 41KB still downloaded on EVERY page
 * load while ~95% of visitors never open it, competing with boot-critical
 * requests. Now the download waits for browser idle time (or a 3s hard cap),
 * after which the FAB appears. No functionality is lost: the widget itself
 * lazy-loads its internals on first interaction.
 */
function DeferredChatBot() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if ("requestIdleCallback" in globalThis) {
      const id = (globalThis as {
        requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number;
        cancelIdleCallback: (id: number) => void;
      }).requestIdleCallback(() => setReady(true), { timeout: 3000 });
      return () => {
        (globalThis as { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(id);
      };
    }
    const t = setTimeout(() => setReady(true), 1500);
    return () => clearTimeout(t);
  }, []);
  if (!ready) return null;
  return <ChatBot />;
}

const Home = lazy(() => import("./pages/Home").then(m => ({ default: m.default })));
const Courses = lazy(() => import("./pages/Courses").then(m => ({ default: m.default })));
const CourseDetail = lazy(() => import("./pages/CourseDetail").then(m => ({ default: m.default })));
const References = lazy(() => import("./pages/References").then(m => ({ default: m.default })));
const Faq = lazy(() => import("./pages/Faq").then(m => ({ default: m.default })));
const Wishlist = lazy(() => import("./pages/Wishlist").then(m => ({ default: m.default })));
const LearningJourney = lazy(() => import("./pages/LearningJourney").then(m => ({ default: m.default })));
const Login = lazy(() => import("./pages/Login").then(m => ({ default: m.default })));
const Register = lazy(() => import("./pages/Register").then(m => ({ default: m.default })));
const Dashboard = lazy(() => import("./pages/Dashboard").then(m => ({ default: m.default })));
const Admin = lazy(() => import("./pages/Admin").then(m => ({ default: m.default })));
const Support = lazy(() => import("./pages/Support").then(m => ({ default: m.default })));
const Profile = lazy(() => import("./pages/Profile").then(m => ({ default: m.default })));
const TermsOfService = lazy(() => import("./pages/TermsOfService").then(m => ({ default: m.default })));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy").then(m => ({ default: m.default })));
const RefundPolicy = lazy(() => import("./pages/RefundPolicy").then(m => ({ default: m.default })));
const NotFound = lazy(() => import("./pages/NotFound").then(m => ({ default: m.default })));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail").then(m => ({ default: m.default })));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword").then(m => ({ default: m.default })));
const ResetPassword = lazy(() => import("./pages/ResetPassword").then(m => ({ default: m.default })));
const Documents = lazy(() => import("./pages/Documents").then(m => ({ default: m.default })));
const Articles = lazy(() => import("./pages/Articles").then(m => ({ default: m.default })));
const ArticleDetail = lazy(() => import("./pages/ArticleDetail").then(m => ({ default: m.default })));

const CertificateView = lazy(() => import("./pages/CertificateView"));
const CertificateVerify = lazy(() => import("./components/CertificateVerify"));

/**
 * 🚀 PERFORMANCE (round-2, F9): route-chunk prefetch on intent (hover/focus).
 *
 * BrowserRouter (react-router) does not support <Link prefetch>, so before
 * this, clicking a nav link started downloading that page's chunk ONLY after
 * the click — a 100-300ms blank PageLoader spinner on 3G/4G even though the
 * user had been HOVERING the link for hundreds of ms before clicking.
 *
 * One delegated listener pair (pointerover + focusin on <document>) matches
 * the hovered/focused anchor against PUBLIC route patterns and triggers the
 * exact same dynamic import the lazy() route uses. Repeat imports resolve
 * from the module registry (free), and a Set guards the regex work. The
 * fetch happens during hover dead-time, so navigation becomes near-instant.
 *
 * Auth-gated routes (dashboard/profile/admin/…) are deliberately excluded:
 * guests would prefetch chunks they can never open (Admin alone is 199KB).
 */
const PREFETCHABLE_ROUTES: ReadonlyArray<readonly [RegExp, () => Promise<unknown>]> = [
  [/^\/$/, () => import("./pages/Home")],
  [/^\/courses$/, () => import("./pages/Courses")],
  [/^\/courses\/[^/]+$/, () => import("./pages/CourseDetail")],
  [/^\/articles$/, () => import("./pages/Articles")],
  [/^\/articles\/[^/]+$/, () => import("./pages/ArticleDetail")],
  [/^\/references$/, () => import("./pages/References")],
  [/^\/faq$/, () => import("./pages/Faq")],
  [/^\/login$/, () => import("./pages/Login")],
  [/^\/register$/, () => import("./pages/Register")],
  [/^\/forgot-password$/, () => import("./pages/ForgotPassword")],
  [/^\/reset-password$/, () => import("./pages/ResetPassword")],
  [/^\/verify-email$/, () => import("./pages/VerifyEmail")],
  [/^\/terms$/, () => import("./pages/TermsOfService")],
  [/^\/privacy$/, () => import("./pages/PrivacyPolicy")],
  [/^\/refund$/, () => import("./pages/RefundPolicy")],
  [/^\/certificate\/[^/]+$/, () => import("./pages/CertificateView")],
  [/^\/verify(\/[^/]+)?$/, () => import("./components/CertificateVerify")],
];

const prefetchedRoutes = new Set<string>();

function prefetchRoute(rawPath: string): void {
  // Normalize: strip query/hash + trailing slash (except root) — same rule
  // the SPA handler uses server-side.
  const path = rawPath.split(/[?#]/)[0].replace(/^(\/.{1,}?)\/+$/, "$1") || "/";
  if (prefetchedRoutes.has(path)) return;
  for (const [pattern, load] of PREFETCHABLE_ROUTES) {
    if (pattern.test(path)) {
      prefetchedRoutes.add(path);
      void load().catch(() => {
        // Offline / chunk error — navigation will surface it normally.
        prefetchedRoutes.delete(path);
      });
      return;
    }
  }
}

function useRoutePrefetch(): void {
  useEffect(() => {
    const handle = (event: Event): void => {
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest("a[href^='/']");
      if (!anchor) return;
      prefetchRoute(anchor.getAttribute("href") ?? "");
    };
    // pointerover (not mouseenter — delegation needs bubbling); focusin covers
    // keyboard tabbing and fires for focus events that don't bubble natively.
    document.addEventListener("pointerover", handle, { passive: true });
    document.addEventListener("focusin", handle);
    return () => {
      document.removeEventListener("pointerover", handle);
      document.removeEventListener("focusin", handle);
    };
  }, []);
}

function PageLoader() {
  const { t } = useTranslation();
  return (
    <ErrorBoundary fallback={<div>{t("loadingError")}</div>}>
      <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label={t("loading")}> {/* NOSONAR - shadcn/ui ARIA role pattern */}
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#1f2d44] border-t-[#06b6d4]" />
        <span className="sr-only">{t("loading")}</span>
      </div>
    </ErrorBoundary>
  );
}

/**
 * ✅ FIX (opened at the footer): React Router keeps the previous scroll offset
 * across navigations. Clicking a category card (e.g. ETAP Software) from the
 * middle of the homepage then landed the new page at the old offset — past a
 * shorter target page the browser clamps to the bottom, so users saw the
 * FOOTER first (most visible on mobile). Every LINK navigation (PUSH, and
 * REPLACE) scrolls back to the top — including search-only changes like
 * /courses?category=10 → /courses via a footer link. #anchor links jump to
 * their target. Back/forward (POP) keeps natural browser behavior.
 */
function ScrollReset() {
  const location = useLocation();
  const navType = useNavigationType();
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname/search/hash are intentional re-run triggers (scroll-reset on navigation), not read values
  useEffect(() => {
    if (navType === "POP") return undefined;
    if (location.hash) {
      const targetId = decodeURIComponent(location.hash.slice(1));
      const timer = setTimeout(() => {
        document.getElementById(targetId)?.scrollIntoView();
      }, 80);
      return () => clearTimeout(timer);
    }
    window.scrollTo(0, 0);
    return undefined;
  }, [navType, location.pathname, location.search, location.hash]);
  return null;
}

function Layout({ children }: { readonly children: React.ReactNode }) {
  const { t } = useTranslation();
  const location = useLocation();
  const AUTH_PAGES = new Set(["/login", "/register", "/forgot-password", "/reset-password"]);
  const isAuthPage = AUTH_PAGES.has(location.pathname);
  // Admin is a standalone app-like dashboard with its own sidebar navigation —
  // the site chrome (navbar/footer/bottom-nav/widgets) would overlap its sticky
  // top bar and floating UI on mobile.
  const isAdminPage = location.pathname.startsWith("/admin");

  return (
    <div className="min-h-screen overflow-x-hidden w-full relative flex flex-col">
      {/* ── Animated starfield + shooting stars background (all pages) ── */}
      <StarfieldBackground />
      {/* ── Ambient floating orbs for visual depth ── */}
      <AmbientOrbs />
      {/* ── Floating AI-style SVG icons in background (all pages) ── */}
      <FloatingIconsBg />
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[9999] focus:rounded-lg focus:bg-[#06b6d4] focus:px-4 focus:py-2 focus:text-[#0a0e17] focus:font-semibold focus:outline-none focus:ring-2 focus:ring-[#06b6d4]">
        {t("skipToContent")}
      </a>
      {!isAdminPage && <Navbar />}
      <ScrollReset />
      <ScrollToTop />
      <main id="main-content" tabIndex={-1}><Suspense fallback={<PageLoader />}>{children}</Suspense></main>
      {!isAuthPage && !isAdminPage && <Footer />}
      {!isAdminPage && <WhatsAppButton />}
      {/* 🚀 PERFORMANCE: ChatBot wrapped in Suspense — downloaded only during idle time */}
      {!isAdminPage && <Suspense fallback={null}><DeferredChatBot /></Suspense>}
      <CookieConsent />
    </div>
  );
}

export default function App() {
  // 🚀 Prefetch route chunks on hover/focus (see PREFETCHABLE_ROUTES above).
  useRoutePrefetch();
  return (
    <ErrorBoundary>
      <NotificationProvider>
        {/* 🔔 Live server notifications → toasts + bell (polls /api/notifications/poll,
            only active while logged in; no-ops silently for guests) */}
        <NotificationPollerBridge />
        <EngineeringModeProvider>
          <ThemeProvider>
            <Toaster theme="dark" richColors position="top-center" />
            <Layout>
              <Routes>
                {/* ── Public Routes ── */}
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/verify-email" element={<VerifyEmail />} />
                <Route path="/" element={<Home />} />
                <Route path="/courses" element={<Courses />} />
                <Route path="/courses/:slug" element={<CourseDetail />} />
                <Route path="/articles" element={<Articles />} />
                <Route path="/articles/:slug" element={<ArticleDetail />} />
                <Route path="/references" element={<References />} />
                <Route path="/faq" element={<Faq />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/terms" element={<TermsOfService />} />
                <Route path="/privacy" element={<PrivacyPolicy />} />
                <Route path="/refund" element={<RefundPolicy />} />

                {/* ── Certificate Routes (public) ── */}
                <Route path="/certificate/:certificateNumber" element={<CertificateView />} />
                <Route path="/verify" element={<CertificateVerify />} />
                <Route path="/verify/:certificateNumber" element={<CertificateVerify />} />

                {/* ── Protected Routes (requires login) ── */}
                <Route path="/dashboard" element={
                  <ProtectedRoute><Dashboard /></ProtectedRoute>
                } />
                <Route path="/profile" element={
                  <ProtectedRoute><Profile /></ProtectedRoute>
                } />
                <Route path="/support" element={
                  <ProtectedRoute><Support /></ProtectedRoute>
                } />
                <Route path="/wishlist" element={
                  <ProtectedRoute><Wishlist /></ProtectedRoute>
                } />
                <Route path="/journey" element={
                  <ProtectedRoute><LearningJourney /></ProtectedRoute>
                } />
                <Route path="/documents" element={
                  <ProtectedRoute><Documents /></ProtectedRoute>
                } />


                {/* ── Admin Route (requires admin role) ── */}
                <Route path="/admin" element={
                  <ProtectedRoute requireAdmin><Admin /></ProtectedRoute>
                } />

                <Route path="*" element={<NotFound />} />
              </Routes>
            </Layout>
          </ThemeProvider>
        </EngineeringModeProvider>
      </NotificationProvider>
    </ErrorBoundary>
  );
}
