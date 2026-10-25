/**
 * CHAT MESSAGE FORMATTING — deterministic table conversion
 *
 * The chat UI renders a hand-rolled line-based Markdown subset (headings,
 * numbered steps, bullets, code fences) — it has NO table renderer, so any
 * Markdown table the model emits shows up as broken pipe-delimited text
 * (live user feedback 2026-10: tables in replies looked misaligned/unreadable).
 *
 * The system prompt forbids tables (reasoningGuard + language/format rules),
 * but prompt rules alone leak occasionally — the same lesson as the CJK
 * incident. This converter is the deterministic enforcement layer: it rewrites
 * every Markdown table into labeled bullet lines that the chat renderer
 * already understands. It runs on the FULL accumulated text at every render
 * (streaming bubbles re-render from scratch per delta), so it is inherently
 * delta-safe — no cross-chunk state, no buffering.
 *
 * Bonus: messages persisted in history before this fix also render cleanly.
 */

/**
 * A table row line: at least 2 pipe characters (header rows, data rows).
 * Ordinary prose almost never contains two pipes, so this is a safe gate.
 */
function isTableRow(line: string): boolean {
  return (line.match(/\|/g) || []).length >= 2;
}

/**
 * GFM separator row: only pipes, dashes, colons and spaces, at least one
 * pipe and at least 3 dashes (a bare `---` horizontal rule does NOT count —
 * it must sit between pipes to be a table separator).
 * Tolerates half-arrived separators during streaming (`| --- | ---`).
 */
function isTableSeparator(line: string): boolean {
  const s = line.trim();
  if (!s.includes("|")) return false;
  if (!/^[\s|:-]+$/.test(s)) return false;
  return (s.match(/-/g) || []).length >= 3;
}

/**
 * Split a table row into trimmed cells. Handles optional leading/trailing
 * pipes and GFM escaped pipes (`\|`) inside cells; strips bold markers the
 * model may already have placed inside cells (the converted output adds its
 * own highlighting). Escaped pipes are masked with a control-char sentinel
 * (built via fromCharCode — no literal in source, no control-char regex)
 * BEFORE the pipe split so they survive as literal `|` in the cell value.
 */
const PIPE_SENTINEL = String.fromCharCode(1);

function splitRow(line: string): string[] {
  const guarded = line.trim().replace(/\\\|/g, PIPE_SENTINEL);
  let body = guarded;
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);
  return body
    .split("|")
    .map((cell) => cell.split(PIPE_SENTINEL).join("|").replace(/\*\*/g, "").trim());
}

/**
 * Convert one table (headers + separator skipped + data rows) into bullet
 * lines the chat renderer understands:
 *   - 1 column  → plain bullets.
 *   - 2 columns → definition bullets: `- **label:** value` (first cell is
 *                 the label, falling back to its header when empty).
 *   - ≥3 cols   → one bullet per row, every cell labeled by its header:
 *                 `- **h1:** v1 — **h2:** v2 — **h3:** v3`.
 * Every bullet stays inside the renderer's existing bullet grammar, so the
 * output is a tidy vertical list instead of a broken pipe grid.
 */
function tableToBullets(headers: string[], rows: string[][]): string[] {
  const H = headers.map((h) => h.replace(/\*\*/g, "").trim());
  if (rows.length === 0) {
    // Degenerate table (header + separator only, e.g. stream cut) — keep the
    // column names as a single bullet so no information is silently dropped.
    return H.length ? [`- ${H.filter(Boolean).join(" — ") || "—"}`] : [];
  }
  return rows.map((cells) => {
    if (H.length <= 1) return `- ${cells[0] || "—"}`;
    if (H.length === 2) {
      const label = cells[0] || H[0] || "—";
      const value = cells[1] || "—";
      return `- **${label}:** ${value}`;
    }
    const parts = H.map((h, idx) => `**${h || `#${idx + 1}`}:** ${cells[idx] || "—"}`);
    return `- ${parts.join(" — ")}`;
  });
}

/**
 * Rewrite every Markdown table in `text` as chat-friendly bullet lines.
 * Non-table text passes through byte-for-byte; tables inside code fences are
 * never touched (the renderer splits fences out before calling this).
 */
export function convertMarkdownTables(text: string): string {
  if (!text.includes("|")) return text;
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitRow(line);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(...tableToBullets(headers, rows));
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join("\n");
}
