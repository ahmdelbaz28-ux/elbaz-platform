import { Link } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { Zap, Youtube, Linkedin, Mail, Phone } from "lucide-react";

export default function Footer() {
  const { lang } = useTranslation();
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
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#06b6d4] to-[#0284c7] shadow-[0_0_16px_rgba(6,182,212,0.3)]">
                <Zap className="h-4 w-4 text-white" strokeWidth={2.5} />
              </div>
              <div>
                <div className="text-[13px] font-extrabold text-[#e8f0fe]">
                  {lang === "ar" ? "أحمد الباز" : "Eng. Ahmed Elbaz"}
                </div>
                <div className="text-[10px] font-medium uppercase tracking-widest text-[#06b6d4]">
                  {lang === "ar" ? "هندسة كهربية" : "Electrical Engineering"}
                </div>
              </div>
            </Link>

            <p className="mt-4 text-[13px] leading-relaxed text-[#64748b]">
              {lang === "ar"
                ? "منصة تعليمية متخصصة في برامج تصميم الطاقة الكهربية للمهندسين العرب."
                : "Specialized platform for power system design software, built for serious electrical engineers."}
            </p>

            {/* Social links */}
            <div className="mt-5 flex items-center gap-3">
              {[
                { icon: <Youtube className="h-4 w-4" />, href: "#", label: "YouTube" },
                { icon: <Linkedin className="h-4 w-4" />, href: "#", label: "LinkedIn" },
                { icon: <Mail className="h-4 w-4" />, href: "mailto:contact@ahmedelbaz.com", label: "Email" },
              ].map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  aria-label={s.label}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#1e2d3d] bg-[#0d1420] text-[#64748b] transition-all hover:border-[#06b6d4] hover:text-[#06b6d4]"
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
          <p className="text-[12px] text-[#475569]">
            © {currentYear}{" "}
            <span className="text-[#64748b]">
              {lang === "ar" ? "أحمد الباز" : "Ahmed Elbaz"}
            </span>
            {lang === "ar" ? " — جميع الحقوق محفوظة" : " — All rights reserved."}
          </p>
          <div className="flex items-center gap-2 text-[11px] text-[#475569]">
            <div className="h-1.5 w-1.5 rounded-full bg-[#10b981] pulse-glow" />
            {lang === "ar" ? "جميع الأنظمة تعمل" : "All systems operational"}
          </div>
        </div>
      </div>
    </footer>
  );
}
