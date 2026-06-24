import { Link } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import CourseCard from "@/components/CourseCard";
import SEO from "@/components/SEO";
import { StaggerContainer, StaggerItem, FadeIn, NeonGlow } from "@/components/ui/motion";
import AnimatedIcon from "@/components/ui/AnimatedIcon";
import BentoCard from "@/components/ui/BentoCard";
import AnimatedCounter from "@/components/ui/AnimatedCounter";
import ScrollReveal from "@/components/ui/ScrollReveal";
import ArcFlashButton from "@/components/ui/ArcFlashButton";
import { motion } from "framer-motion";
import "@/elite-animations.css";
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
  Monitor,
  Globe,
  Trophy,
  Users,
  Code,
  Cpu,
  Layers,
  BarChart3,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Rocket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useRef } from "react";
import { trackEvent } from "@/lib/clarity";

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
};

type Stats = {
  totalCourses: number;
  totalStudents: number;
  totalLessons: number;
  satisfactionRate: number;
};

const categoryIcons: Record<string, React.ReactNode> = {
  Zap: <Zap className="h-5 w-5" />,
  Cpu: <Cpu className="h-5 w-5" />,
  Monitor: <Monitor className="h-5 w-5" />,
  Code: <Code className="h-5 w-5" />,
  Layers: <Layers className="h-5 w-5" />,
  BarChart3: <BarChart3 className="h-5 w-5" />,
};

// Official software logos — downloaded from each vendor's official source and
// stored locally in /public/software-logos/ to prevent broken external hotlinks.
// Sources verified via VLM:
//   ETAP          — official ETAP red wordmark logo (etap.com)
//   SKM           — official SKM Systems Analysis, Inc. corporate logo (skm.com)
//   PowerFactory  — official DIgSILENT logo (red text + red triangle)
//   PVSyst        — official PVsyst logo (yellow sun + blue solar panel + wordmark)
//   AutoCAD       — official AutoCAD logo by Autodesk (Wikimedia Commons)
//   MATLAB        — official MATLAB logo by MathWorks (Wikimedia Commons)
const SOFTWARE_LOGOS = [
  { name: "ETAP", logo: "/software-logos/etap.webp", logoFallback: "/software-logos/etap.png" },
  { name: "SKM", logo: "/software-logos/skm.webp", logoFallback: "/software-logos/skm.png" },
  { name: "PowerFactory", logo: "/software-logos/powerfactory.webp", logoFallback: "/software-logos/powerfactory.png" },
  { name: "PVSyst", logo: "/software-logos/pvsyst.webp", logoFallback: "/software-logos/pvsyst.png" },
  { name: "AutoCAD", logo: "/software-logos/autocad.webp", logoFallback: "/software-logos/autocad.png" },
  { name: "MATLAB", logo: "/software-logos/matlab.webp", logoFallback: "/software-logos/matlab.png" },
];

const FALLBACK_STATS = { totalStudents: 2400, satisfactionRate: 98, totalCourses: 35 };

function useRevealOnce() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, visible] as const;
}

