/**
 * SLD visual QA — renders the EXACT live failure scenario (motor + lighting
 * fed from one busbar) plus the contract specs to SVG files under download/,
 * for before/after eyeballing and screenshot capture.
 * Run: node scripts/render_sld_qa.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { renderSld } from "../api/lib/sld/render.ts";

const LIVE_SPEC = {
  title: "منشأة صناعية - بار موزعة بمحرك وإنارة",
  elements: [
    { id: "G1", type: "grid", x: 1, y: 0, label: "الشبكة العامة 66kV" },
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

// The pathological variant: SHORT bar (len 1) with two adjacent feeders —
// pre-fix this bunched both cables 10px apart with one off the bar's end.
const SHORT_BAR_SPEC = {
  title: "بار قصير مع فيدرين متجاورين",
  elements: [
    { id: "G1", type: "grid", x: 2, y: 0, label: "الشبكة 66kV" },
    { id: "CB1", type: "breaker", x: 2, y: 1 },
    { id: "B1", type: "busbar", x: 2, y: 2, len: 1, label: "بار 11kV" },
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

const CROWDED_SPEC = {
  title: "بار بكابلة كتيرة - اختبار الزحام",
  elements: [
    { id: "G1", type: "grid", x: 3, y: 0, label: "الشبكة" },
    { id: "B1", type: "busbar", x: 0, y: 1, len: 2, label: "بار رئيسي" },
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

const CLASSIC_SPEC = {
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

mkdirSync("../download/sld-qa", { recursive: true });
for (const [name, spec] of [
  ["live-motor-lighting", LIVE_SPEC],
  ["short-bar-grow", SHORT_BAR_SPEC],
  ["crowded-4-feeders", CROWDED_SPEC],
  ["classic-etap-chain", CLASSIC_SPEC],
]) {
  const r = renderSld(spec);
  const file = `../download/sld-qa/${name}.svg`;
  writeFileSync(file, r.svg);
  console.log(`${name}: ok=${r.ok} findings=${JSON.stringify(r.findings)} bytes=${r.svg.length} -> ${file}`);
}
