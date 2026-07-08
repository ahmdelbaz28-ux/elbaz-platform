import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useTransform } from "framer-motion";

/* -------------------------------------------------------------------------- */
/*  BackgroundLogoWatermark                                                    */
/*  ─────────────────────────────────────────────────────────────────────────  */
/*  A large, ultra-subtle brand watermark behind hero content.                 */
/*  Modern, clean design — no circular badge, just the logo with elegant      */
/*  ambient glow. Matches the squircle aesthetic of Logo3D.                    */
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
      setIsLight(document.documentElement.getAttribute("data-theme") === "light");
    };
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  /* ── Reduced motion ── */
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
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
        {/* Elegant squircle backing — no heavy borders or rings */}
        <div
          className="w-full h-full flex items-center justify-center"
          style={{
            borderRadius: "22%",
            opacity: isLight ? opacityLight : opacityDark,
            background: isLight
              ? "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.9) 0%, rgba(241,245,249,0.3) 100%)"
              : "radial-gradient(circle at 35% 30%, rgba(16,23,36,0.85) 0%, rgba(5,8,13,0.4) 100%)",
            border: `1px solid ${
              isLight ? "rgba(8,145,178,0.08)" : "rgba(6,182,212,0.07)"
            }`,
            boxShadow: isLight
              ? "0 0 40px rgba(8,145,178,0.03), inset 0 0 20px rgba(8,145,178,0.015)"
              : "0 0 40px rgba(6,182,212,0.03), inset 0 0 20px rgba(6,182,212,0.015)",
          }}
        >
          {/* Logo image */}
          <picture className="flex items-center justify-center w-full h-full p-[18%]">
            <source srcSet="/logo.webp 1x, /logo@2x.webp 2x" type="image/webp" />
            <img
              src="/logo.png"
              alt=""
              draggable={false}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-contain"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                e.currentTarget.onerror = null;
              }}
              style={{
                filter: isLight
                  ? "brightness(0.55) saturate(0.7)"
                  : "brightness(1.3) saturate(0.85)",
              }}
            />
          </picture>
        </div>
      </motion.div>
    </motion.div>
  );
}
