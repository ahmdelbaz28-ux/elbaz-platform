/**
 * DOCGEN ENGINE TESTS — the permanent document-export skill (v3.9.0).
 *
 * Contract: the LLM emits a JSON DocSpec; api/lib/docgen validates + renders
 * byte-deterministic PDF/DOCX/MD files. These tests lock: spec normalization
 * + caps, byte-level validity of all three formats, Arabic shaping/bidi
 * correctness at the codepoint level, and full determinism.
 */
import { describe, it, expect } from "vitest";

import { normalizeDocSpec, docFilename, MAX_CONTENT_CHARS } from "./spec.js";
import { buildDoc } from "./build.js";
import { shapeLine, bidiRuns } from "./shape.js";

const VALID_SPEC = {
  format: "pdf",
  filename: "Cable Selection Report!!",
  title: "تقرير اختيار كابل التغذية",
  subtitle: "المشروع: مصنع النصر — MCC-2",
  sections: [
    {
      heading: "الملخص التنفيذي",
      paragraphs: ["تم اختيار المقطع 70 مم² بعد التحقق من الأمبيراسية وهبوط الجهد."],
      bullets: ["الأمبيراسية المرجعية: 187 أمبير", "هبوط الجهد: 1.8%"],
      table: {
        headers: ["المقطع مم²", "الأمبيراسية أ"],
        rows: [["50", "153"], ["70", "187"]],
      },
    },
    { heading: "التوصية", paragraphs: ["يوصى بالمقطع 70 مم² وفق جدول (4) صفحة 12 من كتالوج السويدي."] },
  ],
  citations: ["Elsewedy Power Cables 2015 — ص 12، جدول 4"],
};

