import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import Logo3D from "@/components/Logo3D";
import { motion } from "framer-motion";
import { Magnetic } from "@/components/ui/motion";
import {
  Menu, X, LayoutDashboard, Headphones,
  Shield, LogOut, BookOpen, ChevronDown,
  UserCog,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { EngineeringModeToggle } from "@/components/ui/EngineeringMode";

export default function Navbar() {
  const { lang, setLang } = useTranslation();
  const { user, isAuthenticated, isAdmin, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const location = useLocation();
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Scroll detection for navbar glass effect upgrade
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => setMobileOpen(false), [location.pathname]);

  // Focus trap for mobile menu
  useEffect(() => {
    if (!mobileOpen) return;

    // Focus first visible menu link when menu opens
    const firstLink = mobileMenuRef.current?.querySelector<HTMLElement>('a[href], button:not(.sr-only)');
    firstLink?.focus();

    const handleTab = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileOpen(false);
        return;
      }
      if (e.key !== "Tab" || !mobileMenuRef.current) return;

      const focusable = mobileMenuRef.current.querySelectorAll<HTMLElement>(
        'a[href], button, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleTab);
    // Prevent body scroll when mobile menu is open
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleTab);
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  // Close user menu on outside click
  useEffect(() => {
    if (!userMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-user-menu]")) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [userMenuOpen]);

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  const isAuthPage = location.pathname === "/login" || location.pathname === "/register" || location.pathname === "/forgot-password" || location.pathname === "/reset-password" || location.pathname === "/verify-email";

  if (isAuthPage) return null;

  return (
    <>
      <nav
        role="navigation"
        aria-label={lang === "ar" ? "التنقل الرئيسي" : "Main navigation"}
        className={`fixed top-0 left-0 right-0 z-50 h-16 transition-all duration-300 ${
          scrolled
            ? "border-b border-[#1e2d3d] bg-[rgba(7,11,18,0.95)] shadow-[0_4px_32px_rgba(0,0,0,0.4)] backdrop-blur-xl"
            : "bg-transparent"
        }`}
      >
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 lg:px-6">

          {/* ── Brand Mark ── */}
          <Link to="/" className="group flex items-center gap-3 outline-none">
            {/* 3D Auto-Rotating Logo — rotates every 5 seconds */}
            <Logo3D size="lg" interactive={true} />

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
              <Magnetic key={link.path}>
                <Link
                  to={link.path}
                  aria-current={isActive(link.path) ? "page" : undefined}
                  className={`relative flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium transition-all duration-200 ${
                    isActive(link.path)
                      ? "bg-[rgba(6,182,212,0.1)] text-[#06b6d4]"
                      : "text-[#94a3b8] hover:text-[#e8f0fe]"
                  }`}
                >
                  {link.icon}
                  {link.label}
                  {isActive(link.path) && (
                    <motion.span 
                      layoutId="nav-underline"
                      className="absolute -bottom-0.5 left-3 right-3 h-0.5 rounded-full bg-[#06b6d4]" 
                    />
                  )}
                </Link>
              </Magnetic>
            ))}


            {isAuthenticated && (
              <Link
                to="/dashboard"
                aria-current={isActive("/dashboard") ? "page" : undefined}
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
              data-testid="language-toggle"
              onClick={() => setLang(lang === "en" ? "ar" : "en")}
              aria-label={lang === "en" ? "Switch to Arabic" : "Switch to English"}
              className="rounded-lg border border-[#1e2d3d] bg-[#0d1420] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#64748b] transition-all hover:border-[#06b6d4] hover:text-[#06b6d4]"
            >
              {lang === "en" ? "عربي" : "EN"}
            </button>

            {/* Engineering Mode Toggle */}
            <EngineeringModeToggle />

            {isAuthenticated ? (
              /* User dropdown */
              <div className="relative" data-user-menu>
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  aria-expanded={userMenuOpen}
                  aria-haspopup="true"
                  aria-label={lang === "ar" ? "قائمة المستخدم" : "User menu"}
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
                  <div
                    role="menu"
                    className="absolute end-0 top-full mt-2 w-48 overflow-hidden rounded-xl border border-[#1e2d3d] bg-[#0d1420] shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
                  >
                    <Link
                      to="/profile"
                      role="menuitem"
                      className="flex items-center gap-2 px-4 py-3 text-[13px] text-[#94a3b8] transition-colors hover:bg-[rgba(6,182,212,0.08)] hover:text-[#06b6d4]"
                    >
                      <UserCog className="h-4 w-4" />
                      {lang === "ar" ? "الملف الشخصي" : "Profile"}
                    </Link>
                    {isAdmin && (
                      <Link
                        to="/admin"
                        role="menuitem"
                        className="flex items-center gap-2 px-4 py-3 text-[13px] text-[#94a3b8] transition-colors hover:bg-[rgba(6,182,212,0.08)] hover:text-[#06b6d4]"
                      >
                        <Shield className="h-4 w-4" />
                        {lang === "ar" ? "لوحة التحكم" : "Admin Panel"}
                      </Link>
                    )}
                    <Link
                      to="/support"
                      role="menuitem"
                      className="flex items-center gap-2 px-4 py-3 text-[13px] text-[#94a3b8] transition-colors hover:bg-[rgba(255,255,255,0.04)] hover:text-[#e8f0fe]"
                    >
                      <Headphones className="h-4 w-4" />
                      {lang === "ar" ? "الدعم الفني" : "Support"}
                    </Link>
                    <div className="mx-4 h-px bg-[#1e2d3d]" role="separator" />
                    <button
                      role="menuitem"
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
            aria-label={lang === "ar" ? "فتح القائمة" : "Toggle menu"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {/* ── Mobile Menu (full-screen overlay with focus trap) ── */}
      <div
        ref={mobileMenuRef}
        role="dialog"
        aria-modal="true"
        aria-label={lang === "ar" ? "قائمة التنقل" : "Navigation menu"}
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
              aria-current={isActive(link.path) ? "page" : undefined}
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
              data-testid="language-toggle-mobile"
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

          {/* Hidden close button for focus management */}
          <button
            ref={closeButtonRef}
            className="sr-only"
            onClick={() => setMobileOpen(false)}
            tabIndex={-1}
            aria-hidden="true"
          >
            Close menu
          </button>
        </div>
      </div>
    </>
  );
}
