import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { useContactSettings } from "@/hooks/useContactSettings";
import { Youtube, Linkedin, Mail, Facebook, Instagram, Twitter } from "lucide-react";

// Official Telegram brand mark (circular paper-plane logo)
const TelegramIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" role="img" aria-hidden="true">
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
  </svg>
);

// Official TikTok brand mark (musical note logo)
const TiktokIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" role="img" aria-hidden="true">
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1.04-.1z"/>
  </svg>
);

interface SocialLink {
  readonly icon: React.ReactNode;
  readonly href: string;
  readonly label: string;
}

function pushIfValid(out: SocialLink[], url: string | null | undefined, icon: React.ReactNode, label: string, hrefTransform?: (url: string) => string): void {
  if (!url || url === "#") return;
  out.push({ icon, href: hrefTransform ? hrefTransform(url) : url, label });
}

function buildSocialLinks(contact: {
  youtubeUrl?: string | null;
  linkedinUrl?: string | null;
  facebookUrl?: string | null;
  instagramUrl?: string | null;
  twitterUrl?: string | null;
  tiktokUrl?: string | null;
  telegramUrl?: string | null;
  email?: string | null;
}): SocialLink[] {
  const out: SocialLink[] = [];
  // Order mirrors the owner's requested lineup:
  // YouTube → Telegram → Facebook → Instagram → TikTok → Email
  pushIfValid(out, contact.youtubeUrl, <Youtube className="h-4 w-4" />, "YouTube");
  pushIfValid(out, contact.telegramUrl, <TelegramIcon className="h-4 w-4" />, "Telegram");
  pushIfValid(out, contact.facebookUrl, <Facebook className="h-4 w-4" />, "Facebook");
  pushIfValid(out, contact.instagramUrl, <Instagram className="h-4 w-4" />, "Instagram");
  pushIfValid(out, contact.tiktokUrl, <TiktokIcon className="h-4 w-4" />, "TikTok");
  pushIfValid(out, contact.linkedinUrl, <Linkedin className="h-4 w-4" />, "LinkedIn");
  pushIfValid(out, contact.twitterUrl, <Twitter className="h-4 w-4" />, "Twitter");
  pushIfValid(out, contact.email, <Mail className="h-4 w-4" />, "Email", (e) => `mailto:${e}`);
  return out;
}

// Solid official brand colors — buttons POP against the dark footer
// background instead of melting into it (owner request).
const SOLID_BRAND: Record<string, { bg: string; glow: string; fg?: string }> = {
  YouTube: { bg: "#FF0000", glow: "rgba(255,0,0,0.45)" },
  Telegram: { bg: "#229ED9", glow: "rgba(34,158,217,0.45)" },
  Facebook: { bg: "#1877F2", glow: "rgba(24,119,242,0.45)" },
  Instagram: { bg: "linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)", glow: "rgba(204,35,102,0.45)" },
  // TikTok's official black vanishes on the dark footer — use the inverted
  // (white/black) app-icon look so it stays unmissable.
  TikTok: { bg: "#ffffff", glow: "rgba(255,255,255,0.35)", fg: "#010101" },
  LinkedIn: { bg: "#0A66C2", glow: "rgba(10,102,194,0.45)" },
  Twitter: { bg: "#1DA1F2", glow: "rgba(29,161,242,0.45)" },
  Email: { bg: "#f97316", glow: "rgba(249,115,22,0.45)" },
};

