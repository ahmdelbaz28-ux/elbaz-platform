import { useEffect, useRef, useState } from 'react';

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface Logo3DProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** Enable subtle hover scale effect. Default `true`. */
  interactive?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Site palette — keeps the logo "taking the shape of the site" */
const ACCENT_RGB = '6,182,212';
const BADGE_TOP = '#0f1623';
const BADGE_BOTTOM = '#060911';

const SIZE_MAP: Record<NonNullable<Logo3DProps['size']>, number> = {
  sm: 28,
  md: 40,
  lg: 56,
  xl: 80,
};

/** Reserved outer space for the soft halo (kept identical to old layout
 *  so consumers that depend on the previous bounding box don't shift). */
const HALO_SCALE = 1.25;

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */
/**
 * Elegant circular logo badge.
 *
 * Design goals (per owner feedback):
 *   1. The logo must read as a CIRCULAR element that matches the site's
 *      overall rounded/circular aesthetic — no more "thin rectangle
 *      floating inside a circle" look.
 *   2. No spinning conic-gradient ring behind the logo (the previous
 *      version's main complaint — looked amateurish).
 *   3. No tacky holographic sweep, no aggressive 3D tilt on hover.
 *   4. The actual logo image file (`/logo.png`, `/logo.webp`) is NEVER
 *      modified — only the way it is presented inside its circular
 *      background changes.
 *
 * The result is a refined, stationary circular badge with a slow
 * "breathing" accent glow that gives the logo life without distraction.
 */
export default function Logo3D({
  size = 'md',
  className = '',
  interactive = true,
}: Logo3DProps) {
  const px = SIZE_MAP[size];
  const outerSize = Math.round(px * HALO_SCALE);

  const [isHovered, setIsHovered] = useState(false);
  const [breath, setBreath] = useState(0.5);
  const rafRef = useRef<number>(0);
  const visibleRef = useRef(true);

  /* ── Slow breathing glow (4s cycle, very subtle) ──────────────────────── */
  useEffect(() => {
    // Respect users who prefer reduced motion — freeze at the neutral state.
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setBreath(0.5);
      return;
    }

    const PERIOD = 4000;
    let start: number | null = null;

    const tick = (ts: number) => {
      if (!visibleRef.current) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      if (start === null) start = ts;
      const t = (ts - start) / PERIOD;
      // Smooth sinusoidal breathing between 0..1
      setBreath((Math.sin(t * Math.PI * 2) + 1) / 2);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    const onVisibility = () => {
      visibleRef.current = !document.hidden;
      if (!document.hidden) start = null;
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  /* ── Derived values (kept inexpensive) ────────────────────────────────── */
  const glowAlpha = isHovered ? 0.55 : 0.18 + breath * 0.14; // 0.18 → 0.32
  const ringAlpha = isHovered ? 0.55 : 0.22 + breath * 0.08; // 0.22 → 0.30
  const innerRingAlpha = isHovered ? 0.22 : 0.06 + breath * 0.04;
  const scale = isHovered && interactive ? 1.06 : 1;
  const haloBlur = Math.max(4, Math.round(px * 0.18));
  const shadowSpread = Math.max(2, Math.round(px * 0.04));

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <div
      className={`logo-3d-container select-none ${className}`}
      style={{
        width: outerSize,
        height: outerSize,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        position: 'relative',
        cursor: interactive ? 'pointer' : 'default',
      }}
      onMouseEnter={() => interactive && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* ── Soft ambient halo (replaces the spinning ring) ─────────────── */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: -Math.round(px * 0.06),
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(${ACCENT_RGB},${glowAlpha * 0.6}) 0%, rgba(${ACCENT_RGB},${glowAlpha * 0.15}) 40%, transparent 75%)`,
          transition: 'background 0.6s ease',
          pointerEvents: 'none',
          filter: `blur(${haloBlur * 0.5}px)`,
          willChange: 'background',
        }}
      />

      {/* ── Main circular badge (static, elegant) ──────────────────────── */}
      <div
        style={{
          position: 'relative',
          width: px,
          height: px,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `scale(${scale})`,
          transition: 'transform 0.5s cubic-bezier(.175,.885,.32,1.275)',
          willChange: 'transform',
          /* Refined dark gradient that matches the site background —
             gives a clean "cut-out of the site" feel rather than a
             metallic 3D bevel. */
          background: `
            radial-gradient(circle at 32% 28%, rgba(255,255,255,0.07) 0%, transparent 55%),
            linear-gradient(150deg, ${BADGE_TOP} 0%, ${BADGE_BOTTOM} 100%)
          `,
          /* Static accent border — no spinning. */
          border: `${Math.max(1.5, Math.round(px * 0.035))}px solid rgba(${ACCENT_RGB}, ${ringAlpha})`,
          boxShadow: `
            0 ${shadowSpread}px ${Math.round(px * 0.14)}px rgba(0,0,0,0.45),
            0 0 ${Math.round(px * 0.22)}px rgba(${ACCENT_RGB}, ${glowAlpha * 0.35}),
            inset 0 1px 1px rgba(255,255,255,0.06),
            inset 0 -1px 2px rgba(0,0,0,0.5)
          `,
        }}
      >
        {/* Subtle inner accent ring (decorative, static) */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: Math.max(2, Math.round(px * 0.09)),
            borderRadius: '50%',
            border: `1px solid rgba(${ACCENT_RGB}, ${innerRingAlpha})`,
            pointerEvents: 'none',
            transition: 'border-color 0.5s ease',
          }}
        />

        {/* ── Logo image (UNCHANGED — only the surrounding badge changes) ─ */}
        <picture
          aria-hidden="true"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            padding: Math.round(px * 0.16),
            position: 'relative',
            zIndex: 2,
          }}
        >
          <source srcSet="/logo.webp 1x, /logo@2x.webp 2x" type="image/webp" />
          <img
            src="/logo.png"
            srcSet="/logo.png 1x, /logo@2x.webp 2x"
            alt="Elbaz Platform Logo"
            draggable={false}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              width: 'auto',
              height: 'auto',
              objectFit: 'contain',
              filter: isHovered
                ? 'drop-shadow(0 0 8px rgba(6,182,212,0.6)) brightness(1.08)'
                : `drop-shadow(0 0 3px rgba(6,182,212,${0.22 + breath * 0.1}))`,
              transition: 'filter 0.5s ease',
            }}
          />
        </picture>
      </div>
    </div>
  );
}
