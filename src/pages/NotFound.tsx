import { Link } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { Zap, Home, BookOpen, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const { t, lang } = useTranslation();

  return (
    <div className="flex min-h-[80vh] items-center justify-center bg-background px-4">
      <div className="w-full max-w-lg text-center">
        {/* Animated Glow Icon */}
        <div className="animate-float mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-2xl border border-border bg-primary shadow-[0_0_40px_rgba(6,182,212,0.2)]">
          <Zap className="h-12 w-12 text-accent-secondary drop-shadow-[0_0_12px_rgba(6,182,212,0.6)]" />
        </div>

        {/* 404 Number */}
        <div className="relative mb-4">
          <h1 className="text-[120px] font-black leading-none tracking-tighter text-border sm:text-[160px]">
            404
          </h1>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-2xl font-bold text-accent-secondary sm:text-3xl">
              {lang === "en" ? "PAGE NOT FOUND" : "الصفحة غير موجودة"}
            </span>
          </div>
        </div>

        {/* Description */}
        <p className="mx-auto mt-2 max-w-sm text-base text-text-muted">
          {lang === "en"
            ? "The page you're looking for doesn't exist or has been moved. Let's get you back on track."
            : "الصفحة التي تبحث عنها غير موجودة أو تم نقلها. دعنا نعيدك للمسار الصحيح."}
        </p>

        {/* Action Buttons */}
        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Button asChild className="glow-btn h-12 gap-2 bg-gradient-to-r from-accent-secondary to-accent-secondary/80 px-8 font-semibold text-background">
            <Link to="/">
              <Home className="h-4 w-4" />
              {lang === "en" ? "Back to Home" : "العودة للرئيسية"}
            </Link>
          </Button>

          <Button asChild variant="outline" className="h-12 gap-2 border-border bg-transparent px-8 font-semibold text-foreground hover:border-accent-secondary hover:text-accent-secondary">
            <Link to="/courses">
              <BookOpen className="h-4 w-4" />
              {t("exploreCourses")}
            </Link>
          </Button>
        </div>

        {/* Helpful links */}
        <div className="mt-12 flex items-center justify-center gap-6 text-sm text-text-muted">
          <Link to="/courses" className="flex items-center gap-1 transition-colors hover:text-accent-secondary">
            {t("courses")}
            <ArrowRight className="h-3 w-3" />
          </Link>
          <span className="text-border">|</span>
          <Link to="/support" className="flex items-center gap-1 transition-colors hover:text-accent-secondary">
            {t("support")}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
