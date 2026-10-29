/**
 * CHAT MARKDOWN RENDERER — pure, React-free (extracted from ChatBot.tsx)
 *
 * SECURITY INVARIANT (audit run-1, finding chatbot.rendermarkdown.*):
 * EVERY text segment is HTML-escaped BEFORE any markdown transformation.
 * Only renderer-synthesized tags (h4/ol/ul/li/p/code/a/strong/em/img) may
 * appear in the output; the link URL regex additionally restricts hrefs to
 * http(s), and the ONLY allowed <img> is the SLD diagram image synthesized
 * from a ```sld fence — a same-origin URL under /api/diagrams/ whose SVG is
 * produced exclusively by the server-side linted renderer (api/lib/sld/).
 * Model text NEVER becomes markup: a fence that fails spec validation falls
 * back to the escaped code block.
 * The old code escaped only fenced code blocks, letting model/user/history
 * content like `<img src=x onerror=...>` reach dangerouslySetInnerHTML.
 *
 * Bidi support: any message containing Arabic script renders RTL; Latin runs
 * inside an RTL paragraph are isolated by the Unicode bidi algorithm; code
 * blocks and inline code are pinned LTR. Markdown supports: fenced code
 * blocks, inline code, **bold** (cyan key terms), *italic*,
 * [links](https://…) (safe anchors), ### headings, numbered step lists,
 * bullet lists, and paragraphs.
 */
import { convertMarkdownTables } from "@/lib/chat-format";

export const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#x27;");
}

