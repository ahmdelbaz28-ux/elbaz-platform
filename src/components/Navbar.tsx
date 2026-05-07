import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import {
  Zap, Menu, X, LayoutDashboard, Headphones,
  Shield, LogOut, User, BookOpen, ChevronDown,
  UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Navbar() {
  const { t, lang, setLang } = useTranslation();
  const { user, isAuthenticated, isAdmin, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const location = useLocation();

  // Scroll detection for navbar glass effect upgrade
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => setMobileOpen(false), [location.pathname]);

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-50 h-16 transition-all duration-300 ${
          scrolled
            ? "border-b border-[#1e2d3d] bg-[rgba(7,11,18,0.95)] shadow-[0_4px_32px_rgba(0,0,0,0.4)] backdrop-blur-xl"
            : "bg-transparent"
        }`}
      >
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 lg:px-6">

          {/* ── Brand Mark ── */}
          <Link to="/" className="group flex items-center gap-3 outline-none">
            {/* Logo icon */}
            <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#06b6d4] to-[#0284c7] shadow-[0_0_16px_rgba(6,182,212,0.35)]">
              <Zap className="h-4 w-4 text-white" strokeWidth={2.5} />
              {/* Pulse ring */}
              <div className="absolute inset-0 rounded-lg border border-[#06b6d4] opacity-0 transition-opacity group-hover:opacity-100 group-hover:animate-ping" />
            </div>

            {/* Text */}
            <div className="flex flex-col leading-none">
              <span className="text-[13px] font-extrabold tracking-tight text-[#e8f0fe]">
                {lang === "ar" ? "أحمد الباز" : "Eng. Ahmed Elbaz"}
              </span>
              <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-[#06b6d4]">
                {lang === "ar" ? "كورسات الهندسة الكهربية" : "Electrical Engineering"}
              </span>
            </div>
          </Link>

          {/* ── Desktop Nav Links ── */}
          <div className="hidden items-center gap-1 md:flex">
            {[
              { path: "/", label: lang === "ar" ? "الرئيسية" : "Home" },
              { path: "/courses", label: lang === "ar" ? "الكورسات" : "Courses", icon: <BookOpen className="h-3.5 w-3.5" /> },
            ].map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={`relative flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150 ${
                  isActive(link.path)
                    ? "bg-[rgba(6,182,212,0.1)] text-[#06b6d4]"
                    : "text-[#94a3b8] hover:bg-[rgba(255,255,255,0.04)] hover:text-[#e8f0fe]"
                }`}
              >
                {link.icon}
                {link.label}
                {isActive(link.path) && (
                  <span className="absolute -bottom-0.5 left-3 right-3 h-0.5 rounded-full bg-[#06b6d4]" />
                )}
              </Link>
            ))}

            {isAuthenticated && (
              <Link
                to="/dashboard"
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150 ${
                  isActive("/dashboard")
                    ? "bg-[rgba(6,182,212,0.1)] text-[#06b6d4]"
                    : "text-[#94a3b8] hover:bg-[rgba(255,255,255,0.04)] hover:text-[#e8f0fe]"
                }`}
              >
                <LayoutDashboard className="h-3.5 w-3.5" />
                {lang === "ar" ? "لوحتي" : "Dashboard"}
              </Link>
            )}
          </div>

          {/* ── Right Controls ── */}
          <div className="hidden items-center gap-2 md:flex">
            {/* Language toggle */}
            <button
              onClick={() => setLang(lang === "en" ? "ar" : "en")}
              className="rounded-lg border border-[#1e2d3d] bg-[#0d1420] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#64748b] transition-all hover:border-[#06b6d4] hover:text-[#06b6d4]"
            >
              {lang === "en" ? "عربي" : "EN"}
            </button>

            {isAuthenticated ? (
              /* User dropdown */
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  onBlur={() => setTimeout(() => setUserMenuOpen(false), 150)}
                  className="flex items-center gap-2 rounded-lg border border-[#1e2d3d] bg-[#0d1420] px-3 py-1.5 text-[13px] transition-all hover:border-[#2d3f52]"
                >
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[#06b6d4] to-[#0284c7] text-[11px] font-bold text-white">
                    {(user?.name || user?.username || "U").charAt(0).toUpperCase()}
                  </div>
                  <span className="max-w-[100px] truncate text-[#94a3b8]">
                    {user?.name || user?.username}
                  </span>
                  <ChevronDown className={`h-3.5 w-3.5 text-[#475569] transition-transform ${userMenuOpen ? "rotate-180" : ""}`} />
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-48 overflow-hidden rounded-xl border border-[#1e2d3d] bg-[#0d1420] shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
                    <Link
                      to="/profile"
                      className="flex items-center gap-2 px-4 py-3 text-[13px] text-[#94a3b8] transition-colors hover:bg-[rgba(6,182,212,0.08)] hover:text-[#06b6d4]"
                    >
                      <UserCog className="h-4 w-4" />
                      {lang === "ar" ? "الملف الشخصي" : "Profile"}
                    </Link>
                    {isAdmin && (
                      <Link
                        to="/admin"
                        className="flex items-center gap-2 px-4 py-3 text-[13px] text-[#94a3b8] transition-colors hover:bg-[rgba(6,182,212,0.08)] hover:text-[#06b6d4]"
                      >
                        <Shield className="h-4 w-4" />
                        {lang === "ar" ? "لوحة التحكم" : "Admin Panel"}
                      </Link>
                    )}
                    <Link
                      to="/support"
                      className="flex items-center gap-2 px-4 py-3 text-[13px] text-[#94a3b8] transition-colors hover:bg-[rgba(255,255,255,0.04)] hover:text-[#e8f0fe]"
                    >
                      <Headphones className="h-4 w-4" />
                      {lang === "ar" ? "الدعم الفني" : "Support"}
                    </Link>
                    <div className="mx-4 h-px bg-[#1e2d3d]" />
                    <button
                      onClick={() => { logout(); setUserMenuOpen(false); }}
                      className="flex w-full items-center gap-2 px-4 py-3 text-[13px] text-[#64748b] transition-colors hover:bg-[rgba(239,68,68,0.08)] hover:text-[#f87171]"
                    >
                      <LogOut className="h-4 w-4" />
                      {lang === "ar" ? "تسجيل الخروج" : "Sign Out"}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link to="/login">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 border border-[#1e2d3d] bg-transparent text-[13px] text-[#94a3b8] hover:border-[#2d3f52] hover:bg-[rgba(255,255,255,0.04)] hover:text-[#e8f0fe]"
                  >
                    {lang === "ar" ? "تسجيل الدخول" : "Sign In"}
                  </Button>
                </Link>
                <Link to="/register">
                  <Button
                    size="sm"
                    className="h-8 bg-gradient-to-r from-[#06b6d4] to-[#0284c7] text-[13px] font-semibold text-white shadow-[0_0_16px_rgba(6,182,212,0.25)] hover:shadow-[0_0_24px_rgba(6,182,212,0.4)]"
                  >
                    {lang === "ar" ? "ابدأ مجاناً" : "Start Free"}
                  </Button>
                </Link>
              </div>
            )}
          </div>

          {/* ── Mobile Hamburger ── */}
          <button
            className="rounded-lg p-2 text-[#94a3b8] transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-[#e8f0fe] md:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {/* ── Mobile Menu (full-screen overlay) ── */}
      <div
        className={`fixed inset-0 z-40 transition-all duration-300 md:hidden ${
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        } mobile-menu-backdrop`}
      >
        <div className="flex h-full flex-col items-center justify-center gap-4 pt-16">
          {[
            { path: "/", label: lang === "ar" ? "الرئيسية" : "Home" },
            { path: "/courses", label: lang === "ar" ? "الكورسات" : "Courses" },
            ...(isAuthenticated ? [
              { path: "/dashboard", label: lang === "ar" ? "لوحتي" : "Dashboard" },
              { path: "/profile", label: lang === "ar" ? "الملف الشخصي" : "Profile" },
              { path: "/support", label: lang === "ar" ? "الدعم" : "Support" },
            ] : []),
            ...(isAdmin ? [{ path: "/admin", label: lang === "ar" ? "التحكم" : "Admin" }] : []),
          ].map((link) => (
            <Link
              key={link.path}
              to={link.path}
              className={`text-2xl font-bold transition-colors ${
                isActive(link.path) ? "text-[#06b6d4]" : "text-[#94a3b8] hover:text-[#e8f0fe]"
              }`}
            >
              {link.label}
            </Link>
          ))}

          {/* Lang + Auth */}
          <div className="mt-6 flex flex-col items-center gap-3">
            <button
              onClick={() => setLang(lang === "en" ? "ar" : "en")}
              className="rounded-xl border border-[#1e2d3d] px-6 py-2.5 text-base font-medium text-[#64748b] hover:border-[#06b6d4] hover:text-[#06b6d4]"
            >
              {lang === "en" ? "العربية" : "English"}
            </button>
            {isAuthenticated ? (
              <button
                onClick={() => { logout(); setMobileOpen(false); }}
                className="text-base font-medium text-[#f87171]"
              >
                {lang === "ar" ? "تسجيل الخروج" : "Sign Out"}
              </button>
            ) : (
              <Link
                to="/register"
                className="rounded-xl bg-gradient-to-r from-[#06b6d4] to-[#0284c7] px-8 py-3 text-base font-bold text-white"
              >
                {lang === "ar" ? "ابدأ مجاناً" : "Start Free"}
              </Link>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