function PromoBanner({ promotion }: { promotion: any }) {
  const { lang } = useTranslation();
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [dismissed, setDismissed] = useState(() => {
    try {
      return !!localStorage.getItem(`dismissed-promo-${promotion.id}`);
    } catch { return false; }
  });

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
    try { localStorage.setItem(`dismissed-promo-${promotion.id}`, "true"); } catch {}
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
    <div className="relative w-full animate-[fadeIn_0.5s_ease-out]" style={{ background: `linear-gradient(135deg, ${bgFrom}, ${bgTo})`, color: textColor }}>
      <div className="absolute inset-0 opacity-10 promo-pattern" />
      <div className="relative mx-auto flex max-w-7xl flex-col items-center gap-4 px-4 py-5 sm:flex-row sm:justify-between lg:px-6">
        <div className="flex flex-1 flex-col items-center gap-1 text-center sm:items-start sm:text-start">
          <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
            {promotion.discountText && (
              <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold uppercase tracking-wider backdrop-blur-sm">
                {promotion.discountText}
              </span>
            )}
            <span className="text-lg font-bold sm:text-xl">{title}</span>
          </div>
          {subtitle && <p className="mt-1 text-sm opacity-90">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-4">
          {promotion.showCountdown && (
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 opacity-80" />
              {(["days", "hours", "minutes", "seconds"] as const).map((unit, i) => (
                <div key={unit} className="flex items-center gap-1">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-black/20 text-sm font-bold tabular-nums backdrop-blur-sm sm:h-10 sm:w-10 sm:text-base">
                    {pad(timeLeft[unit])}
                  </span>
                  <span className="hidden text-[10px] uppercase tracking-wider opacity-70 sm:inline">{countdownLabels[unit]}</span>
                  {i < 3 && <span className="mx-0.5 text-lg font-light opacity-50">:</span>}
                </div>
              ))}
            </div>
          )}
          {promotion.ctaUrl && ctaText && (
            <Link to={promotion.ctaUrl} className="shrink-0 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold shadow-lg transition-all hover:scale-105 hover:shadow-xl" style={{ color: bgFrom }}>
              {ctaText}
            </Link>
          )}
        </div>
        <button type="button"
          onClick={handleDismiss} className="absolute end-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/70 transition-all hover:bg-white/20 hover:text-white sm:end-3 sm:top-3" aria-label={lang === "ar" ? "إغلاق" : "Dismiss"}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function ParallaxHeroImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, -100]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 0.95]);

  return (
    <motion.div ref={ref} style={{ y, scale }} className={className}>
      <img src={src} alt={alt} className="w-full h-auto object-cover max-h-[480px] lg:max-h-[600px] xl:max-h-[680px]" loading="eager" fetchPriority="high" decoding="async" width="1200" height="800" onError={(e) => { e.currentTarget.src = "/hero-bg.jpg"; e.currentTarget.onerror = null; }} />
    </motion.div>
  );
}

