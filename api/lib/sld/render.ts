/**
 * SLD renderer — spec → deterministic SVG string.
 * Routing: orthogonal 3-segment runs (down → across → down) with per-source
 * fan-out columns (unique X per outgoing wire — the KiCad skill's rule that
 * no two wires share a segment), best-effort with the linter as the quality
 * gate. Output is escaped XML; model text never becomes markup.
 *
 * Label placement contract (visual-audit fix — "nothing on top of anything,
 * text beside what it describes"): a label must NEVER sit on a wire, another
 * symbol, another label or the sheet title. Every candidate spot is SCORED
 * against all painted geometry (title / bodies / placed labels / wire runs /
 * sheet edges) and the first zero-collision spot wins; a least-collision
 * fallback keeps output deterministic when the sheet is dense.
 */
import { paintSymbol, THEMES, type Theme } from "./symbols";
import { labelSideBand, lintSpec, sheetSize } from "./lint";
import {
  LABEL_FONT,
  LABEL_GAP,
  LABEL_SIDE_GAP,
  textWidth,
  type BBox,
  type PlacedElement,
  type SldSpec,
} from "./types";

// Re-exports keep the historical import surface (tests import these from here).
export { textWidth, LABEL_FONT } from "./types";

export interface RenderResult {
  svg: string;
  ok: boolean;
  findings: ReturnType<typeof lintSpec>["findings"];
}

export function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

// ── Label geometry helpers (exported for the no-overlap regression tests) ───

const LABEL_SIDE_GAP_PX = LABEL_SIDE_GAP; // px between a symbol body and its side label

/** Pixel box a label occupies given its anchor and baseline. */
export function labelBox(
  text: string,
  anchor: "start" | "middle" | "end",
  x: number,
  y: number,
  fontSize = LABEL_FONT,
): BBox {
  const w = textWidth(text, fontSize);
  const x1 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
  return { x1, y1: y - fontSize * 0.78, x2: x1 + w, y2: y + fontSize * 0.28 };
}

function boxesOverlap(a: BBox, b: BBox, pad: number): boolean {
  return !(a.x2 + pad < b.x1 || a.x1 - pad > b.x2 || a.y2 + pad < b.y1 || a.y1 - pad > b.y2);
}

/** Does a (guaranteed-orthogonal) wire segment pass within `pad` px of the box? */
export function segHitsBox(
  sx1: number,
  sy1: number,
  sx2: number,
  sy2: number,
  box: BBox,
  pad = 3,
): boolean {
  const bx1 = box.x1 - pad;
  const bx2 = box.x2 + pad;
  const by1 = box.y1 - pad;
  const by2 = box.y2 + pad;
  if (sx1 === sx2) return sx1 >= bx1 && sx1 <= bx2 && Math.max(sy1, sy2) >= by1 && Math.min(sy1, sy2) <= by2;
  if (sy1 === sy2) return sy1 >= by1 && sy1 <= by2 && Math.max(sx1, sx2) >= bx1 && Math.min(sx1, sx2) <= bx2;
  // Defensive fallback (routing only emits orthogonal runs)
  return !(sx2 + pad < bx1 || sx1 - pad > bx2 || sy2 + pad < by1 || sy1 - pad > by2);
}

// ── Routing ──────────────────────────────────────────────────────────────────

type Pt = { x: number; y: number };

/**
 * Orthogonal routes with per-source fan-out stagger (unique X per outgoing
 * wire). Busbar targets land on the bar's top edge at the wire's own X;
 * busbar sources leave from their bottom edge, staggered LEFTWARD so the
 * connection dots stay ON the bar instead of floating past its end.
 */
