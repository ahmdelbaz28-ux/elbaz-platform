/**
 * Unit tests for email templates (api/lib/email-templates.ts).
 * The templates are the user-facing face of the OTP system — the 6-digit
 * code MUST be present, the link MUST be preserved, and the spam-folder
 * guidance MUST be rendered in the user's working language (ar/en/both).
 */

import { describe, it, expect } from "vitest";
import { buildVerificationEmail, buildResetEmail, resolveEmailLang } from "./email-templates.js";

describe("email-templates.ts", () => {
  const url = "https://ahmedelbaz.qzz.io/verify-email?token=abc&uid=1";

  describe("resolveEmailLang", () => {
    it("maps stored language values to template languages", () => {
      expect(resolveEmailLang("ar")).toBe("ar");
      expect(resolveEmailLang("en")).toBe("en");
      expect(resolveEmailLang(null)).toBe("both");
      expect(resolveEmailLang(undefined)).toBe("both");
      expect(resolveEmailLang("fr")).toBe("both");
    });
  });

  describe("buildVerificationEmail", () => {
    it("includes the 6-digit code in html and text", () => {
      const tpl = buildVerificationEmail("أحمد", url, "483920", 30, false);
      expect(tpl.html).toContain("483920");
      expect(tpl.text).toContain("483920");
    });

    it("includes the verification link in html and text", () => {
      const tpl = buildVerificationEmail("أحمد", url, "483920", 30, false);
      expect(tpl.html).toContain(url);
      expect(tpl.text).toContain(url);
    });

    it("escapes the user name (no HTML injection)", () => {
      const tpl = buildVerificationEmail('<script>alert("x")</script>', url, "483920", 30, false);
      expect(tpl.html).not.toContain("<script>");
      expect(tpl.html).toContain("&lt;script&gt;");
    });

    it("mentions the expiry window", () => {
      const tpl = buildVerificationEmail("أحمد", url, "483920", 30, false);
      expect(tpl.html).toContain("30");
      expect(tpl.text).toContain("30");
    });

    it("uses a different subject for email-change confirmation", () => {
      const initial = buildVerificationEmail("أحمد", url, "483920", 30, false);
      const change = buildVerificationEmail("أحمد", url, "483920", 30, true);
      expect(initial.subject).not.toBe(change.subject);
      expect(change.subject.toLowerCase()).toContain("new email");
    });

    it("renders Arabic RTL shell", () => {
      const tpl = buildVerificationEmail("أحمد", url, "483920", 30, false);
      expect(tpl.html).toContain('dir="rtl"');
      expect(tpl.html).toContain("منصة أحمد الباز");
    });

    it("ar variant: Arabic copy + Arabic spam guidance, no English section", () => {
      const tpl = buildVerificationEmail("أحمد", url, "483920", 30, false, "ar");
      expect(tpl.html).toContain("غير المرغوبة");
      expect(tpl.html).toContain("Not spam");
      expect(tpl.text).toContain("الرسائل غير المرغوبة");
      expect(tpl.html).toContain("شكرًا لتسجيلك");
      expect(tpl.html).not.toContain("thanks for registering");
    });

    it("en variant: English copy + English spam guidance, no Arabic section", () => {
      const tpl = buildVerificationEmail("أحمد", url, "483920", 30, false, "en");
      expect(tpl.html).toContain("Check your Spam folder");
      expect(tpl.html).toContain('dir="ltr"');
      expect(tpl.text).toContain("Spam folder");
      expect(tpl.html).toContain("thanks for registering");
      expect(tpl.html).not.toContain("شكرًا لتسجيلك");
    });

    it("both variant (default): Arabic AND English spam guidance present", () => {
      const tpl = buildVerificationEmail("أحمد", url, "483920", 30, false, "both");
      expect(tpl.html).toContain("غير المرغوبة");
      expect(tpl.html).toContain("Check your Spam folder");
      expect(tpl.text).toContain("Spam folder");
      expect(tpl.text).toContain("الرسائل غير المرغوبة");
    });

    it("default parameter is 'both' (bilingual) for every caller", () => {
      const tpl = buildVerificationEmail("أحمد", url, "483920", 30, false);
      expect(tpl.html).toContain("Check your Spam folder");
      expect(tpl.html).toContain("غير المرغوبة");
    });
  });

  describe("buildResetEmail", () => {
    const resetUrl = "https://ahmedelbaz.qzz.io/reset-password?token=xyz&uid=7";

    it("includes the code, link and expiry", () => {
      const tpl = buildResetEmail("محمد", resetUrl, "918273", 15);
      expect(tpl.html).toContain("918273");
      expect(tpl.html).toContain(resetUrl);
      expect(tpl.text).toContain("918273");
      expect(tpl.text).toContain(resetUrl);
      expect(tpl.html).toContain("15");
    });

    it("escapes the user name", () => {
      const tpl = buildResetEmail("<img src=x onerror=alert(1)>", resetUrl, "918273", 15);
      expect(tpl.html).not.toContain("<img src=x");
      expect(tpl.html).toContain("&lt;img");
    });

    it("is RTL Arabic with a code box", () => {
      const tpl = buildResetEmail("محمد", resetUrl, "918273", 15);
      expect(tpl.html).toContain('dir="rtl"');
      expect(tpl.html).toContain("رمز");
    });

    it("ar variant: carries the Arabic spam-folder guidance", () => {
      const tpl = buildResetEmail("محمد", resetUrl, "918273", 15, "ar");
      expect(tpl.html).toContain("غير المرغوبة");
      expect(tpl.html).toContain("Not spam");
      expect(tpl.text).toContain("الرسائل غير المرغوبة");
      expect(tpl.html).not.toContain("Reset My Password");
    });

    it("en variant: carries the English spam-folder guidance", () => {
      const tpl = buildResetEmail("محمد", resetUrl, "918273", 15, "en");
      expect(tpl.html).toContain("Check your Spam folder");
      expect(tpl.html).toContain("Reset My Password");
      expect(tpl.text).toContain("Spam folder");
      expect(tpl.html).not.toContain("وصلنا طلب");
    });

    it("both variant: carries BOTH spam guidances", () => {
      const tpl = buildResetEmail("محمد", resetUrl, "918273", 15, "both");
      expect(tpl.html).toContain("غير المرغوبة");
      expect(tpl.html).toContain("Check your Spam folder");
      expect(tpl.text).toContain("الرسائل غير المرغوبة");
      expect(tpl.text).toContain("Spam folder");
    });

    it("guidance asks the user to mark the message as Not spam", () => {
      const tpl = buildResetEmail("محمد", resetUrl, "918273", 15, "en");
      expect(tpl.html).toContain("Not spam");
    });
  });
});
