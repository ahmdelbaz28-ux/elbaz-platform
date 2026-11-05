/**
 * YouTube IFrame Player API loader — client-side singleton.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The embedded lesson player needs the official widget API so the site can
 * know play/pause/ended (heartbeat watch-time tracking + completion marking
 * — the same contract the self-hosted <video> player had). The API script is
 * loaded once per page from https://www.youtube.com/iframe_api (allowed by
 * CSP script-src) and resolves to a minimal typed surface — no extra npm dep.
 */

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  destroy(): void;
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getPlayerState(): number;
  loadVideoById(videoId: string): void;
}

export interface YTPlayerEvent {
  target: YTPlayer;
  data: number;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement | string,
    config: {
      videoId: string;
      host?: string;
      // "100%" keeps the created iframe fluid — without it the widget
      // hardcodes width/height attributes (640×360) and phones must crop it.
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: YTPlayerEvent) => void;
        onStateChange?: (event: YTPlayerEvent) => void;
        onError?: (event: YTPlayerEvent) => void;
      };
    },
  ) => YTPlayer;
  PlayerState: {
    UNSTARTED: number;
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** YT.PlayerState codes we care about (stable public contract). */
export const YT_STATE = {
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
} as const;

const API_SRC = "https://www.youtube.com/iframe_api";

let loaderPromise: Promise<YTNamespace> | null = null;

/**
 * Load (or wait for) the IFrame API exactly once. Rejects after the timeout
 * so the player can render its fallback UI instead of hanging forever.
 */
export function loadYouTubeIframeApi(timeoutMs = 20_000): Promise<YTNamespace> {
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise<YTNamespace>((resolve, reject) => {
    // Already present (another mount loaded it earlier)?
    if (typeof window !== "undefined" && window.YT?.Player) {
      resolve(window.YT);
      return;
    }

    const timer = setTimeout(() => {
      // Do not cache the rejection — a retry (next mount) may succeed.
      loaderPromise = null;
      reject(new Error("YouTube IFrame API load timed out"));
    }, timeoutMs);

    const settle = (ns: YTNamespace | undefined) => {
      clearTimeout(timer);
      if (ns?.Player) {
        resolve(ns);
      } else {
        loaderPromise = null;
        reject(new Error("YouTube IFrame API failed to initialize"));
      }
    };

    if (typeof window === "undefined") {
      reject(new Error("YouTube IFrame API requires a browser"));
      return;
    }

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try {
        previous?.();
      } catch {
        // A stale callback from another consumer must not break ours.
      }
      settle(window.YT);
    };

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${API_SRC}"]`);
    if (!existing) {
      const script = document.createElement("script");
      script.src = API_SRC;
      script.async = true;
      script.addEventListener("error", () => {
        clearTimeout(timer);
        loaderPromise = null;
        reject(new Error("YouTube IFrame API script failed to load"));
      });
      document.head.appendChild(script);
    }
  });

  return loaderPromise;
}