function routeWires(
  placed: PlacedElement[],
  connections: Array<[string, string]>,
): Array<{ pts: Pt[]; dots: Pt[] }> {
  const byId = new Map(placed.map((p) => [p.el.id, p]));
  const fanIndex = new Map<string, number>();
  const wires: Array<{ pts: Pt[]; dots: Pt[] }> = [];

  for (const [a, b] of connections) {
    const A = byId.get(a);
    const B = byId.get(b);
    if (!A || !B) continue;

    const idx = fanIndex.get(A.el.id) ?? 0;
    fanIndex.set(A.el.id, idx + 1);
    const startX =
      A.el.type === "busbar" ? Math.max(A.bbox.x1 + 6, A.bottom.x - idx * 10) : A.bottom.x + idx * 10;
    const startY = A.bottom.y;

    let endX = B.top.x;
    const endY = B.top.y;
    if (B.el.type === "busbar") {
      endX = Math.min(Math.max(startX, B.bbox.x1 + 6), B.bbox.x2 - 6);
    }

    const dots: Pt[] = [];
    if (A.el.type === "busbar") dots.push({ x: startX, y: startY });
    if (B.el.type === "busbar") dots.push({ x: endX, y: endY });

    const pts: Pt[] = [{ x: startX, y: startY }];
    const gap = endY - startY;
    if (Math.abs(startX - endX) < 1) {
      pts.push({ x: startX, y: endY });
    } else if (gap > 0) {
      // The turn point must stay strictly INSIDE the vertical gap — a turn
      // below the target's top edge would hook the wire backwards (seen live
      // on the 1-grid-cell source→breaker hop during visual verification).
      const midY =
        gap >= 16
          ? startY + Math.min(Math.max(12, Math.round(gap / 2) - 6), gap - 4)
          : startY + Math.max(2, Math.round(gap / 2));
      pts.push({ x: startX, y: midY }, { x: endX, y: midY }, { x: endX, y: endY });
    } else {
      // Target ABOVE the source (spec modelling quirk): side-loop around.
      const loopY = startY + 8;
      pts.push({ x: startX, y: loopY }, { x: endX, y: loopY }, { x: endX, y: endY });
    }
    wires.push({ pts, dots });
  }
  return wires;
}

// ── Label placement (the no-overlap engine) ──────────────────────────────────

interface LabelCandidate {
  anchor: "start" | "middle" | "end";
  x: number;
  y: number;
}

/**
 * RTL base direction for every painted string (live visual-audit fix):
 * diagrams are consumed as <img>, which inherits NO page direction — without
 * an explicit base, mixed Arabic+Latin labels split their number from its
 * unit ("محرك 500kW" rendered as "500 محركkW"). With rtl base the
 * "500kW" run stays one LTR island: "500kW محرك". unicode-bidi:isolate is
 * the SVG2-sanctioned belt-and-suspenders on top of the attribute.
 *
 * ANCHOR GEOMETRY under rtl base: "start" is the RIGHT edge (text extends
 * left), "end" is the LEFT edge (text extends right). Emission therefore
 * FLIPS start↔end so the visual box stays exactly the box the collision
 * engine scored (see emitText below — tests mirror this in parseSvg).
 */
const RTL_TEXT_ATTRS = `direction="rtl" unicode-bidi="isolate"`;

/** Flip a collision-engine anchor into its rtl-base equivalent (same box). */
function flipAnchor(a: "start" | "middle" | "end"): "start" | "middle" | "end" {
  return a === "start" ? "end" : a === "end" ? "start" : "middle";
}

/** Emit an RTL <text> occupying exactly the box scored for (anchor, x). */
function emitText(anchor: "start" | "middle" | "end", x: number, y: number, fontSize: number, fill: string, content: string, extra = ""): string {
  return `\n  <text x="${x}" y="${y}" text-anchor="${flipAnchor(anchor)}" ${RTL_TEXT_ATTRS}${extra} font-size="${fontSize}" fill="${fill}" font-family="'Segoe UI', Tahoma, sans-serif">${escapeXml(content)}</text>`;
}