describe("normalizeDocSpec", () => {
  it("normalizes a valid spec and sanitizes the filename", () => {
    const res = normalizeDocSpec(VALID_SPEC);
    expect(res.ok).toBe(true);
    expect(res.spec!.filename).toBe("cable-selection-report");
    expect(res.spec!.format).toBe("pdf");
    expect(res.spec!.sections).toHaveLength(2);
    expect(res.spec!.citations).toHaveLength(1);
    expect(res.spec!.contentChars).toBeGreaterThan(50);
    expect(docFilename(res.spec!, "pdf")).toBe("cable-selection-report.pdf");
  });

  it("defaults the format to pdf when absent/invalid", () => {
    const res = normalizeDocSpec({ ...VALID_SPEC, format: "exe" });
    expect(res.ok).toBe(true);
    expect(res.spec!.format).toBe("pdf");
  });

  it("rejects a missing title", () => {
    const res = normalizeDocSpec({ ...VALID_SPEC, title: "   " });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("title missing");
  });

  it("rejects a spec with no usable sections", () => {
    const res = normalizeDocSpec({ title: "x", sections: [{ heading: "" }] });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("no usable sections");
  });

  it("rejects oversized content (abuse ceiling)", () => {
    // 30 sections × 24 paragraphs × 1200 chars ≈ 864k — far past the ceiling.
    const many = { title: "t", sections: Array.from({ length: 30 }, () => ({ paragraphs: Array.from({ length: 24 }, () => "x".repeat(1200)) })) };
    const res = normalizeDocSpec(many);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("content too large");
    expect(MAX_CONTENT_CHARS).toBe(60_000);
  });

  it("drops malformed rows instead of failing the whole spec", () => {
    const res = normalizeDocSpec({
      title: "t",
      sections: [
        {
          heading: "h",
          table: { headers: ["a", "b"], rows: [["1", "2"], ["bad-row"], ["3", "4"]] },
        },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.spec!.sections[0].table!.rows).toHaveLength(2);
  });
});

describe("buildDoc — markdown", () => {
  it("renders title, heading, table and citations as GFM", () => {
    const norm = normalizeDocSpec(VALID_SPEC)!;
    const md = new TextDecoder().decode(buildDoc(norm.spec!, "md").bytes);
    expect(md).toContain("# تقرير اختيار كابل التغذية");
    expect(md).toContain("## الملخص التنفيذي");
    expect(md).toContain("| المقطع مم² | الأمبيراسية أ |");
    expect(md).toContain("المصادر والمراجع");
    expect(md).toContain("[1] Elsewedy Power Cables 2015");
  });

  it("escapes pipes inside table cells", () => {
    const norm = normalizeDocSpec({ title: "t", sections: [{ table: { headers: ["a|b"], rows: [["c|d"]] } }] })!;
    const md = new TextDecoder().decode(buildDoc(norm.spec!, "md").bytes);
    expect(md).toContain("a\\|b");
    expect(md).toContain("c\\|d");
  });
});

describe("buildDoc — docx", () => {
  const norm = normalizeDocSpec(VALID_SPEC)!;
  const bytes = buildDoc(norm.spec!, "docx").bytes;

  it("produces a valid ZIP container (PK local header + EOCD)", () => {
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K
    expect(bytes[2]).toBe(0x03); // local file header
    expect(bytes[3]).toBe(0x04);
    // EOCD signature near the end
    const tail = bytes.slice(bytes.length - 64);
    expect(Array.from(tail.slice(0, 60)).some((_, i) => tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06)).toBe(true);
  });

  it("marks paragraphs bidi for Arabic content", () => {
    // word/document.xml lives in the archive; find it by scanning entries
    // (deterministic order: [Content_Types], _rels, document).
    const text = new TextDecoder().decode(bytes);
    // Stored entries keep the XML readable inside the binary — the bidi
    // markers appear verbatim in the serialized document part.
    expect(text).toContain("<w:bidi/>");
    expect(text).toContain("تقرير اختيار كابل التغذية");
  });

  it("is byte-deterministic", () => {
    const again = buildDoc(normalizeDocSpec(VALID_SPEC)!.spec!, "docx").bytes;
    expect(Buffer.from(again).equals(Buffer.from(bytes))).toBe(true);
  });
});

describe("buildDoc — pdf", () => {
  const norm = normalizeDocSpec(VALID_SPEC)!;
  const bytes = buildDoc(norm.spec!, "pdf").bytes;
  const text = Buffer.from(bytes).toString("latin1");

  it("produces a structural PDF 1.4 with embedded CID fonts", () => {
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Subtype /Type0");
    expect(text).toContain("/Encoding /Identity-H");
    expect(text).toContain("/CIDFontType2");
    expect(text).toContain("/FontFile2");
    expect(text).toContain("/ToUnicode");
    expect(text).toContain("/Filter /FlateDecode");
    expect(text).toContain("xref");
    expect(text).toContain("trailer");
  });

  it("is byte-deterministic (fixed dates, no IDs)", () => {
    const again = buildDoc(normalizeDocSpec(VALID_SPEC)!.spec!, "pdf").bytes;
    expect(Buffer.from(again).equals(Buffer.from(bytes))).toBe(true);
  });

  it("paginates a large document (/Count > 1)", () => {
    const big = normalizeDocSpec({
      title: "تقرير ضخم",
      sections: Array.from({ length: 20 }, (_, i) => ({
        heading: `قسم ${i + 1}`,
        paragraphs: ["نص تجريبي طويل نسبياً لتوليد صفحات متعددة عند الطباعة والتنسيق.".repeat(6)],
      })),
    })!;
    const pdfText = Buffer.from(buildDoc(big.spec!, "pdf").bytes).toString("latin1");
    const count = /\/Count (\d+)/.exec(pdfText);
    expect(count).toBeDefined();
    expect(Number(count![1])).toBeGreaterThan(1);
  });
});

describe("shapeLine — Arabic presentation forms", () => {
  it("joins dual-joining letters through the word", () => {
    // بسم → beh-initial, seen-medial, meem-final
    expect(shapeLine("بسم")).toEqual([0xFE91, 0xFEB4, 0xFEE2]);
  });

  it("keeps non-joining letters isolated (alef never joins leftward)", () => {
    // اب → alef-initial(iso shape), beh-isolated
    expect(shapeLine("اب")).toEqual([0xFE8D, 0xFE8F]);
  });

  it("builds the mandatory lam-alef ligature", () => {
    expect(shapeLine("لا")).toEqual([0xFEFC]); // lam-alef final form
  });

  it("drops harakat (unvocalized technical text)", () => {
    expect(shapeLine("بَسْم")).toEqual(shapeLine("بسم"));
  });

  it("passes Latin/digits through untouched", () => {
    expect(shapeLine("MTZ2 400V")).toEqual([0x4d, 0x54, 0x5a, 0x32, 0x20, 0x34, 0x30, 0x30, 0x56]);
  });
});

describe("bidiRuns — simplified UAX #9", () => {
  it("places a leading bullet at the line's right edge in RTL paragraphs", () => {
    const cps = shapeLine("•  [1] عنوان عربي");
    const runs = bidiRuns(cps, true);
    // Visual order: the LAST logical segment paints first (leftmost) — the
    // bullet+prefix is the first logical segment → last visual (rightmost).
    const first = runs[runs.length - 1];
    expect(first.rtl).toBe(true);
    expect(first.cps[first.cps.length - 1]).toBe(0x2022); // bullet rightmost
  });

  it("keeps a [1] bracket glued to its number (pair resolution → L)", () => {
    const cps = shapeLine("مرجع [1] عربي");
    const runs = bidiRuns(cps, true);
    // Find the run containing the digits 1 (0x31) — brackets must be in the
    // SAME LTR run as the digit, not resolved into the RTL flow.
    const ltrRun = runs.find((r) => !r.rtl && r.cps.includes(0x31));
    expect(ltrRun).toBeDefined();
    expect(ltrRun!.cps).toContain(0x5b); // [
    expect(ltrRun!.cps).toContain(0x5d); // ]
  });

  it("reverses RTL run codepoints for visual painting", () => {
    const cps = shapeLine("اب"); // logical: alef, beh
    const runs = bidiRuns(cps, true);
    expect(runs).toHaveLength(1);
    expect(runs[0].rtl).toBe(true);
    // painted left→right: beh first, alef last → alef lands rightmost ✓
    expect(runs[0].cps[0]).toBe(0xFE8F);
    expect(runs[0].cps[1]).toBe(0xFE8D);
  });
});
