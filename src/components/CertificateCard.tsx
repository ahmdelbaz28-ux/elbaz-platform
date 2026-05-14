import { useMemo } from "react";
import { generateQRCodeSVG } from "@/lib/qr-code";

export interface CertificateData {
  studentName: string;
  courseName: string;
  courseNameAr: string;
  certificateNumber: string;
  issuedAt: string | Date;
  grade: string;
  averageScore?: number;
}

interface CertificateCardProps {
  data: CertificateData;
  lang?: "en" | "ar";
}

function getGradeClass(grade: string): string {
  switch (grade?.toLowerCase()) {
    case "distinction":
      return "grade-distinction";
    case "merit":
      return "grade-merit";
    default:
      return "grade-pass";
  }
}

function getGradeLabel(grade: string, score?: number): string {
  if (score !== undefined) {
    switch (grade?.toLowerCase()) {
      case "distinction":
        return `\u2605 Distinction \u2014 ${score}% \u2605`;
      case "merit":
        return `Merit \u2014 ${score}%`;
      default:
        return `Pass \u2014 ${score}%`;
    }
  }
  return grade || "Pass";
}

function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getVerifyUrl(certNumber: string): string {
  return `https://ahmedelbaz.qzz.io/verify/${certNumber}`;
}

export default function CertificateCard({ data }: CertificateCardProps) {
  const qrSvg = useMemo(() => {
    try {
      return generateQRCodeSVG(getVerifyUrl(data.certificateNumber), 90);
    } catch {
      return null;
    }
  }, [data.certificateNumber]);

  const gradeClass = getGradeClass(data.grade);
  const gradeLabel = getGradeLabel(data.grade, data.averageScore);

  return (
    <div className="certificate-wrapper" id="certificate-card">
      {/* Background Effects */}
      <div className="cert-grid-bg" />
      <div className="cert-glow-tl" />
      <div className="cert-glow-br" />
      <div className="cert-glow-center" />

      {/* Borders */}
      <div className="cert-border-outer" />
      <div className="cert-border-accent" />
      <div className="cert-border-inner" />

      {/* Gradient Bars */}
      <div className="cert-bar-top" />
      <div className="cert-bar-bottom" />

      {/* Corner Accents */}
      <div className="cert-corner cert-corner-tl">
        <svg viewBox="0 0 50 50" fill="none">
          <path d="M0 0 L20 0 L20 1 L1 1 L1 20 L0 20 Z" fill="#06b6d4" opacity="0.5" />
          <path d="M0 8 L8 8 L8 0" stroke="#06b6d4" strokeWidth="1" fill="none" opacity="0.8" />
          <circle cx="3" cy="3" r="1.5" fill="#06b6d4" opacity="0.6" />
        </svg>
      </div>
      <div className="cert-corner cert-corner-tr">
        <svg viewBox="0 0 50 50" fill="none">
          <path d="M0 0 L20 0 L20 1 L1 1 L1 20 L0 20 Z" fill="#06b6d4" opacity="0.5" />
          <path d="M0 8 L8 8 L8 0" stroke="#06b6d4" strokeWidth="1" fill="none" opacity="0.8" />
          <circle cx="3" cy="3" r="1.5" fill="#06b6d4" opacity="0.6" />
        </svg>
      </div>
      <div className="cert-corner cert-corner-bl">
        <svg viewBox="0 0 50 50" fill="none">
          <path d="M0 0 L20 0 L20 1 L1 1 L1 20 L0 20 Z" fill="#06b6d4" opacity="0.5" />
          <path d="M0 8 L8 8 L8 0" stroke="#06b6d4" strokeWidth="1" fill="none" opacity="0.8" />
          <circle cx="3" cy="3" r="1.5" fill="#06b6d4" opacity="0.6" />
        </svg>
      </div>
      <div className="cert-corner cert-corner-br">
        <svg viewBox="0 0 50 50" fill="none">
          <path d="M0 0 L20 0 L20 1 L1 1 L1 20 L0 20 Z" fill="#06b6d4" opacity="0.5" />
          <path d="M0 8 L8 8 L8 0" stroke="#06b6d4" strokeWidth="1" fill="none" opacity="0.8" />
          <circle cx="3" cy="3" r="1.5" fill="#06b6d4" opacity="0.6" />
        </svg>
      </div>

      {/* Official Seal */}
      <div className="cert-seal">
        <svg viewBox="0 0 110 110" fill="none">
          <circle cx="55" cy="55" r="52" stroke="#06b6d4" strokeWidth="1.5" fill="none" opacity="0.3" />
          <circle cx="55" cy="55" r="46" stroke="#06b6d4" strokeWidth="0.8" fill="none" opacity="0.2" />
          <circle cx="55" cy="55" r="40" stroke="#06b6d4" strokeWidth="0.5" fill="none" opacity="0.15" />
          <defs>
            <path id="topArc" d="M12,55 A43,43 0 0,1 98,55" />
            <path id="bottomArc" d="M98,55 A43,43 0 0,1 12,55" />
          </defs>
          <text fill="#06b6d4" fontFamily="Inter, sans-serif" fontSize="7" fontWeight="700" letterSpacing="3" opacity="0.6">
            <textPath href="#topArc" startOffset="50%" textAnchor="middle">ELBAZ PLATFORM</textPath>
          </text>
          <text fill="#06b6d4" fontFamily="Inter, sans-serif" fontSize="6" fontWeight="600" letterSpacing="2" opacity="0.5">
            <textPath href="#bottomArc" startOffset="50%" textAnchor="middle">VERIFIED &bull; AUTHENTIC</textPath>
          </text>
          <circle cx="55" cy="55" r="4" fill="none" stroke="#06b6d4" strokeWidth="0.5" opacity="0.4" />
          <path d="M51 55 L53 53 L55 57 L57 53 L59 55" stroke="#06b6d4" strokeWidth="0.8" fill="none" opacity="0.5" />
        </svg>
      </div>

      {/* Main Content */}
      <div className="cert-content">

        {/* Logo & Institution */}
        <div className="cert-logo-area">
          <div className="cert-logo-ring">
            <img src="/logo.png" alt="Elbaz Platform Logo" onError={(e) => { e.currentTarget.src = "/hero-bg.jpg"; e.currentTarget.onerror = null; }} />
          </div>
          <span className="cert-platform-label">Elbaz Platform</span>
          <span className="cert-institution-name">Electrical Engineering Academy</span>
        </div>

        <div className="cert-divider" />

        {/* Certificate Title */}
        <h1 className="cert-title">
          Certificate of Completion
          <span className="cert-title-sub">Professional Achievement</span>
        </h1>

        {/* Presented To */}
        <p className="cert-presented">This Certificate Is Proudly Presented To</p>

        {/* Student Name */}
        <h2 className="cert-student-name">
          {data.studentName}
          <span className="cert-name-underline" />
          <span className="cert-name-glow" />
        </h2>

        {/* Course Info */}
        <div className="cert-course-section">
          <p className="cert-course-label">For Successfully Completing The Professional Course</p>
          <h3 className="cert-course-name">{data.courseName}</h3>
        </div>

        {/* Grade Badge */}
        <div className={`cert-grade-badge ${gradeClass}`}>
          <span dangerouslySetInnerHTML={{ __html: gradeLabel }} />
        </div>

        {/* Bottom Section */}
        <div className="cert-bottom">

          {/* Date & Certificate Number */}
          <div className="cert-date-block">
            <span className="cert-info-label">Date of Issue</span>
            <span className="cert-info-value">{formatDate(data.issuedAt)}</span>
            <div className="cert-info-spacer" />
            <span className="cert-info-label">Certificate Number</span>
            <span className="cert-info-value-mono">{data.certificateNumber}</span>
          </div>

          {/* Signature */}
          <div className="cert-signature">
            <div className="cert-sig-art">
              <svg viewBox="0 0 200 60" fill="none" stroke="#e8f0fe" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 45 C25 35, 30 25, 38 22 C42 20, 46 22, 44 28 C42 34, 35 40, 30 42" opacity="0.9" />
                <path d="M44 28 C50 18, 58 15, 65 18 C70 20, 72 25, 68 30 C64 35, 55 40, 50 42" opacity="0.9" />
                <path d="M68 30 C75 20, 85 14, 95 16 C102 18, 105 24, 100 30 C95 36, 82 42, 75 44" opacity="0.9" />
                <path d="M100 30 C108 22, 118 18, 128 20 C135 22, 138 28, 132 34 C126 38, 115 42, 108 44" opacity="0.9" />
                <path d="M132 34 C140 26, 152 22, 160 24 C166 26, 168 30, 162 36 C158 40, 148 44, 140 46" opacity="0.9" />
                <path d="M162 36 C168 32, 175 30, 180 32" opacity="0.7" />
                <path d="M15 50 C40 48, 80 46, 130 48 C155 49, 175 50, 185 50" stroke="rgba(6,182,212,0.3)" strokeWidth="0.8" />
              </svg>
            </div>
            <span className="cert-sig-name">AHMED ELBAZ</span>
            <span className="cert-sig-title">Founder &amp; Head Instructor</span>
          </div>

          {/* QR Code */}
          <div className="cert-qr-block">
            <span className="cert-info-label">Scan to Verify</span>
            <div className="cert-qr-box">
              {qrSvg ? (
                <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
              ) : (
                <svg viewBox="0 0 90 90" fill="#06b6d4" xmlns="http://www.w3.org/2000/svg">
                  <rect x="5" y="5" width="25" height="25" rx="2" opacity="0.3" />
                  <rect x="60" y="5" width="25" height="25" rx="2" opacity="0.3" />
                  <rect x="5" y="60" width="25" height="25" rx="2" opacity="0.3" />
                </svg>
              )}
            </div>
            <span className="cert-qr-url">ahmedelbaz.qzz.io/verify</span>
          </div>

        </div>
      </div>

      {/* Inline Styles */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,600&family=Inter:wght@300;400;500;600;700;800&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&display=swap');

        /* ══════════════════════════════════════════════════
           CERTIFICATE — Dark Professional Theme
           Matching Elbaz Platform visual identity:
           Background: #0a1628 | Accent: #06b6d4 | Green: #10b981
           ══════════════════════════════════════════════════ */

        .certificate-wrapper {
          width: 1200px;
          height: 850px;
          background: linear-gradient(175deg, #0a1628 0%, #0d1f3c 25%, #091428 50%, #0b1a30 75%, #071020 100%);
          position: relative;
          overflow: hidden;
          box-shadow:
            0 0 0 1px rgba(6,182,212,0.15),
            0 25px 80px rgba(0,0,0,0.6),
            0 0 120px rgba(6,182,212,0.08);
          border-radius: 4px;
          page-break-after: always;
          margin: 0 auto;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        /* ── Background Grid ── */
        .cert-grid-bg {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(6,182,212,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(6,182,212,0.03) 1px, transparent 1px);
          background-size: 40px 40px;
          z-index: 0;
        }

        /* ── Radial Glows ── */
        .cert-glow-tl {
          position: absolute;
          top: -100px;
          left: -100px;
          width: 500px;
          height: 500px;
          background: radial-gradient(circle, rgba(6,182,212,0.12) 0%, transparent 70%);
          z-index: 0;
        }
        .cert-glow-br {
          position: absolute;
          bottom: -100px;
          right: -100px;
          width: 500px;
          height: 500px;
          background: radial-gradient(circle, rgba(16,185,129,0.08) 0%, transparent 70%);
          z-index: 0;
        }
        .cert-glow-center {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 800px;
          height: 400px;
          background: radial-gradient(ellipse, rgba(6,182,212,0.04) 0%, transparent 70%);
          z-index: 0;
        }

        /* ── Borders ── */
        .cert-border-outer {
          position: absolute;
          inset: 0;
          border: 1px solid rgba(6,182,212,0.25);
          z-index: 2;
          pointer-events: none;
        }
        .cert-border-accent {
          position: absolute;
          inset: 12px;
          border: 1px solid rgba(6,182,212,0.1);
          z-index: 2;
          pointer-events: none;
        }
        .cert-border-inner {
          position: absolute;
          inset: 24px;
          border: 1px solid rgba(6,182,212,0.06);
          z-index: 2;
          pointer-events: none;
        }

        /* ── Gradient Bars ── */
        .cert-bar-top {
          position: absolute;
          top: 24px;
          left: 24px;
          right: 24px;
          height: 3px;
          background: linear-gradient(90deg, transparent, #06b6d4, #22d3ee, #10b981, #06b6d4, transparent);
          z-index: 3;
        }
        .cert-bar-bottom {
          position: absolute;
          bottom: 24px;
          left: 24px;
          right: 24px;
          height: 3px;
          background: linear-gradient(90deg, transparent, #06b6d4, #22d3ee, #10b981, #06b6d4, transparent);
          z-index: 3;
        }

        /* ── Corners ── */
        .cert-corner {
          position: absolute;
          width: 50px;
          height: 50px;
          z-index: 3;
        }
        .cert-corner svg { width: 100%; height: 100%; }
        .cert-corner-tl { top: 28px; left: 28px; }
        .cert-corner-tr { top: 28px; right: 28px; transform: scaleX(-1); }
        .cert-corner-bl { bottom: 28px; left: 28px; transform: scaleY(-1); }
        .cert-corner-br { bottom: 28px; right: 28px; transform: scale(-1, -1); }

        /* ── Official Seal ── */
        .cert-seal {
          position: absolute;
          bottom: 75px;
          right: 85px;
          width: 110px;
          height: 110px;
          z-index: 4;
          opacity: 0.85;
        }
        .cert-seal svg { width: 100%; height: 100%; }

        /* ── Content ── */
        .cert-content {
          position: relative;
          z-index: 5;
          padding: 55px 90px;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        /* ── Logo Area ── */
        .cert-logo-area {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          margin-bottom: 8px;
        }
        .cert-logo-ring {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          padding: 3px;
          background: linear-gradient(135deg, rgba(6,182,212,0.5), rgba(16,185,129,0.3), rgba(6,182,212,0.5));
          box-shadow: 0 0 20px rgba(6,182,212,0.2);
        }
        .cert-logo-ring img {
          width: 100%;
          height: 100%;
          border-radius: 50%;
          object-fit: cover;
          background: #0a1628;
        }
        .cert-platform-label {
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 5px;
          text-transform: uppercase;
          color: #06b6d4;
          margin-top: 2px;
        }
        .cert-institution-name {
          font-family: 'Playfair Display', serif;
          font-size: 24px;
          font-weight: 700;
          color: #e8f0fe;
          letter-spacing: 1px;
          text-shadow: 0 0 20px rgba(6,182,212,0.15);
        }

        /* ── Divider ── */
        .cert-divider {
          width: 200px;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(6,182,212,0.4), rgba(16,185,129,0.3), rgba(6,182,212,0.4), transparent);
          margin: 18px auto;
          position: relative;
        }
        .cert-divider::after {
          content: '';
          position: absolute;
          top: -3px;
          left: 50%;
          transform: translateX(-50%);
          width: 8px;
          height: 8px;
          background: #06b6d4;
          border-radius: 50%;
          box-shadow: 0 0 10px rgba(6,182,212,0.5);
        }

        /* ── Title ── */
        .cert-title {
          font-family: 'Cormorant Garamond', serif;
          font-size: 46px;
          font-weight: 600;
          color: #ffffff;
          letter-spacing: 6px;
          text-transform: uppercase;
          margin-top: 6px;
          line-height: 1.2;
          text-shadow: 0 0 30px rgba(6,182,212,0.1);
        }
        .cert-title-sub {
          display: block;
          font-size: 16px;
          font-family: 'Inter', sans-serif;
          font-weight: 400;
          letter-spacing: 8px;
          color: rgba(6,182,212,0.7);
          text-transform: uppercase;
          margin-top: 6px;
        }

        /* ── Presented To ── */
        .cert-presented {
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 5px;
          text-transform: uppercase;
          color: #64748b;
          margin-top: 30px;
        }

        /* ── Student Name ── */
        .cert-student-name {
          font-family: 'Playfair Display', serif;
          font-size: 48px;
          font-weight: 700;
          color: #ffffff;
          margin-top: 10px;
          line-height: 1.2;
          position: relative;
          display: inline-block;
          text-shadow: 0 0 40px rgba(6,182,212,0.15);
        }
        .cert-name-underline {
          display: block;
          width: 100%;
          height: 2px;
          margin-top: 6px;
          background: linear-gradient(90deg, transparent, #06b6d4, #22d3ee, #06b6d4, transparent);
          border-radius: 1px;
        }
        .cert-name-glow {
          position: absolute;
          bottom: -4px;
          left: 0;
          right: 0;
          height: 20px;
          background: radial-gradient(ellipse, rgba(6,182,212,0.2) 0%, transparent 70%);
          filter: blur(4px);
        }

        /* ── Course ── */
        .cert-course-section {
          margin-top: 26px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
        }
        .cert-course-label {
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 500;
          color: #64748b;
          letter-spacing: 3px;
          text-transform: uppercase;
        }
        .cert-course-name {
          font-family: 'Playfair Display', serif;
          font-size: 28px;
          font-weight: 700;
          color: #e8f0fe;
          line-height: 1.3;
          max-width: 700px;
          text-shadow: 0 0 20px rgba(6,182,212,0.08);
        }

        /* ── Grade Badge ── */
        .cert-grade-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-top: 14px;
          padding: 6px 24px;
          border-radius: 20px;
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 3px;
          text-transform: uppercase;
        }
        .grade-distinction {
          background: rgba(245,158,11,0.12);
          color: #fbbf24;
          border: 1px solid rgba(245,158,11,0.3);
          box-shadow: 0 0 20px rgba(245,158,11,0.08);
        }
        .grade-merit {
          background: rgba(99,102,241,0.12);
          color: #a5b4fc;
          border: 1px solid rgba(99,102,241,0.3);
          box-shadow: 0 0 20px rgba(99,102,241,0.08);
        }
        .grade-pass {
          background: rgba(16,185,129,0.12);
          color: #6ee7b7;
          border: 1px solid rgba(16,185,129,0.3);
          box-shadow: 0 0 20px rgba(16,185,129,0.08);
        }

        /* ── Bottom Section ── */
        .cert-bottom {
          margin-top: auto;
          width: 100%;
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: end;
          gap: 60px;
          padding-top: 10px;
        }

        /* ── Date Block ── */
        .cert-date-block {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }
        .cert-info-spacer { height: 20px; }
        .cert-info-label {
          font-family: 'Inter', sans-serif;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #475569;
          margin-bottom: 6px;
        }
        .cert-info-value {
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          font-weight: 500;
          color: #94a3b8;
        }
        .cert-info-value-mono {
          font-family: 'Courier New', monospace;
          font-size: 11px;
          font-weight: 600;
          color: #64748b;
          letter-spacing: 0.5px;
          background: rgba(6,182,212,0.05);
          padding: 4px 12px;
          border-radius: 4px;
          border: 1px solid rgba(6,182,212,0.1);
        }

        /* ── Signature ── */
        .cert-signature {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .cert-sig-art {
          width: 200px;
          height: 60px;
          margin-bottom: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .cert-sig-art svg { width: 100%; height: 100%; }
        .cert-sig-name {
          font-family: 'Playfair Display', serif;
          font-size: 18px;
          font-weight: 600;
          color: #e8f0fe;
          text-shadow: 0 0 10px rgba(6,182,212,0.1);
        }
        .cert-sig-title {
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          font-weight: 500;
          color: #06b6d4;
          letter-spacing: 2px;
          text-transform: uppercase;
          margin-top: 2px;
        }

        /* ── QR Block ── */
        .cert-qr-block {
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .cert-qr-box {
          width: 90px;
          height: 90px;
          border: 1px solid rgba(6,182,212,0.15);
          border-radius: 8px;
          padding: 6px;
          background: rgba(255,255,255,0.03);
        }
        .cert-qr-box svg { width: 100%; height: 100%; }
        .cert-qr-url {
          font-family: 'Inter', sans-serif;
          font-size: 9px;
          color: #475569;
          margin-top: 6px;
        }

        /* ══════════════════════════════════════════════════
           PRINT — A4 Landscape
           ══════════════════════════════════════════════════ */
        @media print {
          body {
            background: #0a1628;
            padding: 0;
            margin: 0;
          }
          .certificate-wrapper {
            box-shadow: none;
            width: 297mm;
            height: 210mm;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          @page {
            size: A4 landscape;
            margin: 0;
          }
          .no-print {
            display: none !important;
          }
        }

        /* ══════════════════════════════════════════════════
           RESPONSIVE (screen only)
           ══════════════════════════════════════════════════ */
        @media screen and (max-width: 1280px) {
          .certificate-wrapper {
            width: 100%;
            max-width: 1200px;
            height: auto;
            aspect-ratio: 1200 / 850;
            transform: scale(0.85);
            transform-origin: top center;
          }
        }
        @media screen and (max-width: 800px) {
          .certificate-wrapper {
            transform: scale(0.45);
            transform-origin: top center;
          }
        }
      `}</style>
    </div>
  );
}
