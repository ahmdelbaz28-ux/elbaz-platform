import { Link } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { useContactSettings } from "@/hooks/useContactSettings";
import Logo3D from "@/components/Logo3D";
import { Youtube, Linkedin, Mail, Facebook, Instagram, Twitter } from "lucide-react";

const TiktokIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1.04-.1z"/>
  </svg>
);

const BRAND_COLORS: Record<string, string> = {
  YouTube: "hover:border-[#FF0000] hover:text-[#FF0000] hover:bg-[rgba(255,0,0,0.1)] hover:shadow-[0_0_15px_rgba(255,0,0,0.3)]",
  LinkedIn: "hover:border-[#0A66C2] hover:text-[#0A66C2] hover:bg-[rgba(10,102,194,0.1)] hover:shadow-[0_0_15px_rgba(10,102,194,0.3)]",
  Facebook: "hover:border-[#1877F2] hover:text-[#1877F2] hover:bg-[rgba(24,119,242,0.1)] hover:shadow-[0_0_15px_rgba(24,119,242,0.3)]",
  Instagram: "hover:border-[#E1306C] hover:text-[#E1306C] hover:bg-[rgba(225,48,108,0.1)] hover:shadow-[0_0_15px_rgba(225,48,108,0.3)]",
  Twitter: "hover:border-[#e8f0fe] hover:text-[#e8f0fe] hover:bg-[rgba(232,240,254,0.1)] hover:shadow-[0_0_15px_rgba(232,240,254,0.3)]",
  TikTok: "hover:border-[#00f2fe] hover:text-[#00f2fe] hover:bg-[rgba(0,242,254,0.1)] hover:shadow-[0_0_15px_rgba(0,242,254,0.3)]",
  Email: "hover:border-[#06b6d4] hover:text-[#06b6d4] hover:bg-[rgba(6,182,212,0.1)] hover:shadow-[0_0_15px_rgba(6,182,212,0.3)]",
};

export default function Footer() {
  const { lang } = useTranslation();
  const { data: contact } = useContactSettings();
  const currentYear = new Date().getFullYear();

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

  // Build social links from dynamic settings — only include non-empty, non-"#" URLs
  const socialLinks: { icon: React.ReactNode; href: string; label: string }[] = [];

  if (contact.youtubeUrl && contact.youtubeUrl !== "#") {
    socialLinks.push({ icon: <Youtube className="h-4 w-4" />, href: contact.youtubeUrl, label: "YouTube" });
  }
  if (contact.linkedinUrl && contact.linkedinUrl !== "#") {
    socialLinks.push({ icon: <Linkedin className="h-4 w-4" />, href: contact.linkedinUrl, label: "LinkedIn" });
  }
  if (contact.facebookUrl && contact.facebookUrl !== "#") {
    socialLinks.push({ icon: <Facebook className="h-4 w-4" />, href: contact.facebookUrl, label: "Facebook" });
  }
  if (contact.instagramUrl && contact.instagramUrl !== "#") {
    socialLinks.push({ icon: <Instagram className="h-4 w-4" />, href: contact.instagramUrl, label: "Instagram" });
  }
  if (contact.twitterUrl && contact.twitterUrl !== "#") {
    socialLinks.push({ icon: <Twitter className="h-4 w-4" />, href: contact.twitterUrl, label: "Twitter" });
  }
  if (contact.tiktokUrl && contact.tiktokUrl !== "#") {
    socialLinks.push({ icon: <TiktokIcon className="h-4 w-4" />, href: contact.tiktokUrl, label: "TikTok" });
  }
  if (contact.email) {
    socialLinks.push({ icon: <Mail className="h-4 w-4" />, href: `mailto:${contact.email}`, label: "Email" });
  }

  return (
    <footer className="relative border-t border-[#1e2d3d] bg-[#070b12]">
      {/* Top ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px w-1/2 bg-gradient-to-r from-transparent via-[rgba(6,182,212,0.3)] to-transparent" />

      <div className="mx-auto max-w-7xl px-4 lg:px-6">
        {/* ── Main grid ── */}
        <div className="grid gap-10 py-16 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand column */}
          <div className="lg:col-span-1">
            <Link to="/" className="flex items-center gap-2.5">
              <Logo3D size="lg" interactive={true} />
              <div>
                <div className="footer-glow-text text-[13px] font-extrabold text-[#e8f0fe]">
                  {lang === "ar" ? "أحمد الباز" : "Eng. Ahmed Elbaz"}
                </div>
                <div className="footer-glow-text text-[10px] font-medium uppercase tracking-widest text-[#06b6d4]">
                  {lang === "ar" ? "هندسة كهربية" : "Electrical Engineering"}
                </div>
              </div>
            </Link>

            <p className="footer-glow-text mt-4 text-[13px] leading-relaxed text-[#64748b]">
              {lang === "ar"
                ? "منصة تعليمية متخصصة في برامج تصميم الطاقة الكهربية للمهندسين العرب."
                : "Specialized platform for power system design software, built for serious electrical engineers."}
            </p>

            {/* Social links */}
            <div className="mt-5 flex items-center gap-3">
              {socialLinks.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  className={`flex h-10 w-10 items-center justify-center rounded-lg border border-[#1e2d3d] bg-[#0d1420] text-[#64748b] transition-all duration-300 ${BRAND_COLORS[s.label] || "hover:border-[#06b6d4] hover:text-[#06b6d4]"}`}
                >
                  {s.icon}
                </a>
              ))}
            </div>
          </div>

          {/* Platform links */}
          <div>
            <h4 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-[#475569]">
              {lang === "ar" ? "المنصة" : "Platform"}
            </h4>
            <ul className="space-y-3">
              {links.platform.map((l) => (
                <li key={l.to}>
                  <Link
                    to={l.to}
                    className="text-[13px] text-[#64748b] transition-colors hover:text-[#06b6d4]"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal links */}
          <div>
            <h4 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-[#475569]">
              {lang === "ar" ? "قانوني" : "Legal"}
            </h4>
            <ul className="space-y-3">
              {links.legal.map((l) => (
                <li key={l.label}>
                  <Link
                    to={l.to}
                    className="text-[13px] text-[#64748b] transition-colors hover:text-[#94a3b8]"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Tools */}
          <div>
            <h4 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-[#475569]">
              {lang === "ar" ? "البرامج التي ستتعلمها" : "Tools You'll Master"}
            </h4>
            <div className="flex flex-wrap gap-2">
              {tools.map((tool) => (
                <span
                  key={tool}
                  className="rounded-md border border-[#1e2d3d] bg-[#0d1420] px-2.5 py-1 text-[11px] font-medium text-[#64748b] transition-colors hover:border-[rgba(6,182,212,0.3)] hover:text-[#94a3b8]"
                >
                  {tool}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Bottom bar ── */}
        <div className="flex flex-col items-center justify-between gap-3 border-t border-[#1e2d3d] py-6 sm:flex-row">
          <p className="footer-glow-text text-[12px] text-[#475569]">
            © {currentYear}{" "}
            <span className="text-[#64748b]">
              {lang === "ar" ? "أحمد الباز" : "Ahmed Elbaz"}
            </span>
            {lang === "ar" ? " — جميع الحقوق محفوظة" : " — All rights reserved."}
          </p>
          <div className="flex items-center gap-2 text-[11px] text-[#475569]">
            <div className="h-1.5 w-1.5 rounded-full bg-[#10b981] animate-pulse" />
            {lang === "ar" ? "جميع الأنظمة تعمل" : "All systems operational"}
          </div>
        </div>
      </div>
    </footer>
  );
}
