/**
 * SLD linter — the "generate → audit → fix" discipline from the KiCad skill,
 * adapted to power diagrams. Every rule returns findings; render() renders
 * best-effort anyway, and callers (chat/lessons) drop the diagram when
 * ERROR-level findings exist so a bad model spec can never break a reply.
 */
import { CELL, MARGIN, placeElements, rectsOverlap, type PlacedElement, type SldSpec } from "./types";

export type FindingLevel = "error" | "warn";
export interface Finding {
  level: FindingLevel;
  rule: string;
  detail: string;
}

export interface LintResult {
  ok: boolean; // no error-level findings
  findings: Finding[];
  placed: PlacedElement[];
  width: number;
  height: number;
}

/** Compute the sheet size from the spec (deterministic). */
export function sheetSize(spec: SldSpec): { width: number; height: number } {
  const placed = placeElements(spec);
  const maxX = Math.max(...placed.map((p) => p.bbox.x2), 0);
  const maxY = Math.max(...placed.map((p) => p.bbox.y2), 0);
  const maxLabelRows = Math.max(
    ...placed.map((p) => (p.el.label ? 1 : 0)),
    0,
  );
  // Labels sit BESIDE their element (renderer contract) — reserve a side band
  // so they never clip at the sheet edges (render splits it half-left/right).
  const sideBand = maxLabelRows > 0 ? 96 : 0;
  return {
    width: Math.ceil(maxX + MARGIN + 40 + sideBand),
    height: Math.ceil(maxY + MARGIN + 30 + maxLabelRows * 16),
  };
}

export function lintSpec(spec: SldSpec): LintResult {
  const findings: Finding[] = [];
  const elements = Array.isArray(spec.elements) ? spec.elements : [];
  const placed = placeElements({ ...spec, elements });

  // 1) structure
  if (elements.length === 0) {
    findings.push({ level: "error", rule: "empty", detail: "spec has no elements" });
  }
  const ids = new Set<string>();
  for (const el of elements) {
    if (!el.id || !/^[A-Za-z]\w{0,11}$/.test(el.id)) {
      findings.push({ level: "error", rule: "id-format", detail: `bad id "${el.id}" (need [A-Za-z]\\w{0,11})` });
    }
    if (ids.has(el.id)) findings.push({ level: "error", rule: "id-duplicate", detail: `duplicate id "${el.id}"` });
    ids.add(el.id);
  }

  // 2) bounds + grid sanity
  const { width, height } = sheetSize(spec);
  for (const p of placed) {
    const { el, bbox } = p;
    if (!Number.isFinite(el.x) || !Number.isFinite(el.y) || el.x < 0 || el.y < 0) {
      findings.push({ level: "error", rule: "grid", detail: `${el.id}: negative/non-numeric grid coords` });
      continue;
    }
    if (bbox.x1 < 8 || bbox.y1 < 8 || bbox.x2 > width - 4 || bbox.y2 > height - 4) {
      findings.push({ level: "error", rule: "bounds", detail: `${el.id} outside the sheet bounds` });
    }
  }

  // 3) overlap — bodies must not intersect (pad 2px, mirroring the 5mm rule)
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      if (rectsOverlap(placed[i].bbox, placed[j].bbox, 2)) {
        findings.push({
          level: "error",
          rule: "overlap",
          detail: `${placed[i].el.id} overlaps ${placed[j].el.id} — separate by at least one grid cell`,
        });
      }
    }
  }

  // 4) connections reference real ids; dedupe
  const seen = new Set<string>();
  for (const [a, b] of Array.isArray(spec.connections) ? spec.connections : []) {
    if (!ids.has(a) || !ids.has(b)) {
      findings.push({ level: "error", rule: "connection-ref", detail: `connection ${a}→${b} references a missing element` });
      continue;
    }
    if (a === b) findings.push({ level: "warn", rule: "self-loop", detail: `${a}→${a}` });
    const key = [a, b].sort().join("|");
    if (seen.has(key)) findings.push({ level: "warn", rule: "duplicate-wire", detail: key });
    seen.add(key);
  }

  // 5) advisory: grid alignment (warn only — SLDs tolerate half-off layouts)
  for (const p of placed) {
    if (p.el.type !== "busbar" && (p.el.x % 1 !== 0 || p.el.y % 1 !== 0)) {
      findings.push({ level: "warn", rule: "off-grid", detail: `${p.el.id} is off the ${CELL}px grid` });
    }
  }

  return {
    ok: !findings.some((f) => f.level === "error"),
    findings,
    placed,
    width,
    height,
  };
}