export default function Footer() {
  const { lang } = useTranslation();
  const { data: contact } = useContactSettings();
  const currentYear = new Date().getFullYear();
  const [systemStatus, setSystemStatus] = useState<"checking" | "ok" | "down">("checking");

  // Live backend health check — powers the "All systems operational" badge
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      fetch("/api/health", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then(() => { if (!cancelled) setSystemStatus("ok"); })
        .catch(() => { if (!cancelled) setSystemStatus("down"); });
    };
    check();
    const interval = setInterval(check, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const tools = ["ETAP", "SKM PowerTools", "PowerFactory", "PVSyst", "AutoCAD Electrical", "MATLAB"];

  const links = {
    platform: [
      { label: lang === "ar" ? "الكورسات" : "Courses", to: "/courses" },
      { label: lang === "ar" ? "لوحتي" : "Dashboard", to: "/dashboard" },
      { label: lang === "ar" ? "الدعم الفني" : "Support", to: "/support" },
    ],
    legal: [
      { label: lang === "ar" ? "الشروط والأحكام" : "Terms of Service", to: "/terms" },
      { label: lang === "ar" ? "سياسة الخصوصية" : "Privacy Policy", to: "/privacy" },
      { label: lang === "ar" ? "سياسة الاسترداد" : "Refund Policy", to: "/refund" },
    ],
  };

  const socialLinks = buildSocialLinks(contact);

  return (
    <footer className="relative border-t border-border bg-background overflow-hidden">
      {/* Top ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px w-1/2 bg-gradient-to-r from-transparent via-accent/40 to-transparent" />

      {/* Background subtle pattern */}
      <div className="absolute inset-0 opacity-[0.02]" style={{ backgroundImage: 'radial-gradient(circle at 25% 50%, rgba(255,255,255,0.1) 0%, transparent 50%), radial-gradient(circle at 75% 50%, rgba(255,255,255,0.05) 0%, transparent 50%)' }} />

      <div className="relative mx-auto max-w-7xl px-4 lg:px-6">
        {/* ── Main grid ── */}
        <div className="grid gap-10 py-16 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand column */}
          <div className="lg:col-span-1">
            <Link to="/" className="group flex items-center gap-2.5">
              <img src="/logo.jpg" alt="Eng. Ahmed Elbaz Logo" className="h-12 w-auto object-contain rounded-xl transition-transform duration-300 group-hover:scale-105" />
              <div>
                <div className="text-[13px] font-extrabold text-foreground tracking-tight">
                  {lang === "ar" ? "أحمد الباز" : "Eng. Ahmed Elbaz"}
                </div>
                <div className="text-[10px] font-medium uppercase tracking-widest text-accent">
                  {lang === "ar" ? "هندسة كهربية" : "Electrical Engineering"}
                </div>
              </div>
            </Link>

            <p className="mt-4 text-[13px] leading-relaxed text-text-secondary">
              {lang === "ar"
                ? "منصة تعليمية متخصصة في برامج تصميم الطاقة الكهربية للمهندسين العرب."
                : "Specialized platform for power system design software, built for serious electrical engineers."}
            </p>

            {/* Social links — solid brand-colored buttons */}
            <div className="mt-5 flex items-center gap-3">
              {socialLinks.map((s) => {
                const brand = SOLID_BRAND[s.label];
                return (
                  <a
                    key={s.label}
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.label}
                    title={s.label}
                    style={{
                      background: brand?.bg,
                      boxShadow: `0 0 16px ${brand?.glow || "rgba(255,255,255,0.2)"}, inset 0 0 0 1px rgba(255,255,255,0.12)`,
                      color: brand?.fg || "#ffffff",
                    }}
                    className="flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-300 hover:scale-[1.15] hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {s.icon}
                  </a>
                );
              })}
            </div>
          </div>

          {/* Platform links */}
          <div>
            <h4 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-text-muted">
              {lang === "ar" ? "المنصة" : "Platform"}
            </h4>
            <ul className="space-y-3">
              {links.platform.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="text-[13px] text-text-secondary transition-colors duration-200 hover:text-accent">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal links */}
          <div>
            <h4 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-text-muted">
              {lang === "ar" ? "قانوني" : "Legal"}
            </h4>
            <ul className="space-y-3">
              {links.legal.map((l) => (
                <li key={l.label}>
                  <Link to={l.to} className="text-[13px] text-text-secondary transition-colors duration-200 hover:text-foreground">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Tools */}
          <div>
            <h4 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-text-muted">
              {lang === "ar" ? "البرامج التي ستتعلمها" : "Tools You'll Master"}
            </h4>
            <div className="flex flex-wrap gap-2">
              {tools.map((tool) => (
                <span
                  key={tool}
                  className="rounded-lg border border-border bg-primary px-2.5 py-1 text-[11px] font-medium text-text-secondary transition-all duration-200 hover:border-accent hover:text-foreground hover:shadow-[0_0_12px_rgba(249,115,22,0.15)]"
                >
                  {tool}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Bottom bar ── */}
        <div className="flex flex-col items-center justify-between gap-3 border-t border-border py-6 sm:flex-row">
          <p className="text-[12px] text-text-secondary">
            © {currentYear}{" "}
            <span className="text-foreground font-medium">
              {lang === "ar" ? "أحمد الباز" : "Ahmed Elbaz"}
            </span>
            {lang === "ar" ? " — جميع الحقوق محفوظة" : " — All rights reserved."}
          </p>
          <div className="flex items-center gap-2 text-[11px] text-text-muted">
            <div className={`h-1.5 w-1.5 rounded-full ${systemStatus === "ok" ? "bg-emerald-500 animate-pulse" : systemStatus === "down" ? "bg-amber-500" : "bg-text-faint"}`} />
            {lang === "ar"
              ? (systemStatus === "down" ? "بعض الأنظمة تعاني من بطء — تحاول مجدداً" : "جميع الأنظمة تعمل")
              : (systemStatus === "down" ? "Degraded — retrying" : "All systems operational")}
          </div>
        </div>
      </div>
    </footer>
  );
}
