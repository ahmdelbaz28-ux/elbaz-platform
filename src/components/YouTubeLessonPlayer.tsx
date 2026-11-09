/**
 * YouTubeLessonPlayer — embedded nocookie YouTube player for playlist-synced lessons.
 *
 * WHY an iframe: the lessons ARE the channel's public YouTube videos; embedding
 * keeps the viewer inside the platform (tracking, certificates, credibility)
 * while YouTube serves the bytes — zero storage cost, zero bandwidth cost.
 *
 * Tracking contract (same as the R2 player):
 *  - heartbeat every 60s while playing (watchedSeconds + lastPosition)
 *  - flush on pause / tab-hidden / unmount (partial seconds, never double-counted)
 *  - ENDED → markWatched → parent refetches enrollment/certificate state
 *  - resume: cue to the saved position (>5s) when the API player is ready
 *
 * Degradation: if the IFrame API never loads (network shim / blocked script),
 * the iframe keeps playing with NO tracking — playback never breaks.
 */

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";

interface YTPlayerLike {
  getCurrentTime: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getPlayerState: () => number;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement | string,
    config: {
      videoId?: string;
      events?: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
      };
    },
  ) => YTPlayerLike;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** States from the IFrame API (numeric contract is stable for a decade+). */
const YT_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2 } as const;

/** Heartbeat cadence — mirrors the R2 player's watch-time accounting. */
const HEARTBEAT_INTERVAL_SECONDS = 60;

/** Load the IFrame API exactly once per document (singleton + 8s timeout). */
function loadYouTubeIframeApi(): Promise<YTNamespace | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.YT?.Player) return Promise.resolve(window.YT);

  return new Promise((resolve) => {
    const settled = (ns: YTNamespace | null) => {
      if (timer) window.clearTimeout(timer);
      resolve(ns);
    };
    const existing = document.querySelector<HTMLScriptElement>("script[data-yt-iframe-api]");
    const timer = window.setTimeout(() => settled(window.YT ?? null), 8000);

    if (existing) return; // another loader in flight — its callback settles us
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.dataset.ytIframeApi = "1";
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      settled(window.YT ?? null);
    };
    document.head.appendChild(script);
  });
}

export interface YouTubeLessonPlayerProps {
  /** Embed URL built server-side (nocookie + enablejsapi + hl=ar + origin). */
  readonly videoUrl: string;
  readonly lessonId: number;
  readonly lessonTitle: string;
  readonly lang: "en" | "ar";
  readonly username?: string;
  /** Fired after the video reaches ENDED and the server marked it watched. */
  readonly onLessonCompleted?: () => void;
}

export default function YouTubeLessonPlayer({
  videoUrl,
  lessonId,
  lessonTitle,
  lang,
  onLessonCompleted,
}: YouTubeLessonPlayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayerLike | null>(null);
  const startedAtRef = useRef<number | null>(null); // timestamp when current play segment began
  const apiReadyRef = useRef(false);
  const completedRef = useRef(false);
  const savedRef = useRef<{ lastPosition: number | null } | undefined>(undefined);
  const [isPlaying, setIsPlaying] = useState(false);

  const heartbeat = trpc.course.heartbeat.useMutation();
  const markWatched = trpc.course.markWatched.useMutation();
  const { data: saved } = trpc.course.getSavedPosition.useQuery(
    { lessonId },
    { enabled: Number.isFinite(lessonId) && lessonId > 0, staleTime: Infinity },
  );

  /** Send the partial watch seconds accumulated since the last flush. */
  const flushPartial = () => {
    if (startedAtRef.current == null) return;
    const seconds = Math.min(300, Math.round((Date.now() - startedAtRef.current) / 1000));
    startedAtRef.current = null;
    if (seconds < 1) return;
    let position = 0;
    try {
      position = Math.round(playerRef.current?.getCurrentTime() ?? 0);
    } catch {
      position = 0;
    }
    heartbeat.mutate({ lessonId, watchedSeconds: seconds, lastPosition: Math.max(0, position) });
  };

  const handleStateChange = (state: number) => {
    if (state === YT_STATE.PLAYING) {
      startedAtRef.current = Date.now();
      setIsPlaying(true);
    } else if (state === YT_STATE.PAUSED) {
      flushPartial();
      setIsPlaying(false);
    } else if (state === YT_STATE.ENDED) {
      flushPartial();
      setIsPlaying(false);
      if (!completedRef.current) {
        completedRef.current = true;
        markWatched.mutate(
          { lessonId },
          { onSuccess: () => onLessonCompleted?.() },
        );
      }
    }
  };

  // Bind the IFrame API to the rendered iframe. The iframe itself is plain
  // markup (works with JS blocked); the API layer only ADDS tracking.
  useEffect(() => {
    let cancelled = false;
    completedRef.current = false;
    apiReadyRef.current = false;

    void loadYouTubeIframeApi().then((YT) => {
      if (cancelled || !YT || !hostRef.current) return;
      // Attach to the EXISTING iframe (never recreate): passing the div would
      // make YT build a fresh default 640×360 iframe that ignores our CSS and
      // overflows narrow screens. An existing iframe with enablejsapi=1 is
      // adopted in place — classes, size and src all stay ours.
      const iframeEl = hostRef.current.querySelector<HTMLIFrameElement>("iframe[data-yt-embed]");
      if (!iframeEl) return;
      try {
        playerRef.current = new YT.Player(iframeEl, {
          events: {
            onReady: () => {
              apiReadyRef.current = true;
              const pos = savedRef.current?.lastPosition ?? 0;
              if (pos > 5) {
                try {
                  playerRef.current?.seekTo(pos, true);
                } catch {
                  // player not cueable yet — resume silently skipped
                }
              }
            },
            onStateChange: (event) => handleStateChange(event.data),
          },
        });
      } catch {
        // API binding failed — the bare iframe keeps playing untracked.
      }
    });

    return () => {
      cancelled = true;
      flushPartial();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, lessonId]);

  // Keep the saved position readable from the onReady closure without
  // re-binding the player on every query update.
  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  // Flush partial watch time when the tab is hidden mid-play.
  useEffect(() => {
    const onHidden = () => {
      if (document.hidden) flushPartial();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  // Heartbeat ticker — only while actually playing.
  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      if (startedAtRef.current != null) flushPartial();
    }, HEARTBEAT_INTERVAL_SECONDS * 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, lessonId]);

  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-black sm:rounded-2xl">
      <div className="relative aspect-video w-full">
        <div ref={hostRef} className="absolute inset-0">
          <iframe
            data-yt-embed="1"
            key={videoUrl}
            src={videoUrl}
            title={lessonTitle}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </div>
      <p className="border-t border-[#1e2d3d] px-3 py-2 text-[11px] text-[#94a3b8] sm:px-4">
        {lang === "ar"
          ? "▶ تشغيل داخل المنصة — التقدم محفوظ تلقائياً. الفيديو من قناة AhmedEtap على يوتيوب."
          : "▶ Playing inside the platform — progress is saved automatically. Video from the AhmedEtap YouTube channel."}
      </p>
    </div>
  );
}
