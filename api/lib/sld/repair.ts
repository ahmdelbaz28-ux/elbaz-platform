/**
 * SLD spec repair pass — the missing half of the "generate → audit → fix"
 * discipline the linter was ported from (KiCad skill).
 *
 * WHY THIS EXISTS (root-cause fix, 2026-10-29): the diagrams router answered
 * 422 for a spec with ERROR-level lint findings, and the chat <img> then
 * showed a broken image — the exact "chat never breaks" contract the router
 * documents, violated at the last step. The model cannot be trusted to emit
 * collision-free specs (it was never able to), so the SERVER now repairs the
 * salvageable error classes deterministically before rendering:
 *   1. bad ids      → sanitized ([A-Za-z]\w{0,11}), unusable ones dropped
 *   2. duplicate ids→ first keeps the name, later ones get deterministic suffixes
 *   3. dead wires   → remapped through the id map, dropped when unsalvageable
 *   4. overlaps     → first-fit relocation (down, then right, then diag) on
 *                     the integer grid — preserves the top→down flow
 * Bounds/grid/connection-ref errors cannot survive coerceSpec (clamped
 * server-side), so overlap + ids are the whole repair surface.
 *
 * renderSld()/lintSpec() stay untouched: repair is a router-level pre-pass,
 * deterministic (same spec → same repaired spec → byte-identical SVG, so the
 * immutable edge cache stays correct).
 */
import {
  CELL,
  MARGIN,
  elementExtent,
  rectsOverlap,
  type BBox,
  type SldElement,
  type SldSpec,
} from "./types";

const ID_RE = /^[A-Za-z]\w{0,11}$/;
const MAX_SUFFIX_TRIES = 5;
const DOWN_STEPS = 24;
const RIGHT_STEPS = 8;
const DIAG_STEPS = 12;

export interface RepairResult {
  /** Repaired spec — render THIS. */
  spec: SldSpec;
  /** Human-readable audit trail (ids/rules only, ASCII-safe for headers). */
  actions: string[];
}

function bboxAt(el: SldElement, x: number, y: number): BBox {
  const { w, h } = elementExtent(el);
  const cx = MARGIN + x * CELL + w / 2;
  const cy = MARGIN + y * CELL + h / 2;
  return { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 };
}

function collides(rect: BBox, placed: BBox[]): boolean {
  return placed.some((p) => rectsOverlap(rect, p, 2));
}

/** Sanitize one id; empty string when unsalvageable. */
function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "");
  if (ID_RE.test(cleaned)) return cleaned;
  const prefixed = `X${cleaned}`.slice(0, 12);
  return ID_RE.test(prefixed) ? prefixed : "";
}

export function repairSpec(spec: SldSpec): RepairResult {
  const actions: string[] = [];

  // ── 1) ids: sanitize + dedupe (first occurrence keeps the name) ──────────
  const elements: SldElement[] = [];
  const idMap = new Map<string, string>(); // original id → final id
  const taken = new Set<string>();
  for (const el of spec.elements) {
    const orig = String(el?.id ?? "");
    let final = orig;
    if (!ID_RE.test(final)) {
      const fixed = sanitizeId(final);
      if (!fixed) {
        actions.push(`drop element "${orig}" — unusable id`);
        continue;
      }
      actions.push(`rename id "${orig}" -> "${fixed}"`);
      final = fixed;
    }
    if (taken.has(final)) {
      let suffixed = "";
      for (let n = 2; n <= 1 + MAX_SUFFIX_TRIES; n++) {
        const cand = `${final}_${n}`.slice(0, 12);
        if (ID_RE.test(cand) && !taken.has(cand)) {
          suffixed = cand;
          break;
        }
      }
      if (!suffixed) {
        actions.push(`drop element "${orig}" — id collision with no free name`);
        continue;
      }
      actions.push(`dedupe id "${orig}" -> "${suffixed}"`);
      final = suffixed;
    }
    taken.add(final);
    // First occurrence wins the wire mapping: a connection that says "B1"
    // means the name-KEEPING element, not whichever duplicate came last.
    if (!idMap.has(orig)) idMap.set(orig, final);
    // non-finite/negative coords would be lint "grid" errors — clamp here too
    // (defence-in-depth when repair runs on a raw spec, e.g. the POST route).
    const x = Number.isFinite(el.x) && el.x >= 0 ? el.x : 0;
    const y = Number.isFinite(el.y) && el.y >= 0 ? el.y : 0;
    if (x !== el.x || y !== el.y) actions.push(`clamp coords of "${final}" to the grid`);
    elements.push({ ...el, id: final, x, y });
  }
  if (elements.length === 0) {
    return { spec, actions: [...actions, "nothing salvageable — returning the original spec"] };
  }

  // ── 2) connections: remap through idMap, drop dead/duplicate wires ───────
  const connections: Array<[string, string]> = [];
  const seenConn = new Set<string>();
  for (const pair of Array.isArray(spec.connections) ? spec.connections : []) {
    const a = idMap.get(String(pair?.[0] ?? ""));
    const b = idMap.get(String(pair?.[1] ?? ""));
    if (!a || !b) {
      actions.push(`drop wire ${String(pair?.[0] ?? "?")}→${String(pair?.[1] ?? "?")} — endpoint missing`);
      continue;
    }
    const key = [a, b].sort().join("|");
    if (a === b || seenConn.has(key)) {
      actions.push(`drop ${a === b ? "self-loop" : "duplicate"} wire ${a}→${b}`);
      continue;
    }
    seenConn.add(key);
    connections.push([a, b]);
  }

  // ── 3) overlap repair: first-fit relocation, deterministic order ─────────
  const placedRects: BBox[] = [];
  const placed = elements.map((el) => {
    if (collides(bboxAt(el, el.x, el.y), placedRects)) {
      let fixed: { x: number; y: number } | null = null;
      for (let d = 1; d <= DOWN_STEPS && !fixed; d++) {
        if (!collides(bboxAt(el, el.x, el.y + d), placedRects)) fixed = { x: el.x, y: el.y + d };
      }
      for (let r = 1; r <= RIGHT_STEPS && !fixed; r++) {
        if (!collides(bboxAt(el, el.x + r, el.y), placedRects)) fixed = { x: el.x + r, y: el.y };
      }
      for (let d = 1; d <= DIAG_STEPS && !fixed; d++) {
        if (!collides(bboxAt(el, el.x + d, el.y + d), placedRects)) fixed = { x: el.x + d, y: el.y + d };
      }
      if (fixed) {
        actions.push(`relocate "${el.id}" (${el.x},${el.y} -> ${fixed.x},${fixed.y}) — overlap`);
        placedRects.push(bboxAt(el, fixed.x, fixed.y));
        return { ...el, x: fixed.x, y: fixed.y };
      }
      actions.push(`keep "${el.id}" as-is — no free cell found`);
    }
    placedRects.push(bboxAt(el, el.x, el.y));
    return el;
  });

  return {
    spec: { ...spec, elements: placed, connections },
    actions,
  };
}
