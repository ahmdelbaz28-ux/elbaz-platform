/**
 * YouTubeLessonPlayer — embedded YouTube playback inside the site's player
 * screen. ═══════════════════════════════════════════════════════════════════
 *
 * The lesson's video streams from the channel's YouTube playlist; NOTHING is
 * hosted on (or proxied through) our server. The viewer never leaves the
 * site: the iframe fills the same aspect-video slot the self-hosted player
 * used, with YouTube's own controls inside the frame.
 *
 * Watch-tracking parity with the R2 player (useWatchTracker contract):
 *   PLAYING  → heartbeat timer every 60s → course.heartbeat(watchedSeconds, lastPosition)
 *   PAUSED   → stop + final heartbeat
 *   ENDED    → stop + course.markWatched (once) → lesson completed → certificate
 *   tab hide → pause the video + final heartbeat (integrity + bandwidth)
 *   onReady  → auto-resume from the saved position (same >5s rule)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { trackEvent } from "@/lib/clarity";
import CommentNudge from "@/components/CommentNudge";
import { buildYouTubeWatchUrl } from "@/lib/youtube-url";
import { sendHeartbeatBeacon } from "@/lib/watch-beacon";
import {
  loadYouTubeIframeApi,
  YT_STATE,
  type YTPlayer,
} from "@/lib/youtube-player-api";

interface YouTubeLessonPlayerProps {
  readonly videoId: string;
  readonly lessonId?: number;
  readonly courseId?: number;
  readonly lessonTitle: string;
  readonly lang: "en" | "ar";
  readonly isTrackingEnabled?: boolean;
  readonly heartbeatIntervalMs?: number;
  /** Fired when the video ends and the server marks the lesson complete. */
  readonly onLessonCompleted?: () => void;
}

