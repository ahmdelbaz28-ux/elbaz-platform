import { useEffect, useRef, useState } from 'react';

/* -------------------------------------------------------------------------- */
/*  Logo3D                                                                     */
/*  ─────────────────────────────────────────────────────────────────────────  */
/*  Professional circular logo badge.                                          */
/*                                                                             */
/*  Design intent:                                                             */
/*    • The logo image file (/logo.png, /logo.webp) is NEVER modified —       */
/*      same brand asset as supplied by the owner.                            */
/*    • The badge surrounding it is a refined, modern monolith:               */
/*        - Soft inner radial light (top-left) for depth                       */
/*        - Hairline accent ring (cyan) — static, no spinning                  */
/*        - Very slow 6s "breathing" glow halo — alive but never distracting   */
/*        - On hover: subtle lift + brighter halo, NO tilt, NO sweep           */
/*    • Accessibility: respects prefers-reduced-motion (freezes at neutral).   */
/*    • Performance: one rAF per instance, paused when tab hidden.             */
/* -------------------------------------------------------------------------- */

interface Logo3DProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  interactive?: boolean;
}

const ACCENT_RGB = '6,182,212';
const BADGE_TOP = '#101724';
const BADGE_BOTTOM = '#05080d';

const SIZE_MAP: Record<NonNullable<Logo3DProps['size']>, number> = {
  sm: 28,
  md: 40,
  lg: 56,
  xl: 80,
};

// Outer space reserved for the halo — kept identical to the previous
// implementation so the logo's bounding box does not shift in the layout.
const HALO_SCALE = 1.25;

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

  /* ── Slow breathing glow (6s cycle, very subtle) ──────────────────────── */
  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setBreath(0.5);
      return;
    }

    const PERIOD = 6000; // 6s — slower, calmer than the previous 4s
    let start: number | null = null;

    const tick = (ts: number) => {
      if (!visibleRef.current) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      if (start === null) start = ts;
      const t = (ts - start) / PERIOD;
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

  /* ── Derived values ───────────────────────────────────────────────────── */
  const haloAlpha = isHovered ? 0.45 : 0.14 + breath * 0.10;  // 0.14 → 0.24
  const ringAlpha = isHovered ? 0.55 : 0.30 + breath * 0.06;  // 0.30 → 0.36
  const innerRingAlpha = isHovered ? 0.25 : 0.08 + breath * 0.04;
  const lift = isHovered && interactive ? -1 : 0;             // 1px lift on hover
  const haloBlur = Math.max(4, Math.round(px * 0.22));
  const ringWidth = Math.max(1, Math.round(px * 0.025));

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
      {/* ── Ambient halo (slow breathing glow) ──────────────────────────── */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: -Math.round(px * 0.08),
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(${ACCENT_RGB},${haloAlpha}) 0%, rgba(${ACCENT_RGB},${haloAlpha * 0.35}) 35%, transparent 72%)`,
          transition: 'background 0.6s ease',
          pointerEvents: 'none',
          filter: `blur(${haloBlur * 0.6}px)`,
          willChange: 'background',
        }}
      />

      {/* ── Main circular badge ─────────────────────────────────────────── */}
      <div
        style={{
          position: 'relative',
          width: px,
          height: px,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `translateY(${lift}px)`,
          transition: 'transform 0.45s cubic-bezier(.2,.8,.2,1)',
          willChange: 'transform',
          /* Layered background:
             1. Inner radial light from top-left for depth (mimics soft studio light)
             2. Linear gradient from top to bottom — keeps the badge integrated
                with the site's dark palette rather than looking like a sticker */
          background: `
            radial-gradient(circle at 30% 25%, rgba(255,255,255,0.08) 0%, transparent 55%),
            linear-gradient(155deg, ${BADGE_TOP} 0%, ${BADGE_BOTTOM} 100%)
          `,
          /* Hairline accent ring — static, no spin */
          border: `${ringWidth}px solid rgba(${ACCENT_RGB}, ${ringAlpha})`,
          boxShadow: `
            0 ${Math.max(2, Math.round(px * 0.05))}px ${Math.round(px * 0.18)}px rgba(0,0,0,0.5),
            0 0 ${Math.round(px * 0.28)}px rgba(${ACCENT_RGB}, ${haloAlpha * 0.5}),
            inset 0 1px 1px rgba(255,255,255,0.08),
            inset 0 -1px 2px rgba(0,0,0,0.55)
          `,
        }}
      >
        {/* Decorative inner ring (static, hairline) */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: Math.max(2, Math.round(px * 0.10)),
            borderRadius: '50%',
            border: `1px solid rgba(${ACCENT_RGB}, ${innerRingAlpha})`,
            pointerEvents: 'none',
            transition: 'border-color 0.5s ease',
          }}
        />

        {/* ── Logo image — NEVER modified, only its container ──────────── */}
        <picture
          aria-hidden="true"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            padding: Math.round(px * 0.17),
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
                ? 'drop-shadow(0 0 9px rgba(6,182,212,0.55)) brightness(1.08)'
                : `drop-shadow(0 0 3px rgba(6,182,212,${0.20 + breath * 0.10}))`,
              transition: 'filter 0.5s ease',
            }}
          />
        </picture>
      </div>
    </div>
  );
}
