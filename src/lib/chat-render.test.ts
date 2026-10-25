/**
 * REGRESSION TESTS — audit run-1 fixes (chatbot.rendermarkdown.* XSS)
 *
 * The chat renderer used to escape only fenced code blocks, letting
 * model/user/history content like `<img src=x onerror=...>` reach
 * dangerouslySetInnerHTML. The fix escapes every text segment BEFORE the
 * markdown machine runs. These tests lock that invariant.
 */
import { describe, it, expect } from "vitest";

import { renderMarkdown, escapeHtml, ARABIC_RE } from "./chat-render";

describe("renderMarkdown — XSS regression (audit run-1)", () => {
  it("never emits a raw <img> tag from message content", () => {
    const out = renderMarkdown("<img src=x onerror=alert(1)>");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("never emits a raw <script> tag from message content", () => {
    const out = renderMarkdown("<script>alert(1)</script>");
    expect(out.toLowerCase()).not.toContain("<script");
    expect(out).toContain("&lt;script&gt;");
  });

  it("cannot break out of the href attribute via a crafted URL", () => {
    const out = renderMarkdown('[x](https://a"onmouseover="alert(1))');
    expect(out).not.toContain('"onmouseover');
  });

  it("refuses javascript: link schemes", () => {
    const out = renderMarkdown("[x](javascript:alert(1))");
    // The text stays inert escaped prose — the security property is that no
    // anchor with a javascript: href is ever synthesized.
    expect(out).not.toContain('href="javascript');
    expect(out).not.toContain("<a ");
  });

  it("still renders markdown grammar on escaped text", () => {
    const out = renderMarkdown("### عنوان\n1. افتح قائمة **Analyse**\n- نقطة أولى\nمائل *خفيف* هنا\n`code`");
    expect(out).toContain('class="chat-h"');
    expect(out).toContain('<li data-n="1">');
    expect(out).toContain("<strong");
    expect(out).toContain("<em");
    expect(out).toContain("<code");
    expect(out).toContain("Analyse");
  });

  it("escapes fenced code blocks verbatim", () => {
    const out = renderMarkdown("```\n<img src=x onerror=alert(1)>\n```");
    expect(out).toContain("&lt;img");
    expect(out).not.toContain("<img");
  });

  it("table conversion output is escaped too (cells with HTML)", () => {
    const src = ["| a | b |", "| --- | --- |", "| <b> | y |"].join("\n");
    const out = renderMarkdown(src);
    expect(out).not.toContain("<b>");
    expect(out).toContain("&lt;b&gt;");
  });

  it("unterminated fence mid-stream is closed, not leaked", () => {
    const out = renderMarkdown("```\npartial");
    expect(out).toContain("<pre");
    expect(out).not.toContain("```\npartial");
  });
});

describe("escapeHtml", () => {
  it("escapes the five dangerous characters", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#x27;");
  });
});

describe("ARABIC_RE", () => {
  it("detects Arabic script for RTL direction", () => {
    expect(ARABIC_RE.test("مرحبا")).toBe(true);
    expect(ARABIC_RE.test("hello")).toBe(false);
  });
});
