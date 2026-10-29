/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SLD — Single-Line Diagram engine for ELBAZ (Phase 1 core)
 * ───────────────────────────────────────────────────────────────────────────
 *  Ported ARCHITECTURE (not code) from abduznik/electrical-schematics-skill:
 *  structured spec → grid layout → orthogonal collision-aware routing →
 *  self-audit linter → SVG. The Python/KiCad original targets electronics
 *  schematics; this port targets ETAP power-system single-line diagrams and
 *  runs in the same Node runtime as the API (node:22-alpine — no Python in
 *  the image, no new dependencies: SVG is plain text).
 *
 *  Integration contract (security-relevant):
 *  - The LLM NEVER produces SVG or HTML. It emits a compact JSON spec inside
 *    a ```sld fenced block; the backend lints + renders it. Model text never
 *    becomes markup (same invariant as src/lib/chat-render.ts).
 *  - Rendering is deterministic: same spec → byte-identical SVG (testable).
 *  - A spec that fails the linter renders best-effort or is dropped by the
 *    caller — a chat reply can never break because of a bad diagram.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Element types the v1 symbol set supports (ETAP SLD vocabulary). */
export const SLD_ELEMENT_TYPES = [
  "generator", // circle with ~ wave — source
  "grid", // utility infeed — circle with G
  "transformer2", // two overlapping circles
  "busbar", // thick horizontal bar (len in grid units, default 2)
  "breaker", // square with diagonal — closed
  "disconnector", // knife switch
  "fuse", // small rectangle with center line
  "load", // arrow into a box (demand)
  "motor", // circle with M
  "ct", // current transformer — circle on the line
  "ground", // ground symbol (leaf node)
  "junction", // plain connection dot (pass-through)
] as const;

export type SldElementType = (typeof SLD_ELEMENT_TYPES)[number];

export interface SldElement {
  /** Unique reference (G1, CB1, T1, B1...) — referenced by connections. */
  id: string;
  type: SldElementType;
  /** Grid coordinates (unit = 40px). Busbars anchor their LEFT end here. */
  x: number;
  y: number;
  /** Optional label rendered near the element (Arabic or English). */
  label?: string;
  /** Busbar length in grid units (default 2, min 1, max 6). */
  len?: number;
}

export interface SldSpec {
  /** Sheet title — rendered top-center. */
  title?: string;
  elements: SldElement[];
  /** Each connection is [fromId, toId] — routed orthogonally. */
  connections: Array<[string, string]>;
  /** "dark" matches the chat panel; "light" for lessons/print. Default dark. */
  theme?: "dark" | "light";
}

// ── Geometry constants (px) ──────────────────────────────────────────────────
export const CELL = 40; // one grid unit
export const MARGIN = 30; // sheet margin
export const LABEL_GAP = 14; // label offset from symbol body
export const LABEL_FONT = 12; // label font size (px)
export const LABEL_SIDE_GAP = 8; // px between a symbol body and its side label

/** Conservative deterministic text width (no DOM metrics available in Node).
 *  Lives here (not render.ts) so the linter's sheet sizing can measure labels
 *  without a circular import. */
export function textWidth(text: string, fontSize: number): number {
  return Math.max(10, Math.round(fontSize * 0.62 * text.length));
}

export interface BBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PlacedElement {
  el: SldElement;
  /** Pixel center of the symbol body. */
  cx: number;
  cy: number;
  /** Body bounding box in px. */
  bbox: BBox;
  /** Terminal points available for wire connections (px). */
  top: { x: number; y: number };
  bottom: { x: number; y: number };
}

export function rectsOverlap(a: BBox, b: BBox, pad = 0): boolean {
  return !(a.x2 + pad < b.x1 || a.x1 - pad > b.x2 || a.y2 + pad < b.y1 || a.y1 - pad > b.y2);
}

/** Busbars are horizontal: len units wide, 10px tall. Others centered on cell. */
export function elementExtent(el: SldElement): { w: number; h: number } {
  switch (el.type) {
    case "busbar":
      return { w: Math.max(1, Math.min(6, el.len ?? 2)) * CELL, h: 10 };
    case "generator":
    case "grid":
    case "motor":
      return { w: 36, h: 36 };
    case "transformer2":
      return { w: 30, h: 44 };
    case "breaker":
    case "disconnector":
      return { w: 26, h: 30 };
    case "fuse":
      return { w: 22, h: 14 };
    case "load":
      return { w: 30, h: 22 };
    case "ct":
      return { w: 18, h: 18 };
    case "ground":
      return { w: 22, h: 18 };
    case "junction":
      return { w: 8, h: 8 };
    default:
      return { w: 30, h: 30 };
  }
}

/**
 * Grid → pixel placement with terminals.
 * Vertical flow convention (ETAP style): sources/transformers chain top→down
 * via `bottom` terminal; busbars feed loads downward via their BOTTOM edge.
 * The busbar bottom terminal sits at its RIGHT end when it has len>1 so a
 * fan-out from a busbar leaves at the bar's end, not mid-bar.
 */
export function placeElements(spec: SldSpec): PlacedElement[] {
  return spec.elements.map((el) => {
    const { w, h } = elementExtent(el);
    const cx = MARGIN + el.x * CELL + w / 2;
    const cy = MARGIN + el.y * CELL + h / 2;
    const bbox: BBox = { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 };
    const isBar = el.type === "busbar";
    return {
      el,
      cx,
      cy,
      bbox,
      top: { x: cx, y: bbox.y1 },
      bottom: isBar ? { x: bbox.x2, y: bbox.y2 } : { x: cx, y: bbox.y2 },
    };
  });
}
