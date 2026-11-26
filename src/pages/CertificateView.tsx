import {
  AlertCircle,
  Award,
  CheckCircle2,
  ChevronRight,
  Download,
  ImageDown,
  Loader2,
  Printer,
  Share2,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import CertificateCard from "@/components/CertificateCard";
import { useTranslation } from "@/hooks/useTranslation";
import { generateQRCodeSVG } from "@/lib/qr-code";
import { trpc } from "@/providers/trpc";

/* ── Share image generator (Brand Kit suggestion #5) ─────────────────────
   Draws a 1200×630 brand card (LinkedIn/Facebook OG size) entirely
   client-side: navy background, the official orange→cyan signature bars,
   circular platform logo, graduate name, course, certificate number, a
   scannable QR pointing at /verify/<number>, and the green proof badge.
   Every graduate who posts this image becomes a backlink to the platform —
   the exact SEO gap (natural external links) the review identified. */
const SHARE_IMG_W = 1200;
const SHARE_IMG_H = 630;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image load failed: ${src}`));
    img.src = src;
  });
}

/** Shrink the font size until the text fits maxWidth (single line). */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, weight: string, family: string, basePx: number, minPx = 20): number {
  let px = basePx;
  ctx.font = `${weight} ${px}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && px > minPx) {
    px -= 2;
    ctx.font = `${weight} ${px}px ${family}`;
  }
  return px;
}

