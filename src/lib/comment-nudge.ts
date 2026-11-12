/**
 * Comment-nudge — one-time, per-video "leave a comment on YouTube" state.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner contract: the viewer is ENCOURAGED (never forced) to comment on the
 * lesson's YouTube watch page, in a way that never annoys:
 *   • shown at most ONCE per video per device,
 *   • a slim inline strip under the player — no modal, no overlay, no
 *     interstitial, playback is never blocked,
 *   • dismissed (X) or opened (commented) → never shown again for that video.
 *
 * YouTube offers no way to VERIFY a viewer commented without a full OAuth
 * round-trip + comment scraping, so — honestly — the nudge is pure
 * encouragement, exactly like the subscribe gate enforces the flow.
 *
 * Pure, dependency-free, private-browsing safe: every accessor is guarded and
 * a throwing store simply means "never nudge", the polite default.
 */

const STORAGE_KEY = "elbaz-comment-nudge";

export type CommentNudgeAction = "opened" | "dismissed";

type NudgeMap = Record<string, { action: CommentNudgeAction; at: number }>;

function readMap(): NudgeMap {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as NudgeMap | null;
    if (!parsed || typeof parsed !== "object") return {};
    // Drop entries with unexpected shapes so one bad write can't wedge state.
    const clean: NudgeMap = {};
    for (const [id, v] of Object.entries(parsed)) {
      if (
        typeof id === "string" && id &&
        v && typeof v === "object" &&
        (v.action === "opened" || v.action === "dismissed") &&
        typeof v.at === "number"
      ) {
        clean[id] = { action: v.action, at: v.at };
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function writeMap(map: NudgeMap): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Private mode — the nudge simply shows again next session. Acceptable.
  }
}

/** Has the viewer already handled (opened/dismissed) the nudge for this video? */
export function commentNudgeState(videoId: string): CommentNudgeAction | "new" {
  if (!videoId) return "new";
  const entry = readMap()[videoId];
  return entry ? entry.action : "new";
}

/** Record that the viewer clicked «علّق على اليوتيوب» (or dismissed it). */
export function markCommentNudge(videoId: string, action: CommentNudgeAction, now: number = Date.now()): void {
  if (!videoId) return;
  const map = readMap();
  map[videoId] = { action, at: now };
  writeMap(map);
}

/** Forget one video's nudge state (admin/reset/test lever). */
export function clearCommentNudge(videoId: string): void {
  try {
    if (!videoId) return;
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as NudgeMap | null;
    if (!parsed || typeof parsed !== "object") return;
    delete parsed[videoId];
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // nothing to clear
  }
}
