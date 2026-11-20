/**
 * Email HTML/Text templates — extracted as pure functions so they are
 * unit-testable without a database or network.
 *
 * Design: Arabic-first RTL with a prominent 6-digit confirmation code and
 * the classic one-click link as fallback. Both lead to the same verification.
 */

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(name: string): string {
  return name
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function codeBox(code: string): string {
  return `
      <div dir="ltr" style="margin: 24px auto; text-align: center;">
        <div style="display: inline-block; background: #0a0e17; border: 1px solid #1f2d44; border-radius: 12px; padding: 18px 34px;">
          <span style="font-size: 34px; font-weight: bold; letter-spacing: 10px; color: #06b6d4; font-family: 'Courier New', monospace;">${code}</span>
        </div>
        <p dir="rtl" style="color: #64748b; font-size: 13px; margin-top: 10px;">أدخل هذا الرمز في صفحة التأكيد بالموقع</p>
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
        <p style="color: #64748b; font-size: 12px; margin-top: 12px;">أو انسخ الرابط: ${url}</p>
      </div>`;
}

function shell(inner: string): string {
  return `<div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0e17; color: #e2e8f0; padding: 32px; border-radius: 14px;">
      <div style="text-align: center; margin-bottom: 8px;">
        <h2 style="color: #06b6d4;">منصة أحمد الباز</h2>
      </div>
      ${inner}
      ${footer()}
    </div>`;
}

/** Verification email (initial verification AND email-change confirmation). */
export function buildVerificationEmail(name: string, url: string, code: string, expiryMinutes: number, isNewEmail: boolean): EmailTemplate {
  const safeName = escapeHtml(name);
  const intro = isNewEmail
    ? `مرحبًا ${safeName}، طلبت تغيير بريدك الإلكتروني. استخدم الرمز التالي للتأكيد:`
    : `مرحبًا ${safeName}، شكرًا لتسجيلك في منصة أحمد الباز للهندسة الكهربائية. استخدم الرمز التالي لتأكيد بريدك:`;
  return {
    subject: isNewEmail
      ? "Confirm Your New Email — Ahmed Elbaz Platform"
      : "Email Verification Code — Ahmed Elbaz Platform",
    html: shell(`
      <p style="font-size: 15px; line-height: 1.8;">${intro}</p>
      ${codeBox(code)}
      <p style="font-size: 13px; color: #94a3b8;">الرمز ورابط التأكيد صالحان لمدة ${expiryMinutes} دقيقة.</p>
      ${button(url, isNewEmail ? "تأكيد البريد الجديد" : "تأكيد بريدي الإلكتروني")}
      <p style="font-size: 12px; color: #64748b;">إن لم تطلب هذا، تجاهل الرسالة — حسابك آمن.</p>
    `),
    text: `${intro}\n\nرمز التأكيد: ${code}\n\nأو افتح الرابط: ${url}\n\nصالح لمدة ${expiryMinutes} دقيقة.\nإن لم تطلب هذا، تجاهل الرسالة.`,
  };
}

/** Password-reset email: 6-digit code + one-click reset link. */
export function buildResetEmail(name: string, url: string, code: string, expiryMinutes: number): EmailTemplate {
  const safeName = escapeHtml(name);
  return {
    subject: "Password Reset Code — Ahmed Elbaz Platform",
    html: shell(`
      <p style="font-size: 15px; line-height: 1.8;">مرحبًا ${safeName}، وصلنا طلب لإعادة تعيين كلمة المرور. استخدم الرمز التالي في صفحة "نسيت كلمة المرور":</p>
      ${codeBox(code)}
      <p style="font-size: 13px; color: #94a3b8;">الرمز والرابط صالحان لمدة ${expiryMinutes} دقيقة فقط.</p>
      ${button(url, "إعادة تعيين كلمة المرور")}
      <p style="font-size: 12px; color: #64748b;">إن لم تطلب إعادة التعيين، تجاهل الرسالة — كلمة المرور لن تتغير.</p>
    `),
    text: `مرحبًا ${safeName}، وصلنا طلب لإعادة تعيين كلمة المرور.\n\nرمز إعادة التعيين: ${code}\n\nأو افتح الرابط: ${url}\n\nصالح لمدة ${expiryMinutes} دقيقة.\nإن لم تطلب هذا، تجاهل الرسالة.`,
  };
}
