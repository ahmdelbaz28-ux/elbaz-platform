/**
 * SCREEN SHARE MANAGER — live "teacher beside you" vision for the chat bot.
 *
 * The user opens an engineering program (ETAP, SKM, PowerFactory…) on their
 * computer and taps the share button in the chat. The browser's
 * getDisplayMedia picker lets them choose the program window; from that
 * moment every message the user sends carries a FRESH frame of what is
 * actually on their screen, so the bot reads the real UI (menus, buttons,
 * field values) and guides them step by step — never from memory, never
 * guessed.
 *
 * Design contract:
 *  - EXPLICIT user consent: capture starts only through the browser's own
 *    picker (a user gesture) and is visible in the browser's sharing bar.
 *  - SNAPSHOT-ON-DEMAND: no continuous streaming, no recording — a frame is
 *    captured to a canvas only at send time (and a tiny 220px thumb at 2fps
 *    for the live preview while the chat is open). Nothing is stored.
 *  - HONESTY: if the track is gone (user pressed "Stop sharing") the state
 *    flips to idle immediately and no frame is ever synthesized — a capture
 *    attempt returns null and the caller sends text-only with a notice.
 *  - Framework-free singleton + subscribe/getSnapshot → consumed from React
 *    via useSyncExternalStore with zero re-render coupling.
 */

// ─── Public state ────────────────────────────────────────────────────────────

export type ScreenShareStatus = "idle" | "starting" | "active";

export interface ScreenShareState {
  status: ScreenShareStatus;
  /** Browser-reported label of the picked window/screen (may be empty). */
  label: string;
  /** Native video dimensions (0 until metadata is ready). */
  width: number;
  height: number;
}

export interface ScreenShareStartResult {
  ok: boolean;
  /** present only when ok=false */
  reason?: "unsupported" | "denied" | "failed" | "not-live";
}

/** A captured frame ready for the vision pipeline (same shape as a file
 *  attachment plus the screen source tag the server validates). */
export interface ScreenFrame {
  dataUrl: string;
  thumb: string;
  source: "screen_capture";
  width: number;
  height: number;
}

// ─── Module state ────────────────────────────────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();

let state: ScreenShareState = { status: "idle", label: "", width: 0, height: 0 };
let stream: MediaStream | null = null;
let video: HTMLVideoElement | null = null;

function setState(patch: Partial<ScreenShareState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

/** React store contract — the snapshot object is stable between changes. */
export function getScreenShareState(): ScreenShareState {
  return state;
}

export function subscribeScreenShare(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Feature detection — getDisplayMedia needs a secure context (HTTPS) and a
 *  browser that implements it (desktop Chrome/Edge/Firefox/Safari; Chrome
 *  Android ≥11). Unsupported clients simply never see the button. */
export function screenShareSupported(): boolean {
  try {
    return typeof window !== "undefined"
      && window.isSecureContext === true
      && !!navigator.mediaDevices
      && typeof navigator.mediaDevices.getDisplayMedia === "function";
  } catch {
    return false;
  }
}

// ─── Start / stop ────────────────────────────────────────────────────────────

/** 1×1 invisible holder — some engines (desktop Safari) refuse to decode a
 *  video element that is not attached to the document. */
const VIDEO_HOLDER_CSS = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;";

function waitForVideoReady(v: HTMLVideoElement, timeoutMs: number): Promise<boolean> {
  if (v.readyState >= 2 && v.videoWidth > 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      v.removeEventListener("loadeddata", onLoad);
      clearTimeout(timer);
      resolve(ok);
    };
    const onLoad = () => done(v.videoWidth > 0);
    v.addEventListener("loadeddata", onLoad, { once: true });
    const timer = setTimeout(() => done(v.readyState >= 2 && v.videoWidth > 0), timeoutMs);
  });
}

function teardown(): void {
  if (stream) {
    for (const t of stream.getTracks()) t.stop();
    stream = null;
  }
  if (video) {
    video.srcObject = null;
    video.remove();
    video = null;
  }
}

/**
 * Open the browser share picker and start capturing the picked surface.
 * Resolves fast; the returned reason maps 1:1 to a localized user toast.
 */
