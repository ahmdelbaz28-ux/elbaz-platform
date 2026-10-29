/**
 * REPAIR PASS TESTS — the root fix for the 422-broken-img leak.
 * A spec the model emits must never leave the chat with a broken diagram
 * image: salvageable lint errors (ids, dead wires, overlaps) are repaired
 * deterministically before render; the router only 422s what repair cannot
 * save. These tests lock: coverage of every repairable error class,
 * determinism, and the render integration (repair → lint ok).
 */
import { describe, it, expect } from "vitest";

import { repairSpec } from "./repair";
import { lintSpec } from "./lint";
import { renderSld } from "./render";
import type { SldSpec } from "./types";

const CLEAN: SldSpec = {
  title: "clean",
  elements: [
    { id: "G1", type: "grid", x: 2, y: 0 },
    { id: "T1", type: "transformer2", x: 2, y: 2 },
    { id: "B1", type: "busbar", x: 1, y: 4, len: 3 },
  ],
  connections: [["G1", "T1"], ["T1", "B1"]],
  theme: "dark",
};

describe("repairSpec — id salvage", () => {
  it("HAPPY: a clean spec passes through untouched with no actions", () => {
    const { spec, actions } = repairSpec(CLEAN);
    expect(actions).toEqual([]);
    expect(spec.elements.map((e) => e.id)).toEqual(["G1", "T1", "B1"]);
    expect(spec.connections).toEqual([["G1", "T1"], ["T1", "B1"]]);
  });

  it("repairs a bad id and remaps its wires", () => {
    const spec: SldSpec = {
      elements: [
        { id: "G 1", type: "grid", x: 2, y: 0 },
        { id: "L1", type: "load", x: 2, y: 4 },
      ],
      connections: [["G 1", "L1"]],
      theme: "dark",
    };
    const { spec: fixed, actions } = repairSpec(spec);
    expect(fixed.elements[0].id).toBe("G1");
    expect(fixed.connections).toEqual([["G1", "L1"]]);
    expect(actions.some((a) => a.includes("rename"))).toBe(true);
    expect(lintSpec(fixed).ok).toBe(true);
  });

  it("deduplicates ids with deterministic suffixes and keeps both elements", () => {
    const spec: SldSpec = {
      elements: [
        { id: "B1", type: "busbar", x: 0, y: 0, len: 2 },
        { id: "B1", type: "busbar", x: 0, y: 2, len: 2 },
        { id: "L1", type: "load", x: 0, y: 4 },
      ],
      connections: [["B1", "L1"]],
      theme: "dark",
    };
    const { spec: fixed } = repairSpec(spec);
    const ids = fixed.elements.map((e) => e.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe("B1");
    expect(ids[1]).toMatch(/^B1_\d$/);
    // the wire now lands on the FIRST (name-keeping) B1
    expect(fixed.connections).toContainEqual(["B1", "L1"]);
    expect(lintSpec(fixed).ok).toBe(true);
  });

  it("drops an unusable id and its dead wires", () => {
    const spec: SldSpec = {
      elements: [
        { id: "123", type: "grid", x: 2, y: 0 },
        { id: "L1", type: "load", x: 2, y: 4 },
      ],
      connections: [["123", "L1"]],
      theme: "dark",
    };
    const { spec: fixed, actions } = repairSpec(spec);
    // "123" sanitizes to "X123" — kept, not dropped (salvage-first policy)
    expect(fixed.elements.map((e) => e.id)).toContain("X123");
    expect(fixed.connections).toContainEqual(["X123", "L1"]);
    expect(actions.join(" ")).toMatch(/rename/);
  });
});

describe("repairSpec — overlap relocation", () => {
  it("EDGE: overlapping elements are relocated down and the lint turns green", () => {
    // T2 sits exactly on T1's cell (the model's classic overlap mistake).
    const spec: SldSpec = {
      elements: [
        { id: "G1", type: "grid", x: 2, y: 0 },
        { id: "T1", type: "transformer2", x: 2, y: 2 },
        { id: "T2", type: "transformer2", x: 2, y: 2 }, // same cell!
        { id: "B1", type: "busbar", x: 1, y: 4, len: 3 },
      ],
      connections: [["G1", "T1"], ["T1", "B1"]],
      theme: "dark",
    };
    expect(lintSpec(spec).ok).toBe(false); // the 422 case, pre-fix
    const { spec: fixed, actions } = repairSpec(spec);
    expect(actions.join(" ")).toMatch(/relocate "T2"/);
    const audit = lintSpec(fixed);
    expect(audit.ok).toBe(true);
    expect(renderSld(fixed).ok).toBe(true);
  });

  it("FAILURE MODE: dense overlap stack still resolves (down → right → diag search)", () => {
    const spec: SldSpec = {
      elements: [
        { id: "G1", type: "grid", x: 2, y: 0 },
        { id: "M1", type: "motor", x: 2, y: 1 },
        { id: "M2", type: "motor", x: 2, y: 1 },
        { id: "M3", type: "motor", x: 2, y: 1 },
        { id: "M4", type: "motor", x: 2, y: 1 },
      ],
      connections: [["G1", "M1"]],
      theme: "dark",
    };
    const { spec: fixed } = repairSpec(spec);
    const audit = lintSpec(fixed);
    expect(audit.ok).toBe(true);
    const cells = new Set(fixed.elements.map((e) => `${e.x},${e.y}`));
    expect(cells.size).toBe(fixed.elements.length);
  });

  it("is deterministic — same broken spec twice, byte-identical SVG", () => {
    const broken: SldSpec = {
      elements: [
        { id: "G 1", type: "grid", x: 2, y: 0 },
        { id: "T1", type: "transformer2", x: 2, y: 2 },
        { id: "T1", type: "transformer2", x: 2, y: 2 },
        { id: "B1", type: "busbar", x: 1, y: 4, len: 3 },
      ],
      connections: [["G 1", "T1"], ["T1", "B1"]],
      theme: "dark",
    };
    const a = repairSpec(broken);
    const b = repairSpec(broken);
    expect(a.spec).toEqual(b.spec);
    expect(a.actions).toEqual(b.actions);
    expect(renderSld(a.spec).svg).toBe(renderSld(b.spec).svg);
  });

  it("does not move anything when the layout is already clean", () => {
    const { spec, actions } = repairSpec(CLEAN);
    expect(spec.elements.map((e) => `${e.id}@${e.x},${e.y}`))
      .toEqual(["G1@2,0", "T1@2,2", "B1@1,4"]);
    expect(actions.filter((a) => a.includes("relocate"))).toEqual([]);
  });
});
