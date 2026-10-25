/**
 * CHAT MESSAGE TABLE-CONVERTER TESTS (live user feedback 2026-10)
 *
 * The chat UI has no table renderer — Markdown tables showed up as broken
 * pipe grids. convertMarkdownTables is the deterministic enforcement layer:
 * every Markdown table becomes labeled bullet lines the renderer already
 * understands. These tests lock the conversion grammar, streaming tolerance
 * (half-arrived separators / un-terminated last row) and pass-through of
 * non-table text.
 */

import { describe, it, expect } from "vitest";

import { convertMarkdownTables } from "./chat-format";

describe("convertMarkdownTables — conversion grammar", () => {
  it("converts a 2-column table into definition bullets", () => {
    const src = [
      "قبل الجدول",
      "| المعامل | القيمة |",
      "| --- | --- |",
      "| الجهد | 11 kV |",
      "| التيار | 250 A |",
      "بعد الجدول",
    ].join("\n");
    const out = convertMarkdownTables(src);
    expect(out).toBe(
      [
        "قبل الجدول",
        "- **الجهد:** 11 kV",
        "- **التيار:** 250 A",
        "بعد الجدول",
      ].join("\n"),
    );
    expect(out).not.toContain("|");
    expect(out).not.toContain("---");
  });

  it("converts a 3-column table into per-row bullets with every cell labeled", () => {
    const src = [
      "| Phase | Setting | Result |",
      "| --- | --- | --- |",
      "| Load Flow | Newton-Raphson | Converged |",
      "| Short Circuit | IEC 60909 | 12.5 kA |",
    ].join("\n");
    const out = convertMarkdownTables(src);
    expect(out).toBe(
      [
        "- **Phase:** Load Flow — **Setting:** Newton-Raphson — **Result:** Converged",
        "- **Phase:** Short Circuit — **Setting:** IEC 60909 — **Result:** 12.5 kA",
      ].join("\n"),
    );
  });

  it("converts an LTR-aligned separator variant (colons + no outer pipes)", () => {
    const src = ["| a | b |", "| :-- | --: |", "| x | y |"].join("\n");
    expect(convertMarkdownTables(src)).toBe("- **x:** y");
  });

  it("falls back to the header when the first cell is empty (2 columns)", () => {
    const src = ["| المعامل | القيمة |", "| --- | --- |", "| | 11 kV |"].join("\n");
    expect(convertMarkdownTables(src)).toBe("- **المعامل:** 11 kV");
  });

  it("renders missing cells as an em dash", () => {
    const src = ["| a | b |", "| --- | --- |", "| x | |"].join("\n");
    expect(convertMarkdownTables(src)).toBe("- **x:** —");
  });

  it("handles a single-column table as plain bullets", () => {
    const src = ["| خطوات |", "| --- |", "| افتح ETAP |", "| اختر Bus |"].join("\n");
    expect(convertMarkdownTables(src)).toBe(["- افتح ETAP", "- اختر Bus"].join("\n"));
  });

  it("strips bold markers already present inside cells (no nested-asterisk noise)", () => {
    const src = ["| a | b |", "| --- | --- |", "| **x** | **y** |"].join("\n");
    expect(convertMarkdownTables(src)).toBe("- **x:** y");
  });

  it("keeps GFM escaped pipes inside cell values", () => {
    const src = ["| a | b |", "| --- | --- |", "| x | yes \\| maybe |"].join("\n");
    expect(convertMarkdownTables(src)).toBe("- **x:** yes | maybe");
  });

  it("keeps a degenerate header+separator table as one bullet (no data loss)", () => {
    const src = ["| a | b |", "| --- | --- |"].join("\n");
    expect(convertMarkdownTables(src)).toBe("- a — b");
  });
});

describe("convertMarkdownTables — streaming tolerance", () => {
  it("converts an un-terminated last row (no trailing pipe, mid-stream)", () => {
    const src = ["| a | b |", "| --- | --- |", "| x | 11 kV"].join("\n");
    expect(convertMarkdownTables(src)).toBe("- **x:** 11 kV");
  });

  it("converts with a half-arrived separator row (mid-stream)", () => {
    const src = ["| a | b |", "| ---"].join("\n");
    expect(convertMarkdownTables(src)).toBe("- a — b");
  });
});

describe("convertMarkdownTables — pass-through", () => {
  it("leaves ordinary prose untouched (single pipe, no separator)", () => {
    const src = "منطق OR | بوابة منطقية بسيطة في الدوائر الرقمية";
    expect(convertMarkdownTables(src)).toBe(src);
  });

  it("leaves a bare horizontal rule untouched", () => {
    const src = "فقرة أولى\n\n---\n\nفقرة ثانية";
    expect(convertMarkdownTables(src)).toBe(src);
  });

  it("returns short text without pipes untouched (fast path)", () => {
    expect(convertMarkdownTables("سلام عليكم")).toBe("سلام عليكم");
    expect(convertMarkdownTables("")).toBe("");
  });

  it("converts two adjacent tables separated by prose", () => {
    const src = [
      "| a | b |",
      "| --- | --- |",
      "| x | y |",
      "سطر فاصل",
      "| c | d |",
      "| --- | --- |",
      "| z | w |",
    ].join("\n");
    const out = convertMarkdownTables(src);
    expect(out).toBe(["- **x:** y", "سطر فاصل", "- **z:** w"].join("\n"));
  });
});
