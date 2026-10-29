/**
 * SLD symbols — SVG body painters for the ETAP power-element vocabulary.
 * Pure string builders; theme-aware stroke/fill; NO text escaping here
 * (labels are escaped once in render.ts).
 */
import type { PlacedElement } from "./types";

export interface Theme {
  stroke: string;
  fill: string;
  busFill: string;
  text: string;
  wire: string;
  accent: string;
}

export const THEMES: Record<"dark" | "light", Theme> = {
  dark: {
    stroke: "#67e8f9", // cyan-300
    fill: "rgba(8,51,68,0.35)",
    busFill: "#22d3ee",
    text: "#e2e8f0",
    wire: "#38bdf8",
    accent: "#fbbf24",
  },
  light: {
    stroke: "#0e7490", // cyan-700
    fill: "rgba(255,255,255,0.9)",
    busFill: "#0891b2",
    text: "#0f172a",
    wire: "#0369a1",
    accent: "#b45309",
  },
};

/**
 * Paint the symbol BODY centered at (cx, cy). Wires/labels are the layout's
 * job — this returns only the element's own shapes so the linter can reason
 * purely about the bbox in types.ts.
 */
export function paintSymbol(p: PlacedElement, t: Theme): string {
  const { cx, cy, el } = p;
  switch (el.type) {
    case "generator":
    case "grid": {
      const glyph = el.type === "grid" ? "G" : "~";
      return `
  <circle cx="${cx}" cy="${cy}" r="18" fill="${t.fill}" stroke="${t.stroke}" stroke-width="2"/>
  ${glyph === "~" ? `<path d="M ${cx - 8} ${cy + 2} q 4 -8 8 0 q 4 8 8 0" fill="none" stroke="${t.stroke}" stroke-width="2"/>` : `<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="16" font-weight="bold" fill="${t.stroke}">G</text>`}`;
    }
    case "transformer2": {
      return `
  <circle cx="${cx}" cy="${cy - 8}" r="14" fill="${t.fill}" stroke="${t.stroke}" stroke-width="2"/>
  <circle cx="${cx}" cy="${cy + 8}" r="14" fill="${t.fill}" stroke="${t.stroke}" stroke-width="2"/>`;
    }
    case "busbar": {
      const b = p.bbox;
      return `
  <rect x="${b.x1}" y="${b.y1}" width="${b.x2 - b.x1}" height="${b.y2 - b.y1}" rx="3" fill="${t.busFill}" stroke="none"/>`;
    }
    case "breaker": {
      return `
  <rect x="${cx - 13}" y="${cy - 15}" width="26" height="30" rx="2" fill="${t.fill}" stroke="${t.stroke}" stroke-width="2"/>
  <line x1="${cx - 7}" y1="${cy + 9}" x2="${cx + 7}" y2="${cy - 9}" stroke="${t.stroke}" stroke-width="2"/>
  <line x1="${cx - 13}" y1="${cy - 15}" x2="${cx - 13}" y2="${cy - 22}" stroke="${t.wire}" stroke-width="2" stroke-linecap="round"/>
  <line x1="${cx + 13}" y1="${cy + 15}" x2="${cx + 13}" y2="${cy + 22}" stroke="${t.wire}" stroke-width="2" stroke-linecap="round"/>`;
    }
    case "disconnector": {
      return `
  <circle cx="${cx - 10}" cy="${cy - 10}" r="3" fill="${t.stroke}"/>
  <circle cx="${cx - 10}" cy="${cy + 10}" r="3" fill="${t.stroke}"/>
  <line x1="${cx - 10}" y1="${cy - 10}" x2="${cx + 12}" y2="${cy + 6}" stroke="${t.stroke}" stroke-width="2"/>
  <circle cx="${cx + 12}" cy="${cy + 6}" r="0"/>`;
    }
    case "fuse": {
      return `
  <rect x="${cx - 11}" y="${cy - 7}" width="22" height="14" rx="2" fill="${t.fill}" stroke="${t.stroke}" stroke-width="2"/>
  <line x1="${cx}" y1="${cy - 7}" x2="${cx}" y2="${cy + 7}" stroke="${t.stroke}" stroke-width="1.5"/>`;
    }
    case "load": {
      return `
  <rect x="${cx - 15}" y="${cy - 11}" width="30" height="22" rx="2" fill="${t.fill}" stroke="${t.stroke}" stroke-width="2"/>
  <line x1="${cx - 6}" y1="${cy}" x2="${cx + 6}" y2="${cy}" stroke="${t.accent}" stroke-width="2"/>
  <path d="M ${cx + 6} ${cy} l -4 -3 l 0 6 z" fill="${t.accent}"/>`;
    }
    case "motor": {
      return `
  <circle cx="${cx}" cy="${cy}" r="16" fill="${t.fill}" stroke="${t.stroke}" stroke-width="2"/>
  <text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="15" font-weight="bold" fill="${t.stroke}">M</text>`;
    }
    case "ct": {
      return `
  <circle cx="${cx}" cy="${cy}" r="9" fill="${t.fill}" stroke="${t.accent}" stroke-width="2"/>`;
    }
    case "ground": {
      return `
  <line x1="${cx - 11}" y1="${cy - 4}" x2="${cx + 11}" y2="${cy - 4}" stroke="${t.stroke}" stroke-width="2"/>
  <line x1="${cx - 7}" y1="${cy + 1}" x2="${cx + 7}" y2="${cy + 1}" stroke="${t.stroke}" stroke-width="2"/>
  <line x1="${cx - 3}" y1="${cy + 6}" x2="${cx + 3}" y2="${cy + 6}" stroke="${t.stroke}" stroke-width="2"/>`;
    }
    case "junction":
    default:
      return `
  <circle cx="${cx}" cy="${cy}" r="4" fill="${t.stroke}"/>`;
  }
}