export async function startScreenShare(): Promise<ScreenShareStartResult> {
  if (!screenShareSupported()) return { ok: false, reason: "unsupported" };
  if (state.status === "active" || state.status === "starting") return { ok: true };

  setState({ status: "starting" });
  try {
    // audio:false — the vision pipeline reads FRAMES only; microphone audio
    // would widen the privacy surface for zero product value.
    const media = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 8, max: 15 } },
      audio: false,
    });
    const track = media.getVideoTracks()[0];
    if (!track) {
      for (const t of media.getTracks()) t.stop();
      setState({ status: "idle" });
      return { ok: false, reason: "not-live" };
    }

    stream = media;
    video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("aria-hidden", "true");
    video.style.cssText = VIDEO_HOLDER_CSS;
    video.srcObject = media;
    document.body.appendChild(video);
    try { await video.play(); } catch { /* play() rejection is non-fatal — the click gesture satisfies autoplay; readiness is re-checked at capture time */ }

    const ready = await waitForVideoReady(video, 2500);
    const settings = track.getSettings();
    const w = video.videoWidth || settings.width || 0;
    const h = video.videoHeight || settings.height || 0;
    if (!ready || !w || !h) {
      teardown();
      setState({ status: "idle" });
      return { ok: false, reason: "failed" };
    }

    // The browser's own "Stop sharing" bar (or OS ending the capture) —
    // the UI must flip to idle the moment the track dies.
    track.addEventListener("ended", () => {
      teardown();
      setState({ status: "idle", label: "", width: 0, height: 0 });
    });

    setState({ status: "active", label: track.label || "", width: w, height: h });
    return { ok: true };
  } catch (err) {
    teardown();
    setState({ status: "idle" });
    const name = (err as DOMException | null)?.name;
    if (name === "NotAllowedError") return { ok: false, reason: "denied" };
    return { ok: false, reason: "failed" };
  }
}

/** Explicit stop from our UI. Idempotent; never throws. */
export function stopScreenShare(): void {
  teardown();
  if (state.status !== "idle") {
    setState({ status: "idle", label: "", width: 0, height: 0 });
  }
}

// ─── Frame capture ───────────────────────────────────────────────────────────

// Longest-edge ladder: engineering-program UI text (menus, field labels)
// stays OCR-readable at 1440px; each step re-encodes until the base64 data
// URL fits the same 300KB budget the attachment path uses (the server caps a
// single image part at 450K chars — this stays safely below it).
const SCREEN_MAX_DIM_STEPS: readonly number[] = [1440, 1152, 896, 640];
const SCREEN_QUALITY_STEPS: readonly number[] = [0.82, 0.72, 0.62, 0.55];
const SCREEN_DATAURL_BUDGET = 300_000;
const SCREEN_THUMB_DIM = 220;

function drawVideoToDataUrl(v: HTMLVideoElement, maxDim: number, quality: number): string {
  const w0 = v.videoWidth;
  const h0 = v.videoHeight;
  const scale = Math.min(1, maxDim / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas-unavailable");
  ctx.drawImage(v, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

/** True only while a live track is actually decoding frames. */
function liveVideoReady(): HTMLVideoElement | null {
  if (state.status !== "active" || !stream || !video) return null;
  const track = stream.getVideoTracks()[0];
  if (!track || track.readyState !== "live") return null;
  if (video.readyState < 2 || !video.videoWidth) return null;
  return video;
}

/**
 * Capture the CURRENT screen frame for the vision pipeline.
 * Returns null when sharing is not active or the frame is not decodable —
 * the caller then sends text-only and tells the user honestly. Never throws.
 */
export function captureScreenFrame(): ScreenFrame | null {
  const v = liveVideoReady();
  if (!v) return null;
  try {
    let dataUrl = "";
    for (let i = 0; i < SCREEN_MAX_DIM_STEPS.length; i++) {
      dataUrl = drawVideoToDataUrl(v, SCREEN_MAX_DIM_STEPS[i], SCREEN_QUALITY_STEPS[i]);
      if (dataUrl.length <= SCREEN_DATAURL_BUDGET) break;
    }
    const thumb = drawVideoToDataUrl(v, SCREEN_THUMB_DIM, 0.6);
    return { dataUrl, thumb, source: "screen_capture", width: v.videoWidth, height: v.videoHeight };
  } catch {
    return null;
  }
}

/** Tiny preview frame for the live share bar (~2fps, 220px, no budget loop). */
export function captureScreenPreview(): string | null {
  const v = liveVideoReady();
  if (!v) return null;
  try {
    return drawVideoToDataUrl(v, SCREEN_THUMB_DIM, 0.5);
  } catch {
    return null;
  }
}
