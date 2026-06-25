/**
 * HLS Video Loader — Isolated module to prevent minifier variable collisions.
 *
 * Problem: Vite's bundler (Rollup+esbuild) can produce temporal dead zone errors
 * when const declarations in module scope collide after minification.
 * Solution: Keep HLS.js as a static import in its own module chunk,
 * preventing any variable name collision with CourseCard or other components.
 */

import Hls from "hls.js";

export interface HlsLoadOptions {
  video: HTMLVideoElement;
  sourceUrl: string;
  fallbackUrl: string;
}

export function loadHlsVideo({ video, sourceUrl, fallbackUrl }: HlsLoadOptions): { destroy: () => void } {
  if (Hls.isSupported()) {
    const player = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      startLevel: -1,
    });

    player.loadSource(sourceUrl);
    player.attachMedia(video);

    player.on(Hls.Events.MANIFEST_PARSED, () => {
      // Video ready to play
    });

    player.on(Hls.Events.ERROR, (_event: unknown, data: { fatal: boolean; type: string }) => {
      if (data.fatal) {
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          player.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          player.recoverMediaError();
        } else {
          player.destroy();
          video.src = fallbackUrl;
        }
      }
    });

    return {
      destroy: () => {
        player.destroy();
      },
    };
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    // Safari native HLS
    video.src = sourceUrl;
    return { destroy: () => {} };
  } else {
    // No HLS support — fall back to direct src
    video.src = fallbackUrl;
    return { destroy: () => {} };
  }
}
