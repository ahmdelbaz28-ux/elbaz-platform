/**
 * DOCX renderer — DocSpec → WordprocessingML (.docx).
 *
 * DOCX is the Arabic-native format: Word itself does the shaping and bidi,
 * so the generator only has to mark paragraphs <w:bidi/> + runs <w:rtl/>
 * and order content logically. Latin-only paragraphs stay LTR. Tables use
 * <w:bidiVisual/> so the FIRST declared column renders rightmost — matching
 * how the PDF engine draws RTL tables.
 *
 * Structure (minimal valid OOXML): [Content_Types].xml, _rels/.rels,
 * word/document.xml. No styles part — all formatting is direct, so a bad
 * style reference can never exist. Deterministic output.
 */

import type { DocSpec, NormalizedDocSpec } from "./spec.js";
import { buildZip, type ZipEntry } from "./zip.js";

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const FONT = "Times New Roman";

/** Run properties — complex-script sizes need w:szCs to actually scale Arabic. */
function runProps(bold: boolean, halfPt: number, rtl: boolean): string {
  return `<w:rPr>${rtl ? "<w:rtl/>" : ""}${bold ? "<w:b/><w:bCs/>" : ""}<w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/><w:sz w:val="${halfPt}"/><w:szCs w:val="${halfPt}"/></w:rPr>`;
}

function para(text: string, opts: { bold?: boolean; halfPt?: number; rtl?: boolean; spacingAfter?: number; shade?: string } = {}): string {
  const rtl = opts.rtl ?? ARABIC_RE.test(text);
  const halfPt = opts.halfPt ?? 24;
  const bold = opts.bold ?? false;
  const spacing = opts.spacingAfter ?? 120;
  return (
    `<w:p><w:pPr>` +
    (rtl ? "<w:bidi/>" : "") +
    `<w:jc w:val="${rtl ? "right" : "left"}"/>` +
    `<w:spacing w:after="${spacing}"/>` +
    (opts.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${opts.shade}"/>` : "") +
    `</w:pPr>` +
    `<w:r>${runProps(bold, halfPt, rtl)}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
  );
}

function heading(text: string): string {
  return para(text, { bold: true, halfPt: 28, spacingAfter: 160, shade: "EEF3FA" });
}

function tableXml(t: { headers: string[]; rows: string[][] }): string {
  const borders = `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"]
    .map((e) => `<w:${e} w:val="single" w:sz="4" w:color="7A93B5"/>`)
    .join("")}</w:tblBorders>`;
  const cols = t.headers
    .map(() => `<w:gridCol w:w="${Math.floor(9280 / t.headers.length)}"/>`)
    .join("");
  const cell = (text: string, bold: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>` +
    `<w:p><w:pPr><w:bidi/><w:jc w:val="right"/><w:spacing w:after="40"/></w:pPr>` +
    `<w:r>${runProps(bold, 22, ARABIC_RE.test(text))}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p></w:tc>`;
  const headerRow = `<w:tr><w:trPr/><w:tblHeader/>${t.headers.map((h) => cell(h, true)).join("")}</w:tr>`;
  const bodyRows = t.rows
    .map((r) => `<w:tr>${r.map((c) => cell(c, false)).join("")}</w:tr>`)
    .join("");
  return `<w:tbl><w:tblPr><w:bidiVisual/>${borders}<w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tblGrid>${cols}</w:tblGrid>${headerRow}${bodyRows}</w:tbl>`;
}

function bulletXml(text: string): string {
  const rtl = ARABIC_RE.test(text);
  // Bullet glyph inline (•) — avoids numbering.xml entirely. In a bidi
  // paragraph the logical run order (mark, then text) renders with the mark
  // rightmost for RTL and leftmost for LTR — correct in both directions.
  return (
    `<w:p><w:pPr>` +
    (rtl ? "<w:bidi/>" : "") +
    `<w:jc w:val="${rtl ? "right" : "left"}"/>` +
    `<w:spacing w:after="80"/>` +
    `</w:pPr>` +
    `<w:r>${runProps(false, 24, false)}<w:t xml:space="preserve">•  </w:t></w:r>` +
    `<w:r>${runProps(false, 24, rtl)}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>` +
    `</w:p>`
  );
}

/** DocSpec → the three OOXML parts (no compression, see zip.ts). */
export function renderDocx(spec: NormalizedDocSpec): Uint8Array {
  const body: string[] = [];
  body.push(para(spec.title, { bold: true, halfPt: 36, spacingAfter: 80 }));
  if (spec.subtitle) body.push(para(spec.subtitle, { halfPt: 26, spacingAfter: 240 }));
  // Generation stamp + owner line (plain text, no external resources).
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  body.push(para(`ELBAZ Platform — أُنشئ آليًا ${stamp} UTC`, { halfPt: 18, spacingAfter: 240, shade: "F4F7FB" }));

  for (const s of spec.sections) {
    if (s.heading) body.push(heading(s.heading));
    for (const p of s.paragraphs ?? []) body.push(para(p));
    for (const b of s.bullets ?? []) body.push(bulletXml(b));
    if (s.table) {
      body.push(tableXml(s.table));
      body.push(para("", { halfPt: 12, spacingAfter: 120 }));
    }
  }

  if (spec.citations?.length) {
    body.push(heading("المصادر والمراجع"));
    for (const [i, c] of spec.citations.entries()) body.push(bulletXml(`[${i + 1}] ${c}`));
  }

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:bidi/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;

  const entries: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    { name: "word/document.xml", text: document },
  ];
  return buildZip(entries);
}

export type { DocSpec };
