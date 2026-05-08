import { useParams, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { useWatchTracker } from "@/hooks/useWatchTracker";
import { trackLearning, trackPlatform, trackEvent } from "@/lib/clarity";
import {
  Clock,
  Star,
  Users,
  PlayCircle,
  Lock,
  CheckCircle,
  Zap,
  Shield,
  Award,
  Smartphone,
  Infinity,
  ChevronLeft,
  Loader2,
  Volume2,
  VolumeX,
  Maximize,
  Pause,
  Phone,
  CreditCard,
  Wallet,
  Building2,
  X,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import QuizComponent from "@/components/QuizComponent";

// ─── Video Player Component ──────────────────────────────────────────────────

interface ProtectedVideoPlayerProps {
  videoUrl: string;
  hlsUrl?: string | null;
  username: string;
  lessonTitle: string;
  lessonId?: number;
  courseId?: number;
  isTrackingEnabled?: boolean;
}

interface ProtectedVideoPlayerHandle {
  getVideoRef: () => HTMLVideoElement | null;
}

const ProtectedVideoPlayer = forwardRef<ProtectedVideoPlayerHandle, ProtectedVideoPlayerProps>(
  function ProtectedVideoPlayerInner({ videoUrl, hlsUrl, username, lessonTitle, lessonId, courseId, isTrackingEnabled }, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [volume, setVolume] = useState(1);
  const hlsControllerRef = useRef<{ destroy: () => void } | null>(null); // HLS controller

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
      if (videoRef.current.buffered.length > 0) {
        const buffEnd = videoRef.current.buffered.end(videoRef.current.buffered.length - 1);
        setBuffered(buffEnd);
      }
    }
  }, []);

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    // Track video play in Clarity (fire once per play action)
    trackEvent("video_play", { lessonId: lessonId || 0, courseId: courseId || 0, lessonTitle });
  }, [lessonId, courseId, lessonTitle]);
  const handlePause = useCallback(() => setIsPlaying(false), []);

  const handleTogglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      // ✅ FIX: play() returns a Promise — catch DOMException (autoplay blocked)
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch((err: DOMException) => {
          // Autoplay was prevented — user needs to interact first (browser policy)
          console.warn("[Video] play() blocked:", err.message);
        });
      }
    } else {
      videoRef.current.pause();
    }
  }, []);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    videoRef.current.currentTime = pos * duration;
  }, [duration]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      setIsMuted(val === 0);
    }
  }, []);

  const handleToggleMute = useCallback(() => {
    if (!videoRef.current) return;
    if (isMuted) {
      videoRef.current.muted = false;
      videoRef.current.volume = volume || 0.5;
      setIsMuted(false);
    } else {
      videoRef.current.muted = true;
      setIsMuted(true);
    }
  }, [isMuted, volume]);

  const handleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!videoRef.current) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          handleTogglePlay();
          break;
        case "m":
          e.preventDefault();
          handleToggleMute();
          break;
        case "f":
          e.preventDefault();
          handleFullscreen();
          break;
        case "ArrowLeft":
          e.preventDefault();
          videoRef.current.currentTime -= 10;
          break;
        case "ArrowRight":
          e.preventDefault();
          videoRef.current.currentTime += 10;
          break;
        case "ArrowUp":
          e.preventDefault();
          videoRef.current.volume = Math.min(1, videoRef.current.volume + 0.1);
          break;
        case "ArrowDown":
          e.preventDefault();
          videoRef.current.volume = Math.max(0, videoRef.current.volume - 0.1);
          break;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleTogglePlay, handleToggleMute, handleFullscreen]);

  // ─── Watch Time Tracking ───
  const { resumePosition } = useWatchTracker({
    lessonId: lessonId || null,
    videoRef,
    enabled: !!isTrackingEnabled,
  });

  // ─── Video Source Loading (HLS or MP4) ───
  // Isolated in src/lib/hls-loader.ts to prevent minifier variable collisions
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    // Cleanup previous
    if (hlsControllerRef.current) {
      hlsControllerRef.current.destroy();
      hlsControllerRef.current = null;
    }

    const isHls = hlsUrl && (videoUrl.endsWith(".m3u8") || hlsUrl.endsWith(".m3u8"));
    const sourceUrl = isHls ? hlsUrl! : videoUrl;

    if (isHls) {
      import("@/lib/hls-loader").then(({ loadHlsVideo }) => {
        hlsControllerRef.current = loadHlsVideo({
          video,
          sourceUrl,
          fallbackUrl: videoUrl,
        });
      });
    } else {
      video.src = sourceUrl;
    }

    return () => {
      if (hlsControllerRef.current) {
        hlsControllerRef.current.destroy();
        hlsControllerRef.current = null;
      }
    };
  }, [videoUrl, hlsUrl]);

  // Auto-resume from saved position
  useEffect(() => {
    if (resumePosition > 5 && videoRef.current) {
      videoRef.current.currentTime = resumePosition;
    }
  }, [resumePosition]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedProgress = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className="protected-video no-select relative bg-black"
      onContextMenu={(e) => e.preventDefault()}
      data-lesson-id={lessonId || 0}
    >
      <div className="absolute inset-0 z-10 overflow-hidden pointer-events-none opacity-[0.03]">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="watermark whitespace-nowrap absolute text-white font-medium"
            style={{
              top: `${(i % 6) * 110 + 30}px`,
              left: `${(i % 2) * 120}px`,
              transform: "rotate(-15deg)",
              fontSize: "14px",
            }}
          >
            Elbaz LMS / {username}
          </div>
        ))}
      </div>

      <video
        ref={videoRef}
        className="aspect-video w-full"
        controlsList="nodownload nofullscreen noremoteplayback"
        disablePictureInPicture
        disableRemotePlayback
        playsInline
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onPlay={handlePlay}
        onPause={handlePause}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onCanPlay={() => setIsBuffering(false)}
        onDurationChange={() => setDuration(videoRef.current?.duration || 0)}
        onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
        onError={() => { setIsBuffering(false); setVideoError(true); }}
      >
        {lessonTitle}
      </video>

      {!isPlaying && (
        <button
          onClick={handleTogglePlay}
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 transition-opacity"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(6,182,212,0.9)] transition-transform hover:scale-110">
            <PlayCircle className="h-10 w-10 text-white ml-1" />
          </div>
        </button>
      )}

      {isBuffering && !videoError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <Loader2 className="h-10 w-10 animate-spin text-[#06b6d4]" />
        </div>
      )}

      {videoError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/80 gap-3">
          <AlertCircle className="h-10 w-10 text-[#ef4444]" />
          <p className="text-sm text-[#f0f4f8]">
            {lang === "en" ? "Failed to load video. Please try again." : "فشل تحميل الفيديو. يرجى المحاولة مرة أخرى."}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="border-[#06b6d4] text-[#06b6d4] hover:bg-[rgba(6,182,212,0.1)]"
            onClick={() => { setVideoError(false); if (videoRef.current) videoRef.current.load(); }}
          >
            {lang === "en" ? "Retry" : "إعادة المحاولة"}
          </Button>
        </div>
      )}

      <div className="absolute right-3 top-3 z-30 flex items-center gap-1 rounded-md border border-[#06b6d4] bg-[rgba(6,182,212,0.15)] px-2 py-1">
        <Shield className="h-3 w-3 text-[#06b6d4]" />
        <span className="text-[11px] font-medium text-[#06b6d4]">Protected</span>
      </div>

      <div
        className="absolute bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-3 pt-8 opacity-0 transition-opacity group-hover:opacity-100 hover:!opacity-100"
        style={{ opacity: isPlaying ? 0.6 : 0 }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = isPlaying ? "0.6" : "0")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="group/progress mb-2 h-1.5 cursor-pointer rounded-full bg-white/20 transition-all group-hover/progress:h-2.5"
          onClick={handleSeek}
        >
          <div className="absolute left-0 top-0 h-full rounded-full bg-white/20" style={{ width: `${bufferedProgress}%` }} />
          <div className="absolute left-0 top-0 h-full rounded-full bg-[#06b6d4]" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleTogglePlay} className="text-white transition-colors hover:text-[#06b6d4]">
            {isPlaying ? <Pause className="h-5 w-5" /> : <PlayCircle className="h-5 w-5" />}
          </button>
          <div className="group/vol flex items-center gap-1">
            <button onClick={handleToggleMute} className="text-white transition-colors hover:text-[#06b6d4]">
              {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="hidden h-1 w-16 cursor-pointer accent-[#06b6d4] group-hover/vol:block"
            />
          </div>
          <span className="text-xs text-white/80">{formatTime(currentTime)} / {formatTime(duration)}</span>
          <div className="flex-1" />
          <button onClick={handleFullscreen} className="text-white transition-colors hover:text-[#06b6d4]">
            <Maximize className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
});

