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
 * Returns `true` when the FABs should currently be hidden. Consumers apply
 * the `.fab-scroll-hidden` CSS class when this is true (see index.css).
 *
 * @param disabled when true the hook always reports visible — used while the
 *        WhatsApp tooltip or the chat window is open (never hide an open UI).
 */
const SHOW_NEAR_TOP_PX = 120; // always visible near the top of the page
const STOP_REVEAL_MS = 220; // reveal debounce once scrolling stops
const DIRECTION_JITTER_PX = 4; // ignore micro-jitter when detecting direction

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

    const scheduleReveal = () => {
      if (revealTimer) clearTimeout(revealTimer);
      revealTimer = setTimeout(() => setHidden(false), STOP_REVEAL_MS);
    };

    const onScroll = () => {
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

    globalThis.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      globalThis.removeEventListener("scroll", onScroll);
      if (revealTimer) clearTimeout(revealTimer);
    };
  }, [disabled]);

  return hidden;
}
