import { describe, it, expect } from "vitest";
import { lintSpec } from "./lint";
import { renderSld, escapeXml } from "./render";
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