async function buildCertificateShareImage(data: {
  studentName: string;
  courseName: string;
  certificateNumber: string;
  lang: "ar" | "en";
}): Promise<Blob | null> {
  const { studentName, courseName, certificateNumber, lang } = data;
  const canvas = document.createElement("canvas");
  canvas.width = SHARE_IMG_W;
  canvas.height = SHARE_IMG_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.direction = lang === "ar" ? "rtl" : "ltr";

  // Brand fonts (self-hosted Cairo/Inter) must be ready before drawing text
  try {
    await Promise.all([
      document.fonts.load('700 58px Cairo'),
      document.fonts.load('600 32px Cairo'),
      document.fonts.load('600 20px Inter'),
    ]);
  } catch { /* system fallback fonts still render readable text */ }

  // ✅ PERF (react-best-practices async-waterfall): the logo (network fetch)
  // and the QR (local data-URI rasterization) are fully independent — they
  // used to be awaited sequentially with ~50 lines of text drawing in between,
  // so the network round-trip added its full latency to the share-image build.
  // Start BOTH loads now and await each inside its original guarded block
  // below; identical error semantics (each catch still ships the card).
  const logoPromise = loadImage("/logo-circle.png?v=2");
  const qrPromise = (async () => {
    // The library emits width/height:100% styling; as an <img> raster source
    // it needs explicit pixel dimensions — strip the style and pin the size.
    const svg = generateQRCodeSVG(`https://ahmedelbaz.qzz.io/verify/${certificateNumber}`, 260)
      .replace(/style="[^"]*"/, "")
      .replace("<svg ", '<svg width="260" height="260" ');
    return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  })();

  // ── Background: navy + soft cyan glow behind the logo ──
  ctx.fillStyle = "#0a1628";
  ctx.fillRect(0, 0, SHARE_IMG_W, SHARE_IMG_H);
  const glow = ctx.createRadialGradient(SHARE_IMG_W / 2, 110, 30, SHARE_IMG_W / 2, 110, 540);
  glow.addColorStop(0, "rgba(6,182,212,0.16)");
  glow.addColorStop(1, "rgba(6,182,212,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SHARE_IMG_W, SHARE_IMG_H);

  // ── The official signature bars (orange→cyan — Brand Kit §2) ──
  const sig = ctx.createLinearGradient(90, 0, SHARE_IMG_W - 90, 0);
  sig.addColorStop(0, "rgba(249,115,22,0)");
  sig.addColorStop(0.22, "#F97316");
  sig.addColorStop(0.78, "#06b6d4");
  sig.addColorStop(1, "rgba(6,182,212,0)");
  ctx.fillStyle = sig;
  ctx.fillRect(90, 42, SHARE_IMG_W - 180, 5);
  ctx.fillRect(90, SHARE_IMG_H - 47, SHARE_IMG_W - 180, 5);

  // ── Circular platform logo, top center ──
  try {
    const logo = await logoPromise;
    ctx.save();
    ctx.beginPath();
    ctx.arc(SHARE_IMG_W / 2, 122, 46, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logo, SHARE_IMG_W / 2 - 46, 76, 92, 92);
    ctx.restore();
    ctx.strokeStyle = "rgba(6,182,212,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(SHARE_IMG_W / 2, 122, 48, 0, Math.PI * 2);
    ctx.stroke();
  } catch { /* logo missing — the text-only card still ships */ }

  // ── Text stack ──
  ctx.fillStyle = "#06b6d4";
  ctx.font = '600 22px Cairo, sans-serif';
  ctx.fillText(
    lang === "ar" ? "منصة م. أحمد الباز — Electrical Engineering Academy" : "Elbaz Platform — Electrical Engineering Academy",
    SHARE_IMG_W / 2,
    206,
  );

  ctx.fillStyle = "#f0f4f8";
  ctx.font = '700 50px Cairo, sans-serif';
  ctx.fillText(lang === "ar" ? "شهادة إتمام كورس" : "Certificate of Completion", SHARE_IMG_W / 2, 268);

  ctx.fillStyle = "#94a3b8";
  ctx.font = '500 24px Cairo, sans-serif';
  ctx.fillText(lang === "ar" ? "تُمنح بامتياز إلى" : "Proudly presented to", SHARE_IMG_W / 2, 316);

  // Graduate name — the hero of the card, tinted with the signature gradient
  fitText(ctx, studentName, 920, "700", "Cairo, sans-serif", 58);
  const nameGrad = ctx.createLinearGradient(SHARE_IMG_W / 2 - 460, 0, SHARE_IMG_W / 2 + 460, 0);
  nameGrad.addColorStop(0.15, "#F97316");
  nameGrad.addColorStop(0.85, "#06b6d4");
  ctx.fillStyle = nameGrad;
  ctx.fillText(studentName, SHARE_IMG_W / 2, 386);

  fitText(ctx, courseName, 880, "600", "Cairo, sans-serif", 30);
  ctx.fillStyle = "#f0f4f8";
  ctx.fillText(courseName, SHARE_IMG_W / 2, 438);

  ctx.fillStyle = "#94a3b8";
  ctx.font = '600 20px Inter, sans-serif';
  ctx.fillText(
    `${lang === "ar" ? "رقم الشهادة" : "Certificate No"}: ${certificateNumber}`,
    SHARE_IMG_W / 2,
    494,
  );
  ctx.fillText(
    `${lang === "ar" ? "تحقّق فوراً" : "Verify instantly"}: ahmedelbaz.qzz.io/verify/${certificateNumber}`,
    SHARE_IMG_W / 2,
    528,
  );

  // ── QR — white plate so it stays scannable on the dark background ──
  try {
    const qr = await qrPromise;
    const plate = 128;
    const plateX = SHARE_IMG_W - 90 - plate;
    const plateY = 462;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(plateX, plateY, plate, plate, 14);
    ctx.fill();
    ctx.drawImage(qr, plateX + 8, plateY + 8, plate - 16, plate - 16);
  } catch { /* QR rasterization failed — the verify URL line carries the link */ }

  // ── Green proof badge (Brand Kit §7) — mirrors the QR on the left ──
  const badgeX = 90 + 10;
  const badgeY = 462 + 64;
  ctx.fillStyle = "rgba(16,185,129,0.14)";
  ctx.beginPath();
  ctx.arc(badgeX + 34, badgeY, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#10b981";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(badgeX + 20, badgeY + 1);
  ctx.lineTo(badgeX + 30, badgeY + 12);
  ctx.lineTo(badgeX + 49, badgeY - 12);
  ctx.stroke();
  ctx.fillStyle = "#10b981";
  ctx.font = '700 18px Cairo, sans-serif';
  ctx.fillText(lang === "ar" ? "شهادة موثقة" : "Verified", badgeX + 34, badgeY + 58);

  return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
}

export default function CertificateView() { // NOSONAR — certificate view with print, download, share, LinkedIn-share, copy-link; extraction would require prop-drilling many handlers
  const { certificateNumber } = useParams<{ certificateNumber: string }>();
  const { t, lang } = useTranslation();
  const navigate = useNavigate();
  const [showLinkedInShare, setShowLinkedInShare] = useState(false);

  const { data: cert, isLoading, isError } = trpc.certificate.verify.useQuery(
    { certificateNumber: certificateNumber || "" },
    { enabled: !!certificateNumber }
  );

  const handlePrint = () => {
    globalThis.print();
  };

  const handleDownloadPDF = async () => {
    // Use browser's print dialog as PDF download
    // The print-optimized CSS will handle the layout
    try {
      globalThis.print();
    } catch {
      toast.error(lang === "ar" ? "فشل تحميل الشهادة" : "Failed to download certificate");
    }
  };

  const handleShareLinkedIn = () => {
    // ✅ FIX (pre-launch audit): the certificate URL was hardcoded to the
    // production domain — previews/dev/native shells shared broken links.
    // location.origin always matches wherever the certificate is actually served.
    const certUrl = `${globalThis.location.origin}/certificate/${certificateNumber}`;
    const fallbackShareText = lang === "ar"
      ? "لقد حصلت على شهادة من منصة الباز!"
      : "I've earned a certificate from Elbaz Platform!";
    const shareText = cert
      ? `I've earned a certificate in "${cert.courseName}" from Elbaz Platform - Electrical Engineering Academy! 🎓`
      : fallbackShareText;

    const linkedInUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(certUrl)}&summary=${encodeURIComponent(shareText)}`;
    globalThis.open(linkedInUrl, "_blank", "width=600,height=500");
    setShowLinkedInShare(false);
  };

  const handleCopyLink = async () => {
    const url = globalThis.location.href;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(lang === "ar" ? "تم نسخ الرابط" : "Link copied to clipboard");
    } catch {
      toast.error(lang === "ar" ? "فشل نسخ الرابط" : "Failed to copy link");
    }
  };

  // Brand Kit suggestion #5 — generate a 1200×630 branded PNG of this
  // certificate. Uses the Web Share API on mobile when available (share
  // sheet straight to WhatsApp/LinkedIn) and falls back to a download.
  const handleDownloadShareImage = async () => {
    if (!cert) return;
    try {
      const blob = await buildCertificateShareImage({
        studentName: cert.studentName || cert.studentUsername || "Student",
        courseName: cert.courseName || "Course",
        certificateNumber: cert.certificateNumber,
        lang,
      });
      if (!blob) throw new Error("canvas unavailable");
      const fileName = `certificate-${cert.certificateNumber}.png`;
      const file = new File([blob], fileName, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (typeof nav.canShare === "function" && nav.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: lang === "ar" ? "شهادة إتمام كورس" : "Certificate of Completion",
          text: lang === "ar"
            ? `حصلت على شهادة إتمام كورس "${cert.courseName}" من منصة م. أحمد الباز`
            : `I've earned a certificate in "${cert.courseName}" from Elbaz Platform`,
        });
        setShowLinkedInShare(false);
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(lang === "ar" ? "تم تجهيز صورة المشاركة (1200×630)" : "Share image ready (1200×630)");
      setShowLinkedInShare(false);
    } catch {
      toast.error(lang === "ar" ? "تعذر توليد صورة المشاركة" : "Failed to generate share image");
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background pt-[calc(6rem+env(safe-area-inset-top,0px))]">
        <div className="text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-accent-secondary" />
          <p className="mt-4 text-text-muted">
            {lang === "ar" ? "جاري التحقق من الشهادة..." : "Verifying certificate..."}
          </p>
        </div>
      </div>
    );
  }

  const errorStatusBlock = isError || cert ? null : (
    <div className="flex items-center gap-3 rounded-xl border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.05)] px-4 py-3">
      <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
      <div>
        <p className="text-sm font-medium text-destructive">
          {lang === "ar" ? "الشهادة غير صالحة" : "Certificate Not Found"}
        </p>
        <p className="mt-0.5 text-xs text-text-muted">
          {lang === "ar"
            ? "لم يتم العثور على شهادة بهذا الرقم. تأكد من صحة الرقم."
            : "No certificate found with this number. Please check and try again."}
        </p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background pt-[calc(6rem+env(safe-area-inset-top,0px))] pb-20">
      <div className="mx-auto max-w-7xl px-4 lg:px-6">
        {/* Breadcrumb */}
        <button
          onClick={() => navigate(-1)}
          className="mb-6 flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-accent-secondary"
        >
          <ChevronRight className="h-4 w-4 rtl:rotate-180" />
          {lang === "ar" ? "رجوع" : "Back"}
        </button>

        {/* Action Buttons - hidden during print */}
        <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[rgba(6,182,212,0.1)]">
              <Award className="h-6 w-6 text-accent-secondary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                {lang === "ar" ? "شهادة الإتمام" : "Certificate of Completion"}
              </h1>
              <p className="text-sm text-text-muted">
                {cert
                  ? `${cert.studentName || cert.studentUsername} — ${cert.courseName}`
                  : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 rounded-lg border border-border bg-primary px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-accent-secondary hover:text-accent-secondary"
            >
              <Printer className="h-4 w-4" />
              {t("print")}
            </button>
            <button
              onClick={handleDownloadPDF}
              className="flex items-center gap-2 rounded-lg border border-border bg-primary px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-accent-secondary hover:text-accent-secondary"
            >
              <Download className="h-4 w-4" />
              {t("download")} PDF
            </button>
            <div className="relative">
              <button
                onClick={() => setShowLinkedInShare(!showLinkedInShare)}
                className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-accent-secondary to-accent-secondary/80 px-4 py-2.5 text-sm font-semibold text-background transition-all hover:shadow-[0_4px_12px_rgba(6,182,212,0.3)]"
              >
                <Share2 className="h-4 w-4" />
                {t("share")}
              </button>

              {/* Share Dropdown */}
              {showLinkedInShare && (
                <>
                  {/* Dropdown backdrop — keyboard-accessible via Escape so
                      screen-reader users can close the menu without a mouse
                      (SonarCloud S1082). */}
                  <button
                    type="button"
                    className="fixed inset-0 z-40 w-full h-full cursor-default"
                    aria-label="Close share menu"
                    onClick={() => setShowLinkedInShare(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setShowLinkedInShare(false);
                      }
                    }}
                  />
                  <div className="absolute end-0 top-full z-50 mt-2 w-56 rounded-xl border border-border bg-primary p-2 shadow-xl">
                    <button
                      onClick={handleShareLinkedIn}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-[rgba(6,182,212,0.1)]"
                    >
                      <Share2 className="h-4 w-4 text-accent" />
                      LinkedIn
                    </button>
                    <button
                      onClick={handleCopyLink}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-[rgba(6,182,212,0.1)]"
                    >
                      <svg className="h-4 w-4 text-accent-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                      {lang === "ar" ? "نسخ الرابط" : "Copy Link"}
                    </button>
                    {/* Brand Kit #5 — branded share image (1200×630) for
                        LinkedIn/Facebook posts; every post carries the
                        platform logo + signature + verify URL. */}
                    <button
                      onClick={handleDownloadShareImage}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-[rgba(6,182,212,0.1)]"
                    >
                      <ImageDown className="h-4 w-4 text-accent" />
                      {lang === "ar" ? "صورة للمشاركة (1200×630)" : "Share image (1200×630)"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Verification Status - hidden during print */}
        <div className="no-print mb-6">
          {cert?.verified ? (
            <div className="flex items-center gap-3 rounded-xl border border-[rgba(16,185,129,0.2)] bg-[rgba(16,185,129,0.05)] px-4 py-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
              <div>
                <p className="text-sm font-medium text-emerald-500">
                  {lang === "ar" ? "هذه الشهادة موثقة ومعتمدة" : "This certificate is verified and authentic"}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {lang === "ar"
                    ? `رقم الشهادة: ${cert.certificateNumber}`
                    : `Certificate No: ${cert.certificateNumber}`}
                </p>
              </div>
            </div>
          ) : errorStatusBlock}
        </div>

        {/* Certificate */}
        {cert ? (
          <div className="overflow-x-auto rounded-xl border border-border bg-background p-4 md:p-8">
            <CertificateCard
              data={{
                studentName: cert.studentName || cert.studentUsername || "Student",
                courseName: cert.courseName || "Course",
                courseNameAr: cert.courseNameAr || "",
                certificateNumber: cert.certificateNumber,
                issuedAt: cert.issuedAt || new Date(),
                grade: cert.grade || "Pass",
                averageScore: cert.averageScore ?? undefined,
              }}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-primary py-20">
            <AlertCircle className="h-16 w-16 text-border" />
            <h2 className="mt-4 text-xl font-bold text-foreground">
              {lang === "ar" ? "الشهادة غير موجودة" : "Certificate Not Found"}
            </h2>
            <p className="mt-2 text-sm text-text-muted">
              {lang === "ar"
                ? "لم يتم العثور على شهادة بهذا الرقم"
                : "No certificate found with this number"}
            </p>
            <button
              onClick={() => navigate("/verify")}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-accent-secondary to-accent-secondary/80 px-5 py-2.5 text-sm font-semibold text-background"
            >
              {lang === "ar" ? "تحقق من شهادة" : "Verify a Certificate"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
