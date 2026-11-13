/**
 * CommentNudge — the one-time, per-video "leave a comment on YouTube"
 * invitation. ═══════════════════════════════════════════════════════════════
 *
 * Owner contract: encourage commenting in a way that NEVER annoys —
 *   • a slim inline strip UNDER the player (page flow, not an overlay/modal),
 *     so playback is never blocked and the layout never jumps,
 *   • appears quietly after `showAfterMs` (default 15 s) of the lesson being
 *     open — never a pop-up the moment the video starts,
 *   • shown at most ONCE per video per device: clicking «علّق» (opens the
 *     video's YouTube watch page, where the comment box lives) or «X»
 *     (dismiss) both retire it for that video permanently — see
 *     src/lib/comment-nudge.ts.
 *
 * The button opens the watch URL in a new tab (noopener) — commenting
 * physically happens on YouTube; there is no embeddable comment composer.
 */
import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { buildYouTubeWatchUrl } from "@/lib/youtube-url";
import { commentNudgeState, markCommentNudge } from "@/lib/comment-nudge";
import { trackEvent } from "@/lib/clarity";

interface CommentNudgeProps {
  readonly videoId: string;
  readonly lang: "en" | "ar";
  /** Quiet-start delay before the strip appears (ms). */
  readonly showAfterMs?: number;
}

export default function CommentNudge({ videoId, lang, showAfterMs = 15_000 }: CommentNudgeProps) {
  const isAr = lang === "ar";
  // "hidden" → (quiet delay, still "new") → "visible" → handled → gone for good.
  const [phase, setPhase] = useState<"hidden" | "visible">("hidden");

  useEffect(() => {
    // Per-video reset is free: the parent mounts us fresh per lesson
    // (key={videoId}), so phase starts "hidden" every time. The quiet-delay
    // timer is the only path to "visible"; we re-check the stored state at
    // show time because the viewer may have handled it in another tab.
    const timer = setTimeout(() => {
      if (commentNudgeState(videoId) === "new") {
        trackEvent("comment_nudge_shown", { videoId });
        setPhase("visible");
      }
    }, Math.max(0, showAfterMs));
    return () => clearTimeout(timer);
  }, [videoId, showAfterMs]);

  if (phase !== "visible") return null;

  const openComments = () => {
    trackEvent("comment_nudge_open", { videoId });
    markCommentNudge(videoId, "opened");
    globalThis.open(buildYouTubeWatchUrl(videoId), "_blank", "noopener,noreferrer");
    setPhase("hidden");
  };

  const dismiss = () => {
    trackEvent("comment_nudge_dismiss", { videoId });
    markCommentNudge(videoId, "dismissed");
    setPhase("hidden");
  };

  return (
    <aside
      className="flex items-center justify-between gap-3 border-t border-[#1f2d44] bg-[rgba(6,182,212,0.06)] px-3 py-2.5"
      data-testid="comment-nudge"
      aria-label={isAr ? "دعوة لكتابة تعليق على اليوتيوب" : "Invitation to comment on YouTube"}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgba(6,182,212,0.14)]">
          <MessageCircle className="h-4 w-4 text-[#22d3ee]" aria-hidden="true" />
        </span>
        <p className="min-w-0 text-xs leading-relaxed text-[#94a3b8]">
          {isAr ? (
            <>
              عجبك الدرس؟{" "}
              <span className="font-semibold text-[#cbd5e1]">سيب تعليق على اليوتيوب</span>{" "}
              — تعليقك بيساعدنا نوصل بالشرح لأكتر عدد من الطلبة.
            </>
          ) : (
            <>
              Enjoying the lesson?{" "}
              <span className="font-semibold text-[#cbd5e1]">Leave a comment on YouTube</span>{" "}
              — it helps the lesson reach more students.
            </>
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={openComments}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#06b6d4] to-[#0891b2] px-3 py-1.5 text-xs font-bold text-[#04121c] transition-transform hover:scale-[1.03] active:scale-[0.99]"
          data-testid="comment-nudge-open"
        >
          <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
          {isAr ? "علّق على اليوتيوب" : "Comment on YouTube"}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#64748b] transition-colors hover:bg-[rgba(100,116,139,0.15)] hover:text-[#94a3b8]"
          aria-label={isAr ? "إخفاء الدعوة" : "Dismiss"}
          data-testid="comment-nudge-dismiss"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
