import { useEffect, useState } from "react";

/**
 * useFabScrollVisibility — YouTube-style hide-while-scrolling for the
 * floating action buttons (FABs).
 *
 * Requested behavior (owner): the FABs must not cover the text the user is
 * reading while scrolling DOWN. They slide below the screen edge while the
 * scroll is actively moving downward, and glide back as soon as the user
 * scrolls UP or the scroll STOPS (short debounce), YouTube-app style.
 *
 * Also hides the FABs whenever the on-screen keyboard opens (mobile): the
 * visual viewport shrinks by ~25%+ when the keyboard covers the screen and
 * fixed-positioned FABs would otherwise float on top of the keyboard and
 * cover the input the user is typing in. They come back when it closes.
 *
 * Returns `true` when the FABs should currently be hidden. Consumers apply
 * the `.fab-scroll-hidden` CSS class when this is true (see index.css).
 *
 * @param disabled when true the hook always reports visible — used while the
 *        WhatsApp tooltip or the chat window is open (never hide an open UI).
 */
const SHOW_NEAR_TOP_PX = 120; // always visible near the top of the page
const STOP_REVEAL_MS = 220; // reveal debounce once scrolling stops
const DIRECTION_JITTER_PX = 4; // ignore micro-jitter when detecting direction
const KEYBOARD_SHRINK_RATIO = 0.75; // ≤75% of rest height = keyboard open

export function useFabScrollVisibility(disabled = false): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (disabled) {
      // An open UI (tooltip / chat window) must never be scrolled away.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHidden(false);
      return undefined;
    }

    let lastY = globalThis.scrollY;
    let revealTimer: ReturnType<typeof setTimeout> | null = null;
    let keyboardOpen = false;

    const scheduleReveal = () => {
      if (revealTimer) clearTimeout(revealTimer);
      revealTimer = setTimeout(() => setHidden(false), STOP_REVEAL_MS);
    };

    const onScroll = () => {
      // While the soft keyboard is open the FABs stay hidden — page scrolling
      // (e.g. the browser scrolling the focused input into view) must not
      // bring them back over the keyboard.
      if (keyboardOpen) return;
      const y = globalThis.scrollY;
      const delta = y - lastY;
      lastY = y;
      // Any scroll activity postpones the "stopped" reveal; when the events
      // stop arriving the timer fires and the FABs glide back in.
      scheduleReveal();
      if (y <= SHOW_NEAR_TOP_PX) {
        setHidden(false);
        return;
      }
      if (delta >= DIRECTION_JITTER_PX) setHidden(true);
      else if (delta <= -DIRECTION_JITTER_PX) setHidden(false);
    };

    // ── Soft-keyboard detection via the visual viewport ──
    // Track the largest viewport height seen (the "rest" height); when the
    // visual viewport shrinks to ≤75% of it the keyboard is covering the
    // screen → hide the FABs. Works on both Android (layout resizes) and
    // iOS (only the visual viewport shrinks).
    const vv = globalThis.visualViewport;
    let restHeight = vv?.height ?? 0;
    const onVVResize = () => {
      if (!vv) return;
      if (vv.height > restHeight) restHeight = vv.height; // rotation / keyboard closed
      const open = restHeight > 0 && vv.height < restHeight * KEYBOARD_SHRINK_RATIO;
      if (open === keyboardOpen) return;
      keyboardOpen = open;
      if (keyboardOpen) {
        if (revealTimer) clearTimeout(revealTimer);
        setHidden(true);
      } else {
        scheduleReveal();
      }
    };

    globalThis.addEventListener("scroll", onScroll, { passive: true });
    vv?.addEventListener("resize", onVVResize);
    return () => {
      globalThis.removeEventListener("scroll", onScroll);
      vv?.removeEventListener("resize", onVVResize);
      if (revealTimer) clearTimeout(revealTimer);
    };
  }, [disabled]);

  return hidden;
}
