import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";

/* -------------------------------------------------------------------------- */
/*  BackgroundLogoWatermark                                                    */
/*  ─────────────────────────────────────────────────────────────────────────  */
/*  A large, ultra-subtle brand watermark behind hero content.                 */
/*  Modern, clean design — just the circular logo itself with an elegant       */
/*  ambient glow. Matches the circular aesthetic of Logo3D.                    */
/*                                                                             */
/*  Features:                                                                  */
/*    • Huge logo image at 4–6% opacity sitting behind the hero text          */
/*    • Parallax: moves slower than scroll so it feels embedded in the page    */
/*    • Gentle floating animation (6s cycle) — alive, never distracting        */
/*    • Theme-aware: different blend mode & opacity for dark/light             */
/*    • Responsive: smaller on mobile, bigger on desktop                       */
/*    • Respects prefers-reduced-motion                                        */
/*    • Zero layout shift — position:absolute behind hero content              */
/* -------------------------------------------------------------------------- */

export default function BackgroundLogoWatermark() {
  const ref = useRef<HTMLDivElement>(null);
  const [isLight, setIsLight] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  /* ── Theme detection ── */
  useEffect(() => {
    const check = () => {
      setIsLight(document.documentElement.dataset.theme === "light");
    };
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  /* ── Reduced motion ── */
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReducedMotion(mq?.matches ?? false);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq?.addEventListener("change", handler);
    return () => mq?.removeEventListener("change", handler);
  }, []);

  /* ── Parallax ── */
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [0, -80]);

  const opacityDark = 0.05;
  const opacityLight = 0.035;

  return (
    <motion.div
      ref={ref}
      aria-hidden="true"
      style={{ y: reducedMotion ? 0 : y }}
      className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden select-none"
    >
      {/* Ambient glow behind the logo */}
      <div
        className="absolute w-[70%] h-[70%] max-w-[800px] max-h-[800px]"
        style={{
          borderRadius: "30%",
          background: isLight
            ? "radial-gradient(circle at 40% 30%, rgba(8,145,178,0.04) 0%, transparent 65%)"
            : "radial-gradient(circle at 40% 30%, rgba(6,182,212,0.045) 0%, transparent 65%)",
        }}
      />

      {/* The logo mark — large, transparent, gently floating */}
      <motion.div
        animate={
          reducedMotion
            ? {}
            : {
                y: [0, -10, 0],
              }
        }
        transition={{
          duration: 7,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        className="relative flex items-center justify-center"
        style={{
          width: "clamp(180px, 40vw, 460px)",
          height: "clamp(180px, 40vw, 460px)",
          mixBlendMode: isLight ? "normal" : "soft-light",
        }}
      >
        {/* The circular logo itself — no backing, no border, no additions.
            The asset is pre-cropped edge-to-edge to the logo's own circle. */}
        <img
          src="/logo-circle.png"
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover rounded-full"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
            e.currentTarget.onerror = null;
          }}
          style={{
            opacity: isLight ? opacityLight : opacityDark,
            filter: isLight
              ? "brightness(0.55) saturate(0.7)"
              : "brightness(1.3) saturate(0.85)",
          }}
        />
      </motion.div>
    </motion.div>
  );
}
