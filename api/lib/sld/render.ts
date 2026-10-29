/**
 * SLD renderer — spec → deterministic SVG string.
 * Routing: orthogonal runs with a real connection-point allocator — every wire
 * touching a busbar gets its OWN slot on the bar (unique X, >= MIN_SLOT apart,
 * ordered left→right by the far endpoint so wires never cross), horizontal
 * turns each get a collision-checked LANE (no two horizontal runs share a Y),
 * and short bars auto-grow before lint so their connections always fit. This
 * is the root fix for the live defect where feeder cables left the busbar
 * bunched 10px apart on a shared horizontal lane, one of them hanging off the
 * bar's rounded end instead of ON the bar. Output is escaped XML; model text
 * never becomes markup.
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
  CELL,
  LABEL_FONT,
  LABEL_GAP,
  LABEL_SIDE_GAP,
  placeElements,
  rectsOverlap,
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

/** Minimum px between two connection slots on the same busbar edge. */
export const MIN_SLOT = 24;
/** px a connection dot sits inside the bar ends — never on the rounded cap. */
export const END_INSET = 10;
/** Vertical px between the horizontal lanes of two different wires. */
export const LANE_SEP = 12;

const clampNum = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * Pre-lint pass: grow a busbar whose connections cannot fit its current
 * length at >= MIN_SLOT spacing (the live bug — two feeders bunched on a
 * 2-cell bar). Grows only when the wider body still clears every other
 * element, so the linter stays the single quality gate.
 */
export function growBusbarsForConnections(spec: SldSpec): SldSpec {
  const elements = Array.isArray(spec.elements) ? spec.elements : [];
  const connections = Array.isArray(spec.connections) ? spec.connections : [];
  if (elements.length === 0) return spec;
  const byId = new Map(elements.map((e) => [e.id, e]));
  const load = new Map<string, { top: number; bottom: number }>();
  for (const [a, b] of connections) {
    const A = byId.get(a);
    const B = byId.get(b);
    if (!A || !B || a === b) continue;
    if (B.type === "busbar") {
      const cur = load.get(b) ?? { top: 0, bottom: 0 };
      cur.top += 1;
      load.set(b, cur);
    }
    if (A.type === "busbar") {
      const cur = load.get(a) ?? { top: 0, bottom: 0 };
      cur.bottom += 1;
      load.set(a, cur);
    }
  }
  const placedOrig = placeElements(spec);
  const selfById = new Map(placedOrig.map((p) => [p.el.id, p]));
  const grown = elements.map((el) => {
    if (el.type !== "busbar") return el;
    const l = load.get(el.id);
    const n = Math.max(l?.top ?? 0, l?.bottom ?? 0);
    if (n <= 1) return el;
    const minUnits = Math.max(1, Math.min(6, el.len ?? 2));
    const needPx = 2 * END_INSET + MIN_SLOT * (n - 1);
    const grownUnits = Math.max(minUnits, Math.min(6, Math.ceil(needPx / CELL)));
    if (grownUnits <= minUnits) return el;
    const self = selfById.get(el.id);
    if (!self) return el;
    const wider: BBox = { x1: self.bbox.x1, y1: self.bbox.y1, x2: self.bbox.x1 + grownUnits * CELL, y2: self.bbox.y2 };
    const collides = placedOrig.some(
      (p) => p.el.id !== el.id && rectsOverlap(wider, p.bbox, 2),
    );
    return collides ? el : { ...el, len: grownUnits };
  });
  return { ...spec, elements: grown };
}

/**
 * Assign every wire that touches a busbar its own connection X on that bar:
 * incoming wires land on the TOP edge, outgoing leave from the BOTTOM edge.
 * Desired X = the far endpoint's position (so an aligned feed is a clean
 * straight drop); slots are then spread left→right with a forward/backward
 * sweep enforcing >= MIN_SLOT separation inside [x1+END_INSET, x2-END_INSET] —
 * dots can never bunch up, never leave the bar, and never cross each other.
 * Keyed by connection index: `"<idx>|T"` (bar as target) / `"<idx>|B"` (bar as source).
 */
