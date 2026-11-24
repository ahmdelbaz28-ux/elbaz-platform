/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DOCGEN — permanent document-generation skill for ELBAZ (PDF/DOCX/MD)
 * ───────────────────────────────────────────────────────────────────────────
 *  Spec layer: the ONLY boundary between model output and the renderers.
 *  The LLM never produces PDF bytes, OOXML or raw file markup. It emits a
 *  compact JSON DocSpec inside a ```docgen fenced block; this module validates
 *  + normalizes + caps it. A spec that fails validation is dropped by the
 *  caller (degrades to a code block) — a chat reply can never break because
 *  of a bad document request. Same invariant as api/lib/sld/.
 *
 *  Deterministic: same spec → byte-identical file (testable, cacheable).
 *  Zero new dependencies: MD is text, DOCX is a minimal stored-ZIP of XML,
 *  PDF is a hand-rolled writer over node:zlib + two vendored font subsets
 *  (GNU FreeFont — GPL with the font-embedding exception, embedding in
 *  documents is explicitly permitted).
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const DOC_FORMATS = ["pdf", "docx", "md"] as const;
export type DocFormat = (typeof DOC_FORMATS)[number];

export interface DocTable {
  /** Column headers (row 1). 1–8 columns, each ≤ 60 chars. */
  headers: string[];
  /** Body rows — every row must have the same cell count as headers. */
  rows: string[][];
}

export interface DocSection {
  /** Section heading (≤ 120 chars). */
  heading?: string;
  /** Body paragraphs (each ≤ 1200 chars). */
  paragraphs?: string[];
  /** Bullet list items (each ≤ 500 chars). */
  bullets?: string[];
  /** Table block (headers + rows). */
  table?: DocTable;
}

export interface DocSpec {
  /** Output format (default pdf). */
  format: DocFormat;
  /** ASCII file stem (no extension) — sanitized, ≤ 60 chars. */
  filename: string;
  /** Document title (≤ 160 chars). */
  title: string;
  /** Optional subtitle line under the title (≤ 200 chars). */
  subtitle?: string;
  /** Ordered content sections (≤ 30). */
  sections: DocSection[];
  /** Source-evidence citations — the platform's citation contract, shipped INSIDE the file (≤ 20). */
  citations?: string[];
}

export interface NormalizedDocSpec extends DocSpec {
  /** Total content characters after normalization (router guards + size hints). */
  contentChars: number;
}

export interface SpecResult {
  ok: boolean;
  /** Machine-readable failure class for the router's 422 diagnostics. */
  error?: string;
  spec?: NormalizedDocSpec;
}

const MAX_SECTIONS = 30;
const MAX_PARAGRAPHS = 24;
const MAX_BULLETS = 24;
const MAX_ROWS = 120;
const MAX_COLS = 8;
const MAX_CITATIONS = 20;
/** Hard content ceiling — a generous multi-page report, bounded for abuse. */
export const MAX_CONTENT_CHARS = 60_000;
/** Raw fence ceiling enforced by the renderer before JSON.parse. */
export const MAX_SPEC_RAW_CHARS = 64_000;

/** Strips C0 control chars (except \n \t) without a control-char regex
 *  ( SonarQube S2639 ) — plain char-code filter, deterministic. */
function stripControlChars(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x20 && cp !== 0x09 && cp !== 0x0a) continue;
    if (cp === 0x7f) continue;
    out += ch;
  }
  return out;
}

function clampStr(s: unknown, max: number): string {
  return typeof s === "string" ? stripControlChars(s.replace(/\r\n/g, "\n")).trim().slice(0, max) : "";
}

/** ASCII file stem: keep [A-Za-z0-9-_], collapse the rest to '-', trim edges. */
export function sanitizeFilename(raw: string): string {
  const cleaned = raw
    .slice(0, 60)
    .replace(/[^A-Za-z0-9-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return cleaned || "elbaz-document";
}

function normalizeTable(raw: unknown): DocTable | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<DocTable>;
  const headers = Array.isArray(t.headers) ? t.headers.slice(0, MAX_COLS).map((h) => clampStr(h, 60)) : [];
  if (headers.length === 0 || headers.some((h) => !h)) return null;
  const rows = Array.isArray(t.rows)
    ? t.rows
        .slice(0, MAX_ROWS)
        .map((r) => (Array.isArray(r) ? r.slice(0, headers.length).map((c) => clampStr(c, 300)) : []))
        .filter((r) => r.length === headers.length && r.some((c) => c))
    : [];
  if (rows.length === 0) return null;
  return { headers, rows };
}

function normalizeSection(raw: unknown): DocSection | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<DocSection>;
  const heading = clampStr(s.heading, 120) || undefined;
  const paragraphs = Array.isArray(s.paragraphs)
    ? s.paragraphs.slice(0, MAX_PARAGRAPHS).map((p) => clampStr(p, 1200)).filter((p) => p)
    : [];
  const bullets = Array.isArray(s.bullets)
    ? s.bullets.slice(0, MAX_BULLETS).map((b) => clampStr(b, 500)).filter((b) => b)
    : [];
  const table = normalizeTable(s.table);
  if (!heading && paragraphs.length === 0 && bullets.length === 0 && !table) return null;
  return {
    ...(heading ? { heading } : {}),
    ...(paragraphs.length ? { paragraphs } : {}),
    ...(bullets.length ? { bullets } : {}),
    ...(table ? { table } : {}),
  };
}

export function isDocFormat(f: unknown): f is DocFormat {
  return typeof f === "string" && (DOC_FORMATS as readonly string[]).includes(f);
}

/**
 * Validate + normalize a raw (model-emitted) spec. Never throws — every
 * failure returns a typed error so the fence can degrade gracefully.
 */
export function normalizeDocSpec(raw: unknown): SpecResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "spec is not an object" };
  const r = raw as Partial<DocSpec>;

  const title = clampStr(r.title, 160);
  if (!title) return { ok: false, error: "title missing" };

  const sectionsRaw = Array.isArray(r.sections) ? r.sections : [];
  const sections: DocSection[] = [];
  for (const s of sectionsRaw.slice(0, MAX_SECTIONS)) {
    const ns = normalizeSection(s);
    if (ns) sections.push(ns);
  }
  if (sections.length === 0) return { ok: false, error: "no usable sections" };

  const citations = Array.isArray(r.citations)
    ? r.citations.slice(0, MAX_CITATIONS).map((c) => clampStr(c, 300)).filter((c) => c)
    : [];

  let contentChars = title.length + (clampStr(r.subtitle, 200).length || 0);
  for (const s of sections) {
    if (s.heading) contentChars += s.heading.length;
    for (const p of s.paragraphs ?? []) contentChars += p.length;
    for (const b of s.bullets ?? []) contentChars += b.length;
    if (s.table) {
      for (const h of s.table.headers) contentChars += h.length;
      for (const row of s.table.rows) for (const c of row) contentChars += c.length;
    }
  }
  for (const c of citations) contentChars += c.length;
  if (contentChars > MAX_CONTENT_CHARS) return { ok: false, error: `content too large (${contentChars} > ${MAX_CONTENT_CHARS})` };

  return {
    ok: true,
    spec: {
      format: isDocFormat(r.format) ? r.format : "pdf",
      filename: sanitizeFilename(clampStr(r.filename, 60)),
      title,
      ...(clampStr(r.subtitle, 200) ? { subtitle: clampStr(r.subtitle, 200) } : {}),
      sections,
      ...(citations.length ? { citations } : {}),
      contentChars,
    },
  };
}

/** Output filename with extension, e.g. "cable-report.pdf". */
export function docFilename(spec: NormalizedDocSpec, format: DocFormat): string {
  return `${sanitizeFilename(spec.filename)}.${format}`;
}

export const DOC_MIME: Record<DocFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md: "text/markdown; charset=utf-8",
};
