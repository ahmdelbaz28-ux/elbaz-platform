import { Link, useLocation } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { Home, BookOpen, LayoutDashboard, User, LogIn, FileBox } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface NavTab {
  readonly path: string;
  readonly icon: LucideIcon;
  readonly label: string;
}

function buildTabs(isAuthenticated: boolean, lang: "ar" | "en"): readonly NavTab[] {
  if (isAuthenticated) {
    return [
      { path: "/", icon: Home, label: lang === "ar" ? "الرئيسية" : "Home" },
      { path: "/courses", icon: BookOpen, label: lang === "ar" ? "الكورسات" : "Courses" },
      { path: "/references", icon: FileBox, label: lang === "ar" ? "المراجع" : "Refs" },
      { path: "/dashboard", icon: LayoutDashboard, label: lang === "ar" ? "لوحتي" : "Dashboard" },
      { path: "/profile", icon: User, label: lang === "ar" ? "حسابي" : "Profile" },
    ];
  }
  return [
    { path: "/", icon: Home, label: lang === "ar" ? "الرئيسية" : "Home" },
    { path: "/courses", icon: BookOpen, label: lang === "ar" ? "الكورسات" : "Courses" },
    { path: "/references", icon: FileBox, label: lang === "ar" ? "المراجع" : "Refs" },
    { path: "/login", icon: LogIn, label: lang === "ar" ? "دخول" : "Login" },
  ];
}

function NavTabLink({ tab, active }: { readonly tab: NavTab; readonly active: boolean }) {
  const Icon = tab.icon;
  return (
    <Link
      key={tab.path}
      to={tab.path}
      aria-current={active ? "page" : undefined}
      className="relative flex flex-col items-center gap-0.5 px-3 py-1.5 min-w-[60px] outline-none focus-visible:ring-2 focus-visible:ring-[#06b6d4] focus-visible:rounded-lg"
    >
      {/* Active indicator dot */}
      {active && (
        <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 h-1 w-6 rounded-full bg-[#06b6d4]" />
      )}

      <div
        className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-200 ${
          active
            ? "bg-[rgba(6,182,212,0.15)] text-[#06b6d4] scale-110"
            : "text-[#475569]"
        }`}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.5 : 2} />
      </div>

      <span
        className={`text-[10px] font-medium transition-colors duration-200 ${
          active ? "text-[#06b6d4]" : "text-[#475569]"
        }`}
      >
        {tab.label}
      </span>
    </Link>
  );
}

export default function MobileBottomNav() {
  const { lang } = useTranslation();
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  // Don't show on auth pages or when loading
  if (location.pathname === "/login" || location.pathname === "/register") return null;

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  const tabs = buildTabs(isAuthenticated, lang);

  return (
    <nav
      aria-label={lang === "ar" ? "التنقل السفلي" : "Bottom navigation"}
      className="mobile-bottom-nav fixed bottom-0 left-0 right-0 z-50 md:hidden transform-gpu will-change-transform"
    >
      {/* Ambient top glow line */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px w-1/3 bg-gradient-to-r from-transparent via-[rgba(6,182,212,0.4)] to-transparent" />

      <div className="flex items-center justify-around px-2 pt-2 pb-[env(safe-area-inset-bottom,8px)]"
        style={{ background: "rgba(7,11,18,0.92)", backdropFilter: "blur(20px) saturate(1.8)" }}
      >
        {tabs.map((tab) => (
          <NavTabLink key={tab.path} tab={tab} active={isActive(tab.path)} />
        ))}
      </div>
    </nav>
  );
}
