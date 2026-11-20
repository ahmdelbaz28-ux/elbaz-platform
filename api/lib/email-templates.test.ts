/**
 * Unit tests for email templates (api/lib/email-templates.ts).
 * The templates are the user-facing face of the OTP system — the 6-digit
 * code MUST be present, the link MUST be preserved, and Arabic copy MUST
 * render (this is an Arabic-first platform).
 */

import { describe, it, expect } from "vitest";
import { buildVerificationEmail, buildResetEmail } from "./email-templates.js";

describe("email-templates.ts", () => {
  const url = "https://ahmedelbaz.qzz.io/verify-email?token=abc&uid=1";

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
  });
});