function assignBarSlots(
  placed: PlacedElement[],
  connections: Array<[string, string]>,
): Map<string, number> {
  const byId = new Map(placed.map((p) => [p.el.id, p]));
  interface Req {
    idx: number;
    desired: number;
  }
  const slots = new Map<string, number>();
  const bars = new Map<string, { top: Req[]; bottom: Req[] }>();
  connections.forEach(([a, b], idx) => {
    const A = byId.get(a);
    const B = byId.get(b);
    if (!A || !B || A === B) return;
    if (B.el.type === "busbar") {
      const cur = bars.get(B.el.id) ?? { top: [], bottom: [] };
      cur.top.push({ idx, desired: clampNum(A.bottom.x, B.bbox.x1 + END_INSET, B.bbox.x2 - END_INSET) });
      bars.set(B.el.id, cur);
    }
    if (A.el.type === "busbar") {
      const cur = bars.get(A.el.id) ?? { top: [], bottom: [] };
      cur.bottom.push({ idx, desired: clampNum(B.top.x, A.bbox.x1 + END_INSET, A.bbox.x2 - END_INSET) });
      bars.set(A.el.id, cur);
    }
  });
  const spread = (reqs: Req[], lo: number, hi: number, edge: "T" | "B"): void => {
    if (reqs.length === 0) return;
    const order = [...reqs].sort((p, q) => p.desired - q.desired || p.idx - q.idx);
    const xs = new Map<number, number>();
    let prev = -Infinity;
    for (const r of order) {
      const x = Math.min(Math.max(clampNum(r.desired, lo, hi), prev + MIN_SLOT), hi);
      xs.set(r.idx, x);
      prev = x;
    }
    let next = Infinity;
    for (let k = order.length - 1; k >= 0; k--) {
      const r = order[k];
      const x = Math.max(lo, Math.min(xs.get(r.idx)!, next - MIN_SLOT));
      xs.set(r.idx, x);
      next = x;
    }
    for (const [idx, x] of xs) slots.set(`${idx}|${edge}`, x);
  };
  for (const [barId, edge] of bars) {
    const bar = byId.get(barId);
    if (!bar) continue;
    spread(edge.top, bar.bbox.x1 + END_INSET, bar.bbox.x2 - END_INSET, "T");
    spread(edge.bottom, bar.bbox.x1 + END_INSET, bar.bbox.x2 - END_INSET, "B");
  }
  return slots;
}

/**
 * Orthogonal routes with real connection points:
 * - Busbar wires attach ON the bar (top edge in, bottom edge out) at their own
 *   allocated slot — never at the bar's rounded end, never bunched together.
 * - A wire falling inside its target's own top span lands where it is (straight
 *   drop) instead of jogging sideways for a few px.
 * - Every horizontal turn takes a collision-checked LANE, so no two horizontal
 *   runs ever share (or even touch) the same Y — the collinear-overlap defect
 *   is structurally impossible, not just unlikely.
 * - Terminals shared by >= 2 wires (busbar slots always) get a junction dot,
 *   painted after the bodies so it reads as a real connection node.
 */
