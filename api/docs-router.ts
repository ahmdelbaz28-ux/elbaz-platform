/**
 * Documents router — serves chat-generated files (PDF / DOCX / Markdown).
 *
 * POST /api/docs/gen   body: { spec: DocSpec, format?: "pdf"|"docx"|"md" }
 *   → the built file bytes (Content-Disposition: attachment)
 *
 * Public + stateless + zero storage, exactly like /api/diagrams/sld: the
 * file is derived deterministically from the spec on every request and is
 * never cached server-side. The LLM NEVER produces file bytes — it emits a
 * JSON DocSpec inside a ```docgen fence; api/lib/docgen validates + caps it
 * (MAX_CONTENT_CHARS) and renders. A failing spec answers 422 with a
 * machine-readable error; the chat reply itself never breaks (the renderer
 * falls back to a plain code block).
 *
 * Abuse surface: bounded body size (spec cap), bounded output content, no
 * filesystem/network access at render time, no user identifiers in the file.
 */
import { Hono } from "hono";
import { normalizeDocSpec, isDocFormat, DOC_MIME, docFilename, MAX_SPEC_RAW_CHARS } from "./lib/docgen/spec.js";
import { buildDoc } from "./lib/docgen/build.js";

export const docsRouter = new Hono({ strict: false });

/** RFC 5987 filename* — ASCII fallback + UTF-8 form for Arabic titles. */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const utf8 = encodeURIComponent(filename).replace(/['()]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

docsRouter.post("/docs/gen", async (c) => {
  const raw = await c.req.text();
  if (!raw || raw.length > MAX_SPEC_RAW_CHARS * 1.2) {
    return c.json({ error: "missing or oversized body" }, 400);
  }
  let parsed: { spec?: unknown; format?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return c.json({ error: "body is not valid JSON" }, 400);
  }
  const format = isDocFormat(parsed.format) ? parsed.format : "pdf";
  const result = normalizeDocSpec(parsed.spec);
  if (!result.ok || !result.spec) {
    return c.json({ error: result.error ?? "invalid spec" }, 422);
  }

  let bytes: Uint8Array;
  let filename: string;
  let mime: string;
  try {
    const built = buildDoc(result.spec, format);
    bytes = built.bytes;
    filename = docFilename(result.spec, format);
    mime = DOC_MIME[format];
  } catch (err) {
    // A render failure must never leak a stack — typed error only.
    console.error("[docs] render failed:", err instanceof Error ? err.message : err);
    return c.json({ error: "document render failed" }, 500);
  }

  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": contentDisposition(filename),
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
