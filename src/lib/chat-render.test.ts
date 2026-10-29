/**
 * REGRESSION TESTS — audit run-1 fixes (chatbot.rendermarkdown.* XSS)
 *
 * The chat renderer used to escape only fenced code blocks, letting
 * model/user/history content like `<img src=x onerror=...>` reach
 * dangerouslySetInnerHTML. The fix escapes every text segment BEFORE the
 * markdown machine runs. These tests lock that invariant.
 */
import { describe, it, expect } from "vitest";

import { renderMarkdown, escapeHtml, ARABIC_RE, detectUnfulfilledDiagramPromise } from "./chat-render";

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

describe("renderMarkdown — SLD diagram fences", () => {
  const GOOD = JSON.stringify({
    title: "شبكة 11kV",
    elements: [
      { id: "G1", type: "grid", x: 2, y: 0 },
      { id: "B1", type: "busbar", x: 1, y: 2, len: 3 },
    ],
    connections: [["G1", "B1"]],
  });

  it("renders a valid sld fence as a same-origin diagram image", () => {
    const out = renderMarkdown(`قبل\n\`\`\`sld\n${GOOD}\n\`\`\`\nبعدها`);
    expect(out).toContain(`<img src="/api/diagrams/sld?spec=${encodeURIComponent(GOOD)}&amp;v=`);
    expect(out).toContain('alt="شبكة 11kV"');
    expect(out).not.toContain("<pre");
  });

  it("falls back to an escaped code block when the fence JSON is malformed", () => {
    const out = renderMarkdown("```sld\n{not json at all\n```");
    expect(out).toContain("<pre");
    expect(out).not.toContain("<img");
  });

  it("falls back when connections reference missing ids (shape check)", () => {
    const bad = JSON.stringify({
      elements: [{ id: "G1", type: "grid", x: 0, y: 0 }],
      connections: [["G1", "GHOST"]],
    });
    const out = renderMarkdown(`\`\`\`sld\n${bad}\n\`\`\``);
    expect(out).toContain("<pre");
    expect(out).not.toContain("<img");
  });

  it("never lets fence content become markup even in sld fences", () => {
    const evil = JSON.stringify({ title: '<script>alert(1)</script>', elements: [{ id: "A1", type: "grid", x: 0, y: 0 }], connections: [] }).replace(/</g, "<");
    const out = renderMarkdown(`\`\`\`sld\n${evil}\n\`\`\``);
    if (out.includes("<img")) {
      // image path: title must be attribute-escaped
      expect(out).not.toContain("<script>");
      expect(out).toContain("&lt;script&gt;");
    } else {
      expect(out).toContain("<pre");
    }
  });
});

describe("detectUnfulfilledDiagramPromise — 📐 draw-now chip trigger", () => {
  const GOOD = JSON.stringify({
    title: "شبكة 11kV",
    elements: [
      { id: "G1", type: "grid", x: 2, y: 0 },
      { id: "B1", type: "busbar", x: 1, y: 2, len: 3 },
    ],
    connections: [["G1", "B1"]],
  });

  it("happy: Arabic promise with no board → chip shows", () => {
    expect(detectUnfulfilledDiagramPromise("حاضر، سأرسم لك مخطط الشبكة.")).toBe(true);
    expect(detectUnfulfilledDiagramPromise("تمام، هجهز لك المخطط في الرد الجاي.")).toBe(true);
    expect(detectUnfulfilledDiagramPromise("سأقوم برسم مخطط تدفق الأحمال الآن.")).toBe(true);
  });

  it("happy: English first-person promise with no board → chip shows", () => {
    expect(detectUnfulfilledDiagramPromise("I'll draw the diagram for you.")).toBe(true);
    expect(detectUnfulfilledDiagramPromise("Let me sketch the single-line diagram.")).toBe(true);
    expect(detectUnfulfilledDiagramPromise("I can generate an SLD for this network.")).toBe(true);
  });

  it("happy: bare offer instead of drawing → chip shows", () => {
    expect(detectUnfulfilledDiagramPromise("تحب أن أرسمه لك؟")).toBe(true);
    expect(detectUnfulfilledDiagramPromise("أرسمه لك في خطوات؟")).toBe(true);
  });

  it("happy: delivery wording over a broken fence → chip shows", () => {
    expect(detectUnfulfilledDiagramPromise("إليك المخطط:\n```sld\n{not json\n```")).toBe(true);
    expect(detectUnfulfilledDiagramPromise("Here's the diagram:\n```sld\n{oops\n```")).toBe(true);
  });

  it("happy: past-tense delivery claims with no board → chip shows (observed live)", () => {
    expect(detectUnfulfilledDiagramPromise("جهزت لك المخطط.")).toBe(true);
    expect(detectUnfulfilledDiagramPromise("حضرت المخطط التالي:")).toBe(true);
    expect(detectUnfulfilledDiagramPromise("رسمت المخطط بناءً على طلبك.")).toBe(true);
    expect(detectUnfulfilledDiagramPromise("The following diagram shows the topology:")).toBe(true);
  });

  it("edge: promise wording AROUND a valid board → no chip (diagram delivered)", () => {
    const withBoard = `سأرسم لك المخطط:\n\`\`\`sld\n${GOOD}\n\`\`\`\nافترضت: جهد شبكة 66kV.`;
    expect(detectUnfulfilledDiagramPromise(withBoard)).toBe(false);
  });

  it("edge: token-cap cut right after the promise sentence → chip shows", () => {
    expect(detectUnfulfilledDiagramPromise("سأرسم لك مخططاً يوضح")).toBe(true);
  });

  it("edge: teaching phrasing is NOT a promise → no chip", () => {
    expect(detectUnfulfilledDiagramPromise("لرسم المخطط في ETAP: افتح قائمة Transient Analysis ثم اختر...")).toBe(false);
    expect(detectUnfulfilledDiagramPromise("I'll show you how to draw the diagram in ETAP step by step.")).toBe(false);
  });

  it("edge: user-echo imperative is NOT a promise → no chip", () => {
    expect(detectUnfulfilledDiagramPromise("اكتب: ارسم المخطط ثم اضغط Enter.")).toBe(false);
    expect(detectUnfulfilledDiagramPromise("الرسمة تحتاج بيانات الجهد أولاً.")).toBe(false);
  });

  it("failure mode: broken sld fence + no promise wording → no chip (degrades to code block silently)", () => {
    expect(detectUnfulfilledDiagramPromise("```sld\n{broken\n```")).toBe(false);
  });

  it("failure mode: empty/oversized input never throws or matches", () => {
    expect(detectUnfulfilledDiagramPromise("")).toBe(false);
    expect(detectUnfulfilledDiagramPromise("x".repeat(21_000) + "سأرسم")).toBe(false);
  });

  it("invariant: detection agrees with the renderer on what counts as a board", () => {
    // Whatever renderMarkdown turns into an <img …/api/diagrams/sld…> must
    // never trigger the chip — same shape check on both sides.
    const out = renderMarkdown(`\`\`\`sld\n${GOOD}\n\`\`\``);
    expect(out).toContain("/api/diagrams/sld");
    expect(detectUnfulfilledDiagramPromise(`\`\`\`sld\n${GOOD}\n\`\`\``)).toBe(false);
  });
});