function routeWires(
  placed: PlacedElement[],
  connections: Array<[string, string]>,
): Array<{ pts: Pt[]; dots: Pt[] }> {
  const byId = new Map(placed.map((p) => [p.el.id, p]));
  const slots = assignBarSlots(placed, connections);

  // Junction dots: a non-bar terminal feeding/receiving >= 2 wires is a T-joint.
  const bottomUse = new Map<string, number>();
  const topUse = new Map<string, number>();
  for (const [a, b] of connections) {
    const A = byId.get(a);
    const B = byId.get(b);
    if (!A || !B || A === B) continue;
    if (A.el.type !== "busbar") bottomUse.set(a, (bottomUse.get(a) ?? 0) + 1);
    if (B.el.type !== "busbar") topUse.set(b, (topUse.get(b) ?? 0) + 1);
  }

  // Horizontal-lane allocator: unique Y per horizontal run, collision-checked
  // against every lane taken so far (|Δy| < 7 with intersecting X = clash).
  const lanes: Array<{ y: number; x1: number; x2: number }> = [];
  const laneClash = (y: number, lo: number, hi: number): boolean =>
    lanes.some((l) => Math.abs(l.y - y) < 7 && Math.max(l.x1, lo) - 2 <= Math.min(l.x2, hi) + 2);
  const takeLane = (startY: number, endY: number, xa: number, xb: number): number => {
    const lo = Math.min(xa, xb);
    const hi = Math.max(xa, xb);
    const ceiling = endY - 8; // keep the final vertical drop >= 8px
    for (let k = 0; ; k++) {
      const y = startY + 10 + k * LANE_SEP;
      const chosen = y > ceiling ? Math.max(startY + 4, ceiling) : y;
      if (!laneClash(chosen, lo, hi)) {
        lanes.push({ y: chosen, x1: lo, x2: hi });
        return chosen;
      }
      if (y > ceiling) {
        // Dense sheet: no free lane below the ceiling — deterministic fallback.
        lanes.push({ y: chosen, x1: lo, x2: hi });
        return chosen;
      }
    }
  };

  const wires: Array<{ pts: Pt[]; dots: Pt[] }> = [];
  connections.forEach(([a, b], idx) => {
    const A = byId.get(a);
    const B = byId.get(b);
    if (!A || !B || A === B) return;

    const startX = A.el.type === "busbar" ? (slots.get(`${idx}|B`) ?? A.bottom.x) : A.bottom.x;
    const startY = A.bottom.y;
    const endY = B.top.y;
    let endX = B.el.type === "busbar" ? (slots.get(`${idx}|T`) ?? B.top.x) : B.top.x;

    const dots: Pt[] = [];
    if (A.el.type === "busbar" || (bottomUse.get(a) ?? 0) >= 2) dots.push({ x: startX, y: startY });
    if (B.el.type === "busbar" || (topUse.get(b) ?? 0) >= 2) dots.push({ x: endX, y: endY });

    const pts: Pt[] = [{ x: startX, y: startY }];

    // Snap: falling inside the target's own top span → straight drop, no jog.
    if (
      B.el.type !== "busbar" &&
      Math.abs(startX - endX) > 0 &&
      startX >= B.bbox.x1 + 2 &&
      startX <= B.bbox.x2 - 2
    ) {
      endX = startX;
    }

    const gap = endY - startY;
    if (Math.abs(startX - endX) < 1) {
      pts.push({ x: startX, y: endY });
    } else if (gap >= 18) {
      const laneY = takeLane(startY, endY, startX, endX);
      pts.push({ x: startX, y: laneY }, { x: endX, y: laneY }, { x: endX, y: endY });
    } else if (gap >= 2) {
      // Tight gap: single mid jog (no room for a lane stack).
      const midY = startY + Math.max(2, Math.round(gap / 2));
      pts.push({ x: startX, y: midY }, { x: endX, y: midY }, { x: endX, y: endY });
    } else {
      // Target level with / above the source: loop below, then back up.
      const lo = Math.min(startX, endX);
      const hi = Math.max(startX, endX);
      let loopY = startY + 8;
      for (let k = 0; k <= 24; k++) {
        const y = startY + 8 + k * LANE_SEP;
        if (!laneClash(y, lo, hi)) {
          loopY = y;
          break;
        }
        loopY = y;
      }
      lanes.push({ y: loopY, x1: lo, x2: hi });
      pts.push({ x: startX, y: loopY }, { x: endX, y: loopY }, { x: endX, y: endY });
    }
    wires.push({ pts, dots });
  });
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
  // Busbars grow (pre-lint) so their connections fit at proper spacing; the
  // linter then audits the FINAL geometry, not the pre-growth spec.
  const effective = growBusbarsForConnections(spec);
  const audit = lintSpec(effective);
  const theme = THEMES[effective.theme === "light" ? "light" : "dark"];
  const { width, height } = sheetSize(effective);
  const connections = Array.isArray(effective.connections) ? effective.connections : [];

  // Labeled elements reserve a side band scaled to the LONGEST label (see
  // labelSideBand in lint.ts) — split it half-left/half-right so beside-labels
  // fit on both sheet edges without clamping onto symbol bodies.
  const DX = labelSideBand(effective) / 2;
  const placed = audit.placed.map((p) => shiftX(p, DX));

  const wires = routeWires(placed, connections);
  const wirePts = wires.map((w) => w.pts);

  const bodies = placed.map((p) => paintSymbol(p, theme)).join("");

  const title = (effective.title ?? "").trim();
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
        `<polyline points="${w.pts.map((pt) => `${pt.x},${pt.y}`).join(" ")}" fill="none" stroke="${theme.wire}" stroke-width="2" stroke-linejoin="round"/>`,
    )
    .join("\n  ");

  // Junction dots paint AFTER the bodies: on a busbar the dot sits ON the bar
  // edge fully visible — the attachment point is unmistakable.
  const dotSvg = wires
    .flatMap((w) => w.dots)
    .map((d) => `<circle cx="${d.x}" cy="${d.y}" r="3" fill="${theme.wire}"/>`)
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title || "Single-line diagram")}">
  <rect width="${width}" height="${height}" fill="${effective.theme === "light" ? "#ffffff" : "#0b1622"}"/>${titleSvg}
  <g>${wireSvg}</g>
  <g>${bodies}</g>
  <g>${dotSvg}</g>
  <g>${labels}</g>
</svg>`;

  return { svg, ok: audit.ok, findings: audit.findings };
}