/**
 * Candidate spots, side-first — the label sits NEXT TO what it describes.
 * Busbars prefer the LEFT side: their top edge receives the feed wire and
 * their bottom edge launches fan-out wires, so the right flank is busy.
 *
 * Dense-row escapes (live-audit regression: "فيوز 100A" on a packed bottom
 * row had NO zero-collision spot — its neighbors' bodies reach DEEPER than
 * its own short symbol, so every same-band below/side spot is boxed in and
 * the least-collision fallback dropped the label onto the fan-out wires):
 *  - 4 diagonal side spots (right/left × up/down);
 *  - a DEPTH LADDER under/over the element: 3 tiers × 3 x-shifts. Deeper
 *    tiers clear the neighbors' bodies/labels entirely (the loop's
 *    first-zero-wins rule means sparse sheets keep today's t0 placements).
 * Every candidate is scored; the first zero-collision spot wins.
 */
function labelCandidates(p: PlacedElement): LabelCandidate[] {
  const right: LabelCandidate = { anchor: "start", x: p.bbox.x2 + LABEL_SIDE_GAP_PX, y: p.cy + 4 };
  const left: LabelCandidate = { anchor: "end", x: p.bbox.x1 - LABEL_SIDE_GAP_PX, y: p.cy + 4 };
  const rightDown: LabelCandidate = { anchor: "start", x: right.x, y: p.cy + 34 };
  const rightUp: LabelCandidate = { anchor: "start", x: right.x, y: p.cy - 26 };
  const leftDown: LabelCandidate = { anchor: "end", x: left.x, y: p.cy + 34 };
  const leftUp: LabelCandidate = { anchor: "end", x: left.x, y: p.cy - 26 };
  const belowY = p.bbox.y2 + LABEL_GAP + 4;
  const aboveY = p.bbox.y1 - LABEL_GAP;
  // One tier = 3 x-variants at the same depth: centered + shifted both ways
  // (a shift threads the gap between neighbor bodies that block the center).
  const tier = (y: number): LabelCandidate[] => [
    { anchor: "middle", x: p.cx, y },
    { anchor: "end", x: p.cx + 15, y },
    { anchor: "start", x: p.cx + 15, y },
  ];
  const belowTiers = [...tier(belowY), ...tier(belowY + 22), ...tier(belowY + 44)];
  const aboveTiers = [...tier(aboveY), ...tier(aboveY - 22), ...tier(aboveY - 44)];
  return p.el.type === "busbar"
    ? [left, right, aboveTiers[0], belowTiers[0], leftDown, leftUp, rightDown, rightUp, ...aboveTiers.slice(1), ...belowTiers.slice(1)]
    : [right, left, rightDown, rightUp, leftDown, leftUp, belowTiers[0], aboveTiers[0], ...belowTiers.slice(1), ...aboveTiers.slice(1)];
}

/** Keep the candidate inside the sheet (labels must never clip at an edge). */
function clampCandidateX(c: LabelCandidate, w: number, width: number): number {
  if (c.anchor === "start") return Math.min(c.x, width - 4 - w);
  if (c.anchor === "end") return Math.max(c.x, 4 + w);
  return Math.min(Math.max(c.x, 4 + w / 2), width - 4 - w / 2);
}

/**
 * Place every label in the first candidate spot whose box collides with
 * NOTHING (title, other bodies, already-placed labels, wire runs, sheet
 * edges); fall back to the least-colliding spot so output stays
 * deterministic on dense sheets.
 */
