/**
 * Markdown renderer — DocSpec → GitHub-flavored Markdown text.
 * The user asked for "PDF, markdown or docx" — MD is the instant, copyable
 * form. Tables become GFM pipe tables (cells are escaped); citations become
 * a numbered source list. Deterministic, pure text.
 */
import type { NormalizedDocSpec } from "./spec.js";

function cell(s: string): string {
  return s.replaceAll("|", "\\|").replaceAll("\n", " ").trim();
}

export function renderMarkdown(spec: NormalizedDocSpec): string {
  const out: string[] = [];
  out.push(`# ${spec.title}`);
  if (spec.subtitle) out.push(`*${spec.subtitle}*`);
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  out.push(`> مُولَّد آليًا بواسطة ELBAZ Platform — ${stamp} UTC`);
  out.push("");

  for (const s of spec.sections) {
    if (s.heading) {
      out.push(`## ${s.heading}`);
      out.push("");
    }
    if (s.paragraphs?.length) {
      for (const p of s.paragraphs) {
        out.push(p);
        out.push("");
      }
    }
    if (s.bullets?.length) {
      for (const b of s.bullets) out.push(`- ${b}`);
      out.push("");
    }
    if (s.table) {
      const { headers, rows } = s.table;
      out.push(`| ${headers.map(cell).join(" | ")} |`);
      out.push(`| ${headers.map(() => "---").join(" | ")} |`);
      for (const r of rows) out.push(`| ${r.map(cell).join(" | ")} |`);
      out.push("");
    }
  }

  if (spec.citations?.length) {
    out.push("## المصادر والمراجع");
    out.push("");
    for (const [i, c] of spec.citations.entries()) out.push(`- [${i + 1}] ${c}`);
    out.push("");
  }

  return `${out.join("\n").replaceAll(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