export default function YouTubeLessonPlayer({
  videoId,
  lessonId,
  courseId,
  lessonTitle,
  lang,
  isTrackingEnabled,
  heartbeatIntervalMs = 60_000,
  onLessonCompleted,
}: YouTubeLessonPlayerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Same pattern as useWatchTracker: lazy-set inside effects/handlers (React
  // Compiler purity rule — no Date.now() in ref initializers).
  const lastTickRef = useRef(0);
  const lastPositionRef = useRef(0);
  const isPlayingRef = useRef(false);
  const lessonIdRef = useRef<number | undefined>(lessonId);
  const completedLessonRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    lessonIdRef.current = lessonId;
  }, [lessonId]);

  const onLessonCompletedRef = useRef(onLessonCompleted);
  useEffect(() => {
    onLessonCompletedRef.current = onLessonCompleted;
  }, [onLessonCompleted]);

  // ── Heartbeat mutations (silent-fail, same contract as useWatchTracker) ──
  const heartbeatMutation = trpc.course.heartbeat.useMutation({
    onError: (err) => console.warn("[YTPlayer] heartbeat failed:", err.message),
  });
  const markWatchedMutation = trpc.course.markWatched.useMutation({
    onSuccess: () => onLessonCompletedRef.current?.(),
    onError: (err) => console.warn("[YTPlayer] markWatched failed:", err.message),
  });

  const { data: savedProgress } = trpc.course.getSavedPosition.useQuery(
    { lessonId: lessonId || 0 },
    { enabled: !!isTrackingEnabled && !!lessonId && lessonId > 0, staleTime: 5 * 60 * 1000 },
  );

  const sendHeartbeat = useCallback(() => {
    if (!lessonIdRef.current) return;
    const player = playerRef.current;
    const currentPosition = Math.floor(player?.getCurrentTime() || 0);
    const now = Date.now();
    const watchedSeconds = Math.floor((now - lastTickRef.current) / 1000);
    if (watchedSeconds < 1 && currentPosition === lastPositionRef.current) return;

    lastPositionRef.current = currentPosition;
    lastTickRef.current = now;
    heartbeatMutation.mutate({
      lessonId: lessonIdRef.current,
      watchedSeconds: Math.min(watchedSeconds, 300), // server caps at 5 min/beat
      lastPosition: currentPosition,
    });
  }, [heartbeatMutation]);

  const startTracking = useCallback(() => {
    if (timerRef.current || !lessonIdRef.current) return;
    isPlayingRef.current = true;
    lastTickRef.current = Date.now();
    lastPositionRef.current = Math.floor(playerRef.current?.getCurrentTime() || 0);
    timerRef.current = setInterval(sendHeartbeat, heartbeatIntervalMs);
  }, [heartbeatIntervalMs, sendHeartbeat]);

  const stopTracking = useCallback(() => {
    isPlayingRef.current = false;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    sendHeartbeat();
  }, [sendHeartbeat]);

  // ── Player lifecycle: create once on mount, destroy on unmount ──
  // The parent mounts this component with key={videoId} — a new video always
  // remounts fresh (React's endorsed pattern), so no in-effect state resets.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot per mount by design (key={videoId} remount) — listing courseId/mutation/callbacks would tear down and rebuild the live YT player mid-playback
  useEffect(() => {
    let cancelled = false;

    void loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled || !mountRef.current) return;
        playerRef.current = new YT.Player(mountRef.current, {
          videoId,
          host: "https://www.youtube-nocookie.com",
          // MOBILE FIX: the widget replaces the mount div with an <iframe>
          // carrying its attributes. Without these it defaults to 640×360,
          // overflowing (and getting cropped by) the 16:9 screen on phones.
          // The CSS rule on [data-youtube-player] iframe enforces the same
          // fit independently of the API's behaviour.
          width: "100%",
          height: "100%",
          playerVars: {
            rel: 0,
            playsinline: 1,
            modestbranding: 1,
            cc_load_policy: 1,
            hl: "ar",
            // enablejsapi/origin are set automatically by the widget API
            // from this host config — no need to pass them here.
          },
          events: {
            onReady: () => {
              if (cancelled) return;
              setReady(true);
            },
            onStateChange: (event) => {
              if (cancelled) return;
              switch (event.data) {
                case YT_STATE.PLAYING:
                  trackEvent("video_play", {
                    lessonId: lessonIdRef.current || 0,
                    courseId: courseId || 0,
                    lessonTitle,
                    source: "youtube",
                  });
                  startTracking();
                  break;
                case YT_STATE.PAUSED:
                case YT_STATE.BUFFERING:
                  if (event.data === YT_STATE.PAUSED) stopTracking();
                  break;
                case YT_STATE.ENDED: {
                  stopTracking();
                  const id = lessonIdRef.current;
                  if (id && completedLessonRef.current !== id) {
                    completedLessonRef.current = id;
                    markWatchedMutation.mutate({ lessonId: id });
                  }
                  break;
                }
                default:
                  break;
              }
            },
            onError: () => {
              if (!cancelled) setFailed(true);
            },
          },
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.warn("[YTPlayer] API unavailable:", err instanceof Error ? err.message : err);
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      try {
        playerRef.current?.destroy();
      } catch {
        // already destroyed by a re-render race — nothing to do
      }
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  // Auto-resume from the saved position (same >5s rule as the R2 player).
  // ✅ ROOT-CURE (resume race): the old effect listed only [ready, lessonId],
  // so when the progress query resolved AFTER the player became ready (slow
  // network / cold cache) the effect never re-ran and the lesson silently
  // restarted from 0:00. Guarded by resumedLessonRef, the effect now runs
  // exactly ONCE per lesson with whatever data is present — first of
  // (ready ∧ progress) wins, later refetches never re-seek mid-playback.
  const resumedLessonRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!ready) return;
    if (resumedLessonRef.current === lessonId) return;
    resumedLessonRef.current = lessonId;
    const resume = savedProgress?.lastPosition;
    if (resume && resume > 5) {
      playerRef.current?.seekTo(Math.max(0, resume - 3), true);
    }
  }, [ready, lessonId, savedProgress?.lastPosition]);

  // Tab hidden → pause + final heartbeat (same integrity rule as R2 path).
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && isPlayingRef.current) {
        try {
          playerRef.current?.pauseVideo();
        } catch {
          // player already gone — heartbeat below still runs
        }
        sendHeartbeat();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [sendHeartbeat]);

  // Page unload → sendBeacon final save (mirrors the R2 player path).
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!isPlayingRef.current || !lessonIdRef.current) return;
      const currentPosition = Math.floor(playerRef.current?.getCurrentTime() || 0);
      const watchedSeconds = Math.floor((Date.now() - lastTickRef.current) / 1000);
      if (watchedSeconds >= 1 || currentPosition !== lastPositionRef.current) {
        // ✅ ROOT-CURE (2026-11-13): the beacon now carries the superjson
        // envelope tRPC parses — the raw JSON body was silently discarded
        // (input parse failure) and the final ≤60s of progress never saved.
        sendHeartbeatBeacon({
          lessonId: lessonIdRef.current,
          watchedSeconds: Math.min(watchedSeconds, 120),
          lastPosition: currentPosition,
        });
      }
    };
    globalThis.addEventListener("beforeunload", handleBeforeUnload);
    return () => globalThis.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const watchLink = buildYouTubeWatchUrl(videoId);

  return (
    <div
      className="relative bg-black"
      role="application"
      aria-label={lang === "en" ? "Embedded YouTube lesson player" : "مشغل درس مدمج من يوتيوب"}
      data-youtube-player={videoId}
    >
      {/* Screen zone (16:9) — mount + overlays live INSIDE this relative box
          so a fallback never covers the provenance strip below. */}
      <div className="relative aspect-video w-full overflow-hidden">
        {/* Mount target — the widget API replaces this div with the iframe. */}
        <div ref={mountRef} className="h-full w-full" />

        {!ready && !failed && (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#0f172a] to-[#1e293b]">
            <p className="text-sm text-[#94a3b8]">
              {lang === "en" ? "Preparing the video..." : "بتجهّز الشاشة..."}
            </p>
          </div>
        )}

        {failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#0f172a] to-[#1e293b] px-6 text-center">
            <p className="text-sm text-[#94a3b8]">
              {lang === "en"
                ? "The embedded player couldn't load here."
                : "مشغل يوتيوب ماتحمّلش هنا — افتح الفيديو مباشرة:"}
            </p>
            <a
              href={watchLink}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-[rgba(6,182,212,0.15)] px-4 py-2 text-sm font-semibold text-[#22d3ee] transition-colors hover:bg-[rgba(6,182,212,0.25)]"
            >
              {lang === "en" ? "Open on YouTube" : "افتح الفيديو على يوتيوب"}
            </a>
          </div>
        )}
      </div>

      {/* Honest provenance chip — the video plays from the channel's YouTube
          playlist inside the site; keeps the open-internet contract clear. */}
      <div className="flex items-center justify-between gap-2 bg-[rgba(13,20,32,0.85)] px-3 py-1.5">
        <span className="truncate text-[11px] text-[#64748b]">{lessonTitle}</span>
        <a
          href={watchLink}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-[10px] font-medium text-[#64748b] transition-colors hover:text-[#22d3ee]"
        >
          {lang === "en" ? "▶ YouTube" : "▶ يوتيوب"}
        </a>
      </div>

      {/* Owner contract: encourage a YouTube comment — once per video,
          inline under the player, dismissible, never blocking playback. */}
      <CommentNudge videoId={videoId} lang={lang} />
    </div>
  );
}