function SectionHeader({ badge, title, subtitle }: { badge: string; title: string; subtitle?: string }) {
  return (
    <ScrollReveal className="mb-16 text-center">
      <motion.span
        initial={{ opacity: 0, scale: 0.8 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
        className="inline-flex items-center gap-2 rounded-full border border-[rgba(6,182,212,0.2)] bg-[rgba(6,182,212,0.05)] px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-[#06b6d4]"
      >
        <Sparkles className="h-3 w-3" />
        {badge}
      </motion.span>
      <motion.h2
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ delay: 0.1, duration: 0.6 }}
        className="mt-4 text-3xl font-bold text-[#f0f4f8] lg:text-5xl section-header-glow"
      >
        {title}
      </motion.h2>
      {subtitle && (
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="mx-auto mt-4 max-w-lg text-[#94a3b8]"
        >
          {subtitle}
        </motion.p>
      )}
    </ScrollReveal>
  );
}

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

  const faqData = [
    { q: lang === "en" ? "How long do I have access to a purchased course?" : "ما مدة الوصول للكورس بعد الشراء؟", a: lang === "en" ? "Lifetime access. Once enrolled, the course is yours forever, including all future updates and bonus materials added to that course." : "وصول مدى الحياة. بمجرد التسجيل، يصبح الكورس ملكك إلى الأبد، بما في ذلك جميع التحديثات المستقبلية." },
    { q: lang === "en" ? "Can I watch courses on mobile?" : "هل يمكنني مشاهدة الكورسات على الموبايل؟", a: lang === "en" ? "Absolutely. The platform is fully responsive and works on any device. Our protected video player is optimized for mobile streaming without compromising security." : "بالتأكيد. المنصة متجاوبة بالكامل وتعمل على أي جهاز. مشغل الفيديو المحمي مُحسّن للبث على الموبايل." },
    { q: lang === "en" ? "What payment methods are accepted?" : "ما هي طرق الدفع المتاحة؟", a: lang === "en" ? "We accept Visa/Mastercard, InstaPay bank transfers, Vodafone Cash, and major mobile wallets. All transactions are processed through encrypted, PCI-compliant gateways." : "نقبل Visa/Mastercard، وتحويلات InstaPay، وفودافون كاش، والمحافظ الإلكترونية الرئيسية. جميع المعاملات تتم عبر بوابات مشفرة." },
    { q: lang === "en" ? "Do I get a certificate after completing a course?" : "هل أحصل على شهادة بعد إتمام الكورس؟", a: lang === "en" ? "Yes. Every course completion awards a verified digital certificate with a unique QR code for validation. Certificates can be downloaded as PDF and shared directly to LinkedIn." : "نعم. يحصل كل طالب يكمل الكورس على شهادة رقمية موثقة برمز QR فريد للتحقق." },
    { q: lang === "en" ? "Is there a refund policy?" : "هل يوجد سياسة استرداد؟", a: lang === "en" ? "We offer a 7-day money-back guarantee for all premium courses. If the content doesn't meet your expectations, contact support for a full refund." : "نقدم ضمان استرداد الأموال لمدة 7 أيام لجميع الكورسات المدفوعة." },
  ];

  const topPromotion = activePromotions?.find((p: Promotion) => {
    try { return (p.position === "top" || p.position === "hero_above") && !localStorage.getItem(`dismissed-promo-${p.id}`); } catch { return (p.position === "top" || p.position === "hero_above"); }
  });

  return (
    <div className="min-h-screen bg-[#0a0e17] overflow-hidden">
      <SEO title={lang === "en" ? "Home" : "الرئيسية"} description={lang === "en" ? "Master electrical engineering with professional courses in ETAP, SKM, PowerFactory, and PVSyst." : "أتقن الهندسة الكهربية مع كورسات احترافية في ETAP وSKM وPowerFactory وPVSyst."} />
      {topPromotion && <PromoBanner promotion={topPromotion} />}

      {/* ═══════════════════ HERO ═══════════════════ */}
      <section className="relative min-h-screen overflow-hidden pt-20">
        {/* Subtle radial glow behind hero content — keeps depth without electrical effects */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 35%, rgba(6,182,212,0.06) 0%, transparent 70%)",
          }}
        />

        <div className="relative z-10 mx-auto flex max-w-7xl flex-col items-center px-4 py-16 lg:flex-row lg:px-6 lg:py-20 gap-8 lg:gap-0">
          <StaggerContainer className="flex-1 text-center lg:text-start" staggerChildren={0.12}>
            <StaggerItem>
              <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, type: "spring" }} className="flex items-center justify-center gap-2 lg:justify-start">
                <motion.div animate={{ opacity: [0.5, 1, 0.5], scale: [0.95, 1.05, 0.95] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}>
                  <Zap className="h-4 w-4 text-[#06b6d4]" />
                </motion.div>
                <span className="text-xs font-medium uppercase tracking-[0.15em] text-[#06b6d4]">
                  {lang === "en" ? "PREMIUM ELECTRICAL ENGINEERING" : "تعليم هندسي كهربي متميز"}
                </span>
              </motion.div>
            </StaggerItem>

            <StaggerItem>
              <h1 className="mt-6 text-5xl font-extrabold leading-[1.06] tracking-tight text-[#f0f4f8] sm:text-5xl lg:text-[64px]">
                {lang === "en" ? "Master the Power" : "أتقن قوة"}
                <br />
                <span className="gradient-text">
                  {lang === "en" ? "of Electrical Engineering" : "الهندسة الكهربية"}
                </span>
              </h1>
            </StaggerItem>

            <StaggerItem>
              <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.6 }} className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-[#94a3b8] lg:mx-0 lg:text-lg">
                {lang === "en" ? "From electrical network design to advanced simulations in ETAP, SKM, PowerFactory, and PVSyst. Learn from an industry expert with real-world project experience." : "من تصميم الشبكات الكهربية إلى المحاكاة المتقدمة في ETAP وSKM وPowerFactory وPVSyst. تعلم من خبير صناعة ذي خبرة عملية."}
              </motion.p>
            </StaggerItem>

            <StaggerItem>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.5 }} className="mt-8 flex flex-col items-center gap-4 sm:flex-row lg:justify-start">
                <Link to="/courses">
                  <ArcFlashButton variant="primary" onClick={() => trackEvent("cta_click", { button: "explore_courses", page: "hero" })}>
                    <Zap className="h-4 w-4" />
                    {t("exploreCourses")}
                  </ArcFlashButton>
                </Link>
                <ArcFlashButton variant="outline" onClick={() => trackEvent("cta_click", { button: "watch_preview", page: "hero" })}>
                  <PlayCircle className="h-4 w-4" />
                  {t("watchFreePreview")}
                </ArcFlashButton>
              </motion.div>
            </StaggerItem>

            <StaggerItem>
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.5 }} className="mt-10 flex flex-wrap items-center justify-center gap-8 lg:justify-start">
                <AnimatedCounter value={resolvedStats.totalStudents} label={t("studentsEnrolled")} color="#06b6d4" suffix="+" />
                <div className="h-10 w-px bg-[#1f2d44]" />
                <AnimatedCounter value={resolvedStats.satisfactionRate} label={t("satisfactionRate")} color="#10b981" suffix="%" />
                <div className="h-10 w-px bg-[#1f2d44]" />
                <AnimatedCounter value={resolvedStats.totalCourses} label={t("premiumCourses")} color="#f59e0b" suffix="+" />
              </motion.div>
            </StaggerItem>
          </StaggerContainer>

          <FadeIn delay={0.3} className="mt-8 flex flex-1 justify-center lg:mt-0 lg:justify-end">
            <motion.div initial={{ opacity: 0, scale: 0.9, x: 50 }} animate={{ opacity: 1, scale: 1, x: 0 }} transition={{ duration: 0.8, type: "spring", stiffness: 100, damping: 20 }} className="relative w-full max-w-2xl lg:max-w-[600px] xl:max-w-[700px]">
              <motion.div animate={{ opacity: [0.4, 0.7, 0.4], scale: [1, 1.05, 1] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} className="absolute -inset-6 rounded-[2rem] bg-gradient-to-br from-[#06b6d4]/20 via-[#8b5cf6]/10 to-transparent blur-3xl" />
              <motion.div animate={{ boxShadow: ["0 0 30px rgba(6,182,212,0.3)", "0 0 50px rgba(6,182,212,0.5)", "0 0 30px rgba(6,182,212,0.3)"] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }} className="relative z-10 overflow-hidden rounded-[1.5rem] border border-[#1f2d44] bg-[#0a0e17] shadow-2xl">
                <ParallaxHeroImage src="hero-main.webp" alt="Master Electrical Engineering with Eng. Ahmed Elbaz" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a0e17]/40 via-transparent to-white/5 pointer-events-none" />
              </motion.div>

              <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }} className="absolute -bottom-4 -right-4 z-20 hidden lg:flex">
                <NeonGlow color="#06b6d4" className="flex items-center gap-3 rounded-2xl bg-[#111827] p-4 border border-[#1f2d44] shadow-xl">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(6,182,212,0.1)]">
                    <Star className="h-6 w-6 text-yellow-400 fill-yellow-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">Top Rated</p>
                    <p className="text-xs text-[#94a3b8]">Engineering Expert</p>
                  </div>
                </NeonGlow>
              </motion.div>

              <motion.div animate={{ y: [0, 6, 0] }} transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }} className="absolute -top-2 -left-2 z-20 hidden lg:flex">
                <motion.div animate={{ boxShadow: ["0 0 15px rgba(16,185,129,0.3)", "0 0 25px rgba(16,185,129,0.5)", "0 0 15px rgba(16,185,129,0.3)"] }} transition={{ duration: 2, repeat: Infinity }} className="flex items-center gap-2 rounded-xl bg-[#111827] border border-[#1f2d44] px-3 py-2 shadow-xl">
                  <Zap className="h-5 w-5 text-[#10b981]" />
                  <span className="text-xs font-semibold text-white">2,400+ {lang === "ar" ? "طالب" : "Students"}</span>
                </motion.div>
              </motion.div>
            </motion.div>
          </FadeIn>
        </div>

        <motion.div animate={{ y: [0, 8, 0], opacity: [0.4, 1, 0.4] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }} className="absolute bottom-8 left-1/2 z-20 -translate-x-1/2 flex flex-col items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-[#64748b]">{lang === "ar" ? "مرر للأسفل" : "Scroll Down"}</span>
          <div className="flex h-6 w-4 items-start justify-center">
            <svg width="16" height="24" viewBox="0 0 16 24" fill="none">
              <path d="M8 0 L8 18 M3 13 L8 18 L13 13" stroke="#06b6d4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </motion.div>
      </section>

      {/* ═══════════════════ SOFTWARE STRIP ═══════════════════ */}
      <section className="border-y border-[#1f2d44] bg-[#111827] py-10 overflow-hidden">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <ScrollReveal>
            <p className="mb-8 text-center text-xs font-semibold uppercase tracking-[0.15em] text-[#64748b]">
              {lang === "en" ? "Industry Software You Will Master" : "البرامج الهندسية التي ستتقنها"}
            </p>
          </ScrollReveal>
          <div className="relative flex overflow-x-auto pb-4 scrollbar-hide">
            <div className="absolute start-0 top-0 bottom-0 w-20 bg-gradient-to-r from-[#111827] to-transparent z-10 pointer-events-none shrink-0" />
            <div className="absolute end-0 top-0 bottom-0 w-20 bg-gradient-to-l from-[#111827] to-transparent z-10 pointer-events-none shrink-0" />
            <div className="flex gap-10" style={{ animation: "scrollLogos 20s linear infinite", minWidth: "max-content" }}>
              {[...SOFTWARE_LOGOS, ...SOFTWARE_LOGOS].map((tool, i) => (
                <motion.div key={`${tool.name}-${i}`} className="software-logo-pill group flex flex-col items-center gap-2 cursor-default shrink-0" whileHover={{ y: -6, scale: 1.05 }} title={tool.name}>
                  <div className="flex h-16 w-32 items-center justify-center rounded-xl border border-[#1f2d44] bg-[#0a0e17] px-4 py-3 transition-all group-hover:border-[rgba(6,182,212,0.6)] group-hover:bg-[rgba(6,182,212,0.08)] shadow-lg">
                    <picture>
                      <source srcSet={tool.logo} type="image/webp" />
                      <img
                        src={tool.logoFallback}
                        alt={`${tool.name} official logo`}
                        width={120}
                        height={48}
                        loading="lazy"
                        decoding="async"
                        className="max-h-10 max-w-full object-contain filter brightness-110 contrast-125 transition-all group-hover:scale-110 drop-shadow-md"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const next = e.currentTarget.nextElementSibling as HTMLElement | null;
                          if (next) next.style.display = 'block';
                        }}
                      />
                    </picture>
                    <span className="hidden text-sm font-bold text-[#06b6d4]">{tool.name}</span>
                  </div>
                  <span className="text-[11px] font-bold uppercase tracking-widest text-[#64748b] group-hover:text-[#06b6d4] transition-colors">{tool.name}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════ CATEGORIES ═══════════════════ */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <SectionHeader badge={t("curriculum")} title={t("browseByCategory")} subtitle={lang === "en" ? "Structured learning paths from fundamentals to advanced design." : "مسارات تعليمية منظمة من الأساسيات إلى التصميم المتقدم."} />

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {(categories || []).map((cat: Category, idx: number) => {
              // Cycle through modern variants so each card feels distinct
              const variants = ["glow", "pulse", "tilt", "ripple"] as const;
              const variant = variants[idx % variants.length];
              return (
              <ScrollReveal key={cat.id} delay={idx * 0.1}>
                <Link to={`/courses?category=${cat.id}`}>
                  <motion.div whileHover={{ y: -8, scale: 1.03 }} whileTap={{ scale: 0.98 }} transition={{ type: "spring", stiffness: 400, damping: 20 }} className="group rounded-xl border border-[#1f2d44] bg-[#111827] p-8 transition-all hover:border-[rgba(6,182,212,0.35)] hover:shadow-[0_12px_32px_rgba(6,182,212,0.08)]">
                    <AnimatedIcon icon={categoryIcons[cat.icon] || <Zap className="h-5 w-5" />} variant={variant} size="md" color="#06b6d4" />
                    <h3 className="mt-4 text-lg font-semibold text-[#f0f4f8]">{lang === "ar" ? cat.nameAr : cat.nameEn}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-[#94a3b8]">{lang === "ar" ? cat.descriptionAr : cat.descriptionEn}</p>
                    <motion.div className="mt-4 flex items-center gap-2 text-sm font-medium text-[#06b6d4] opacity-0 group-hover:opacity-100 transition-opacity">
                      {lang === "en" ? "Explore" : "استكشف"}
                      <ArrowRight className="h-4 w-4" />
                    </motion.div>
                  </motion.div>
                </Link>
              </ScrollReveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ═══════════════════ FEATURED COURSES ═══════════════════ */}
      <section className="relative py-24">
        <div className="absolute inset-0 grid-pattern pointer-events-none" />
        <div className="relative z-10 mx-auto max-w-7xl px-4 lg:px-6">
          <SectionHeader badge={t("featured")} title={t("mostPopularCourses")} />
          <div className="flex justify-end mb-8">
            <Link to="/courses" className="inline-flex items-center gap-2 text-sm font-medium text-[#94a3b8] transition-colors hover:text-[#06b6d4] group">
              {t("viewAll")}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
          <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course, idx: number) => (
              <ScrollReveal key={course.id} delay={idx * 0.1}>
                <CourseCard course={course} />
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════ FEATURES BENTO GRID ═══════════════════ */}
      <section className="border-t border-[#1f2d44] py-24">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <SectionHeader badge={t("whyUs")} title={t("builtForSeriousEngineers")} subtitle={lang === "en" ? "Every feature designed to maximize your learning and career growth." : "كل ميزة مصممة لتعظيم تعلمك ونمو مسيرتك المهنية."} />

          <div className="bento-grid bento-grid-cols-3">
            <BentoCard span={2} delay={0} className="p-8">
              <div className="flex flex-col h-full">
                <AnimatedIcon icon={<Shield className="h-8 w-8" />} variant="glow" size="lg" color="#06b6d4" />
                <h3 className="mt-6 text-xl font-bold text-[#f0f4f8]">{t("secureAntiPiracyStreaming")}</h3>
                <p className="mt-3 text-sm leading-relaxed text-[#94a3b8]">
                  {lang === "en" ? "Your premium content stays protected. Our player blocks screen recording, disables right-click downloads, and embeds invisible forensic watermarks unique to each student." : "يظل المحتوى المتميز محمياً. مشغلنا يمنع تصوير الشاشة ويعطل التنزيل ويضع علامات مائية فريدة."}
                </p>
                <ul className="mt-5 space-y-2">
                  {["Screen capture blocking at OS level", "Dynamic watermarking with user ID", "Encrypted HLS streaming protocol"].map((b, j) => (
                    <motion.li key={j} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} transition={{ delay: j * 0.1 + 0.3 }} viewport={{ once: true }} className="flex items-start gap-2 text-sm text-[#94a3b8]">
                      <CheckCircle2 className="h-4 w-4 text-[#10b981] mt-0.5 shrink-0" />
                      {b}
                    </motion.li>
                  ))}
                </ul>
              </div>
            </BentoCard>

            <BentoCard delay={0.1} className="p-8">
              <div className="flex flex-col h-full items-center text-center">
                <AnimatedIcon icon={<Award className="h-8 w-8" />} variant="orbit" size="lg" color="#f59e0b" />
                <h3 className="mt-6 text-xl font-bold text-[#f0f4f8]">{t("quizzesVerifiedCertificates")}</h3>
                <p className="mt-3 text-sm leading-relaxed text-[#94a3b8]">
                  {lang === "en" ? "Auto-graded quizzes and blockchain-verifiable certificates with QR codes." : "اختبارات مصححة تلقائياً وشهادات قابلة للتحقق برموز QR."}
                </p>
              </div>
            </BentoCard>

            <BentoCard delay={0.2} className="p-8">
              <div className="flex flex-col h-full items-center text-center">
                <AnimatedIcon icon={<CreditCard className="h-8 w-8" />} variant="bounce" size="lg" color="#10b981" />
                <h3 className="mt-6 text-xl font-bold text-[#f0f4f8]">{t("flexiblePaymentMethods")}</h3>
                <p className="mt-3 text-sm leading-relaxed text-[#94a3b8]">
                  {lang === "en" ? "Visa, InstaPay, Vodafone Cash — all encrypted and PCI-compliant." : "Visa وInstaPay وفودافون كاش — كلها مشفرة ومتوافقة مع PCI."}
                </p>
              </div>
            </BentoCard>

            <BentoCard span={2} delay={0.3} className="p-8">
              <div className="flex flex-col lg:flex-row items-center gap-8 h-full">
                <div className="flex-1">
                  <AnimatedIcon icon={<Rocket className="h-8 w-8" />} variant="morph" size="lg" color="#8b5cf6" />
                  <h3 className="mt-6 text-xl font-bold text-[#f0f4f8]">
                    {lang === "en" ? "Learn at Your Own Pace" : "تعلم بالسرعة التي تناسبك"}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-[#94a3b8]">
                    {lang === "en" ? "Lifetime access to all courses. Watch on any device, anytime. Track your progress with detailed analytics and get personalized recommendations." : "وصول مدى الحياة لجميع الكورسات. شاهد على أي جهاز في أي وقت. تابع تقدمك مع تحليلات مفصلة."}
                  </p>
                </div>
                <div className="flex-1 grid grid-cols-2 gap-4">
                  {[
                    { icon: <Clock className="h-5 w-5" />, label: lang === "en" ? "Lifetime Access" : "وصول مدى الحياة", color: "#06b6d4" },
                    { icon: <Globe className="h-5 w-5" />, label: lang === "en" ? "Any Device" : "أي جهاز", color: "#10b981" },
                    { icon: <BarChart3 className="h-5 w-5" />, label: lang === "en" ? "Progress Tracking" : "متابعة التقدم", color: "#f59e0b" },
                    { icon: <Sparkles className="h-5 w-5" />, label: lang === "en" ? "AI Recommendations" : "توصيات ذكية", color: "#8b5cf6" },
                  ].map((item, i) => (
                    <motion.div key={i} whileHover={{ y: -4, scale: 1.05 }} className="rounded-xl border border-[#1f2d44] bg-[#0a0e17] p-4 text-center">
                      <motion.div whileHover={{ rotate: [0, -10, 10, 0] }} transition={{ duration: 0.4 }} className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: `rgba(${hexToRgb(item.color)}, 0.1)`, color: item.color }}>
                        {item.icon}
                      </motion.div>
                      <p className="text-xs font-medium text-[#f0f4f8]">{item.label}</p>
                    </motion.div>
                  ))}
                </div>
              </div>
            </BentoCard>
          </div>
        </div>
      </section>

      {/* ═══════════════════ INSTRUCTOR ═══════════════════ */}
      <section className="border-t border-[#1f2d44] py-24">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <SectionHeader badge={t("yourInstructor")} title={lang === "en" ? "Eng. Ahmed Elbaz" : "م. أحمد الباز"} />

          <div className="flex flex-col items-center gap-12 lg:flex-row lg:items-start">
            <ScrollReveal direction="left" className="flex-1 text-center lg:text-start">
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="mx-auto mb-6 flex h-28 w-28 items-center justify-center rounded-2xl border border-[#1f2d44] bg-[#1a2233] lg:mx-0">
                <motion.div animate={{ filter: ["hue-rotate(0deg)", "hue-rotate(15deg)", "hue-rotate(0deg)"] }} transition={{ duration: 4, repeat: Infinity }}>
                  <User className="h-14 w-14 text-[#06b6d4]" />
                </motion.div>
              </motion.div>
              <p className="mb-2 text-sm font-medium uppercase tracking-wider text-[#06b6d4]">
                {lang === "en" ? t("instructorRole") : t("instructorRoleAr")}
              </p>
              <p className="text-base leading-relaxed text-[#94a3b8] lg:text-lg">
                {lang === "en" ? t("instructorBio") : t("instructorBioAr")}
              </p>
            </ScrollReveal>

            <ScrollReveal direction="right" className="grid flex-1 grid-cols-2 gap-4 lg:max-w-sm">
              {[
                { icon: <Briefcase className="h-6 w-6" />, value: "10+", label: t("yearsExperience"), color: "#06b6d4" },
                { icon: <GraduationCap className="h-6 w-6" />, value: "35+", label: t("coursesTaught"), color: "#10b981" },
                { icon: <Users className="h-6 w-6" />, value: "2,400+", label: t("studentsReached"), color: "#f59e0b" },
                { icon: <Trophy className="h-6 w-6" />, value: "98%", label: t("satisfactionRate"), color: "#8b5cf6" },
              ].map((item, i) => (
                <motion.div key={i} whileHover={{ y: -4, scale: 1.03 }} whileTap={{ scale: 0.97 }} transition={{ type: "spring", stiffness: 400, damping: 20 }} className="rounded-xl border border-[#1f2d44] bg-[#0a0e17] p-5 text-center">
                  <motion.div whileHover={{ rotate: [0, -10, 10, -5, 5, 0], scale: 1.1 }} transition={{ duration: 0.4 }} className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg" style={{ background: `rgba(${hexToRgb(item.color)}, 0.1)` }}>
                    <span style={{ color: item.color }}>{item.icon}</span>
                  </motion.div>
                  <p className="text-xl font-bold text-[#f0f4f8]">{item.value}</p>
                  <p className="mt-1 text-xs text-[#64748b]">{item.label}</p>
                </motion.div>
              ))}
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* ═══════════════════ TESTIMONIALS ═══════════════════ */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <SectionHeader badge={t("testimonials")} title={t("whatEngineersSay")} />

          <div className="grid gap-6 md:grid-cols-3">
            {(testimonials || []).map((testimonial: Testimonial, idx: number) => (
              <ScrollReveal key={testimonial.id} delay={idx * 0.1}>
                <motion.div whileHover={{ y: -6, scale: 1.02 }} whileTap={{ scale: 0.98 }} className="rounded-xl border border-[#1f2d44] bg-[#111827] p-8">
                  <motion.div animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }} className="flex gap-1">
                    {Array.from({ length: testimonial.rating || 5 }).map((_, j) => (
                      <Star key={j} className="h-4 w-4 fill-[#f59e0b] text-[#f59e0b]" />
                    ))}
                  </motion.div>
                  <p className="mt-4 text-sm leading-relaxed italic text-[#f0f4f8]">"{testimonial.content}"</p>
                  <motion.div whileHover={{ x: 4 }} className="mt-6 flex items-center gap-3">
                    <motion.div whileHover={{ rotate: 360, scale: 1.1 }} transition={{ duration: 0.5 }} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1a2233] text-sm font-semibold text-[#06b6d4]">
                      {testimonial.name.charAt(0)}
                    </motion.div>
                    <div>
                      <p className="text-sm font-semibold text-[#f0f4f8]">{testimonial.name}</p>
                      <p className="text-xs text-[#64748b]">{testimonial.title} {testimonial.company ? `at ${testimonial.company}` : ""}</p>
                    </div>
                  </motion.div>
                </motion.div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════ FAQ ═══════════════════ */}
      <section className="py-24">
        <div className="mx-auto max-w-3xl px-4 lg:px-6">
          <SectionHeader badge={t("faq")} title={t("commonQuestions")} />

          <div>
            {faqData.map((faq, i) => (
              <FAQItem key={i} question={faq.q} answer={faq.a} />
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════ CTA BANNER ═══════════════════ */}
      <section className="border-y border-[#1f2d44] py-20 relative overflow-hidden">
        <div className="relative z-10 mx-auto max-w-3xl px-4 text-center lg:px-6">
          <ScrollReveal>
            <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }} className="text-3xl font-bold text-[#f0f4f8] lg:text-4xl">
              {t("readyToPowerUp")}
            </motion.h2>
            <motion.p initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }} className="mt-3 text-base text-[#94a3b8]">
              {lang === "en" ? "Join 2,400+ engineers mastering the tools that matter. Start learning today — no credit card required for free courses." : "انضم لأكثر من 2400 مهندس يتقنون الأدوات المهمة. ابدأ التعلم اليوم — لا تحتاج بطاقة ائتمان للكورسات المجانية."}
            </motion.p>
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.3 }} className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link to="/courses">
                <Button className="glow-btn h-12 bg-gradient-to-r from-[#06b6d4] to-[#0891b2] px-7 text-sm font-semibold text-[#0a0e17]" onClick={() => trackEvent("cta_click", { button: "get_started_free", page: "cta_banner" })}>
                  {t("getStartedFree")}
                </Button>
              </Link>
              <Link to="/courses">
                <Button variant="outline" className="h-12 border-[#1f2d44] bg-transparent px-7 text-sm font-semibold text-[#f0f4f8] hover:border-[#06b6d4] hover:text-[#06b6d4]" onClick={() => trackEvent("cta_click", { button: "view_pricing", page: "cta_banner" })}>
                  {t("viewCoursePricing")}
                </Button>
              </Link>
            </motion.div>
          </ScrollReveal>
        </div>
      </section>
    </div>
  );
}

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.div layout className="border-b border-[#1f2d44] overflow-hidden">
      <motion.button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between py-6 text-start" whileTap={{ scale: 0.99 }}>
        <span className="text-base font-semibold text-[#f0f4f8] transition-colors hover:text-[#06b6d4]">{question}</span>
        <motion.div animate={{ rotate: open ? 180 : 0, color: open ? "#06b6d4" : "#64748b" }} transition={{ duration: 0.3, type: "spring", stiffness: 300, damping: 25 }}>
          {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
        </motion.div>
      </motion.button>
      <motion.div initial={false} animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }} transition={{ duration: 0.4, type: "spring", stiffness: 300, damping: 30 }} className="overflow-hidden">
        <p className="pb-6 text-sm leading-relaxed text-[#94a3b8]">{answer}</p>
      </motion.div>
    </motion.div>
  );
}

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : "6, 182, 212";
}
