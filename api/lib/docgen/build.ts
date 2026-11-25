/**
 * Document dispatch — DocSpec + format → file bytes + filename + MIME.
 * The single entry point the router (and tests) call. Pure + deterministic.
 */

import { renderDocx } from "./docx.js";
import { renderMarkdown } from "./md.js";
import { renderPdf } from "./pdf.js";
import { type DocFormat, docFilename, type NormalizedDocSpec } from "./spec.js";

export interface BuiltDoc {
  bytes: Uint8Array;
  filename: string;
  mime: string;
}

export function buildDoc(spec: NormalizedDocSpec, format: DocFormat): BuiltDoc {
  switch (format) {
    case "pdf":
      return { bytes: renderPdf(spec), filename: docFilename(spec, "pdf"), mime: "application/pdf" };
    case "docx":
      return { bytes: renderDocx(spec), filename: docFilename(spec, "docx"), mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    case "md":
      return { bytes: new TextEncoder().encode(renderMarkdown(spec)), filename: docFilename(spec, "md"), mime: "text/markdown; charset=utf-8" };
  }
}