/** Inline markdown (code / links / bold / italic) — input is already escaped. */
function renderInline(md: string): string {
  // Inline code first, so ** inside code is never bolded. dir="ltr" isolates
  // the code run from the surrounding RTL/LTR paragraph.
  let html = md.replaceAll(/`([^`]+)`/g, '<code dir="ltr" class="bg-black/30 border border-[#1e2d3d] px-1.5 py-0.5 rounded text-[12px] text-cyan-300">$1</code>');
  // Markdown links → safe anchors (documented-answer citations from web
  // search). URL is restricted to http/https; the input was already
  // HTML-escaped, so `"` cannot break out of the href attribute.
  html = html.replaceAll(/\[([^\]\n]+)\]\((https?:\/\/[^\s<>()]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-cyan-300 underline decoration-cyan-300/40 hover:decoration-cyan-200 break-all" dir="ltr">$1</a>');
  // Bold → highlighted key term (the UI colors important words cyan)
  html = html.replaceAll(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-cyan-300">$1</strong>');
  // Italic
  html = html.replaceAll(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  return html;
}

/**
 * Render a non-code text segment: headings, numbered step lists, bullet lists
 * and paragraphs. Line-based so the model's "1. step" instructions render as
 * real ordered steps (with a number badge) instead of a wall of text.
 * Input is already HTML-escaped (enforced by renderMarkdown).
 */
function renderTextBlock(text: string): string {
  const lines = text.split("\n");
  let out = "";
  let mode: "none" | "ol" | "ul" = "none";
  let para: string[] = [];

  const closeList = () => {
    if (mode === "ol") out += "</ol>";
    else if (mode === "ul") out += "</ul>";
    mode = "none";
  };
  const flushPara = () => {
    if (para.length) {
      out += `<p>${para.join("<br>")}</p>`;
      para = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    const step = /^(\d{1,2})[.)]\s+(.+)$/.exec(line);
    const bullet = /^[-*•]\s+(.+)$/.exec(line);

    if (heading) {
      flushPara();
      closeList();
      out += `<h4 class="chat-h">${renderInline(heading[1])}</h4>`;
    } else if (step) {
      flushPara();
      if (mode !== "ol") {
        closeList();
        out += '<ol class="chat-ol">';
        mode = "ol";
      }
      out += `<li data-n="${step[1]}">${renderInline(step[2])}</li>`;
    } else if (bullet) {
      flushPara();
      if (mode !== "ul") {
        closeList();
        out += '<ul class="chat-ul">';
        mode = "ul";
      }
      out += `<li>${renderInline(bullet[1])}</li>`;
    } else if (!line) {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(renderInline(line));
    }
  }
  flushPara();
  closeList();
  return out;
}

/**
 * SLD fence → same-origin diagram image. The spec is re-validated on the
 * server (lint + render); client-side we only do a cheap shape check so a
 * malformed fence degrades to a plain code block instead of a broken image.
 * Returns null whenever anything is off — the caller keeps the code block.
 */
function renderSldFence(rawCode: string): string | null {
  try {
    const spec = JSON.parse(rawCode) as { title?: unknown; elements?: Array<{ id?: unknown; type?: unknown }>; connections?: Array<[unknown, unknown]> } | null;
    if (!spec || typeof spec !== "object") return null;
    const elements = Array.isArray(spec.elements) ? spec.elements : [];
    if (elements.length === 0 || elements.length > 40) return null;
    const ids = new Set(elements.map((e) => String(e?.id ?? "")));
    if (elements.some((e) => !ids.has(String(e?.id ?? "")) || !String(e?.type ?? ""))) return null;
    const conns = Array.isArray(spec.connections) ? spec.connections : [];
    if (conns.some(([a, b]) => !ids.has(String(a)) || !ids.has(String(b)))) return null;
    // v = renderer revision — busts stale browser/edge caches when the SLD
    // rendering engine itself changes (labels, geometry, themes).
    const url = `/api/diagrams/sld?spec=${encodeURIComponent(rawCode)}&v=4`;
    const title = typeof spec.title === "string" && spec.title.trim() ? spec.title.trim() : "Single-line diagram";
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(title)}" loading="lazy" decoding="async" class="max-w-full h-auto rounded-lg border border-[#1e2d3d] my-1.5" dir="ltr"/>`;
  } catch {
    return null;
  }
}

/**
 * ─── Unfulfilled diagram-promise detector (pure, React-free) ────────────────
 * Powers the "📐 ارسمها دلوقتي" chip: when an assistant reply PROMISES a
 * diagram (or offers/announces one) but the message carries NO valid SLD
 * board, the chip offers a one-tap follow-up instead of making the user
 * retype their request. Real failure modes this covers (observed live):
 *  - the stream was cut by the output-token cap right after "سأرسم لك مخططاً…"
 *  - the model emitted a broken ```sld fence (fails the shape check → code block)
 *  - the model merely offered ("تحب أرسمه لك؟") instead of drawing.
 * A message that DID render a diagram never shows the chip, no matter how
 * many promise-shaped words surround the board.
 */

/** Same fence grammar as renderMarkdown; true when any ```sld fence passes the
 * same cheap shape check the renderer uses (i.e. it WILL show as a diagram). */
function hasValidSldFence(text: string): boolean {
  // split yields [text, lang, code, text, lang, code, …] — starting the loop
  // at the FIRST lang index (1), the matching code block sits at i+1.
  const segments = text.split(/```(\w*)[ \t]*\n?([\s\S]*?)```/); // NOSONAR — S8786: same bounded grammar as renderMarkdown
  for (let i = 1; i < segments.length; i += 3) {
    if (segments[i] === "sld" && renderSldFence((segments[i + 1] ?? "").trim())) return true;
  }
  return false;
}

// Arabic: affirmative promises/offers around drawing. Deliberately does NOT
// match the bare imperative "ارسم" (that is the USER's ask, quoted back) nor
// teaching phrases like "لرسم المخطط في ETAP" — only first-person commitments.
const DIAGRAM_PROMISE_AR_RE =
  /(س[أا]رسم|ه[أا]رسم|سوف\s+أرسم|دعني\s+أرسم|دعيني\s+أرسم|أن\s+أرسم|أرسم\s+(?:لك|لكم|ه|ها|هو|هم)|أرسم(?:ه|ها|هم)\s+لك|سأقوم\s+برسم|سوف\s+أقوم\s+برسم|أقوم\s+برسم\s+(?:المخطط|مخطط|الرسمة|رسمة)|جاري\s+رسم|سأجهز\s+(?:لك\s+)?(?:المخطط|مخطط|الرسمة|رسمة)|هجهز\s+(?:لك\s+)?(?:المخطط|مخطط|الرسمة|رسمة)|هعمل\s+(?:لك\s+)?(?:المخطط|مخطط|الرسمة|رسمة)|سأرسل\s+(?:لك\s+)?(?:المخطط|مخطط|الرسمة|رسمة)|سأرفق\s+(?:المخطط|مخطط|الرسمة|رسمة))/;
// Arabic: "delivery" wording with no board behind it ("إليك المخطط:" + broken fence).
const DIAGRAM_DELIVERY_AR_RE = /(إليك\s+(?:المخطط|مخطط|الرسمة|رسمة)|هذا\s+هو\s+(?:المخطط|الرسمة)|دي\s+(?:الرسمة|المخطط)|المخطط\s+(?:تحت|اللي\s+فوق))/;
// English: first-person draw commitments ("I'll draw the diagram", "let me
// sketch the SLD"). The ≤3-word gap skips teaching phrasing like
// "I'll show you how to draw…" while still catching "I'll happily draw…".
const DIAGRAM_PROMISE_EN_RE =
  /\b(?:i'?ll|i will|i can|i'?m|i am|let me|allow me to|i'?m going to|i am going to)\s+(?:\w+\s+){0,3}?(?:draw|sketch|create|generate|make|build|prepare|drawing)\b[^\n]{0,60}?\b(?:diagram|sld|single[- ]line|one[- ]line|schematic|drawing)\b/i;
// English: "here's the diagram" with no board behind it.
const DIAGRAM_DELIVERY_EN_RE = /\bhere(?:'s| is)(?:\s+the|\s+your)?\s+(?:diagram|sld|schematic)|\bdiagram\s+(?:below|here)\b/i;

/**
 * True when this assistant message promised/announced a diagram but the
 * rendered result contains NO valid SLD board (→ show the draw-now chip).
 */
export function detectUnfulfilledDiagramPromise(text: string): boolean {
  if (!text || text.length > 20_000) return false;
  if (hasValidSldFence(text)) return false;
  return (
    DIAGRAM_PROMISE_AR_RE.test(text) ||
    DIAGRAM_PROMISE_EN_RE.test(text) ||
    DIAGRAM_DELIVERY_AR_RE.test(text) ||
    DIAGRAM_DELIVERY_EN_RE.test(text)
  );
}

/**
 * Render a chat message to safe HTML. Text segments are escaped BEFORE the
 * markdown machine runs (the security invariant above); fenced code blocks
 * are escaped verbatim. While streaming, a momentarily unclosed fence is
 * closed so partial code renders as a block instead of leaking backticks.
 */
export function renderMarkdown(text: string): string {
  let src = text;
  const fenceCount = (src.match(/```/g) || []).length;
  if (fenceCount % 2 === 1) src += "\n```";

  // S8786: regex is intentionally bounded; `[\s\S]*?` is the canonical
  // non-backtracking pattern for delimited multiline captures.
  const segments = src.split(/```(\w*)[ \t]*\n?([\s\S]*?)```/); // NOSONAR — S8786: bounded lazy capture between ``` delimiters
  // segments: [text, lang, code, text, lang, code, …, text]
  let html = "";
  for (let i = 0; i < segments.length; i += 3) {
    // Tables are converted on the raw text (pipe grammar), then the whole
    // segment is HTML-escaped before the line machine sees it — the audit
    // fix for the unescaped-innerHTML XSS.
    html += renderTextBlock(escapeHtml(convertMarkdownTables(segments[i])));
    if (segments[i + 2] !== undefined) {
      const lang = segments[i + 1];
      const raw = segments[i + 2].trim();
      if (lang === "sld") {
        const img = renderSldFence(raw);
        if (img) {
          html += img;
          continue;
        }
      }
      const code = escapeHtml(raw);
      html += `<pre dir="ltr" class="bg-black/40 border border-[#1e2d3d] rounded-lg p-2.5 my-1.5 overflow-x-auto text-[12px] leading-5 text-[#b4c6e0]" style="text-align:left"><code>${code}</code></pre>`;
    }
  }
  return html;
}
