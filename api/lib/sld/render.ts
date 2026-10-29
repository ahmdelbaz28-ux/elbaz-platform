/**
 * SLD renderer — spec → deterministic SVG string.
 * Routing: orthogonal 3-segment runs (down → across → down) with per-source
 * fan-out columns (unique X per outgoing wire — the KiCad skill's rule that
 * no two wires share a segment), best-effort with the linter as the quality
 * gate. Output is escaped XML; model text never becomes markup.
 */
import { paintSymbol, THEMES } from "./symbols";
import { lintSpec, sheetSize } from "./lint";
import { LABEL_GAP, type PlacedElement, type SldSpec } from "./types";

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

/** Label above/below a body (below for terminal-flow elements). */
function paintLabel(p: PlacedElement, theme: (typeof THEMES)["dark" | "light"]): string {
  const label = (p.el.label ?? "").trim();
  if (!label) return "";
  const below = p.el.type === "load" || p.el.type === "motor" || p.el.type === "ground";
  const y = below ? p.bbox.y2 + LABEL_GAP + 4 : p.bbox.y1 - LABEL_GAP;
  return `\n  <text x="${p.cx}" y="${y}" text-anchor="middle" font-size="12" fill="${theme.text}" font-family="'Segoe UI', Tahoma, sans-serif">${escapeXml(label)}</text>`;
}

/**
 * Orthogonal routes with per-source fan-out stagger (unique X per outgoing
 * wire). Busbar targets land on the bar's top edge at the wire's own X;
 * busbar sources leave from their bottom edge, staggered right→left.
 */
function routeWires(
  placed: PlacedElement[],
  connections: Array<[string, string]>,
): Array<{ points: string; dots: Array<{ x: number; y: number }> }> {
  const byId = new Map(placed.map((p) => [p.el.id, p]));
  const fanIndex = new Map<string, number>();
  const wires: Array<{ points: string; dots: Array<{ x: number; y: number }> }> = [];

  for (const [a, b] of connections) {
    const A = byId.get(a);
    const B = byId.get(b);
    if (!A || !B) continue;

    const idx = fanIndex.get(A.el.id) ?? 0;
    fanIndex.set(A.el.id, idx + 1);
    const startX = A.bottom.x + idx * 10; // unique fan-out column per wire
    const startY = A.bottom.y;

    let endX = B.top.x;
    const endY = B.top.y;
    if (B.el.type === "busbar") {
      endX = Math.min(Math.max(startX, B.bbox.x1 + 6), B.bbox.x2 - 6);
    }

    const dots: Array<{ x: number; y: number }> = [];
    if (A.el.type === "busbar") dots.push({ x: startX, y: startY });
    if (B.el.type === "busbar") dots.push({ x: endX, y: endY });

    const pts: string[] = [`${startX},${startY}`];
    const gap = endY - startY;
    if (Math.abs(startX - endX) < 1) {
      pts.push(`${startX},${endY}`);
    } else if (gap > 0) {
      // The turn point must stay strictly INSIDE the vertical gap — a turn
      // below the target's top edge would hook the wire backwards (seen live
      // on the 1-grid-cell source→breaker hop during visual verification).
      const midY = gap >= 16 ? startY + Math.min(Math.max(12, Math.round(gap / 2) - 6), gap - 4) : startY + Math.max(2, Math.round(gap / 2));
      pts.push(`${startX},${midY}`, `${endX},${midY}`, `${endX},${endY}`);
    } else {
      // Target ABOVE the source (spec modelling quirk): side-loop around.
      const loopY = startY + 8;
      pts.push(`${startX},${loopY}`, `${endX},${loopY}`, `${endX},${endY}`);
    }
    wires.push({ points: pts.join(" "), dots });
  }
  return wires;
}

export function renderSld(spec: SldSpec): RenderResult {
  const audit = lintSpec(spec);
  const theme = THEMES[spec.theme === "light" ? "light" : "dark"];
  const { width, height } = sheetSize(spec);
  const connections = Array.isArray(spec.connections) ? spec.connections : [];

  const wires = routeWires(audit.placed, connections);

  const bodies = audit.placed.map((p) => paintSymbol(p, theme)).join("");
  const labels = audit.placed.map((p) => paintLabel(p, theme)).join("");
  const wireSvg = wires
    .map(
      (w) =>
        `<polyline points="${w.points}" fill="none" stroke="${theme.wire}" stroke-width="2" stroke-linejoin="round"/>${w.dots
          .map((d) => `<circle cx="${d.x}" cy="${d.y}" r="3" fill="${theme.wire}"/>`)
          .join("")}`,
    )
    .join("\n  ");

  const title = (spec.title ?? "").trim();
  const titleSvg = title
    ? `\n  <text x="${Math.round(width / 2)}" y="20" text-anchor="middle" font-size="14" font-weight="bold" fill="${theme.text}" font-family="'Segoe UI', Tahoma, sans-serif">${escapeXml(title)}</text>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title || "Single-line diagram")}">
  <rect width="${width}" height="${height}" fill="${spec.theme === "light" ? "#ffffff" : "#0b1622"}"/>${titleSvg}
  <g>${wireSvg}</g>
  <g>${bodies}</g>
  <g>${labels}</g>
</svg>`;

  return { svg, ok: audit.ok, findings: audit.findings };
}