// ─── Main Course Detail Page ─────────────────────────────────────────────────

export default function CourseDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { t, lang } = useTranslation();
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Store timeout IDs for cleanup to prevent memory leaks
  const pendingTimeouts = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Cleanup all pending timeouts on unmount
  useEffect(() => {
    return () => {
      pendingTimeouts.current.forEach(clearTimeout);
      pendingTimeouts.current = [];
    };
  }, []);

  const [activeLesson, setActiveLesson] = useState<number | null>(null);
  const [showQuiz, setShowQuiz] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [paymentStep, setPaymentStep] = useState<"idle" | "redirecting" | "processing" | "success" | "error">("idle");
  const [lastTransactionId, setLastTransactionId] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // Promo code states
  const [promoCode, setPromoCode] = useState("");
  const [promoValidation, setPromoValidation] = useState<{
    valid: boolean;
    promoId?: number;
    discountType?: string;
    discountValue?: string;
    discountAmount?: string;
    finalAmount?: string;
    description?: string;
    error?: string;
  } | null>(null);
  const [isApplyingPromo, setIsApplyingPromo] = useState(false);

  // Check if we're returning from a payment (via URL parameter)
  const checkingPaymentTxn = searchParams.get("txn");

  const { data: course, isLoading } = trpc.course.bySlug.useQuery(
    { slug: slug! },
    { enabled: !!slug }
  );

  // ✅ Track course view in Clarity (fires once per page load)
  useEffect(() => {
    if (course?.id) {
      trackLearning("course_view", { courseId: course.id, slug: slug, isPremium: course.isPremium });
    }
  }, [course?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: isEnrolled } = trpc.course.checkEnrollment.useQuery(
    { courseId: course?.id || 0 },
    { enabled: !!course && !!user }
  );

  const { data: videoData, isLoading: videoLoading } = trpc.course.lessonVideo.useQuery(
    { lessonId: activeLesson || 0 },
    { enabled: !!activeLesson && isAuthenticated }
  );

  // ✅ Derive values from course data (must be declared before use in hooks)
  const price = parseFloat(course?.price || "0");
  const title = lang === "ar" && course?.titleAr ? course?.titleAr : course?.titleEn;

  // ✅ Promo code validation query (manual trigger via refetch)
  const { data: promoResult, isFetching: isCheckingPromo, refetch: refetchPromo } = trpc.promo.validate.useQuery(
    {
      code: promoCode,
      courseId: course?.id,
      amount: price,
    },
    {
      enabled: false, // Don't auto-fetch, only on button click
    }
  );

  // Handle promo validation result
  useEffect(() => {
    if (promoResult) {
      setPromoValidation(promoResult);
      setIsApplyingPromo(false);
    }
  }, [promoResult]);

  // ✅ Poll payment status when returning from Paymob
  const { data: paymentStatus } = trpc.payment.verify.useQuery(
    { transactionId: checkingPaymentTxn || "" },
    {
      enabled: !!checkingPaymentTxn,
      refetchInterval: (data) => {
        // Stop polling when payment is confirmed or failed
        if (data?.status === "completed" || data?.status === "failed") return false;
        return 3000; // Poll every 3 seconds
      },
    }
  );

  // Handle payment result from polling
  useEffect(() => {
    if (!checkingPaymentTxn || !paymentStatus) return;

    if (paymentStatus.status === "completed") {
      setPaymentStep("success");
      // Clean URL after short delay
      const tid = setTimeout(() => {
        setSearchParams({}, { replace: true });
        window.location.reload();
      }, 2000);
      pendingTimeouts.current.push(tid);
    } else if (paymentStatus.status === "failed" || paymentStatus.status === "expired") {
      setPaymentStep("error");
      setSearchParams({}, { replace: true });
    }
  }, [paymentStatus?.status, checkingPaymentTxn, setSearchParams]);

  // Show processing state when checking payment
  useEffect(() => {
    if (checkingPaymentTxn && paymentStatus?.status === "pending") {
      setPaymentStep("processing");
    }
  }, [checkingPaymentTxn, paymentStatus?.status]);

  const enrollMutation = trpc.payment.create.useMutation({
    onSuccess: (data) => {
      if (data.duplicate) {
        // Duplicate payment attempt — just reload
        window.location.reload();
        return;
      }

      if (data.requiresRedirect && data.paymentUrl) {
        // ✅ PAID COURSE: Redirect to Paymob payment page
        trackPlatform("payment_initiated", { courseId: course?.id });
        setLastTransactionId(data.transactionId);
        setPaymentStep("redirecting");

        // Save transaction ID in case user closes the tab
        sessionStorage.setItem("pending_payment", data.transactionId);

        // Redirect to Paymob after a brief moment (to show the redirecting state)
        const tid = setTimeout(() => {
          window.location.href = data.paymentUrl!;
        }, 800);
        pendingTimeouts.current.push(tid);
      } else if (!data.requiresRedirect) {
        // ✅ FREE COURSE: Reload to show enrolled state
        window.location.reload();
      }
    },
    onError: (error) => {
      setPaymentStep("error");
      setPaymentError(error.message || "Failed to initiate payment");
    },
  });

  const handleEnroll = () => {
    if (!isAuthenticated) {
      trackEvent("enrollment_click", { courseId: course?.id, slug, source: "enroll_button", isLoggedIn: false });
      navigate("/login");
      return;
    }
    if (course?.isPremium && parseFloat(course.price || "0") > 0) {
      trackEvent("enrollment_click", { courseId: course?.id, slug, source: "enroll_button", isLoggedIn: true, isPremium: true });
      setShowPayment(true);
    } else {
      trackEvent("enrollment_click", { courseId: course?.id, slug, source: "enroll_button", isLoggedIn: true, isPremium: false });
      enrollMutation.mutate({
        courseId: course!.id,
        paymentMethod: "wallet",
        idempotencyKey: crypto.randomUUID(),
        phoneNumber: "",
      });
    }
  };

  const handlePayment = (method: "visa" | "wallet" | "paypal" | "kiosk" | "cash_collection") => {
    // ✅ Validate phone number (required by Paymob for all payment methods)
    const cleanPhone = phoneNumber.replace(/[\s\-\(\)]/g, "");
    if (cleanPhone.length < 11) {
      setPaymentError(lang === "ar" ? "رقم الموبايل مطلوب (11 رقم على الأقل)" : "Phone number is required (at least 11 digits)");
      return;
    }

    setPaymentError(null);
    setPaymentStep("idle");

    // Track payment method selection in Clarity
    trackEvent("payment_method_selected", { courseId: course?.id, method, slug });

    enrollMutation.mutate({
      courseId: course!.id,
      paymentMethod: method,
      idempotencyKey: crypto.randomUUID(),
      phoneNumber: cleanPhone,
    });
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0e17]">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-[#1f2d44] border-t-[#06b6d4]" />
      </div>
    );
  }

  if (!course) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0e17] px-4">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-[rgba(6,182,212,0.1)]">
            <AlertCircle className="h-10 w-10 text-[#06b6d4]" />
          </div>
          <h2 className="text-2xl font-bold text-[#f0f4f8]">
            {lang === "ar" ? "الكورس غير موجود" : "Course Not Found"}
          </h2>
          <p className="mt-2 text-[#94a3b8]">
            {lang === "ar" ? "هذا الكورس غير موجود أو تم حذفه" : "This course doesn't exist or has been removed"}
          </p>
          <Button
            className="mt-6 bg-gradient-to-r from-[#06b6d4] to-[#0891b2] text-[#0a0e17]"
            onClick={() => navigate("/courses")}
          >
            {lang === "ar" ? "تصفح الكورسات" : "Browse Courses"}
          </Button>
        </div>
      </div>
    );
  }

  const description = lang === "ar" && course.descriptionAr ? course.descriptionAr : course.descriptionEn;
  const rawOutcomes = lang === "ar" && course.learningOutcomesAr
    ? course.learningOutcomesAr
    : course.learningOutcomesEn;
  // ✅ FIX: Ensure outcomes is always an array (DB may store as JSON string)
  const outcomes = Array.isArray(rawOutcomes)
    ? rawOutcomes
    : typeof rawOutcomes === "string"
      ? (() => { try { const p = JSON.parse(rawOutcomes); return Array.isArray(p) ? p : []; } catch { return []; } })()
      : [];

  const activeLessonData = course.lessons?.find((l) => l.id === activeLesson);
  const activeLessonTitle = activeLessonData
    ? (lang === "ar" ? activeLessonData.titleAr : activeLessonData.titleEn)
    : "";

  const canAccessLesson = (lesson: typeof course.lessons[0]) => {
    if (!course.isPremium) return true;
    if (lesson.isFree) return true;
    return isEnrolled;
  };

  const isVideoReady = activeLesson && canAccessLesson(activeLessonData!) && videoData?.videoUrl;

  // Payment method icons
  const methodIcons: Record<string, typeof CreditCard> = {
    visa: CreditCard,
    wallet: Smartphone,
    paypal: Wallet,
    kiosk: Building2,
    cash_collection: Phone,
  };

  return (
    <div className="min-h-screen bg-[#0a0e17] pt-24">
      <div className="mx-auto max-w-7xl px-4 pb-20 lg:px-6">
        {/* Breadcrumb */}
        <button
          onClick={() => navigate("/courses")}
          className="mb-6 flex items-center gap-1 text-sm text-[#94a3b8] transition-colors hover:text-[#06b6d4]"
        >
          <ChevronLeft className="h-4 w-4" />
          {t("courses")}
        </button>

        <div className="grid gap-8 lg:grid-cols-3">
          {/* Main Content */}
          <div className="lg:col-span-2">
            {/* Video Player Area */}
            <div className="relative mb-8 overflow-hidden rounded-xl border border-[#1f2d44] bg-black">

              {/* Payment Processing Overlay */}
              {(paymentStep === "processing" || paymentStep === "redirecting") && (
                <div className="flex aspect-video items-center justify-center bg-gradient-to-br from-[#0f172a] to-[#1e293b]">
                  <div className="text-center">
                    <Loader2 className="mx-auto h-12 w-12 animate-spin text-[#06b6d4]" />
                    <p className="mt-4 text-base font-medium text-[#f0f4f8]">
                      {paymentStep === "redirecting"
                        ? (lang === "en" ? "Redirecting to payment gateway..." : "جاري التحويل لبوابة الدفع...")
                        : (lang === "en" ? "Verifying payment..." : "جاري التحقق من الدفع...")
                      }
                    </p>
                    <p className="mt-2 text-sm text-[#94a3b8]">
                      {lang === "en" ? "Please wait, do not close this page" : "يرجى الانتظار، لا تغلق هذه الصفحة"}
                    </p>
                  </div>
                </div>
              )}

              {/* Payment Success Overlay */}
              {paymentStep === "success" && (
                <div className="flex aspect-video items-center justify-center bg-gradient-to-br from-[#0f172a] to-[#1e293b]">
                  <div className="text-center">
                    <CheckCircle2 className="mx-auto h-16 w-16 text-[#10b981]" />
                    <p className="mt-4 text-xl font-bold text-[#10b981]">
                      {t("transactionSuccessful")}
                    </p>
                    <p className="mt-2 text-sm text-[#94a3b8]">
                      {lang === "en" ? "Redirecting to course..." : "جاري التحويل للكورس..."}
                    </p>
                  </div>
                </div>
              )}

              {/* Payment Error Overlay */}
              {paymentStep === "error" && !showPayment && (
                <div className="flex aspect-video items-center justify-center bg-gradient-to-br from-[#0f172a] to-[#1e293b]">
                  <div className="text-center">
                    <AlertCircle className="mx-auto h-12 w-12 text-[#ef4444]" />
                    <p className="mt-4 text-base font-medium text-[#f0f4f8]">
                      {t("transactionFailed")}
                    </p>
                    <p className="mt-2 text-sm text-[#94a3b8]">
                      {paymentError || (lang === "en" ? "Please try again" : "يرجى المحاولة مرة أخرى")}
                    </p>
                    <Button
                      className="mt-4 bg-gradient-to-r from-[#06b6d4] to-[#0891b2] text-[#0a0e17]"
                      onClick={() => { setPaymentStep("idle"); setPaymentError(null); }}
                    >
                      {lang === "en" ? "Try Again" : "حاول مرة أخرى"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Normal video area (hidden during payment processing) */}
              {paymentStep !== "processing" && paymentStep !== "redirecting" && paymentStep !== "success" && paymentStep !== "error" && (
                <>
                  {activeLesson && canAccessLesson(activeLessonData!) && videoLoading && (
                    <div className="flex aspect-video items-center justify-center bg-gradient-to-br from-[#0f172a] to-[#1e293b]">
                      <div className="text-center">
                        <Loader2 className="mx-auto h-10 w-10 animate-spin text-[#06b6d4]" />
                        <p className="mt-3 text-sm text-[#94a3b8]">
                          {lang === "en" ? "Loading video..." : "جاري تحميل الفيديو..."}
                        </p>
                      </div>
                    </div>
                  )}

                  {isVideoReady && (
                    <ProtectedVideoPlayer
                      videoUrl={videoData.videoUrl}
                      hlsUrl={videoData.hlsUrl}
                      username={user?.username || "guest"}
                      lessonTitle={activeLessonTitle}
                      lessonId={activeLesson || undefined}
                      courseId={course?.id}
                      isTrackingEnabled={isAuthenticated}
                    />
                  )}

                  {activeLesson && canAccessLesson(activeLessonData!) && !videoLoading && !videoData?.videoUrl && (
                    <div className="flex aspect-video items-center justify-center bg-gradient-to-br from-[#0f172a] to-[#1e293b]">
                      <div className="text-center">
                        <PlayCircle className="mx-auto h-12 w-12 text-[#06b6d4]" />
                        <p className="mt-3 text-sm text-[#94a3b8]">
                          {lang === "en" ? "No video available for this lesson" : "لا يوجد فيديو متاح لهذا الدرس"}
                        </p>
                      </div>
                    </div>
                  )}

                  {!activeLesson || !canAccessLesson(activeLessonData!) ? (
                    <div className="relative">
                      <img
                        src={course.thumbnail || "/hero-bg.jpg"}
                        alt={title}
                        className="aspect-video w-full object-cover opacity-60"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                        <div className="text-center">
                          {!isEnrolled && course.isPremium ? (
                            <>
                              <Lock className="mx-auto h-12 w-12 text-[#f59e0b]" />
                              <p className="mt-3 text-sm text-[#f0f4f8]">
                                {lang === "en" ? "Enroll to unlock all lessons" : "سجل للوصول لجميع الدروس"}
                              </p>
                            </>
                          ) : (
                            <>
                              <PlayCircle className="mx-auto h-12 w-12 text-[#06b6d4]" />
                              <p className="mt-3 text-sm text-[#f0f4f8]">
                                {lang === "en" ? "Select a lesson to start" : "اختر درساً للبدء"}
                              </p>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>

            {/* Course Info */}
            <div className="mb-8">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded bg-[rgba(6,182,212,0.15)] px-2 py-0.5 text-xs font-medium text-[#06b6d4]">
                  {course.category?.nameEn || "Engineering"}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    course.isPremium
                      ? "bg-[#06b6d4] text-[#0a0e17]"
                      : "border border-[#f59e0b] text-[#f59e0b]"
                  }`}
                >
                  {course.isPremium ? t("premium") : t("free")}
                </span>
              </div>
              <h1 className="mt-3 text-2xl font-bold text-[#f0f4f8] lg:text-3xl">{title}</h1>
              <p className="mt-4 leading-relaxed text-[#94a3b8]">{description}</p>
            </div>

            {/* What you'll learn */}
            {Array.isArray(outcomes) && outcomes.length > 0 && (
              <div className="mb-8 rounded-xl border border-[#1f2d44] bg-[#111827] p-6">
                <h2 className="text-lg font-semibold text-[#f0f4f8]">{t("whatYouWillLearn")}</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {outcomes.map((outcome: string, i: number) => (
                    <div key={i} className="flex items-start gap-2">
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#10b981]" />
                      <span className="text-sm text-[#94a3b8]">{outcome}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quiz */}
            {activeLesson && canAccessLesson(activeLessonData!) && (
              <div className="mb-8 rounded-xl border border-[#1f2d44] bg-[#111827] p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-[#f0f4f8]">
                    {lang === "en" ? "Lesson Quiz" : "اختبار الدرس"}
                  </h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowQuiz(!showQuiz)}
                    className="border-[#1f2d44] text-[#06b6d4] hover:bg-[rgba(6,182,212,0.05)]"
                  >
                    {showQuiz ? t("cancel") : t("takeQuiz")}
                  </Button>
                </div>
                {showQuiz && (
                  <div className="mt-4">
                    <QuizComponent lessonId={activeLesson} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Enrollment Card */}
            <div className="sticky top-24 rounded-xl border border-[#1f2d44] bg-[#111827] p-6">
              {isEnrolled ? (
                <>
                  <div className="flex items-center gap-2 text-[#10b981]">
                    <CheckCircle className="h-5 w-5" />
                    <span className="font-semibold">{t("youAreEnrolled")}</span>
                  </div>
                  <p className="mt-2 text-sm text-[#94a3b8]">
                    {lang === "en" ? "Continue your learning journey" : "واصل رحلتك التعليمية"}
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-baseline gap-2">
                    {price > 0 ? (
                      <>
                        {promoValidation?.valid ? (
                          <>
                            {/* Show original price with strikethrough */}
                            <span className="text-lg text-[#64748b] line-through">
                              {price.toLocaleString()} {lang === "ar" ? "ج.م" : "EGP"}
                            </span>
                            {/* Show discount amount */}
                            <span className="rounded bg-[rgba(16,185,129,0.15)] px-1.5 py-0.5 text-xs font-semibold text-[#10b981]">
                              -{promoValidation.discountAmount} {lang === "ar" ? "ج.م" : "EGP"}
                            </span>
                            {/* Show final discounted price */}
                            <span className="text-3xl font-bold text-[#10b981]">
                              {promoValidation.finalAmount} {lang === "ar" ? "ج.م" : "EGP"}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-3xl font-bold text-[#f0f4f8]">
                              {price.toLocaleString()} {lang === "ar" ? "ج.م" : "EGP"}
                            </span>
                            {course.originalPrice && parseFloat(course.originalPrice) > 0 && (
                              <span className="text-lg text-[#64748b] line-through">
                                {parseFloat(course.originalPrice).toLocaleString()} {lang === "ar" ? "ج.م" : "EGP"}
                              </span>
                            )}
                          </>
                        )}
                      </>
                    ) : (
                      <span className="text-2xl font-bold text-[#10b981]">{t("free")}</span>
                    )}
                  </div>
                  <Button
                    className="glow-btn mt-4 w-full bg-gradient-to-r from-[#06b6d4] to-[#0891b2] font-semibold text-[#0a0e17]"
                    onClick={handleEnroll}
                    disabled={enrollMutation.isPending || paymentStep === "redirecting" || paymentStep === "processing"}
                  >
                    {enrollMutation.isPending || paymentStep === "redirecting" || paymentStep === "processing"
                      ? t("loading")
                      : price > 0
                      ? t("buyNow")
                      : t("enrollForFree")}
                  </Button>
                </>
              )}

              <div className="mt-6 space-y-3">
                <h3 className="text-sm font-semibold text-[#f0f4f8]">{t("thisCourseIncludes")}</h3>
                {[
                  { icon: <Infinity className="h-4 w-4" />, text: t("lifetimeAccess") },
                  { icon: <Smartphone className="h-4 w-4" />, text: t("mobileAccess") },
                  { icon: <Award className="h-4 w-4" />, text: t("certificateCompletion") },
                  { icon: <Shield className="h-4 w-4" />, text: t("drmProtected") },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-[#94a3b8]">
                    <span className="text-[#06b6d4]">{item.icon}</span>
                    {item.text}
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-wrap gap-4 border-t border-[#1f2d44] pt-4">
                <div className="flex items-center gap-1">
                  <Star className="h-4 w-4 fill-[#f59e0b] text-[#f59e0b]" />
                  <span className="text-sm text-[#f0f4f8]">{course.rating}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Users className="h-4 w-4 text-[#64748b]"/>
                  <span className="text-sm text-[#94a3b8]">{course.studentCount}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4 text-[#64748b]" />
                  <span className="text-sm text-[#94a3b8]">
                    {course.durationHours}{t("hours")}
                  </span>
                </div>
              </div>
            </div>

            {/* Lesson List */}
            <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-6">
              <h2 className="mb-4 text-lg font-semibold text-[#f0f4f8]">{t("courseContent")}</h2>
              <div className="space-y-1">
                {course.lessons?.map((lesson, i) => {
                  const canAccess = canAccessLesson(lesson);
                  const isActive = activeLesson === lesson.id;
                  return (
                    <button
                      key={lesson.id}
                      onClick={() => {
                        if (canAccess) {
                          setActiveLesson(lesson.id);
                          setShowQuiz(false);
                        }
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start transition-colors ${
                        isActive
                          ? "bg-[rgba(6,182,212,0.1)] border border-[rgba(6,182,212,0.2)]"
                          : canAccess
                          ? "hover:bg-[#1a2233]"
                          : "opacity-50 cursor-not-allowed"
                      }`}
                    >
                      {canAccess ? (
                        <PlayCircle className={`h-4 w-4 shrink-0 ${isActive ? "text-[#06b6d4]" : "text-[#94a3b8]"}`} />
                      ) : (
                        <Lock className="h-4 w-4 shrink-0 text-[#64748b]" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm text-[#f0f4f8]">
                          {i + 1}. {lang === "ar" ? lesson.titleAr : lesson.titleEn}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-[#64748b]">
                        {lesson.durationMinutes != null ? `${lesson.durationMinutes}m` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ✅ Payment Modal with Phone Number */}
      {showPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              if (paymentStep === "error") setPaymentStep("idle");
              setPromoCode("");
              setPromoValidation(null);
              setShowPayment(false);
            }
          }}
        >
          <div className="mx-4 w-full max-w-md rounded-xl border border-[#1f2d44] bg-[#111827] p-6 relative">
            {/* Close button */}
            <button
              onClick={() => {
                setPaymentStep("idle");
                setPaymentError(null);
                setPromoCode("");
                setPromoValidation(null);
                setShowPayment(false);
              }}
              className="absolute right-4 top-4 text-[#94a3b8] hover:text-[#f0f4f8] transition-colors"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="text-lg font-semibold text-[#f0f4f8]">{t("paymentMethods")}</h2>
            <p className="mt-1 text-sm text-[#94a3b8]">
              {price.toLocaleString()} {lang === "ar" ? "ج.م" : "EGP"} — {title}
            </p>

            {/* ✅ Phone Number Input (required by Paymob) */}
            <div className="mt-4">
              <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[#f0f4f8]">
                <Phone className="h-4 w-4 text-[#06b6d4]" />
                {lang === "en" ? "Phone Number" : "رقم الموبايل"}
                <span className="text-[#ef4444]">*</span>
              </label>
              <input
                type="tel"
                dir="ltr"
                placeholder="01012345678"
                value={phoneNumber}
                onChange={(e) => {
                  // Only allow digits
                  const val = e.target.value.replace(/\D/g, "");
                  setPhoneNumber(val);
                  setPaymentError(null);
                }}
                maxLength={15}
                className="w-full rounded-lg border border-[#1f2d44] bg-[#0a0e17] px-4 py-2.5 text-sm text-[#f0f4f8] placeholder-[#64748b] focus:border-[#06b6d4] focus:outline-none focus:ring-1 focus:ring-[#06b6d4]"
              />
              {lang === "ar" ? (
                <p className="mt-1 text-xs text-[#64748b]">مطلوب لبوابة الدفع Paymob (أدخل 11 رقم)</p>
              ) : (
                <p className="mt-1 text-xs text-[#64748b]">Required by Paymob gateway (enter 11 digits)</p>
              )}
            </div>

            {/* Promo Code Section */}
            <div className="mt-4 rounded-lg border border-[#1f2d44] bg-[#0a0e17] p-4">
              <label className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[#f0f4f8]">
                <Zap className="h-4 w-4 text-[#f59e0b]" />
                {lang === "ar" ? "كود الخصم" : "Promo Code"}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  dir="ltr"
                  placeholder={lang === "ar" ? "مثال: ELBAZ20" : "e.g. ELBAZ20"}
                  value={promoCode}
                  onChange={(e) => {
                    setPromoCode(e.target.value.toUpperCase());
                    setPromoValidation(null);
                  }}
                  maxLength={20}
                  className="flex-1 rounded-lg border border-[#1f2d44] bg-[#111827] px-4 py-2.5 text-sm text-[#f0f4f8] placeholder-[#64748b] focus:border-[#f59e0b] focus:outline-none focus:ring-1 focus:ring-[#f59e0b]"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!promoCode.trim()) return;
                    setIsApplyingPromo(true);
                    refetchPromo();
                  }}
                  disabled={!promoCode.trim() || isApplyingPromo}
                  className="border-[#f59e0b] text-[#f59e0b] hover:bg-[rgba(245,158,11,0.1)] shrink-0"
                >
                  {isApplyingPromo || isCheckingPromo ? "..." : lang === "ar" ? "تطبيق" : "Apply"}
                </Button>
              </div>

              {/* Promo result */}
              {promoValidation && (
                <div className={`mt-3 rounded-lg px-3 py-2 ${
                  promoValidation.valid
                    ? "border border-[rgba(16,185,129,0.3)] bg-[rgba(16,185,129,0.1)]"
                    : "border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.1)]"
                }`}>
                  {promoValidation.valid ? (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-[#10b981]" />
                        <span className="text-xs text-[#10b981]">
                          {lang === "ar" ? "تم تطبيق الكود!" : "Code applied!"}
                          {promoValidation.discountType === "percentage"
                            ? ` (${promoValidation.discountValue}% ${lang === "ar" ? "خصم" : "off"})`
                            : ` (${promoValidation.discountAmount} EGP ${lang === "ar" ? "خصم" : "off"})`
                          }
                        </span>
                      </div>
                      <span className="text-sm font-bold text-[#10b981]">
                        {lang === "ar" ? "السعر النهائي" : "Final"}: {promoValidation.finalAmount} {lang === "ar" ? "ج.م" : "EGP"}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-[#ef4444]" />
                      <span className="text-xs text-[#ef4444]">{promoValidation.error}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Error message */}
            {paymentError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.1)] px-3 py-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-[#ef4444]" />
                <span className="text-xs text-[#ef4444]">{paymentError}</span>
              </div>
            )}

            {/* Payment Methods */}
            <div className="mt-5 space-y-3">
              {[
                { key: "visa" as const, label: lang === "en" ? "Card Payment" : "بطاقة ائتمان", desc: lang === "en" ? "Visa / Mastercard" : "فيزا / ماستركارد" },
                { key: "wallet" as const, label: lang === "en" ? "Mobile Wallet" : "محفظة موبايل", desc: lang === "en" ? "Vodafone / Orange / Etisalat" : "فودافون / أورانج / اتصالات" },
                { key: "kiosk" as const, label: lang === "en" ? "Kiosk" : "كiosk (فوري / أمين)", desc: lang === "en" ? "Pay at nearest kiosk" : "ادفع من أقرب فرع فوري أو أمين" },
                { key: "cash_collection" as const, label: lang === "en" ? "Cash Collection" : "تحصيل نقدى", desc: lang === "en" ? "Pay on delivery" : "دفع عند الاستلام" },
                { key: "paypal" as const, label: "PayPal", desc: lang === "en" ? "International (USD)" : "دولار أمريكي" },
              ].map((method) => {
                const Icon = methodIcons[method.key] || CreditCard;
                return (
                  <button
                    key={method.key}
                    onClick={() => handlePayment(method.key)}
                    disabled={enrollMutation.isPending || paymentStep === "redirecting" || paymentStep === "processing"}
                    className="flex w-full items-center gap-3 rounded-lg border border-[#1f2d44] p-4 text-start transition-colors hover:border-[#06b6d4] hover:bg-[rgba(6,182,212,0.05)] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-[#1a2233]">
                      <Icon className="h-4 w-4 text-[#06b6d4]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-[#f0f4f8]">{method.label}</span>
                      <p className="text-xs text-[#64748b]">{method.desc}</p>
                    </div>
                    <Zap className="h-4 w-4 text-[#64748b]" />
                  </button>
                );
              })}
            </div>

            <Button
              variant="ghost"
              className="mt-4 w-full text-[#94a3b8] hover:text-[#f0f4f8]"
              onClick={() => {
                setPaymentStep("idle");
                setPaymentError(null);
                setPromoCode("");
                setPromoValidation(null);
                setShowPayment(false);
              }}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
