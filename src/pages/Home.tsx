import { Link } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import CourseCard from "@/components/CourseCard";
import {
  Zap,
  CircuitBoard,
  Cpu,
  FileCheck,
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
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useRef } from "react";
import { trackEvent } from "@/lib/clarity";

function useCountUp(end: number, duration: number = 2000, start: boolean = false) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!start) return;
    let startTime: number;
    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      setCount(Math.floor(progress * end));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [end, duration, start]);
  return count;
}

function AnimatedCounter({ end, label }: { end: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const count = useCountUp(end, 2000, isVisible);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setIsVisible(true); },
      { threshold: 0.5 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

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
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.1 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

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
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const dismissedKey = `dismissed-promo-${promotion.id}`;
    if (localStorage.getItem(dismissedKey)) {
      setDismissed(true);
    }
  }, [promotion.id]);

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
    const dismissedKey = `dismissed-promo-${promotion.id}`;
    localStorage.setItem(dismissedKey, "true");
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
        <div className="flex flex-1 flex-col items-center gap-1 text-center sm:items-start sm:text-left">
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
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/70 transition-all hover:bg-white/20 hover:text-white sm:right-3 sm:top-3"
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
  CircuitBoard: <CircuitBoard className="h-5 w-5 text-[#06b6d4]" />,
  Cpu: <Cpu className="h-5 w-5 text-[#06b6d4]" />,
  FileCheck: <FileCheck className="h-5 w-5 text-[#06b6d4]" />,
};

