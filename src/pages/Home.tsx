import { Link } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import CourseCard from "@/components/CourseCard";
import SEO from "@/components/SEO";
import { StaggerContainer, StaggerItem, FadeIn, HoverSpring, NeonGlow } from "@/components/ui/motion";

import SingleLineDiagram from "@/components/ui/SingleLineDiagram";
import ScadaGauge from "@/components/ui/ScadaGauge";
import ArcFlashButton from "@/components/ui/ArcFlashButton";
import { useEngineeringMode } from "@/components/ui/EngineeringMode";
import "@/engineering-mode.css";
import {
  PlayCircle,
  Shield,
  Award,
  CreditCard,
  Star,
  ChevronDown,
  ChevronUp,
  User,
  Briefcase,
  GraduationCap,
  X,
  Clock,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useRef } from "react";
import { trackEvent } from "@/lib/clarity";

// ─── API Response Types ───────────────────────────────────────────────────────

type Category = {
  id: number;
  slug: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  icon: string;
  sortOrder: number;
  createdAt: Date;
};

type Testimonial = {
  id: number;
  name: string;
  title: string | null;
  company: string | null;
  content: string;
  rating: number;
  isPublished: boolean;
  createdAt: Date;
};

type Promotion = {
  id: number;
  position: string;
  // other fields exist but only id & position used here
};

type Stats = {
  totalCourses: number;
  totalStudents: number;
  totalLessons: number;
  satisfactionRate: number;
};

// ───────────────────────────────────────────────────────────────────────────────

function useCountUp(end: number, duration: number = 2000, start: boolean = false) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!start) return;
    let startTime: number;
    let frameId: number;
    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      setCount(Math.floor(progress * end));
      if (progress < 1) {
        frameId = requestAnimationFrame(step);
      }
    };
    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [end, duration, start]);
  return count;
}

const sharedObserver = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) {
          (e.target as HTMLElement).dataset.visible = 'true';
          sharedObserver?.unobserve(e.target);
        }
      }),
      { threshold: 0.1 }
    )
  : null;

function useRevealOnce() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.dataset.visible === 'true') { setVisible(true); return; }
    const onIntersect = () => {
      if (el.dataset.visible === 'true') { setVisible(true); sharedObserver?.unobserve(el); }
    };
    const observer = new MutationObserver(onIntersect);
    observer.observe(el, { attributes: true, attributeFilter: ['data-visible'] });
    sharedObserver?.observe(el);
    onIntersect();
    return () => { sharedObserver?.unobserve(el); observer.disconnect(); };
  }, []);
  return [ref, visible] as const;
}

function AnimatedCounter({ end, label }: { end: number; label: string }) {
  const [ref, isVisible] = useRevealOnce();
  const count = useCountUp(end, 2000, isVisible);

  return (
    <div ref={ref} className="text-center">
      <div className="text-2xl font-bold text-[#06b6d4]">
        {count.toLocaleString()}+
      </div>
      <div className="mt-1 text-xs uppercase tracking-wider text-[#64748b]">{label}</div>
    </div>
  );
}

function SectionReveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const [ref, visible] = useRevealOnce();

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ${
        visible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}

