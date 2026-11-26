/**
 * SIGNATURE PROGRESS BAR — Brand Kit visual signature (UI suggestion #3)
 *
 * The brand's official signature is the orange→cyan gradient at 3px thickness
 * (see docs/BRAND-KIT.md). This component repeats that exact signature as a
 * scroll-progress bar pinned to the top of every page, so any screenshot from
 * the platform is recognizable before a single word is read.
 *
 * Engineering notes:
 *  - rAF-throttled passive scroll listener: one style write per frame, no
 *    layout thrash, no re-renders (progress lives in a ref, not state).
 *  - transform-only animation (scaleX) → compositor-only, zero layout cost.
 *  - honours prefers-reduced-motion: the bar still reflects real progress
 *    (it is position feedback, not decorative motion) but without any
 *    transition smoothing.
 *  - aria-hidden + pointer-events-none: purely visual aid, never traps
 *    interaction or reaches assistive tech.
 */
import { useEffect, useRef } from "react";

export default function SignatureProgressBar() {
  const barRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const update = () => {
      rafRef.current = 0;
      const bar = barRef.current;
      if (!bar) return;
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      const progress = max > 0 ? Math.min(doc.scrollTop / max, 1) : 0;
      bar.style.transform = `scaleX(${progress})`;
    };
    const onScroll = () => {
      if (rafRef.current === 0) {
        rafRef.current = requestAnimationFrame(update);
      }
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="brand-signature-track"
    >
      <div ref={barRef} className="brand-signature-bar" />
    </div>
  );
}
