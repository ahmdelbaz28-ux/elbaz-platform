/**
 * useWatchTracker — Heartbeat-based Watch Time Tracking Hook
 *
 * Tracks how long a user watches a video lesson:
 * - Sends heartbeat to server every 60 seconds while video is playing
 * - Saves current position for "resume from where you stopped"
 * - Sends final update on pause, tab hide, or page leave
 * - Loads saved position on mount (auto-resume)
 *
 * Usage:
 *   const { resumePosition, savedWatchTime } = useWatchTracker({
 *     lessonId: 123,
 *     videoRef: myVideoRef,
 *     enabled: isAuthenticated,
 *   });
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { trpc } from "@/providers/trpc";

interface UseWatchTrackerOptions {
  lessonId: number | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  enabled?: boolean;
  heartbeatIntervalMs?: number;
}

interface UseWatchTrackerReturn {
  resumePosition: number;       // Saved position to resume from (seconds)
  savedWatchTime: number;       // Total previously watched seconds
  isTracking: boolean;          // Whether tracking is currently active
}

export function useWatchTracker({
  lessonId,
  videoRef,
  enabled = true,
  heartbeatIntervalMs = 60000, // 60 seconds default
}: UseWatchTrackerOptions): UseWatchTrackerReturn {
  const [resumePosition, setResumePosition] = useState(0);
  const [savedWatchTime, setSavedWatchTime] = useState(0);
  const [isTracking, setIsTracking] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPositionRef = useRef(0);
  const lastTickRef = useRef<number>(Date.now());
  const isPlayingRef = useRef(false);
  const lessonIdRef = useRef(lessonId);
  const mountedRef = useRef(true);

  // Keep lessonIdRef in sync
  useEffect(() => {
    lessonIdRef.current = lessonId;
  }, [lessonId]);

  // Mutation for sending heartbeat (lightweight — no loading states)
  const heartbeatMutation = trpc.course.heartbeat.useMutation({
    onError: (err) => {
      // Silent fail — don't disrupt the user's video experience
      console.warn("[WatchTracker] Heartbeat failed:", err.message);
    },
  });

  // Load saved position when lesson changes
  const { data: savedProgress } = trpc.course.getSavedPosition.useQuery(
    { lessonId: lessonId || 0 },
    {
      enabled: enabled && !!lessonId && lessonId > 0,
      staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    },
  );

  useEffect(() => {
    if (savedProgress) {
      setResumePosition(savedProgress.lastPosition || 0);
      setSavedWatchTime(savedProgress.watchedSeconds || 0);
    }
  }, [savedProgress]);

  // The core send function
  const sendHeartbeat = useCallback(async () => {
    if (!lessonIdRef.current || !mountedRef.current) return;

    const currentPosition = Math.floor(videoRef.current?.currentTime || 0);
    const now = Date.now();
    const watchedSeconds = Math.floor((now - lastTickRef.current) / 1000);

    // Only send if there's meaningful data (at least 1 second watched)
    if (watchedSeconds < 1 && currentPosition === lastPositionRef.current) return;

    lastPositionRef.current = currentPosition;
    lastTickRef.current = now;

    heartbeatMutation.mutate({
      lessonId: lessonIdRef.current,
      watchedSeconds: Math.min(watchedSeconds, 300), // Cap at 5 minutes per heartbeat (matches server validation)
      lastPosition: currentPosition,
    });
  }, [videoRef, heartbeatMutation]);

  // Start tracking (when video plays)
  const startTracking = useCallback(() => {
    if (timerRef.current) return; // Already tracking
    if (!lessonIdRef.current) return;

    isPlayingRef.current = true;
    lastTickRef.current = Date.now();
    lastPositionRef.current = Math.floor(videoRef.current?.currentTime || 0);
    setIsTracking(true);

    // Send first heartbeat after interval
    timerRef.current = setInterval(sendHeartbeat, heartbeatIntervalMs);
  }, [videoRef, heartbeatIntervalMs, sendHeartbeat]);

  // Stop tracking (when video pauses, tab hides, or page leaves)
  const stopTracking = useCallback(() => {
    isPlayingRef.current = false;
    setIsTracking(false);

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Send final position save
    sendHeartbeat();
  }, [sendHeartbeat]);

  // Watch video play/pause events
  useEffect(() => {
    if (!enabled || !lessonId) return;

    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => startTracking();
    const onPause = () => stopTracking();
    const onEnded = () => stopTracking();
    const onSeeked = () => {
      lastPositionRef.current = Math.floor(video.currentTime);
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("seeked", onSeeked);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("seeked", onSeeked);
    };
  }, [enabled, lessonId, videoRef, startTracking, stopTracking]);

  // Auto-resume: seek to saved position when video loads
  useEffect(() => {
    if (!enabled || !lessonId || !videoRef.current || resumePosition <= 0) return;

    const video = videoRef.current;
    const canAutoResume = resumePosition > 5; // Only resume if > 5 seconds

    if (canAutoResume) {
      const onLoaded = () => {
        // Seek to saved position minus 3 seconds (re-watch a bit for context)
        video.currentTime = Math.max(0, resumePosition - 3);
        // ✅ FIX: Remove listener immediately after firing (was only removed inside
        // the callback, but if loadedmetadata never fires, the listener leaks).
        video.removeEventListener("loadedmetadata", onLoaded);
      };
      video.addEventListener("loadedmetadata", onLoaded);

      // ✅ FIX: Return cleanup function so the listener is removed if the
      // component unmounts before loadedmetadata fires.
      return () => {
        video.removeEventListener("loadedmetadata", onLoaded);
      };
    }
  }, [enabled, lessonId, videoRef, resumePosition]);

  // Save position when tab is hidden (user switches tabs)
  // 🚀 PERFORMANCE + INTEGRITY (Task ID 7): Also PAUSE the video when the tab
  // is hidden. This (a) stops bandwidth waste on R2 presigned URL streaming,
  // (b) prevents the HLS buffer from running ahead and being discarded on
  // return, and (c) ensures watch-time tracking reflects actual viewing —
  // critical for certificate eligibility (courses require N minutes watched).
  useEffect(() => {
    if (!enabled || !lessonId) return;

    const handleVisibilityChange = () => {
      if (document.hidden && isPlayingRef.current) {
        // Tab hidden while playing — pause the video and save position.
        // We pause via the video element directly (not via the player UI) so
        // the user's play button state stays in sync when they return.
        const video = videoRef.current;
        if (video && !video.paused) {
          video.pause();
        }
        sendHeartbeat();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [enabled, lessonId, sendHeartbeat, videoRef]);

  // Save position when page is about to unload (navigation, close)
  useEffect(() => {
    if (!enabled || !lessonId) return;

    const handleBeforeUnload = () => {
      if (isPlayingRef.current) {
        // Use sendBeacon for reliability during page unload
        const currentPosition = Math.floor(videoRef.current?.currentTime || 0);
        const watchedSeconds = Math.floor((Date.now() - lastTickRef.current) / 1000);

        if (lessonIdRef.current && (watchedSeconds >= 1 || currentPosition !== lastPositionRef.current)) {
          const blob = new Blob([JSON.stringify({
            lessonId: lessonIdRef.current,
            watchedSeconds: Math.min(watchedSeconds, 120),
            lastPosition: currentPosition,
          })], { type: "application/json" });
          const baseUrl = (window as any).Capacitor?.isNativePlatform?.() ? (import.meta.env.VITE_API_URL || "https://ahmedelbaz.qzz.io") : "";
          navigator.sendBeacon?.(`${baseUrl}/api/trpc/course.heartbeat`, blob);
        }
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [enabled, lessonId, videoRef]);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return { resumePosition, savedWatchTime, isTracking };
}
