import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import GlobalSearch from "@/components/GlobalSearch";
import { motion, AnimatePresence } from "framer-motion";
import { Magnetic } from "@/components/ui/motion";
import {
  Menu, X, LayoutDashboard, Headphones,
  Shield, LogOut, BookOpen, ChevronDown,
  UserCog, FileBox, HelpCircle, Heart, TrendingUp,
  SunDim, BookMarked,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { EngineeringModeToggle } from "@/components/ui/EngineeringMode";

import { useEyeProtection } from "@/hooks/useEyeProtection";

export default function Navbar() {
  const { lang, setLang } = useTranslation();
  const { user, isAuthenticated, isAdmin, logout } = useAuth();
  const { isEyeProtectionActive, toggleEyeProtection } = useEyeProtection();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const lastScrollY = useRef(0);
  const location = useLocation();
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  // Scroll detection: glass effect + hide/reveal
  useEffect(() => {
    const onScroll = () => {
      const y = globalThis.scrollY;
      setScrolled(y > 20);
      // Hide on scroll down, reveal on scroll up
      if (y > lastScrollY.current && y > 80) {
        setHidden(true);
      } else {
        setHidden(false);
      }
      lastScrollY.current = y;
    };
    globalThis.addEventListener("scroll", onScroll, { passive: true });
    return () => globalThis.removeEventListener("scroll", onScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => setMobileOpen(false), [location.pathname]);

  // Focus trap for mobile menu
  useEffect(() => {
    if (!mobileOpen) return;
    const firstLink = mobileMenuRef.current?.querySelector<HTMLElement>('a[href], button:not(.sr-only)');
    firstLink?.focus();

    const handleTab = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setMobileOpen(false); return; }
      if (e.key !== "Tab" || !mobileMenuRef.current) return;
      const focusable = mobileMenuRef.current.querySelectorAll<HTMLElement>('a[href], button, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener("keydown", handleTab);
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
      if (!target.closest("[data-user-menu]")) setUserMenuOpen(false);
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [userMenuOpen]);

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  const isAuthPage = ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email"].includes(location.pathname);

  if (isAuthPage) return null;

  const navLinkBase = "relative flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium transition-all duration-200";
  const navLinkActive = "bg-accent/10 text-accent";
  const navLinkInactive = "text-text-secondary hover:text-foreground hover:bg-white/5";

  return (
    <>
      <nav
        aria-label={lang === "ar" ? "التنقل الرئيسي" : "Main navigation"}
        className={`fixed top-0 left-0 right-0 z-50 h-16 transition-all duration-300 ${
          hidden ? "-translate-y-full" : "translate-y-0"
        }`}
      >
        <div
          className={`mx-auto flex h-full max-w-7xl items-center justify-between px-4 lg:px-6 transition-all duration-300 ${
            scrolled
              ? "border-b border-border bg-[rgba(11,15,25,0.92)] shadow-lg backdrop-blur-2xl"
              : "bg-transparent"
          }`}
        >
          {/* ── Brand Mark ── */}
          <Link to="/" className="group flex items-center gap-3 outline-none">
            <img src="/logo.svg" alt="Eng. Ahmed Elbaz Logo" className="h-10 w-auto object-contain rounded-lg transition-transform duration-300 group-hover:scale-105" />
            <div className="flex flex-col leading-none">
              <span className="text-[13px] font-extrabold tracking-tight text-foreground">
                {lang === "ar" ? "أحمد الباز" : "Eng. Ahmed Elbaz"}
              </span>
              <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-accent">
                {lang === "ar" ? "كورسات الهندسة الكهربية" : "Electrical Engineering"}
              </span>
            </div>
          </Link>

          {/* ── Desktop Nav Links ── */}
          <div className="hidden items-center gap-1 md:flex">
            {[
              { path: "/", label: lang === "ar" ? "الرئيسية" : "Home" },
              { path: "/courses", label: lang === "ar" ? "الكورسات" : "Courses", icon: <BookOpen className="h-3.5 w-3.5" /> },
              { path: "/references", label: lang === "ar" ? "المراجع" : "References", icon: <FileBox className="h-3.5 w-3.5" /> },
              { path: "/faq", label: lang === "ar" ? "الأسئلة" : "FAQ", icon: <HelpCircle className="h-3.5 w-3.5" /> },
              ...(isAuthenticated ? [{ path: "/documents", label: lang === "ar" ? "المستندات" : "Documents", icon: <BookMarked className="h-3.5 w-3.5" /> }] : []),
            ].map((link) => (
              <Magnetic key={link.path}>
                <Link
                  to={link.path}
                  aria-current={isActive(link.path) ? "page" : undefined}
                  className={`${navLinkBase} ${isActive(link.path) ? navLinkActive : navLinkInactive}`}
                >
                  {link.icon}
                  {link.label}
                  {isActive(link.path) && (
                    <motion.span layoutId="nav-underline" className="absolute -bottom-0.5 left-3 right-3 h-0.5 rounded-full bg-accent" />
                  )}
                </Link>
              </Magnetic>
            ))}

            {isAuthenticated && (
              <Link to="/dashboard" aria-current={isActive("/dashboard") ? "page" : undefined} className={`${navLinkBase} ${isActive("/dashboard") ? navLinkActive : navLinkInactive}`}>
                <LayoutDashboard className="h-3.5 w-3.5" />
                {lang === "ar" ? "لوحتي" : "Dashboard"}
              </Link>
            )}
          </div>

          {/* ── Right Controls ── */}
          <div className="hidden items-center gap-2 md:flex">
            <GlobalSearch />

            <button onClick={toggleEyeProtection} aria-label={lang === "ar" ? "حماية العين" : "Eye protection"} title={lang === "ar" ? "فلتر حماية العين" : "Blue light filter"} className={`rounded-lg p-2 text-[13px] transition-all duration-200 ${isEyeProtectionActive ? "text-amber-400 bg-amber-400/10" : "text-text-secondary hover:text-foreground hover:bg-white/5"}`}>
              <SunDim className="h-4 w-4" />
            </button>

            <button data-testid="language-toggle" onClick={() => setLang(lang === "en" ? "ar" : "en")} aria-label={lang === "en" ? "Switch to Arabic" : "Switch to English"} className="rounded-lg border border-border bg-primary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-secondary transition-all hover:border-accent hover:text-accent">
              {lang === "en" ? "عربي" : "EN"}
            </button>

            <EngineeringModeToggle />

            {isAuthenticated ? (
              <div className="relative" data-user-menu>
                <button onClick={() => setUserMenuOpen(!userMenuOpen)} aria-expanded={userMenuOpen} aria-haspopup="true" aria-label={lang === "ar" ? "قائمة المستخدم" : "User menu"} className="flex items-center gap-2 rounded-lg border border-border bg-primary px-3 py-1.5 text-[13px] transition-all hover:border-accent">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white">{(user?.name || user?.username || "U").charAt(0).toUpperCase()}</div>
                  <span className="max-w-[100px] truncate text-text-secondary">{user?.name || user?.username}</span>
                  <ChevronDown className={`h-3.5 w-3.5 text-text-muted transition-transform duration-200 ${userMenuOpen ? "rotate-180" : ""}`} />
                </button>

                <AnimatePresence>
                  {userMenuOpen && (
                    <motion.div role="menu" initial={{ opacity: 0, y: -8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.96 }} transition={{ duration: 0.15 }} className="absolute end-0 top-full mt-2 w-48 overflow-hidden rounded-xl border border-border bg-primary shadow-2xl backdrop-blur-xl">
                      {[
                        { to: "/profile", icon: <UserCog className="h-4 w-4" />, label: lang === "ar" ? "الملف الشخصي" : "Profile" },
                        { to: "/wishlist", icon: <Heart className="h-4 w-4" />, label: lang === "ar" ? "المفضلة" : "Wishlist" },
                        { to: "/journey", icon: <TrendingUp className="h-4 w-4" />, label: lang === "ar" ? "رحلتي" : "My Journey" },
                        ...(isAdmin ? [{ to: "/admin", icon: <Shield className="h-4 w-4" />, label: lang === "ar" ? "لوحة التحكم" : "Admin Panel" }] : []),
                        { to: "/support", icon: <Headphones className="h-4 w-4" />, label: lang === "ar" ? "الدعم الفني" : "Support", variant: "default" as const },
                        { to: "#", icon: <LogOut className="h-4 w-4" />, label: lang === "ar" ? "تسجيل الخروج" : "Sign Out", variant: "destructive" as const, onClick: () => { logout(); setUserMenuOpen(false); } },
                      ].map((item, idx) => (
                        <Link key={idx} to={item.to} role="menuitem" onClick={item.onClick} className={`flex items-center gap-2 px-4 py-3 text-[13px] transition-colors ${item.variant === "destructive" ? "text-destructive hover:bg-destructive/10" : "text-text-secondary hover:text-accent hover:bg-accent/5"}`}>
                          {item.icon}
                          {item.label}
                        </Link>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link to="/login">
                  <Button variant="ghost" size="sm" className="h-8 border border-border bg-transparent text-[13px] text-text-secondary hover:border-accent hover:bg-white/5 hover:text-foreground">
                    {lang === "ar" ? "تسجيل الدخول" : "Sign In"}
                  </Button>
                </Link>
                <Link to="/register">
                  <Button size="sm" className="h-8 btn-primary">{lang === "ar" ? "ابدأ مجاناً" : "Start Free"}</Button>
                </Link>
              </div>
            )}
          </div>

          {/* ── Mobile Hamburger ── */}
          <button className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-white/5 hover:text-foreground md:hidden" onClick={() => setMobileOpen(!mobileOpen)} aria-label={lang === "ar" ? "فتح القائمة" : "Toggle menu"} aria-expanded={mobileOpen}>
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      {/* ── Mobile Menu ── */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div ref={mobileMenuRef} role="dialog" aria-modal="true" aria-label={lang === "ar" ? "قائمة التنقل" : "Navigation menu"} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="fixed inset-0 z-40 md:hidden mobile-menu-backdrop">
            <div className="flex h-full flex-col items-center justify-center gap-6 pt-16">
              {[
                { path: "/", label: lang === "ar" ? "الرئيسية" : "Home" },
                { path: "/courses", label: lang === "ar" ? "الكورسات" : "Courses" },
                { path: "/references", label: lang === "ar" ? "المراجع" : "References" },
                { path: "/faq", label: lang === "ar" ? "الأسئلة الشائعة" : "FAQ" },
                ...(isAuthenticated ? [
                  { path: "/dashboard", label: lang === "ar" ? "لوحتي" : "Dashboard" },
                  { path: "/wishlist", label: lang === "ar" ? "المفضلة" : "Wishlist" },
                  { path: "/journey", label: lang === "ar" ? "رحلتي" : "My Journey" },
                  { path: "/documents", label: lang === "ar" ? "المستندات" : "Documents" },
                  { path: "/profile", label: lang === "ar" ? "الملف الشخصي" : "Profile" },
                  { path: "/support", label: lang === "ar" ? "الدعم" : "Support" },
                ] : []),
                ...(isAdmin ? [{ path: "/admin", label: lang === "ar" ? "التحكم" : "Admin" }] : []),
              ].map((link) => (
                <Link key={link.path} to={link.path} className={`text-2xl font-bold transition-colors ${isActive(link.path) ? "text-accent" : "text-text-secondary hover:text-foreground"}`}>
                  {link.label}
                </Link>
              ))}

              <div className="mt-6 flex flex-col items-center gap-3">
                <button onClick={() => setLang(lang === "en" ? "ar" : "en")} className="rounded-xl border border-border px-6 py-2.5 text-base font-medium text-text-secondary hover:border-accent hover:text-accent transition-colors">
                  {lang === "en" ? "العربية" : "English"}
                </button>
                {isAuthenticated ? (
                  <button onClick={() => { logout(); setMobileOpen(false); }} className="text-base font-medium text-destructive transition-colors hover:text-destructive/80">
                    {lang === "ar" ? "تسجيل الخروج" : "Sign Out"}
                  </button>
                ) : (
                  <Link to="/register" className="btn-primary">{lang === "ar" ? "ابدأ مجاناً" : "Start Free"}</Link>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