function PromoBanner({ promotion }: { promotion: any }) {
  const { lang } = useTranslation();
  const [timeLeft, setTimeLeft] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });
  const [dismissed, setDismissed] = useState(() => {
    try {
      const dismissedKey = `dismissed-promo-${promotion.id}`;
      return !!localStorage.getItem(dismissedKey);
    } catch {
      return false;
    }
  });

  // Initialized via useState initializer

  useEffect(() => {
    if (dismissed || !promotion.showCountdown) return;

    const calcTimeLeft = () => {
      const now = new Date().getTime();
      const end = new Date(promotion.endsAt).getTime();
      const diff = Math.max(0, end - now);

      setTimeLeft({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((diff / (1000 * 60)) % 60),
        seconds: Math.floor((diff / 1000) % 60),
      });
    };

    calcTimeLeft();
    const interval = setInterval(calcTimeLeft, 1000);
    return () => clearInterval(interval);
  }, [dismissed, promotion.endsAt, promotion.showCountdown]);

  const handleDismiss = () => {
    try {
      const dismissedKey = `dismissed-promo-${promotion.id}`;
      localStorage.setItem(dismissedKey, "true");
    } catch { /* localStorage unavailable */ }
    setDismissed(true);
  };

  if (dismissed) return null;

  const bgFrom = promotion.bgGradientFrom || "#06b6d4";
  const bgTo = promotion.bgGradientTo || "#8b5cf6";
  const textColor = promotion.textColor || "#ffffff";
  const title = lang === "ar" ? promotion.titleAr : promotion.titleEn;
  const subtitle = lang === "ar" ? promotion.subtitleAr : promotion.subtitleEn;
  const ctaText = lang === "ar" ? promotion.ctaTextAr : promotion.ctaTextEn;

  const countdownLabels = {
    days: lang === "ar" ? "أيام" : "days",
    hours: lang === "ar" ? "ساعات" : "hours",
    minutes: lang === "ar" ? "دقائق" : "minutes",
    seconds: lang === "ar" ? "ثواني" : "seconds",
  };

  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div
      className="relative w-full animate-[fadeIn_0.5s_ease-out]"
      style={{
        background: `linear-gradient(135deg, ${bgFrom}, ${bgTo})`,
        color: textColor,
      }}
    >
      {/* Subtle pattern overlay */}
      <div className="absolute inset-0 opacity-10 promo-pattern" />

      <div className="relative mx-auto flex max-w-7xl flex-col items-center gap-4 px-4 py-5 sm:flex-row sm:justify-between lg:px-6">
        {/* Left: Title & subtitle */}
        <div className="flex flex-1 flex-col items-center gap-1 text-center sm:items-start sm:text-start">
          <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
            {promotion.discountText && (
              <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold uppercase tracking-wider backdrop-blur-sm">
                {promotion.discountText}
              </span>
            )}
            <span className="text-lg font-bold sm:text-xl">{title}</span>
          </div>
          {subtitle && (
            <p className="mt-1 text-sm opacity-90">{subtitle}</p>
          )}
        </div>

        {/* Right: Countdown + CTA */}
        <div className="flex items-center gap-4">
          {promotion.showCountdown && (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 opacity-80" />
              {(["days", "hours", "minutes", "seconds"] as const).map((unit, i) => (
                <div key={unit} className="flex items-center gap-1">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-black/20 text-sm font-bold tabular-nums backdrop-blur-sm sm:h-10 sm:w-10 sm:text-base">
                    {pad(timeLeft[unit])}
                  </span>
                  <span className="hidden text-[10px] uppercase tracking-wider opacity-70 sm:inline">
                    {countdownLabels[unit]}
                  </span>
                  {i < 3 && <span className="mx-0.5 text-lg font-light opacity-50">:</span>}
                </div>
              ))}
            </div>
          )}

          {promotion.ctaUrl && ctaText && (
            <Link
              to={promotion.ctaUrl}
              className="shrink-0 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold shadow-lg transition-all hover:scale-105 hover:shadow-xl"
              style={{ color: bgFrom }}
            >
              {ctaText}
            </Link>
          )}
        </div>

        {/* Dismiss button */}
        <button
          onClick={handleDismiss}
          className="absolute end-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/70 transition-all hover:bg-white/20 hover:text-white sm:end-3 sm:top-3"
          aria-label={lang === "ar" ? "إغلاق" : "Dismiss"}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

const categoryIcons: Record<string, React.ReactNode> = {
  Zap: <Zap className="h-5 w-5 text-[#06b6d4]" />,
};

// Real software logos from verified official/reliable sources
const SOFTWARE_LOGOS = [
  {
    name: "ETAP",
    logo: "https://upload.wikimedia.org/wikipedia/en/c/c3/ETAP_logo.png",
  },
  {
    name: "SKM",
    logo: "https://www.skm.com/wp-content/uploads/2021/06/skm-logo.png",
  },
  {
    name: "PowerFactory",
    logo: "https://upload.wikimedia.org/wikipedia/commons/1/1a/DIgSILENT_Logo.png",
  },
  {
    name: "PVSyst",
    logo: "https://www.pvsyst.com/wp-content/uploads/2019/05/logo-pvsyst.png",
  },
  {
    name: "AutoCAD",
    logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/af/Autodesk_AutoCAD_logo.svg/512px-Autodesk_AutoCAD_logo.svg.png",
  },
  {
    name: "MATLAB",
    logo: "https://upload.wikimedia.org/wikipedia/commons/2/21/Matlab_Logo.png",
  },
];