function placeLabels(
  placed: PlacedElement[],
  wirePts: Pt[][],
  titleBox: BBox | null,
  width: number,
  height: number,
  theme: Theme,
): string {
  const taken: BBox[] = [];
  const out: string[] = [];
  for (const p of placed) {
    const label = (p.el.label ?? "").trim();
    if (!label) continue;
    const w = textWidth(label, LABEL_FONT);
    let best: { c: LabelCandidate; box: BBox; score: number } | null = null;
    for (const c of labelCandidates(p)) {
      const x = clampCandidateX(c, w, width);
      const box = labelBox(label, c.anchor, x, c.y);
      let score = 0;
      if (box.x1 < 4 || box.x2 > width - 4 || box.y1 < 4 || box.y2 > height - 4) score += 100;
      if (titleBox && boxesOverlap(box, titleBox, 6)) score += 50;
      for (const q of placed) {
        // NOTE: the label's OWN body is included — the edge clamp can push a
        // candidate onto the element it describes, and that must score as a
        // collision ("nothing on top of anything" has no self-exemption).
        if (boxesOverlap(box, q.bbox, 5)) score += 40;
      }
      for (const t of taken) {
        if (boxesOverlap(box, t, 4)) score += 30;
      }
      for (const pts of wirePts) {
        let hit = false;
        for (let i = 1; i < pts.length; i++) {
          if (segHitsBox(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, box, 3)) {
            hit = true;
            break;
          }
        }
        if (hit) {
          score += 20;
          break;
        }
      }
      if (!best || score < best.score) best = { c: { ...c, x }, box, score };
      if (score === 0) break; // clean spot found — take it
    }
    if (!best) continue;
    taken.push(best.box);
    out.push(emitText(best.c.anchor, best.c.x, best.c.y, LABEL_FONT, theme.text, label));
  }
  return out.join("");
}

/** Shift geometry right so left-side labels never clip at the sheet edge. */
function shiftX(p: PlacedElement, dx: number): PlacedElement {
  if (!dx) return p;
  return {
    ...p,
    cx: p.cx + dx,
    bbox: { ...p.bbox, x1: p.bbox.x1 + dx, x2: p.bbox.x2 + dx },
    top: { x: p.top.x + dx, y: p.top.y },
    bottom: { x: p.bottom.x + dx, y: p.bottom.y },
  };
}

export function renderSld(spec: SldSpec): RenderResult {
  const audit = lintSpec(spec);
  const theme = THEMES[spec.theme === "light" ? "light" : "dark"];
  const { width, height } = sheetSize(spec);
  const connections = Array.isArray(spec.connections) ? spec.connections : [];

  // Labeled elements reserve a side band scaled to the LONGEST label (see
  // labelSideBand in lint.ts) — split it half-left/half-right so beside-labels
  // fit on both sheet edges without clamping onto symbol bodies.
  const DX = labelSideBand(spec) / 2;
  const placed = audit.placed.map((p) => shiftX(p, DX));

  const wires = routeWires(placed, connections);
  const wirePts = wires.map((w) => w.pts);

  const bodies = placed.map((p) => paintSymbol(p, theme)).join("");

  const title = (spec.title ?? "").trim();
  let titleSvg = "";
  let titleBox: BBox | null = null;
  if (title) {
    const fs = 14;
    const tw = textWidth(title, fs);
    const maxW = width - 16;
    // Over-long titles are squeezed INSIDE the sheet instead of spilling over
    // the top row of symbols.
    const tl = tw > maxW ? ` textLength="${maxW}" lengthAdjust="spacingAndGlyphs"` : "";
    // Middle anchor is direction-invariant; rtl base keeps mixed titles
    // ("منشأة صناعية - بار طوارئ بمصدرين") in Arabic reading order.
    titleSvg = emitText("middle", Math.round(width / 2), 22, fs, theme.text, title, ` font-weight="bold"${tl}`);
    titleBox = labelBox(title, "middle", Math.round(width / 2), 22, fs);
  }

  const labels = placeLabels(placed, wirePts, titleBox, width, height, theme);

  const wireSvg = wires
    .map(
      (w) =>
        `<polyline points="${w.pts.map((pt) => `${pt.x},${pt.y}`).join(" ")}" fill="none" stroke="${theme.wire}" stroke-width="2" stroke-linejoin="round"/>${w.dots
          .map((d) => `<circle cx="${d.x}" cy="${d.y}" r="3" fill="${theme.wire}"/>`)
          .join("")}`,
    )
    .join("\n  ");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title || "Single-line diagram")}">
  <rect width="${width}" height="${height}" fill="${spec.theme === "light" ? "#ffffff" : "#0b1622"}"/>${titleSvg}
  <g>${wireSvg}</g>
  <g>${bodies}</g>
  <g>${labels}</g>
</svg>`;

  return { svg, ok: audit.ok, findings: audit.findings };
}
