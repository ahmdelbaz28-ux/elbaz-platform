import { Routes, Route, useLocation } from "react-router";
import { lazy, Suspense } from "react";
import { Toaster } from "sonner";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import MobileBottomNav from "@/components/MobileBottomNav";
import WhatsAppButton from "@/components/WhatsAppButton";
import CookieConsent from "@/components/CookieConsent";
import ChatBot from "@/components/ChatBot";
import ScrollToTop from "@/components/ScrollToTop";
import ProtectedRoute from "@/components/ProtectedRoute";
import ErrorBoundary from "@/components/ErrorBoundary";
import { NotificationProvider } from "@/components/NotificationToast";
import ThemeProvider from "@/components/ThemeProvider";
import { EngineeringModeProvider } from "@/components/ui/EngineeringMode";

const Home = lazy(() => import("./pages/Home").then(m => ({ default: m.default })));
const Courses = lazy(() => import("./pages/Courses").then(m => ({ default: m.default })));
const CourseDetail = lazy(() => import("./pages/CourseDetail").then(m => ({ default: m.default })));
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
const CertificateView = lazy(() => import("./pages/CertificateView"));
const CertificateVerify = lazy(() => import("./components/CertificateVerify"));

function PageLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="Loading">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#1f2d44] border-t-[#06b6d4]" />
      <span className="sr-only">Loading...</span>
    </div>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const isAuthPage = location.pathname === "/login" || location.pathname === "/register" || location.pathname === "/forgot-password" || location.pathname === "/reset-password";

  return (
    <div className="min-h-screen bg-[#070b12] overflow-x-hidden w-full relative flex flex-col">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[9999] focus:rounded-lg focus:bg-[#06b6d4] focus:px-4 focus:py-2 focus:text-[#0a0e17] focus:font-semibold focus:outline-none focus:ring-2 focus:ring-[#06b6d4]">
        Skip to main content
      </a>
      <Navbar />
      <ScrollToTop />
      <main id="main-content" tabIndex={-1} className="pb-20 md:pb-0"><Suspense fallback={<PageLoader />}>{children}</Suspense></main>
      {!isAuthPage && <Footer />}
      <MobileBottomNav />
      <WhatsAppButton />
      <ChatBot />
      <CookieConsent />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <NotificationProvider>
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
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/terms" element={<TermsOfService />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/refund" element={<RefundPolicy />} />

            {/* ── Certificate Routes (public) ── */}
            <Route path="/certificate/:certificateNumber" element={<CertificateView />} />
            <Route path="/verify" element={<CertificateVerify />} />

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
