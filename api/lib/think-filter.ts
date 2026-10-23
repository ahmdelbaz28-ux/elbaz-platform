/**
 * THINK-TAG FILTER — hard code-level guarantee that internal model reasoning
 * NEVER reaches the user, even if a model ignores the prompt guard.
 *
 * Why this exists (zero-gap policy):
 *   Reasoning models (Nemotron, Qwen3, Gemma-thinking, …) sometimes emit
 *   their chain-of-thought wrapped in tags like <think>…</think> or
 *   <reasoning>…</reasoning> directly inside `content`. The system prompt
 *   forbids it, but prompts are not guarantees. If raw reasoning ever
 *   reached the chat bubble it would look broken and destroy user trust.
 *
 * Two layers:
 *   - stripThinkBlocks(text)      — non-streaming: regex strip + trim.
 *   - ThinkStreamFilter           — streaming: stateful filter that handles
 *     tags SPLIT ACROSS CHUNKS (e.g. one chunk ends with "<thi", the next
 *     starts with "nk>"). Keeps a small hold-back buffer so partial tag
 *     prefixes are never emitted prematurely.
 *
 * Unclosed tags: if a model runs out of tokens INSIDE a think block, the
 * filter drops everything after the opening tag — the (empty) result then
 * flows into the existing zero-content guards, which move on to the next
 * model in the cascade. Exactly the behavior we want.
 */

const OPEN_TAGS = ["<think>", "<reasoning>"] as const;
const CLOSE_TAGS = ["</think>", "</reasoning>"] as const;

const MAX_OPEN_TAG_LEN = Math.max(...OPEN_TAGS.map((t) => t.length));
const MAX_CLOSE_TAG_LEN = Math.max(...CLOSE_TAGS.map((t) => t.length));

/** Non-streaming strip: remove every complete think/reasoning block. */
export function stripThinkBlocks(text: string): string {
  if (!text) return "";
  let out = text;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const open of OPEN_TAGS) {
      const close = "</" + open.slice(1);
      for (;;) {
        const start = out.toLowerCase().indexOf(open);
        if (start === -1) break;
        const end = out.toLowerCase().indexOf(close, start + open.length);
        if (end === -1) {
          // Unclosed block: drop everything from the opening tag onward.
          out = out.slice(0, start);
          changed = true;
          break;
        }
        out = out.slice(0, start) + out.slice(end + close.length);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out.trim();
}

/**
 * Longest suffix of `tail` (up to `maxLen` chars) that is a prefix of any
 * pending tag. This tells the filter how many chars to HOLD BACK because
 * they might be the beginning of a tag arriving split across chunks.
 */
function holdBackLen(tail: string, tags: readonly string[], maxLen: number): number {
  const window = tail.slice(-maxLen);
  for (let len = Math.min(window.length, maxLen); len > 0; len--) {
    const suffix = window.slice(window.length - len);
    const lowered = suffix.toLowerCase();
    for (const tag of tags) {
      if (tag.startsWith(lowered)) return len;
    }
  }
  return 0;
}

export class ThinkStreamFilter {
  private buffer = "";
  private inside = false;
  private sawAnyOutput = false;

  /** Feed one delta; returns the safe text that may be emitted now. */
  push(delta: string): string {
    this.buffer += delta;
    let out = "";

    for (;;) {
      if (!this.inside) {
        const lowered = this.buffer.toLowerCase();
        let openIdx = -1;
        let openTag = "";
        for (const t of OPEN_TAGS) {
          const idx = lowered.indexOf(t);
          if (idx !== -1 && (openIdx === -1 || idx < openIdx)) {
            openIdx = idx;
            openTag = t;
          }
        }
        if (openIdx !== -1) {
          out += this.buffer.slice(0, openIdx);
          this.buffer = this.buffer.slice(openIdx + openTag.length);
          this.inside = true;
          continue; // re-scan inside the block
        }
        // No full opening tag — emit everything except a possible partial
        // tag prefix sitting at the very end of the buffer.
        const hold = holdBackLen(this.buffer, OPEN_TAGS, MAX_OPEN_TAG_LEN);
        const emit = this.buffer.slice(0, this.buffer.length - hold);
        if (emit) {
          out += emit;
          this.sawAnyOutput = true;
          this.buffer = this.buffer.slice(this.buffer.length - hold);
        }
        break;
      }

      // Inside a think block: look for the matching close tag.
      const lowered = this.buffer.toLowerCase();
      let closeIdx = -1;
      let closeTag = "";
      for (const t of CLOSE_TAGS) {
        const idx = lowered.indexOf(t);
        if (idx !== -1 && (closeIdx === -1 || idx < closeIdx)) {
          closeIdx = idx;
          closeTag = t;
        }
      }
      if (closeIdx !== -1) {
        this.buffer = this.buffer.slice(closeIdx + closeTag.length);
        this.inside = false;
        continue;
      }
      // Still inside — keep only a possible partial close-tag prefix.
      const hold = holdBackLen(this.buffer, CLOSE_TAGS, MAX_CLOSE_TAG_LEN);
      this.buffer = this.buffer.slice(this.buffer.length - hold);
      break;
    }

    return out;
  }

  /**
   * End of stream. Emits any safely-buffered tail. If the stream ended
   * INSIDE an unclosed think block, everything buffered is reasoning —
   * drop it (the empty output then triggers the zero-content guards).
   */
  flush(): string {
    if (this.inside) {
      this.buffer = "";
      return "";
    }
    // At stream end a partial-tag lookalike can no longer be completed —
    // but do not emit something that LOOKS like a dangling tag fragment.
    const rest = this.buffer;
    this.buffer = "";
    if (rest && holdBackLen(rest, OPEN_TAGS, MAX_OPEN_TAG_LEN) === rest.length) {
      return ""; // entire remainder is a tag prefix fragment — drop it
    }
    if (rest) this.sawAnyOutput = true;
    return rest;
  }

  /** Whether any user-visible content was emitted (zero-content guards). */
  get sawOutput(): boolean {
    return this.sawAnyOutput;
  }
}