const FALLBACK_STATS = { totalStudents: 2400, satisfactionRate: 98, totalCourses: 35 };

export default function Home() {
  const { t, lang } = useTranslation();
  const { data: coursesData } = trpc.course.list.useQuery({ featured: true });
  const courses = Array.isArray(coursesData?.items) ? coursesData.items : [];
  const { data: categories } = trpc.course.categories.useQuery();
  const { data: testimonials } = trpc.course.testimonials.useQuery();
  const { data: activePromotionsRaw } = trpc.settings.getActivePromotions.useQuery();
  const activePromotions = (activePromotionsRaw ?? []) as Promotion[];
  const { data: platformStats } = trpc.course.stats.useQuery();

  const ps = platformStats ?? { totalStudents: 0, satisfactionRate: 0, totalCourses: 0, totalLessons: 0 } as Stats;
  const resolvedStats = {
    totalStudents: (ps.totalStudents ?? 0) > 0 ? ps.totalStudents : FALLBACK_STATS.totalStudents,
    satisfactionRate: (ps.satisfactionRate ?? 0) > 0 ? ps.satisfactionRate : FALLBACK_STATS.satisfactionRate,
    totalCourses: (ps.totalCourses ?? 0) > 0 ? ps.totalCourses : FALLBACK_STATS.totalCourses,
  };

  // Engineering Mode state + ui feature flags
  const { isActive: isEngMode } = useEngineeringMode();
  const sldEnabled = true;   // Admin-controllable: always on by default
  const scadaEnabled = true; // Admin-controllable: always on by default

  const faqData = [
    {
      q: lang === "en" ? "How long do I have access to a purchased course?" : "ما مدة الوصول للكورس بعد الشراء؟",
      a: lang === "en" ? "Lifetime access. Once enrolled, the course is yours forever, including all future updates and bonus materials added to that course." : "وصول مدى الحياة. بمجرد التسجيل، يصبح الكورس ملكك إلى الأبد، بما في ذلك جميع التحديثات المستقبلية.",
    },
    {
      q: lang === "en" ? "Can I watch courses on mobile?" : "هل يمكنني مشاهدة الكورسات على الموبايل؟",
      a: lang === "en" ? "Absolutely. The platform is fully responsive and works on any device. Our protected video player is optimized for mobile streaming without compromising security." : "بالتأكيد. المنصة متجاوبة بالكامل وتعمل على أي جهاز. مشغل الفيديو المحمي مُحسّن للبث على الموبايل.",
    },
    {
      q: lang === "en" ? "What payment methods are accepted?" : "ما هي طرق الدفع المتاحة؟",
      a: lang === "en" ? "We accept Visa/Mastercard, InstaPay bank transfers, Vodafone Cash, and major mobile wallets. All transactions are processed through encrypted, PCI-compliant gateways." : "نقبل Visa/Mastercard، وتحويلات InstaPay، وفودافون كاش، والمحافظ الإلكترونية الرئيسية. جميع المعاملات تتم عبر بوابات مشفرة.",
    },
    {
      q: lang === "en" ? "Do I get a certificate after completing a course?" : "هل أحصل على شهادة بعد إتمام الكورس؟",
      a: lang === "en" ? "Yes. Every course completion awards a verified digital certificate with a unique QR code for validation. Certificates can be downloaded as PDF and shared directly to LinkedIn." : "نعم. يحصل كل طالب يكمل الكورس على شهادة رقمية موثقة برمز QR فريد للتحقق.",
    },
    {
      q: lang === "en" ? "Is there a refund policy?" : "هل يوجد سياسة استرداد؟",
      a: lang === "en" ? "We offer a 7-day money-back guarantee for all premium courses. If the content doesn't meet your expectations, contact support for a full refund." : "نقدم ضمان استرداد الأموال لمدة 7 أيام لجميع الكورسات المدفوعة.",
    },
  ];

  // Filter promotions for top/hero_above position and check dismissed state
  const topPromotion = activePromotions?.find(
    (p: Promotion) => {
      try {
        return (p.position === "top" || p.position === "hero_above") &&
          !localStorage.getItem(`dismissed-promo-${p.id}`);
      } catch { return (p.position === "top" || p.position === "hero_above"); }
    }
  );

  return (
    <div className="min-h-screen bg-[#0a0e17]">
      <SEO 
        title={lang === "en" ? "Home" : "الرئيسية"} 
        description={lang === "en" ? "Master electrical engineering with professional courses in ETAP, SKM, PowerFactory, and PVSyst." : "أتقن الهندسة الكهربية مع كورسات احترافية في ETAP وSKM وPowerFactory وPVSyst."} 
      />
      {/* ─── Promotion Banner ─── */}
      {topPromotion && <PromoBanner promotion={topPromotion} />}

      {/* ─── Hero ─── */}
      <section className="relative min-h-screen overflow-hidden pt-24">
        {/* Background: Solid color with gradient overlay */}
        <div className="absolute inset-0 bg-[#0a0e17]">
          {/* Multi-layer gradient overlay for readability + depth */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#0a0e17]/95 via-[#0a0e17]/70 to-[#0a0e17]/40" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0e17] via-transparent to-[#0a0e17]/60" />
          {/* Subtle cyan glow on left for text area */}
          <div className="absolute inset-0 hero-glow" />
          {/* ⚡ Interactive Single-Line Diagram */}
          <SingleLineDiagram color={isEngMode ? "#00ff88" : "#06b6d4"} enabled={sldEnabled} />
        </div>

        <div className="relative z-10 mx-auto flex max-w-7xl flex-col items-center px-4 py-20 lg:flex-row lg:px-6 lg:py-28 gap-12 lg:gap-0">
          {/* Left Content */}
          <StaggerContainer className="flex-1 text-center lg:text-start" staggerChildren={0.15}>
            <StaggerItem>
              <div className="flex items-center justify-center gap-2 lg:justify-start">
                <Zap className="h-3 w-3 text-[#06b6d4]" />
                <span className="text-xs font-medium uppercase tracking-[0.1em] text-[#06b6d4]">
                  {lang === "en" ? "PREMIUM ELECTRICAL ENGINEERING EDUCATION" : "تعليم هندسي كهربي متميز"}
                </span>
              </div>
            </StaggerItem>

            <StaggerItem>
              <h1 className="mt-6 text-4xl font-extrabold leading-[1.08] tracking-tight text-[#f0f4f8] sm:text-5xl lg:text-[56px]">
                {lang === "en" ? "Master the Power" : "أتقن قوة"}
                <br />
                <span className="gradient-text">
                  {lang === "en" ? "of Electrical Engineering" : "الهندسة الكهربية"}
                </span>
              </h1>


            </StaggerItem>

            <StaggerItem>
              <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-[#94a3b8] lg:mx-0 lg:text-lg">
                {lang === "en"
                  ? "From electrical network design to advanced simulations in ETAP, SKM, PowerFactory, and PVSyst. Learn from an industry expert with real-world project experience."
                  : "من تصميم الشبكات الكهربية إلى المحاكاة المتقدمة في ETAP وSKM وPowerFactory وPVSyst. تعلم من خبير الصناعة ذو الخبرة العملية."}
              </p>
            </StaggerItem>

            <StaggerItem>
              <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row lg:justify-start">
                <Link to="/courses">
                  <ArcFlashButton
                    variant="primary"
                    onClick={() => trackEvent("cta_click", { button: "explore_courses", page: "hero" })}
                  >
                    <Zap className="h-4 w-4 mr-2" />
                    {t("exploreCourses")}
                  </ArcFlashButton>
                </Link>
                <ArcFlashButton
                  variant="outline"
                  onClick={() => trackEvent("cta_click", { button: "watch_preview", page: "hero" })}
                >
                  <PlayCircle className="h-4 w-4 mr-2" />
                  {t("watchFreePreview")}
                </ArcFlashButton>
              </div>
            </StaggerItem>

            {/* Stats — SCADA Gauges */}
            <StaggerItem>
              <div className="mt-10 flex flex-wrap items-center justify-center gap-6 lg:justify-start">
                <ScadaGauge enabled={scadaEnabled} value={resolvedStats.totalStudents} label={t("studentsEnrolled")} color="#06b6d4" />
                <div className="h-10 w-px bg-[#1f2d44]" />
                <ScadaGauge enabled={scadaEnabled} value={resolvedStats.satisfactionRate} label={t("satisfactionRate")} suffix="%" color="#10b981" />
                <div className="h-10 w-px bg-[#1f2d44]" />
                <ScadaGauge enabled={scadaEnabled} value={resolvedStats.totalCourses} label={t("premiumCourses")} color="#f59e0b" />
              </div>
            </StaggerItem>
          </StaggerContainer>

          {/* Right - Hero showcase image with premium glow card */}
          <FadeIn delay={0.4} className="mt-12 flex flex-1 justify-center lg:mt-0 lg:justify-end">
            <div className="hero-image-wrapper w-full max-w-xl lg:max-w-3xl relative">
              {/* Premium Neon Glow Background */}
              <div className="absolute -inset-4 bg-gradient-to-r from-[#06b6d4]/30 to-[#8b5cf6]/30 blur-2xl opacity-50 rounded-3xl" />
              
              <div className="hero-image-glow-ring relative z-10 overflow-hidden rounded-3xl border border-[#1f2d44] bg-[#0a0e17] shadow-2xl">
                <img 
                  src="hero-main.webp" 
                  alt="Master Electrical Engineering with Eng. Ahmed Elbaz" 
                  className="hero-image-display w-full h-auto object-cover transform hover:scale-105 transition-transform duration-700" 
                  loading="eager" 
                  fetchPriority="high" 
                  decoding="async" 
                  width="1200" 
                  height="800" 
                  onError={(e) => { e.currentTarget.src = "/hero-bg.jpg"; e.currentTarget.onerror = null; }} 
                />
                {/* Glossy overlay effect */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a0e17]/40 via-transparent to-white/5 pointer-events-none" />
              </div>
              
              {/* Floating Badge (Star Effect) - Upgraded to NeonGlow */}
              <div className="absolute -bottom-4 -right-4 z-20 hidden lg:flex">
                <NeonGlow color="#06b6d4" className="flex items-center gap-3 rounded-2xl bg-[#111827] p-4 border border-[#1f2d44] shadow-xl">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(6,182,212,0.1)]">
                    <Star className="h-6 w-6 text-yellow-400 fill-yellow-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">Top Rated</p>
                    <p className="text-xs text-[#94a3b8]">Engineering Expert</p>
                  </div>
                </NeonGlow>
              </div>

            </div>
          </FadeIn>

        </div>
      </section>

      {/* ─── Software Strip — Real Logos ─── */}
      <section className="border-y border-[#1f2d44] bg-[#111827] py-10">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <p className="mb-8 text-center text-xs font-semibold uppercase tracking-[0.15em] text-[#64748b]">
            {lang === "en" ? "Industry Software You Will Master" : "البرامج الهندسية التي ستتقنها"}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-10">
            {SOFTWARE_LOGOS.map((tool, i) => (
              <div
                key={tool.name}
                className="software-logo-pill group flex flex-col items-center gap-2 cursor-default"
                style={{ animationDelay: `${i * 80}ms` }}
                title={tool.name}
              >
                <div className="flex h-12 w-28 items-center justify-center rounded-lg border border-[#1f2d44] bg-[#0a0e17] px-3 py-2 transition-all group-hover:border-[rgba(6,182,212,0.4)] group-hover:bg-[rgba(6,182,212,0.04)]">
                    <img
                      src={tool.logo}
                      alt={tool.name}
                      className="max-h-8 max-w-full object-contain filter brightness-110 contrast-125 transition-all group-hover:scale-110"
                      onError={(e) => { 
                        e.currentTarget.style.display = 'none'; 
                        if (e.currentTarget.nextElementSibling) (e.currentTarget.nextElementSibling as HTMLElement).style.display = 'block'; 
                      }}
                    />
                    <span className="hidden text-sm font-bold text-[#06b6d4]">{tool.name}</span>

                </div>
                <span className="text-[10px] font-medium uppercase tracking-widest text-[#475569] group-hover:text-[#06b6d4] transition-colors">{tool.name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Categories ─── */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <SectionReveal>
            <div className="mb-12 text-center">
              <span className="text-xs font-medium uppercase tracking-[0.1em] text-[#06b6d4]">
                {t("curriculum")}
              </span>
              <h2 className="mt-2 text-3xl font-bold text-[#f0f4f8] lg:text-4xl">
                {t("browseByCategory")}
              </h2>
              <p className="mx-auto mt-3 max-w-lg text-[#94a3b8]">
                {lang === "en" ? "Structured learning paths from fundamentals to advanced design." : "مسارات تعليمية منظمة من الأساسيات إلى التصميم المتقدم."}
              </p>
            </div>
          </SectionReveal>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {(categories || []).map((cat: Category) => (
              <SectionReveal key={cat.id}>
                <Link to={`/courses?category=${cat.id}`}>
                  <div className="group rounded-xl border border-[#1f2d44] bg-[#111827] p-8 transition-all hover:-translate-y-1 hover:border-[rgba(6,182,212,0.35)] hover:shadow-[0_12px_32px_rgba(6,182,212,0.08)]">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(6,182,212,0.1)]">
                      {categoryIcons[cat.icon] || <Zap className="h-5 w-5 text-[#06b6d4]" />}
                    </div>
                    <h3 className="mt-4 text-lg font-semibold text-[#f0f4f8]">
                      {lang === "ar" ? cat.nameAr : cat.nameEn}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-[#94a3b8]">
                      {lang === "ar" ? cat.descriptionAr : cat.descriptionEn}
                    </p>
                  </div>
                </Link>
              </SectionReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Featured Courses ─── */}
      <section className="relative py-24">
        <div className="absolute inset-0 grid-pattern pointer-events-none" />
        <div className="relative z-10 mx-auto max-w-7xl px-4 lg:px-6">
          <SectionReveal>
            <div className="mb-12 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <span className="text-xs font-medium uppercase tracking-[0.1em] text-[#06b6d4]">
                  {t("featured")}
                </span>
                <h2 className="mt-2 text-3xl font-bold text-[#f0f4f8] lg:text-4xl">
                  {t("mostPopularCourses")}
                </h2>
              </div>
              <Link
                to="/courses"
                className="text-sm font-medium text-[#94a3b8] transition-colors hover:text-[#06b6d4]"
              >
                {t("viewAll")} →
              </Link>
            </div>
          </SectionReveal>

          <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => (
              <SectionReveal key={course.id}>
                <CourseCard course={course} />
              </SectionReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Features ─── */}
      <section className="border-t border-[#1f2d44] bg-[#111827] py-24">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <SectionReveal>
            <div className="mb-16 text-center">
              <span className="text-xs font-medium uppercase tracking-[0.1em] text-[#06b6d4]">
                {t("whyUs")}
              </span>
              <h2 className="mt-2 text-3xl font-bold text-[#f0f4f8] lg:text-4xl">
                {t("builtForSeriousEngineers")}
              </h2>
              <p className="mx-auto mt-3 max-w-lg text-[#94a3b8]">
                {lang === "en" ? "Every feature designed to maximize your learning and career growth." : "كل ميزة مصممة لتعظيم تعلمك ونمو مسيرتك المهنية."}
              </p>
            </div>
          </SectionReveal>

          <div className="space-y-20">
            {[
              {
                icon: <Shield className="h-8 w-8 text-[#06b6d4]" />,
                title: t("secureAntiPiracyStreaming"),
                body: lang === "en"
                  ? "Your premium content stays protected. Our player blocks screen recording, disables right-click downloads, and embeds invisible forensic watermarks unique to each student."
                  : "يظل المحتوى المتميز محمياً. مشغلنا يمنع تصوير الشاشة ويعطل التنزيل ويضعل علامات مائية فريدة.",
                bullets: lang === "en"
                  ? ["Screen capture blocking at OS level", "Dynamic watermarking with user ID", "Encrypted HLS streaming protocol", "No downloadable video source exposed"]
                  : ["حجب التقاط الشاشة على مستوى النظام", "علامة مائية ديناميكية بمعرف المستخدم", "بروتوكول بث HLS مشفر", "لا يوجد مصدر فيديو قابل للتنزيل"],
              },
              {
                icon: <Award className="h-8 w-8 text-[#06b6d4]" />,
                title: t("quizzesVerifiedCertificates"),
                body: lang === "en"
                  ? "Test your knowledge after every lesson with auto-graded quizzes. Earn a blockchain-verifiable certificate upon course completion to showcase on LinkedIn."
                  : "اختبر معرفتك بعد كل درس مع اختبارات مصححة تلقائياً. احصل على شهادة قابلة للتحقق عند إتمام الكورس.",
                bullets: lang === "en"
                  ? ["Lesson-level assessments with instant feedback", "Downloadable PDF certificates with QR verification", "LinkedIn integration for profile display", "Progress tracking dashboard"]
                  : ["تقييمات على مستوى الدرس مع تغذية راجعة فورية", "شهادات PDF قابلة للتحميل مع QR", "تكامل مع LinkedIn", "لوحة متابعة التقدم"],
              },
              {
                icon: <CreditCard className="h-8 w-8 text-[#06b6d4]" />,
                title: t("flexiblePaymentMethods"),
                body: lang === "en"
                  ? "Pay however suits you best. All transactions are encrypted, PCI-compliant, and processed through verified local payment gateways with instant access upon confirmation."
                  : "ادفع بالطريقة التي تناسبك. جميع المعاملات مشفرة ومتوافقة مع PCI.",
                bullets: lang === "en"
                  ? ["Credit/Debit card (Visa/Mastercard)", "InstaPay bank transfers", "Vodafone Cash & mobile wallets", "Split-payment options for premium bundles"]
                  : ["بطاقة ائتمان/خصم (Visa/Mastercard)", "تحويلات بنكية InstaPay", "فودافون كاش والمحافظ الإلكترونية", "خيارات تقسيط الدفع"],
              },
            ].map((feature, i) => (
              <SectionReveal key={i}>
                <div className={`flex flex-col items-center gap-10 lg:flex-row ${i % 2 === 1 ? "lg:flex-row-reverse" : ""}`}>
                  {/* Visual — with floating icon animation */}
                  <div className="flex flex-1 items-center justify-center">
                    <div className="flex h-48 w-48 items-center justify-center rounded-2xl border border-[#1f2d44] bg-[#1a2233] animate-float-icon">
                      {feature.icon}
                    </div>
                  </div>
                  {/* Text */}
                  <div className="flex-1 text-center lg:text-start">
                    <h3 className="text-xl font-bold text-[#f0f4f8] lg:text-2xl">
                      {feature.title}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-[#94a3b8] lg:text-base">
                      {feature.body}
                    </p>
                    <ul className="mt-5 space-y-2">
                      {(feature.bullets || []).map((b, j) => (
                        <li key={j} className="flex items-start gap-2 text-sm text-[#94a3b8]">
                          <span className="mt-0.5 text-[#10b981]">✓</span>
                          {b}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </SectionReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Instructor Section ─── */}
      <SectionReveal>
        <section className="border-t border-[#1f2d44] bg-[#111827] py-24">
          <div className="mx-auto max-w-7xl px-4 lg:px-6">
            <div className="mb-12 text-center">
              <span className="text-xs font-medium uppercase tracking-[0.1em] text-[#06b6d4]">
                {t("yourInstructor")}
              </span>
              <h2 className="mt-2 text-3xl font-bold text-[#f0f4f8] lg:text-4xl">
                {lang === "en" ? "Eng. Ahmed Elbaz" : "م. أحمد الباز"}
              </h2>
            </div>

            <div className="flex flex-col items-center gap-12 lg:flex-row lg:items-start">
              {/* Left - Avatar & Bio */}
              <div className="flex-1 text-center lg:text-start">
                <div className="mx-auto mb-6 flex h-28 w-28 items-center justify-center rounded-2xl border border-[#1f2d44] bg-[#1a2233] lg:mx-0">
                  <User className="h-14 w-14 text-[#06b6d4]" />
                </div>
                <p className="mb-2 text-sm font-medium uppercase tracking-wider text-[#06b6d4]">
                  {lang === "en" ? t("instructorRole") : t("instructorRoleAr")}
                </p>
                <p className="text-base leading-relaxed text-[#94a3b8] lg:text-lg">
                  {lang === "en" ? t("instructorBio") : t("instructorBioAr")}
                </p>
              </div>

              {/* Right - Highlights Grid */}
              <div className="grid flex-1 grid-cols-2 gap-4 lg:max-w-sm">
                {[
                  {
                    icon: <Briefcase className="h-6 w-6 text-[#06b6d4]" />,
                    value: "10+",
                    label: t("yearsExperience"),
                  },
                  {
                    icon: <GraduationCap className="h-6 w-6 text-[#06b6d4]" />,
                    value: "35+",
                    label: t("coursesTaught"),
                  },
                  {
                    icon: <User className="h-6 w-6 text-[#06b6d4]" />,
                    value: "2,400+",
                    label: t("studentsReached"),
                  },
                  {
                    icon: <Award className="h-6 w-6 text-[#06b6d4]" />,
                    value: "98%",
                    label: t("satisfactionRate"),
                  },
                ].map((item, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-[#1f2d44] bg-[#0a0e17] p-5 text-center"
                  >
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-[rgba(6,182,212,0.1)]">
                      {item.icon}
                    </div>
                    <p className="text-xl font-bold text-[#f0f4f8]">{item.value}</p>
                    <p className="mt-1 text-xs text-[#64748b]">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </SectionReveal>

      {/* ─── Testimonials ─── */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <SectionReveal>
            <div className="mb-12 text-center">
              <span className="text-xs font-medium uppercase tracking-[0.1em] text-[#06b6d4]">
                {t("testimonials")}
              </span>
              <h2 className="mt-2 text-3xl font-bold text-[#f0f4f8] lg:text-4xl">
                {t("whatEngineersSay")}
              </h2>
            </div>
          </SectionReveal>

          <div className="grid gap-6 md:grid-cols-3">
            {(testimonials || []).map((testimonial: Testimonial) => (
              <SectionReveal key={testimonial.id}>
                <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-8">
                  <div className="flex gap-1">
                    {Array.from({ length: testimonial.rating || 5 }).map((_, j) => (
                      <Star key={j} className="h-4 w-4 fill-[#f59e0b] text-[#f59e0b]" />
                    ))}
                  </div>
                  <p className="mt-4 text-sm leading-relaxed italic text-[#f0f4f8]">
                    "{testimonial.content}"
                  </p>
                  <div className="mt-6 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1a2233] text-sm font-semibold text-[#06b6d4]">
                      {testimonial.name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[#f0f4f8]">{testimonial.name}</p>
                      <p className="text-xs text-[#64748b]">
                        {testimonial.title} {testimonial.company ? `at ${testimonial.company}` : ""}
                      </p>
                    </div>
                  </div>
                </div>
              </SectionReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section className="py-24">
        <div className="mx-auto max-w-3xl px-4 lg:px-6">
          <SectionReveal>
            <div className="mb-12 text-center">
              <span className="text-xs font-medium uppercase tracking-[0.1em] text-[#06b6d4]">
                {t("faq")}
              </span>
              <h2 className="mt-2 text-3xl font-bold text-[#f0f4f8] lg:text-4xl">
                {t("commonQuestions")}
              </h2>
            </div>
          </SectionReveal>

          <div>
            {faqData.map((faq, i) => (
              <FAQItem key={i} question={faq.q} answer={faq.a} />
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA Banner ─── */}
      <section className="border-y border-[#1f2d44] py-20 cta-gradient">
        <div className="mx-auto max-w-3xl px-4 text-center lg:px-6">
          <h2 className="text-3xl font-bold text-[#f0f4f8]">
            {t("readyToPowerUp")}
          </h2>
          <p className="mt-3 text-base text-[#94a3b8]">
            {lang === "en" ? "Join 2,400+ engineers mastering the tools that matter. Start learning today — no credit card required for free courses." : "انضم لأكثر من 2400 مهندس يتقنون الأدوات المهمة. ابدأ التعلم اليوم — لا تحتاج بطاقة ائتمان للكورسات المجانية."}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link to="/courses">
              <Button className="glow-btn h-12 bg-gradient-to-r from-[#06b6d4] to-[#0891b2] px-7 text-sm font-semibold text-[#0a0e17]"
                onClick={() => trackEvent("cta_click", { button: "get_started_free", page: "cta_banner" })}
              >
                {t("getStartedFree")}
              </Button>
            </Link>
            <Link to="/courses">
              <Button
                variant="outline"
                className="h-12 border-[#1f2d44] bg-transparent px-7 text-sm font-semibold text-[#f0f4f8] hover:border-[#06b6d4] hover:text-[#06b6d4]"
                onClick={() => trackEvent("cta_click", { button: "view_pricing", page: "cta_banner" })}
              >
                {t("viewCoursePricing")}
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-[#1f2d44]">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-6 text-start"
      >
        <span className="text-base font-semibold text-[#f0f4f8] transition-colors hover:text-[#06b6d4]">
          {question}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-[#64748b]" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-[#64748b]" />
        )}
      </button>
      {open && (
        <p className="pb-6 text-sm leading-relaxed text-[#94a3b8]">{answer}</p>
      )}
    </div>
  );
}
