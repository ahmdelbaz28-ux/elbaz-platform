/**
 * Diagrams router — serves generated single-line diagrams.
 *
 * GET /api/diagrams/sld?spec=<URI-encoded JSON>   → image/svg+xml
 * GET /api/diagrams/sld (POST JSON body)          → { svg, ok, findings }
 *
 * Public, read-only, zero storage: the SVG is derived deterministically from
 * the spec, so it is computed on request and cached at the edge. The spec is
 * validated + LINTED before rendering; a failing spec answers 422 with the
 * findings (the caller decides whether to drop the diagram — chat never
 * breaks). Size-capped to keep this endpoint uninteresting for abuse.
 */
import { Hono } from "hono";
import { renderSld } from "./lib/sld/render.js";
import type { SldSpec } from "./lib/sld/types.js";

export const diagramsRouter = new Hono({ strict: false });

const MAX_SPEC_CHARS = 4_000; // an SLD spec is tiny; 4k chars is generous
const MAX_ELEMENTS = 40;

function coerceSpec(raw: unknown): SldSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<SldSpec>;
  if (!Array.isArray(s.elements) || s.elements.length === 0 || s.elements.length > MAX_ELEMENTS) return null;
  if (!Array.isArray(s.connections)) return null;
  const elements = s.elements.map((e) => ({
    id: String(e?.id ?? "").slice(0, 12),
    type: String(e?.type ?? "") as SldSpec["elements"][number]["type"],
    x: Math.min(40, Math.max(0, Number(e?.x) || 0)),
    y: Math.min(40, Math.max(0, Number(e?.y) || 0)),
    label: typeof e?.label === "string" ? e.label.slice(0, 60) : undefined,
    len: typeof e?.len === "number" ? Math.min(6, Math.max(1, e.len)) : undefined,
  }));
  const ids = new Set(elements.map((e) => e.id));
  const connections = s.connections
    .slice(0, 120)
    .map((c) => [String(c?.[0] ?? ""), String(c?.[1] ?? "")] as [string, string])
    .filter(([a, b]) => ids.has(a) && ids.has(b));
  return {
    title: typeof s.title === "string" ? s.title.slice(0, 120) : undefined,
    elements,
    connections,
    theme: s.theme === "light" ? "light" : "dark",
  };
}

diagramsRouter.get("/diagrams/sld", (c) => {
  const rawSpec = c.req.query("spec") ?? "";
  if (!rawSpec || rawSpec.length > MAX_SPEC_CHARS) {
    return c.json({ error: "missing or oversized spec (URL-encoded JSON)" }, 400);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawSpec);
  } catch {
    return c.json({ error: "spec is not valid JSON" }, 400);
  }
  const spec = coerceSpec(parsed);
  if (!spec) return c.json({ error: "spec shape invalid (need elements[], connections[])" }, 400);

  const result = renderSld(spec);
  if (!result.ok) {
    return c.json({ error: "spec failed the diagram linter", findings: result.findings }, 422);
  }
  return c.body(result.svg, 200, {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": "public, max-age=86400, immutable",
    "X-Content-Type-Options": "nosniff",
  });
});

diagramsRouter.post("/diagrams/sld", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body is not valid JSON" }, 400);
  }
  const spec = coerceSpec(body);
  if (!spec) return c.json({ error: "spec shape invalid (need elements[], connections[])" }, 400);
  const result = renderSld(spec);
  return c.json(
    {
      ok: result.ok,
      findings: result.findings,
      svgUrl: result.ok ? `/api/diagrams/sld?spec=${encodeURIComponent(JSON.stringify(spec))}` : undefined,
      svg: result.ok ? result.svg : undefined,
    },
    result.ok ? 200 : 422,
  );
});
