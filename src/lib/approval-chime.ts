/**
 * APPROVAL CHIME — the owner's mobile-screen notification sound (2026-11-24).
 *
 * When someone registers and asks to join, the admin's open clients play a
 * short two-tone chime + (on supporting phones) a haptic buzz, alongside the
 * toast and the device-level Notification. Generated with the Web Audio API
 * — no binary asset, no licensing, zero bytes on the wire.
 *
 * Autoplay policies: an AudioContext may start suspended until the page has
 * had a user gesture. Admins always interact before a registration can
 * arrive (they logged in), but we still resume() defensively; if the browser
 * still refuses, the chime is silently skipped (the toast + device
 * notification still fire — the sound must never crash the client).
 */

let ctx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    const AC = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** One soft tone: sine oscillator with a quick attack + exponential decay. */
function tone(ac: AudioContext, freq: number, startAt: number, duration: number, peak: number): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, ac.currentTime + startAt);
  gain.gain.exponentialRampToValueAtTime(peak, ac.currentTime + startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + startAt + duration);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(ac.currentTime + startAt);
  osc.stop(ac.currentTime + startAt + duration + 0.05);
}

/**
 * Two-tone pleasant chime (E5 → A5). Returns false when the browser refused
 * playback (autoplay policy) — callers treat that as "sound skipped", never
 * as an error.
 */
export function playApprovalChime(): boolean {
  const ac = getAudioContext();
  if (!ac || ac.state === "closed") return false;
  try {
    // E5 (659.25 Hz) then A5 (880 Hz) — short, warm, unmistakably "attention".
    tone(ac, 659.25, 0, 0.22, 0.16);
    tone(ac, 880, 0.18, 0.34, 0.14);
    return true;
  } catch {
    return false;
  }
}

/** Haptic buzz on supporting phones (Android Chrome). Best-effort, quiet. */
export function vibrateApproval(): void {
  try {
    navigator.vibrate?.([90, 60, 120]);
  } catch { /* unsupported */ }
}

/** Request device-notification permission from a user gesture. */
export async function requestDeviceNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/**
 * Fire a device-level notification (lock screen / notification shade on
 * mobile). Falls back silently when permission was never granted.
 */
export function showDeviceNotification(title: string, body: string, tag: string): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag, icon: "/icon-192.png", silent: false });
  } catch { /* SW-less environments may throw — non-fatal */ }
}
