import { describe, it, expect } from "vitest";
import { lintSpec } from "./lint";
import { renderSld, escapeXml, textWidth, labelBox, MIN_SLOT, END_INSET } from "./render";
import { CELL } from "./types";
import type { SldSpec } from "./types";

/** Classic ETAP training diagram: grid → breaker → transformer → bus → loads. */
const GOOD_SPEC: SldSpec = {
  title: "شبكة توزيع بسيطة 11kV",
  elements: [
    { id: "G1", type: "grid", x: 2, y: 0, label: "الشبكة 66kV" },
    { id: "CB1", type: "breaker", x: 2, y: 1 },
    { id: "T1", type: "transformer2", x: 2, y: 2, label: "66/11 kV" },
    { id: "B1", type: "busbar", x: 1, y: 4, len: 3, label: "Main 11kV" },
    { id: "F1", type: "fuse", x: 1, y: 5 },
    { id: "L1", type: "load", x: 1, y: 6, label: "Feeder 1" },
    { id: "M1", type: "motor", x: 3, y: 5, label: "Motor" },
  ],
  connections: [
    ["G1", "CB1"],
    ["CB1", "T1"],
    ["T1", "B1"],
    ["B1", "F1"],
    ["F1", "L1"],
    ["B1", "M1"],
  ],
  theme: "dark",
};

describe("sld lint", () => {
  it("accepts a well-formed ETAP distribution spec", () => {
    const r = lintSpec(GOOD_SPEC);
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([]);
  });

  it("errors on empty specs", () => {
    const r = lintSpec({ elements: [], connections: [] });
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.rule === "empty")).toBe(true);
  });

  it("errors on duplicate ids", () => {
    const r = lintSpec({
      elements: [
        { id: "B1", type: "busbar", x: 0, y: 0 },
        { id: "B1", type: "load", x: 2, y: 0 },
      ],
      connections: [],
    });
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.rule === "id-duplicate")).toBe(true);
  });

  it("errors on overlapping element bodies", () => {
    const r = lintSpec({
      elements: [
        { id: "A1", type: "motor", x: 0, y: 0 },
        { id: "M1", type: "motor", x: 0, y: 0 },
      ],
      connections: [],
    });
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.rule === "overlap")).toBe(true);
  });

  it("errors on connections to missing elements", () => {
    const r = lintSpec({
      elements: [{ id: "A1", type: "motor", x: 0, y: 0 }],
      connections: [["A1", "GHOST"]],
    });
    expect(r.ok).toBe(false);
    expect(r.findings.some((f) => f.rule === "connection-ref")).toBe(true);
  });

  it("warns on off-grid placement but stays ok", () => {
    const r = lintSpec({
      elements: [{ id: "A1", type: "motor", x: 0.5, y: 0 }],
      connections: [],
    });
    expect(r.ok).toBe(true);
    expect(r.findings.some((f) => f.rule === "off-grid")).toBe(true);
  });
});