export default function Home() {
  const { t, lang } = useTranslation();
  const { data: courses } = trpc.course.list.useQuery({ featured: true });
  const { data: categories } = trpc.course.categories.useQuery();
  const { data: testimonials } = trpc.course.testimonials.useQuery();
  const { data: activePromotions } = trpc.settings.getActivePromotions.useQuery();

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
    (p) =>
      (p.position === "top" || p.position === "hero_above") &&
      !localStorage.getItem(`dismissed-promo-${p.id}`)
  );

  return (
    <div className="min-h-screen bg-[#0a0e17]">
      {/* ─── Promotion Banner ─── */}
      {topPromotion && <PromoBanner promotion={topPromotion} />}

      {/* ─── Hero ─── */}
      <section className="relative min-h-screen overflow-hidden pt-24">
        {/* Background: Full-bleed hero image with gradient overlay */}
        <div className="absolute inset-0 bg-[#0a0e17]">
          <img
            src="/hero-main.webp"
            alt=""
            className="hero-bg-image"
            loading="eager"
            aria-hidden="true"
          />
          {/* Multi-layer gradient overlay for readability + depth */}
          <div className="absolute inset-0 bg-gradient-to-r from-[#0a0e17]/95 via-[#0a0e17]/70 to-[#0a0e17]/40" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0e17] via-transparent to-[#0a0e17]/60" />
          {/* Subtle cyan glow on left for text area */}
          <div className="absolute inset-0 hero-glow" />
        </div>

        <div className="relative z-10 mx-auto flex max-w-7xl flex-col items-center px-4 py-20 lg:flex-row lg:px-6 lg:py-28">
          {/* Left Content */}
          <div className="flex-1 text-center lg:text-left">
            <div className="flex items-center justify-center gap-2 lg:justify-start">
              <Zap className="h-3 w-3 text-[#06b6d4]" />
              <span className="text-xs font-medium uppercase tracking-[0.1em] text-[#06b6d4]">
                {lang === "en" ? "PREMIUM ELECTRICAL ENGINEERING EDUCATION" : "تعليم هندسي كهربي متميز"}
              </span>
            </div>

            <h1 className="mt-6 text-4xl font-extrabold leading-[1.08] tracking-tight text-[#f0f4f8] sm:text-5xl lg:text-[56px]">
              {lang === "en" ? "Master the Power" : "أتقن قوة"}
              <br />
              <span className="gradient-text">
                {lang === "en" ? "of Electrical Engineering" : "الهندسة الكهربية"}
              </span>
            </h1>

            <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-[#94a3b8] lg:mx-0 lg:text-lg">
              {lang === "en"
                ? "From electrical network design to advanced simulations in ETAP, SKM, PowerFactory, and PVSyst. Learn from an industry expert with real-world project experience."
                : "من تصميم الشبكات الكهربية إلى المحاكاة المتقدمة في ETAP وSKM وPowerFactory وPVSyst. تعلم من خبير الصناعة ذو الخبرة العملية."}
            </p>

            <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row lg:justify-start">
              <Link to="/courses">
                <Button className="glow-btn h-12 gap-2 bg-gradient-to-r from-[#06b6d4] to-[#0891b2] px-7 text-sm font-semibold text-[#0a0e17]"
                  onClick={() => trackEvent("cta_click", { button: "explore_courses", page: "hero" })}
                >
                  <Zap className="h-4 w-4" />
                  {t("exploreCourses")}
                </Button>
              </Link>
              <Button
                variant="outline"
                className="h-12 gap-2 border-[#1f2d44] bg-transparent px-7 text-sm font-semibold text-[#f0f4f8] hover:border-[#06b6d4] hover:text-[#06b6d4]"
                onClick={() => trackEvent("cta_click", { button: "watch_preview", page: "hero" })}
              >
                <PlayCircle className="h-4 w-4" />
                {t("watchFreePreview")}
              </Button>
            </div>

            {/* Stats */}
            <div className="mt-10 flex items-center justify-center gap-8 lg:justify-start">
              <AnimatedCounter end={2400} label={t("studentsEnrolled")} />
              <div className="h-8 w-px bg-[#1f2d44]" />
              <AnimatedCounter end={98} label={t("satisfactionRate")} />
              <div className="h-8 w-px bg-[#1f2d44]" />
              <AnimatedCounter end={35} label={t("premiumCourses")} />
            </div>
          </div>

          {/* Right - Hero showcase image with glow card */}
          <div className="mt-12 flex flex-1 justify-center lg:mt-0">
            <div className="hero-image-wrapper w-full max-w-lg">
              <div className="hero-image-glow-ring">
                <img src="/hero-main.webp" alt="Master Electrical Engineering with ETAP, SKM, PowerFactory, and PVSyst" className="hero-image-display" loading="eager" />
              </div>
              <div className="hero-image-shimmer" />
            </div>
          </div>
        </div>
      </section>

      {/* ─── Software Strip ─── */}
      <section className="border-y border-[#1f2d44] bg-[#111827] py-10">
        <div className="mx-auto max-w-7xl px-4 lg:px-6">
          <p className="mb-6 text-center text-xs uppercase tracking-wider text-[#64748b]">
            {lang === "en" ? "Software & Tools You Will Master" : "البرامج والأدوات التي ستتقنها"}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 opacity-50">
            {[
              {
                icon: <Zap className="h-5 w-5 text-[#06b6d4]" />,
                name: "ETAP",
              },
              {
                icon: <CircuitBoard className="h-5 w-5 text-[#06b6d4]" />,
                name: "SKM",
              },
              {
                icon: <Cpu className="h-5 w-5 text-[#06b6d4]" />,
                name: "PowerFactory",
              },
              {
                icon: <FileCheck className="h-5 w-5 text-[#06b6d4]" />,
                name: "PVSyst",
              },
              {
                icon: <Wrench className="h-5 w-5 text-[#06b6d4]" />,
                name: "AutoCAD",
              },
              {
                icon: <Cpu className="h-5 w-5 text-[#06b6d4]" />,
                name: "MATLAB",
              },
            ].map((tool, i) => (
              <span
                key={tool.name}
                className="flex items-center gap-1.5 text-lg font-semibold tracking-wide text-[#94a3b8] transition-all hover:text-[#06b6d4] hover:opacity-100 hover:drop-shadow-[0_0_8px_rgba(6,182,212,0.3)]"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <span className="animate-float-icon" style={{ animationDelay: `${i * 200}ms` }}>
                  {tool.icon}
                </span>
                {tool.name}
              </span>
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
            {categories?.map((cat) => (
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
            {courses?.map((course) => (
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
                  <div className="flex-1 text-center lg:text-left">
                    <h3 className="text-xl font-bold text-[#f0f4f8] lg:text-2xl">
                      {feature.title}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-[#94a3b8] lg:text-base">
                      {feature.body}
                    </p>
                    <ul className="mt-5 space-y-2">
                      {feature.bullets.map((b, j) => (
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
              <div className="flex-1 text-center lg:text-left">
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
            {testimonials?.map((testimonial) => (
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
        className="flex w-full items-center justify-between py-6 text-left"
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
