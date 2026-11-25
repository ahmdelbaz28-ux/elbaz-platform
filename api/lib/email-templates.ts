/**
 * Email HTML/Text templates — extracted as pure functions so they are
 * unit-testable without a database or network.
 *
 * Design: a prominent 6-digit confirmation code plus the classic one-click
 * link as fallback — both lead to the same verification.
 *
 * ✅ OWNER REQUIREMENT (2026-11-22 "reset code never arrives" follow-up):
 * every template carries a bilingual spam-folder guidance line, rendered in
 * the language the user actually works with (users.preferredLanguage):
 *   "ar"   → Arabic template
 *   "en"   → English template
 *   "both" → Arabic + English sections (default when language is unknown)
 * The guidance also asks the user to mark the message "Not spam" so future
 * emails train their mailbox to deliver us to the inbox.
 */

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

/** Language contract shared by all auth-email templates. */
export type EmailLang = "ar" | "en" | "both";

/** Map the stored user language to the template language (default: both). */
export function resolveEmailLang(preferredLanguage?: string | null): EmailLang {
  if (preferredLanguage === "en") return "en";
  if (preferredLanguage === "ar") return "ar";
  return "both";
}

function escapeHtml(name: string): string {
  return name
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

// ─── Spam-folder guidance (the 2026-11-22 owner requirement, verbatim) ────

const SPAM_HINT_AR_HTML =
  '<p style="font-size: 13px; color: #f59e0b; line-height: 1.8;">لم تصلك الرسالة؟ افحص مجلد «الرسائل غير المرغوبة» (Spam) في بريدك — وإن وجدت الرسالة هناك اضغط «ليست رسالة غير مرغوبة / Not spam» لتصلك رسائل المنصة مباشرة إلى صندوق الوارد في المرات القادمة.</p>';
const SPAM_HINT_AR_TEXT =
  "لم تصلك الرسالة؟ افحص مجلد «الرسائل غير المرغوبة» (Spam) في بريدك — وإن وجدت الرسالة هناك اضغط «ليست رسالة غير مرغوبة (Not spam)» لتصلك رسائل المنصة مباشرة إلى صندوق الوارد في المرات القادمة.";
const SPAM_HINT_EN_HTML =
  '<p style="font-size: 13px; color: #f59e0b; line-height: 1.8;">Didn\'t receive this email? Check your Spam folder — if you find it there, mark it as "Not spam" so our emails reach your inbox directly next time.</p>';
const SPAM_HINT_EN_TEXT =
  'Didn\'t receive this email? Check your Spam folder — if you find it there, mark it as "Not spam" so our emails reach your inbox directly next time.';

function spamHintHtml(lang: EmailLang): string {
  if (lang === "ar") return SPAM_HINT_AR_HTML;
  if (lang === "en") return SPAM_HINT_EN_HTML;
  return `${SPAM_HINT_AR_HTML}${SPAM_HINT_EN_HTML}`;
}

function spamHintText(lang: EmailLang): string {
  if (lang === "ar") return SPAM_HINT_AR_TEXT;
  if (lang === "en") return SPAM_HINT_EN_TEXT;
  return `${SPAM_HINT_AR_TEXT}\n${SPAM_HINT_EN_TEXT}`;
}

// ─── Shared building blocks ────────────────────────────────────────────────

function codeBox(code: string, caption: string): string {
  return `
      <div dir="ltr" style="margin: 24px auto; text-align: center;">
        <div style="display: inline-block; background: #0a0e17; border: 1px solid #1f2d44; border-radius: 12px; padding: 18px 34px;">
          <span style="font-size: 34px; font-weight: bold; letter-spacing: 10px; color: #06b6d4; font-family: 'Courier New', monospace;">${code}</span>
        </div>
        <p style="color: #64748b; font-size: 13px; margin-top: 10px;">${caption}</p>
      </div>`;
}

function footer(): string {
  return `
      <hr style="border: none; border-top: 1px solid #1f2d44; margin: 24px 0;" />
      <p style="color: #64748b; font-size: 12px;">منصة أحمد الباز للهندسة الكهربائية — Ahmed Elbaz Electrical Engineering Platform</p>`;
}

function button(url: string, label: string): string {
  return `
      <div style="text-align: center; margin: 20px 0;">
        <a href="${url}" style="display: inline-block; background: #06b6d4; color: #0a0e17; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: bold;">
          ${label}
        </a>
        <p style="color: #64748b; font-size: 12px; margin-top: 12px;">${url}</p>
      </div>`;
}

function shell(inner: string, dir: "rtl" | "ltr"): string {
  return `<div dir="${dir}" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0e17; color: #e2e8f0; padding: 32px; border-radius: 14px;">
      <div style="text-align: center; margin-bottom: 8px;">
        <h2 style="color: #06b6d4;">منصة أحمد الباز — Ahmed Elbaz Platform</h2>
      </div>
      ${inner}
      ${footer()}
    </div>`;
}

function sectionDivider(): string {
  return `<hr style="border: none; border-top: 1px solid #1f2d44; margin: 20px 0;" />`;
}

// ─── Verification email (initial verification AND email-change confirm) ───

export function buildVerificationEmail(
  name: string,
  url: string,
  code: string,
  expiryMinutes: number,
  isNewEmail: boolean,
  lang: EmailLang = "both",
): EmailTemplate {
  const safeName = escapeHtml(name);
  const arIntro = isNewEmail
    ? `مرحبًا ${safeName}، طلبت تغيير بريدك الإلكتروني. استخدم الرمز التالي للتأكيد:`
    : `مرحبًا ${safeName}، شكرًا لتسجيلك في منصة أحمد الباز للهندسة الكهربائية. استخدم الرمز التالي لتأكيد بريدك:`;
  const enIntro = isNewEmail
    ? `Hi ${safeName}, you requested an email change. Use the code below to confirm it:`
    : `Hi ${safeName}, thanks for registering on the Ahmed Elbaz Electrical Engineering Platform. Use the code below to verify your email:`;

  const arSection = `
      <div dir="rtl">
        <p style="font-size: 15px; line-height: 1.8;">${arIntro}</p>
        ${codeBox(code, "أدخل هذا الرمز في صفحة التأكيد بالموقع")}
        <p style="font-size: 13px; color: #94a3b8;">الرمز ورابط التأكيد صالحان لمدة ${expiryMinutes} دقيقة.</p>
        <p style="font-size: 12px; color: #64748b;">إن لم تطلب هذا، تجاهل الرسالة — حسابك آمن.</p>
      </div>`;
  const enSection = `
      <div dir="ltr">
        <p style="font-size: 15px; line-height: 1.8;">${enIntro}</p>
        ${codeBox(code, "Enter this code on the confirmation page of the platform")}
        <p style="font-size: 13px; color: #94a3b8;">The code and link are valid for ${expiryMinutes} minutes.</p>
        <p style="font-size: 12px; color: #64748b;">If you didn't request this, ignore this email — your account is safe.</p>
      </div>`;

  const htmlByLang: Record<EmailLang, string> = {
    ar: shell(`${arSection}${spamHintHtml("ar")}${button(url, "تأكيد بريدي الإلكتروني")}`, "rtl"),
    en: shell(`${enSection}${spamHintHtml("en")}${button(url, "Verify My Email")}`, "ltr"),
    both: shell(`${arSection}${sectionDivider()}${enSection}${spamHintHtml("both")}${button(url, "تأكيد البريد / Verify Email")}`, "ltr"),
  };
  const textByLang: Record<EmailLang, string> = {
    ar: `${arIntro}\n\nرمز التأكيد: ${code}\n\nأو افتح الرابط: ${url}\n\nصالح لمدة ${expiryMinutes} دقيقة.\nإن لم تطلب هذا، تجاهل الرسالة.\n\n${spamHintText("ar")}`,
    en: `${enIntro}\n\nVerification code: ${code}\n\nOr open this link: ${url}\n\nValid for ${expiryMinutes} minutes.\nIf you didn't request this, ignore this email.\n\n${spamHintText("en")}`,
    both: `${arIntro}\n\nرمز التأكيد: ${code}\n\nأو افتح الرابط: ${url}\n\nصالح لمدة ${expiryMinutes} دقيقة.\nإن لم تطلب هذا، تجاهل الرسالة.\n\n${spamHintText("ar")}\n\n———\n\n${enIntro}\n\nVerification code: ${code}\n\nOr open this link: ${url}\n\nValid for ${expiryMinutes} minutes.\nIf you didn't request this, ignore this email.\n\n${spamHintText("en")}`,
  };

  return {
    subject: isNewEmail
      ? "Confirm Your New Email — Ahmed Elbaz Platform"
      : "Email Verification Code — Ahmed Elbaz Platform",
    html: htmlByLang[lang],
    text: textByLang[lang],
  };
}

// ─── Password-reset email: 6-digit code + one-click reset link ────────────

export function buildResetEmail(
  name: string,
  url: string,
  code: string,
  expiryMinutes: number,
  lang: EmailLang = "both",
): EmailTemplate {
  const safeName = escapeHtml(name);
  const arIntro = `مرحبًا ${safeName}، وصلنا طلب لإعادة تعيين كلمة المرور. استخدم الرمز التالي في صفحة «نسيت كلمة المرور» بالموقع:`;
  const enIntro = `Hi ${safeName}, we received a request to reset your password. Use the code below on the "Forgot Password" page of the platform:`;

  const arSection = `
      <div dir="rtl">
        <p style="font-size: 15px; line-height: 1.8;">${arIntro}</p>
        ${codeBox(code, "أدخل هذا الرمز مع كلمة المرور الجديدة")}
        <p style="font-size: 13px; color: #94a3b8;">الرمز والرابط صالحان لمدة ${expiryMinutes} دقيقة فقط.</p>
        <p style="font-size: 12px; color: #64748b;">إن لم تطلب إعادة التعيين، تجاهل الرسالة — كلمة المرور لن تتغير.</p>
      </div>`;
  const enSection = `
      <div dir="ltr">
        <p style="font-size: 15px; line-height: 1.8;">${enIntro}</p>
        ${codeBox(code, "Enter this code together with your new password")}
        <p style="font-size: 13px; color: #94a3b8;">The code and link are valid for ${expiryMinutes} minutes only.</p>
        <p style="font-size: 12px; color: #64748b;">If you didn't request a reset, ignore this email — your password will remain unchanged.</p>
      </div>`;

  const htmlByLang: Record<EmailLang, string> = {
    ar: shell(`${arSection}${spamHintHtml("ar")}${button(url, "إعادة تعيين كلمة المرور")}`, "rtl"),
    en: shell(`${enSection}${spamHintHtml("en")}${button(url, "Reset My Password")}`, "ltr"),
    both: shell(`${arSection}${sectionDivider()}${enSection}${spamHintHtml("both")}${button(url, "إعادة تعيين كلمة المرور / Reset Password")}`, "ltr"),
  };
  const textByLang: Record<EmailLang, string> = {
    ar: `${arIntro}\n\nرمز إعادة التعيين: ${code}\n\nأو افتح الرابط: ${url}\n\nصالح لمدة ${expiryMinutes} دقيقة فقط.\nإن لم تطلب هذا، تجاهل الرسالة.\n\n${spamHintText("ar")}`,
    en: `${enIntro}\n\nReset code: ${code}\n\nOr open this link: ${url}\n\nValid for ${expiryMinutes} minutes only.\nIf you didn't request this, ignore this email.\n\n${spamHintText("en")}`,
    both: `${arIntro}\n\nرمز إعادة التعيين: ${code}\n\nأو افتح الرابط: ${url}\n\nصالح لمدة ${expiryMinutes} دقيقة فقط.\nإن لم تطلب هذا، تجاهل الرسالة.\n\n${spamHintText("ar")}\n\n———\n\n${enIntro}\n\nReset code: ${code}\n\nOr open this link: ${url}\n\nValid for ${expiryMinutes} minutes only.\nIf you didn't request this, ignore this email.\n\n${spamHintText("en")}`,
  };

  return {
    subject: "Password Reset Code — Ahmed Elbaz Platform",
    html: htmlByLang[lang],
    text: textByLang[lang],
  };
}

// ─── Admin approval-request email (registration gate, 2026-11-24) ──────────
//
// Sent to the OWNER's inbox when someone registers. The owner can approve or
// reject straight from the email via signed single-purpose action links —
// without ever opening the platform. Always bilingual (the owner reads both,
// and the applicant's own language says nothing about the recipient's).

export interface AdminApprovalRequestInput {
  username: string;
  name: string | null;
  email: string | null;
  registeredAt: Date;
  /** Pre-signed single-use links (api/lib/approval.ts). */
  approveUrl: string;
  rejectUrl: string;
  dashboardUrl: string;
}

export function buildAdminApprovalRequestEmail(input: AdminApprovalRequestInput): EmailTemplate {
  const who = escapeHtml(input.name || input.username);
  const handle = escapeHtml(input.username);
  const mail = input.email ? escapeHtml(input.email) : null;
  const when = `${input.registeredAt.toISOString().replace("T", " ").slice(0, 16)} UTC`;

  const infoRows = [
    ["الاسم / Name", who],
    ["المعرف / Username", `@${handle}`],
    ["البريد / Email", mail ?? "—"],
    ["التاريخ / Date", when],
  ]
    .map(
      ([k, v]) => `
        <tr>
          <td style="padding: 8px 14px; color: #94a3b8; font-size: 13px; white-space: nowrap;">${k}</td>
          <td dir="ltr" style="padding: 8px 14px; color: #e2e8f0; font-size: 13px; font-weight: bold;">${v}</td>
        </tr>`
    )
    .join("");

  const arSection = `
      <p style="font-size: 15px; line-height: 1.9;">سجّل مستخدم جديد في المنصة ويحتاج موافقتك قبل أن يتمكن من الدخول. يمكنك القبول أو الرفض مباشرة من الأزرار أدناه — بدون فتح المنصة.</p>
      <table style="width: 100%; border-collapse: collapse; background: #0d1520; border-radius: 10px; overflow: hidden; margin: 16px 0;">${infoRows}</table>`;

  const enSection = `
      <p style="font-size: 15px; line-height: 1.9;">A new user just registered and needs your approval before they can sign in. Approve or reject directly from the buttons below — without opening the platform.</p>`;

  const actionButtons = `
      <div style="text-align: center; margin: 26px 0;">
        <a href="${input.approveUrl}" style="display: inline-block; background: #10b981; color: #052e1a; padding: 12px 26px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 4px;">✓ قبول / Approve</a>
        <a href="${input.rejectUrl}" style="display: inline-block; background: #ef4444; color: #2e0505; padding: 12px 26px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 4px;">✕ رفض / Reject</a>
        <p style="color: #64748b; font-size: 12px; margin-top: 14px;">الروابط صالحة 7 أيام وتعمل مرة واحدة — valid 7 days, one-time use</p>
      </div>`;

  const dashboardLink = `
      <p style="text-align: center; font-size: 13px;">
        <a href="${input.dashboardUrl}" style="color: #06b6d4; text-decoration: none;">إدارة كل الطلبات من لوحة التحكم / Manage all requests from the dashboard →</a>
      </p>`;

  return {
    subject: `طلب انضمام جديد: @${handle} — New registration needs your approval`,
    html: shell(`${arSection}${sectionDivider()}${enSection}${actionButtons}${dashboardLink}`, "rtl"),
    text: [
      `طلب انضمام جديد للمنصة — يحتاج موافقتك`,
      ``,
      `الاسم: ${who}`,
      `المعرف: @${handle}`,
      `البريد: ${mail ?? "—"}`,
      `التاريخ: ${when}`,
      ``,
      `قبول: ${input.approveUrl}`,
      `رفض: ${input.rejectUrl}`,
      `الروابط صالحة 7 أيام وتعمل مرة واحدة.`,
      ``,
      `———`,
      ``,
      `New registration needs your approval before the user can sign in.`,
      `Approve: ${input.approveUrl}`,
      `Reject: ${input.rejectUrl}`,
      `Links are valid for 7 days and work once.`,
    ].join("\n"),
  };
}