describe("sld render", () => {
  it("produces deterministic SVG (byte-identical for the same spec)", () => {
    const a = renderSld(GOOD_SPEC).svg;
    const b = renderSld(GOOD_SPEC).svg;
    expect(a).toBe(b);
  });

  it("renders valid XML with escaped Arabic labels and no raw model markup", () => {
    const r = renderSld({
      ...GOOD_SPEC,
      elements: GOOD_SPEC.elements.map((e, i) => (i === 0 ? { ...e, label: '<script>alert("x")</script>' } : e)),
    });
    expect(r.ok).toBe(true);
    expect(r.svg).not.toContain("<script>");
    expect(r.svg).toContain("&lt;script&gt;");
  });

  it("escapeXml covers all five XML entities", () => {
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });

  it("keeps wire fan-out columns unique per outgoing busbar wire", () => {
    const r = renderSld(GOOD_SPEC);
    // two wires leave B1 (to F1 and to M1) — their first points must differ in X
    const starts = [...r.svg.matchAll(/<polyline points="(\d+),(\d+)/g)].map((m) => `${m[1]},${m[2]}`);
    const unique = new Set(starts);
    expect(unique.size).toBe(starts.length);
  });

  it("switches themes without changing geometry", () => {
    const dark = renderSld(GOOD_SPEC).svg;
    const light = renderSld({ ...GOOD_SPEC, theme: "light" }).svg;
    const geo = (s: string) => (s.match(/(?:cx|cy|x|y)="[\d.]+"/g) ?? []).length;
    expect(geo(dark)).toBe(geo(light));
    expect(dark).not.toBe(light);
  });

  it("best-effort renders warn-only specs with ok=true", () => {
    const r = renderSld({
      elements: [{ id: "A1", type: "motor", x: 1, y: 1, label: "M1" }],
      connections: [["A1", "A1"]],
    });
    expect(r.ok).toBe(true); // self-loop is a warn
    expect(r.svg).toContain("<svg");
  });
});

describe("sld label placement — no-overlap contract", () => {
  type Box = { x1: number; y1: number; x2: number; y2: number };
  const overlap = (a: Box, b: Box, pad = 0) =>
    !(a.x2 + pad < b.x1 || a.x1 - pad > b.x2 || a.y2 + pad < b.y1 || a.y1 - pad > b.y2);
  const segHits = (sx1: number, sy1: number, sx2: number, sy2: number, b: Box, pad = 3) => {
    const bx1 = b.x1 - pad, bx2 = b.x2 + pad, by1 = b.y1 - pad, by2 = b.y2 + pad;
    if (sx1 === sx2) return sx1 >= bx1 && sx1 <= bx2 && Math.max(sy1, sy2) >= by1 && Math.min(sy1, sy2) <= by2;
    if (sy1 === sy2) return sy1 >= by1 && sy1 <= by2 && Math.max(sx1, sx2) >= bx1 && Math.min(sx1, sx2) <= bx2;
    return overlap({ x1: Math.min(sx1, sx2), y1: Math.min(sy1, sy2), x2: Math.max(sx1, sx2), y2: Math.max(sy1, sy2) }, b, pad);
  };

  interface ParsedText { anchor: string; x: number; y: number; fs: number; rtl: boolean; content: string }
  function parseSvg(svg: string) {
    const texts: ParsedText[] = [...svg.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)].map((m) => {
      const get = (k: string) => m[1].match(new RegExp(`${k}="([^"]+)"`))?.[1] ?? "";
      return {
        anchor: get("text-anchor"),
        x: Number(get("x")),
        y: Number(get("y")),
        fs: Number(get("font-size")),
        rtl: m[1].includes('direction="rtl"'),
        content: m[2],
      };
    });
    const rects: Box[] = [...svg.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g)].map(
      (m) => ({ x1: +m[1], y1: +m[2], x2: +m[1] + +m[3], y2: +m[2] + +m[4] }),
    );
    const circles: Box[] = [...svg.matchAll(/<circle [^>]*cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"/g)].map(
      (m) => ({ x1: +m[1] - +m[3], y1: +m[2] - +m[3], x2: +m[1] + +m[3], y2: +m[2] + +m[3] }),
    );
    const polys = [...svg.matchAll(/<polyline points="([^"]+)"/g)].map((m) =>
      m[1].split(" ").map((pt) => pt.split(",").map(Number)),
    );
    const sheet = svg.match(/<svg [^>]*width="(\d+)" height="(\d+)"/);
    return { texts, rects, circles, polys, w: Number(sheet?.[1] ?? 0), h: Number(sheet?.[2] ?? 0) };
  }

  /**
   * Visual box of a painted string. Rendered texts carry an rtl base
   * direction with a FLIPPED anchor (see render.ts emitText): under rtl
   * base, "start" extends LEFT and "end" extends RIGHT. Re-flip here so
   * boxes are scored with the same LTR semantics the collision engine used.
   */
  const visualAnchor = (t: ParsedText): "start" | "middle" | "end" =>
    !t.rtl ? (t.anchor as "middle") : t.anchor === "start" ? "end" : t.anchor === "end" ? "start" : "middle";

  /** Shared audit: every label beside its element, touching NOTHING. */
  function assertNoOverlap(svg: string, expectedLabels: number) {
    const { texts, rects, circles, polys, w, h } = parseSvg(svg);
    const labels = texts.filter((t) => t.fs === 12);
    const title = texts.find((t) => t.fs === 14);
    expect(labels).toHaveLength(expectedLabels);
    expect(title).toBeTruthy();

    const titleBox = labelBox(title!.content, visualAnchor(title!), title!.x, title!.y, title!.fs);
    const labelBoxes = labels.map((t) => ({ box: labelBox(t.content, visualAnchor(t), t.x, t.y, t.fs), t }));

    for (const { box, t } of labelBoxes) {
      // inside the sheet
      expect(box.x1, `label "${t.content}" clips left`).toBeGreaterThanOrEqual(4);
      expect(box.x2, `label "${t.content}" clips right`).toBeLessThanOrEqual(w - 4);
      expect(box.y1, `label "${t.content}" clips top`).toBeGreaterThanOrEqual(4);
      expect(box.y2, `label "${t.content}" clips bottom`).toBeLessThanOrEqual(h - 4);
      // clear of the title
      expect(overlap(box, titleBox, 4), `label "${t.content}" hits the title`).toBe(false);
      // clear of every symbol body shape
      for (const r of rects) expect(overlap(box, r, 1), `label "${t.content}" sits on a rect`).toBe(false);
      for (const c of circles) expect(overlap(box, c, 1), `label "${t.content}" sits on a circle`).toBe(false);
      // clear of every wire run
      for (const poly of polys) {
        for (let i = 1; i < poly.length; i++) {
          expect(segHits(poly[i - 1][0], poly[i - 1][1], poly[i][0], poly[i][1], box, 3), `wire crosses label "${t.content}"`).toBe(false);
        }
      }
      // clear of the other labels
      for (const other of labelBoxes) {
        if (other.t === t) continue;
        expect(overlap(box, other.box, 2), `label "${t.content}" overlaps label "${other.t.content}"`).toBe(false);
      }
    }
    // title itself stays inside the sheet
    expect(titleBox.x1).toBeGreaterThanOrEqual(2);
    expect(titleBox.x2).toBeLessThanOrEqual(w - 2);
  }

  it("paints every label and title with an rtl base direction (mixed Arabic+unit labels never split)", () => {
    // The <img> embedding inherits no page direction: without an explicit
    // base, "محرك 500kW" renders as "500 محركkW" (number split from unit).
    // Symbol body glyphs (G/M, fs 15-16, middle-anchored) are excluded —
    // single Latin letters are direction-invariant.
    const svg = renderSld(GOOD_SPEC).svg;
    const texts = [...svg.matchAll(/<text ([^>]*)>/g)].map((m) => m[1]).filter((a) => /font-size="1[24]"/.test(a));
    expect(texts.length).toBeGreaterThan(0);
    for (const attrs of texts) {
      expect(attrs, `text lacks rtl base: ${attrs}`).toContain('direction="rtl"');
      expect(attrs, `text lacks bidi isolation: ${attrs}`).toContain('unicode-bidi="isolate"');
    }
  });

  it("keeps every label clear of wires, symbols, other labels and the title (dark)", () => {
    assertNoOverlap(renderSld(GOOD_SPEC).svg, 5); // G1, T1, B1, L1, M1
  });

  it("keeps every label clear of wires, symbols, other labels and the title (light)", () => {
    assertNoOverlap(renderSld({ ...GOOD_SPEC, theme: "light" }).svg, 5);
  });

  it("keeps labels clear on a dense two-source spec", () => {
    const svg = renderSld({
      title: "شبكتان متوازيتان",
      elements: [
        { id: "G1", type: "grid", x: 1, y: 0, label: "شبكة 66kV" },
        { id: "G2", type: "generator", x: 4, y: 0, label: "مولد 11kV" },
        { id: "CB1", type: "breaker", x: 1, y: 1 },
        { id: "CB2", type: "breaker", x: 4, y: 1 },
        { id: "T1", type: "transformer2", x: 1, y: 2, label: "66/11 kV" },
        { id: "B1", type: "busbar", x: 0, y: 4, len: 6, label: "Main 11kV" },
        { id: "L1", type: "load", x: 0, y: 5, label: "حمل 1" },
        { id: "M1", type: "motor", x: 2, y: 5, label: "موتور" },
        { id: "F1", type: "fuse", x: 4, y: 5, label: "فيوز" },
        { id: "L2", type: "load", x: 5, y: 5, label: "حمل 2" },
      ],
      connections: [
        ["G1", "CB1"], ["CB1", "T1"], ["T1", "B1"], ["G2", "CB2"], ["CB2", "B1"],
        ["B1", "L1"], ["B1", "M1"], ["B1", "F1"], ["B1", "L2"], ["F1", "L2"],
      ],
      theme: "dark",
    }).svg;
    assertNoOverlap(svg, 8); // G1, G2, T1, B1, L1, M1, F1, L2
  });

  it("keeps LONG mixed labels clear — edge-load spec (regression: label clamped onto its own symbol)", () => {
    // Live-audit regression: with the old fixed 96px side band and the
    // self-body collision exemption, "حمل إنارة 150kVA" on the leftmost load
    // was clamped ONTO its own symbol. The band now scales with the longest
    // label and self-bodies count as collisions.
    const svg = renderSld({
      title: "محطة 66/11kV - تغذية مزدوجة",
      elements: [
        { id: "G1", type: "grid", x: 1, y: 0, label: "الشبكة 66kV" },
        { id: "G2", type: "generator", x: 5, y: 0, label: "مولد 1500kW" },
        { id: "CB1", type: "breaker", x: 1, y: 1 },
        { id: "CB2", type: "breaker", x: 5, y: 1 },
        { id: "T1", type: "transformer2", x: 1, y: 2, label: "66/11 kV" },
        { id: "B1", type: "busbar", x: 0, y: 4, len: 6, label: "بار 11kV" },
        { id: "L1", type: "load", x: 0, y: 5, label: "حمل إنارة 150kVA" },
        { id: "M1", type: "motor", x: 2, y: 5, label: "محرك 500kW" },
        { id: "F1", type: "fuse", x: 4, y: 5, label: "فيوز 100A" },
        { id: "L2", type: "load", x: 5, y: 5, label: "Feeder 2" },
      ],
      connections: [
        ["G1", "CB1"], ["CB1", "T1"], ["T1", "B1"], ["G2", "CB2"], ["CB2", "B1"],
        ["B1", "L1"], ["B1", "M1"], ["B1", "F1"], ["B1", "L2"],
      ],
      theme: "dark",
    }).svg;
    assertNoOverlap(svg, 8); // G1, G2, T1, B1, L1, M1, F1, L2
  });

  it("grows the side band with the longest label (deterministic sheet sizing)", () => {
    const short = renderSld({
      elements: [{ id: "A1", type: "motor", x: 1, y: 1, label: "M" }],
      connections: [],
    }).svg;
    const long = renderSld({
      elements: [{ id: "A1", type: "motor", x: 1, y: 1, label: "حمل إنارة 150kVA" }],
      connections: [],
    }).svg;
    const w = (s: string) => Number(s.match(/<svg [^>]*width="(\d+)"/)![1]);
    expect(w(long)).toBeGreaterThan(w(short));
    // Band half grows from the 48px floor to ≈ maxLabelW - 10, so the sheet
    // grows by at least 2 × (maxLabelW - 60) once the label exceeds the floor.
    expect(w(long) - w(short)).toBeGreaterThanOrEqual(2 * (textWidth("حمل إنارة 150kVA", 12) - 60));
  });

  it("keeps textWidth estimates conservative (Arabic and Latin)", () => {
    expect(textWidth("Motor", 12)).toBeGreaterThanOrEqual(5 * 12 * 0.5);
    expect(textWidth("الشبكة 66kV", 12)).toBeGreaterThanOrEqual(11 * 12 * 0.5);
    expect(labelBox("Main 11kV", "end", 100, 200).x1).toBeLessThan(100);
    expect(labelBox("Main 11kV", "end", 100, 200).x2).toBeLessThanOrEqual(100);
  });
});

describe("sld wire routing — busbar attachment & anti-overlap contract", () => {
  interface Seg {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    wire: number; // polyline index
  }
  interface Bar {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }

  function parseGeometry(svg: string) {
    const polys = [...svg.matchAll(/<polyline points="([^"]+)"/g)].map((m) =>
      m[1]
        .split(" ")
        .map((pt) => pt.split(",").map(Number))
        .map(([x, y]) => ({ x, y })),
    );
    // busbars: the only 10px-tall rects
    const bars: Bar[] = [...svg.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="10"/g)].map(
      (m) => ({ x1: +m[1], y1: +m[2], x2: +m[1] + +m[3], y2: +m[2] + 10 }),
    );
    // junction dots paint in their own <g> AFTER the bodies group
    const dots = [...svg.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="3"/g)].map((m) => ({
      x: +m[1],
      y: +m[2],
    }));
    return { polys, bars, dots };
  }

  function segments(poly: Array<{ x: number; y: number }>, wire: number): Seg[] {
    const segs: Seg[] = [];
    for (let i = 1; i < poly.length; i++) {
      segs.push({ x1: poly[i - 1].x, y1: poly[i - 1].y, x2: poly[i].x, y2: poly[i].y, wire });
    }
    return segs;
  }

  /** The live defect: motor+lighting fed from one busbar (user-rejected render). */
  const LIVE_SPEC: SldSpec = {
    title: "منشأة صناعية",
    elements: [
      { id: "G1", type: "grid", x: 1, y: 0, label: "الشبكة 66kV" },
      { id: "GEN", type: "generator", x: 4, y: 0, label: "مولد احتياطي" },
      { id: "CB1", type: "breaker", x: 1, y: 1 },
      { id: "CB2", type: "breaker", x: 4, y: 1 },
      { id: "B1", type: "busbar", x: 1, y: 2, len: 3, label: "بار 11kV" },
      { id: "M1", type: "motor", x: 1, y: 3, label: "محرك 500kW" },
      { id: "L1", type: "load", x: 3, y: 3, label: "إنارة 150kVA" },
    ],
    connections: [
      ["G1", "CB1"],
      ["CB1", "B1"],
      ["GEN", "CB2"],
      ["CB2", "B1"],
      ["B1", "M1"],
      ["B1", "L1"],
    ],
    theme: "dark",
  };

  it("attaches every busbar wire ON the bar — endpoints on an edge, never past its ends", () => {
    for (const spec of [GOOD_SPEC, LIVE_SPEC]) {
      const { polys, bars } = parseGeometry(renderSld(spec).svg);
      expect(bars.length).toBeGreaterThanOrEqual(1);
      for (const bar of bars) {
        for (const poly of polys) {
          for (const pt of [poly[0], poly[poly.length - 1]]) {
            const onTop = Math.abs(pt.y - bar.y1) < 0.5;
            const onBottom = Math.abs(pt.y - bar.y2) < 0.5;
            if (!onTop && !onBottom) continue;
            expect(pt.x, `wire endpoint ${pt.x},${pt.y} hangs LEFT of the bar`).toBeGreaterThanOrEqual(bar.x1 + 4);
            expect(pt.x, `wire endpoint ${pt.x},${pt.y} hangs off the bar's right end`).toBeLessThanOrEqual(bar.x2 - 4);
          }
        }
      }
    }
  });

  it("spaces busbar connection dots >= MIN_SLOT apart — no bunched cables", () => {
    const { dots, bars } = parseGeometry(renderSld(LIVE_SPEC).svg);
    expect(dots.length).toBeGreaterThanOrEqual(4); // 2 in + 2 out on B1
    for (const bar of bars) {
      for (const edgeY of [bar.y1, bar.y2]) {
        const xs = dots.filter((d) => Math.abs(d.y - edgeY) < 0.5).map((d) => d.x);
        for (let i = 1; i < xs.length; i++) {
          expect(xs[i] - xs[i - 1], `dots ${xs[i - 1]},${xs[i]} bunched on one bar edge`).toBeGreaterThanOrEqual(MIN_SLOT - 0.5);
        }
      }
    }
  });

  it("dots sit strictly inside the bar span (never on the rounded cap)", () => {
    const { dots, bars } = parseGeometry(renderSld(LIVE_SPEC).svg);
    for (const bar of bars) {
      for (const d of dots) {
        if (Math.abs(d.y - bar.y1) >= 0.5 && Math.abs(d.y - bar.y2) >= 0.5) continue;
        expect(d.x).toBeGreaterThanOrEqual(bar.x1 + END_INSET - 0.5);
        expect(d.x).toBeLessThanOrEqual(bar.x2 - END_INSET + 0.5);
      }
    }
  });

  it("no two horizontal runs share or touch the same lane (the collinear-overlap defect)", () => {
    for (const spec of [GOOD_SPEC, LIVE_SPEC]) {
      const { polys } = parseGeometry(renderSld(spec).svg);
      const hs: Seg[] = polys.flatMap((p, i) => segments(p, i).filter((s) => s.y1 === s.y2));
      for (let i = 0; i < hs.length; i++) {
        for (let j = i + 1; j < hs.length; j++) {
          const a = hs[i];
          const b = hs[j];
          if (a.wire === b.wire) continue;
          if (Math.abs(a.y1 - b.y1) >= 7) continue; // different lanes — fine
          const xOverlap = Math.max(Math.min(a.x1, a.x2), Math.min(b.x1, b.x2)) - 2 <= Math.min(Math.max(a.x1, a.x2), Math.max(b.x1, b.x2)) + 2;
          expect(xOverlap, `horizontal runs of wires ${a.wire} and ${b.wire} overlap at y≈${a.y1}`).toBe(false);
        }
      }
    }
  });

  it("auto-grows a short busbar so its feeders fit with proper spacing", () => {
    const SHORT_BAR: SldSpec = {
      elements: [
        { id: "G1", type: "grid", x: 2, y: 0 },
        { id: "CB1", type: "breaker", x: 2, y: 1 },
        { id: "B1", type: "busbar", x: 2, y: 2, len: 1 },
        { id: "M1", type: "motor", x: 2, y: 3, label: "محرك" },
        { id: "L1", type: "load", x: 3, y: 3, label: "إنارة" },
      ],
      connections: [
        ["G1", "CB1"],
        ["CB1", "B1"],
        ["B1", "M1"],
        ["B1", "L1"],
      ],
      theme: "dark",
    };
    const { bars, dots } = parseGeometry(renderSld(SHORT_BAR).svg);
    expect(bars[0].x2 - bars[0].x1, "len-1 bar with 2 feeders must grow beyond one cell").toBeGreaterThan(CELL);
    const bottomDots = dots.filter((d) => Math.abs(d.y - bars[0].y2) < 0.5).map((d) => d.x);
    expect(bottomDots.length).toBe(2);
    expect(bottomDots[1] - bottomDots[0]).toBeGreaterThanOrEqual(MIN_SLOT - 0.5);
  });

  it("keeps an aligned feed a clean straight drop (no Z-jog)", () => {
    const { polys } = parseGeometry(renderSld(GOOD_SPEC).svg);
    // G1→CB1: source directly above target → 2-point polyline
    const straight = polys.filter((p) => p.length === 2);
    expect(straight.length).toBeGreaterThanOrEqual(1);
    for (const p of straight) {
      expect(p[0].x).toBe(p[1].x);
    }
  });

  it("marks every busbar connection with a visible junction dot", () => {
    // B1 in LIVE_SPEC: 2 incoming (top edge) + 2 outgoing (bottom edge) = 4 dots
    const { dots, bars } = parseGeometry(renderSld(LIVE_SPEC).svg);
    const bar = bars[0];
    const onBar = dots.filter((d) => Math.abs(d.y - bar.y1) < 0.5 || Math.abs(d.y - bar.y2) < 0.5);
    expect(onBar.length).toBe(4);
  });

  it("renders the crowded 4-feeder spec with four separated slots", () => {
    const CROWDED: SldSpec = {
      elements: [
        { id: "G1", type: "grid", x: 3, y: 0 },
        { id: "B1", type: "busbar", x: 0, y: 1, len: 2 },
        { id: "M1", type: "motor", x: 0, y: 2, label: "م1" },
        { id: "M2", type: "motor", x: 1, y: 2, label: "م2" },
        { id: "M3", type: "motor", x: 2, y: 2, label: "م3" },
        { id: "M4", type: "motor", x: 3, y: 2, label: "م4" },
      ],
      connections: [
        ["G1", "B1"],
        ["B1", "M1"],
        ["B1", "M2"],
        ["B1", "M3"],
        ["B1", "M4"],
      ],
      theme: "dark",
    };
    const { dots, bars } = parseGeometry(renderSld(CROWDED).svg);
    const bar = bars[0];
    const bottom = dots.filter((d) => Math.abs(d.y - bar.y2) < 0.5).map((d) => d.x);
    expect(bottom.length).toBe(4);
    for (let i = 1; i < bottom.length; i++) {
      expect(bottom[i] - bottom[i - 1]).toBeGreaterThanOrEqual(MIN_SLOT - 0.5);
    }
  });
});
