import { useEffect, useRef, useState } from 'react';

/* -------------------------------------------------------------------------- */
/*  Logo3D                                                                     */
/*  ─────────────────────────────────────────────────────────────────────────  */
/*  Professional circular logo badge — theme-aware (dark + light).            */
/*                                                                             */
/*  Design intent:                                                             */
/*    • The logo image file (/logo.png, /logo.webp) is NEVER modified —       */
/*      same brand asset as supplied by the owner.                            */
/*    • The badge surrounding it adapts to the active theme:                   */
/*        - Dark mode:  deep gradient (#101724 → #05080d) + cyan accent       */
/*        - Light mode: light gradient (#ffffff → #f1f5f9) + darker cyan      */
/*    • Slow 6s "breathing" glow halo — alive but never distracting           */
/*    • On hover: subtle lift + brighter halo, NO tilt, NO sweep              */
/*    • Accessibility: respects prefers-reduced-motion.                        */
/*    • Performance: one rAF per instance, paused when tab hidden.             */
/* -------------------------------------------------------------------------- */

interface Logo3DProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  interactive?: boolean;
}

const ACCENT_RGB_DARK = '6,182,212';
const ACCENT_RGB_LIGHT = '8,145,178';  // cyan-600 — darker for contrast on light bg
const BADGE_TOP_DARK = '#101724';
const BADGE_BOTTOM_DARK = '#05080d';
const BADGE_TOP_LIGHT = '#ffffff';
const BADGE_BOTTOM_LIGHT = '#e2e8f0';

const SIZE_MAP: Record<NonNullable<Logo3DProps['size']>, number> = {
  sm: 28,
  md: 40,
  lg: 56,
  xl: 80,
};

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
  const [isLight, setIsLight] = useState(false);
  const rafRef = useRef<number>(0);
  const visibleRef = useRef(true);

  /* ── Theme detection ──────────────────────────────────────────────────── */
  useEffect(() => {
    const checkTheme = () => {
      setIsLight(document.documentElement.getAttribute('data-theme') === 'light');
    };
    checkTheme();
    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  /* ── Slow breathing glow (6s cycle, very subtle) ──────────────────────── */
  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setBreath(0.5);
      return;
    }

    const PERIOD = 6000;
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
  const accentRgb = isLight ? ACCENT_RGB_LIGHT : ACCENT_RGB_DARK;
  const badgeTop = isLight ? BADGE_TOP_LIGHT : BADGE_TOP_DARK;
  const badgeBottom = isLight ? BADGE_BOTTOM_LIGHT : BADGE_BOTTOM_DARK;
  const haloAlpha = isHovered ? 0.45 : 0.14 + breath * 0.10;
  const ringAlpha = isHovered ? 0.55 : 0.30 + breath * 0.06;
  const innerRingAlpha = isHovered ? 0.25 : 0.08 + breath * 0.04;
  const lift = isHovered && interactive ? -1 : 0;
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
          background: `radial-gradient(circle, rgba(${accentRgb},${haloAlpha}) 0%, rgba(${accentRgb},${haloAlpha * 0.35}) 35%, transparent 72%)`,
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
          background: `
            radial-gradient(circle at 30% 25%, rgba(255,255,255,${isLight ? 0.9 : 0.08}) 0%, transparent 55%),
            linear-gradient(155deg, ${badgeTop} 0%, ${badgeBottom} 100%)
          `,
          border: `${ringWidth}px solid rgba(${accentRgb}, ${ringAlpha})`,
          boxShadow: `
            0 ${Math.max(2, Math.round(px * 0.05))}px ${Math.round(px * 0.18)}px rgba(0,0,0,${isLight ? 0.12 : 0.5}),
            0 0 ${Math.round(px * 0.28)}px rgba(${accentRgb}, ${haloAlpha * 0.5}),
            inset 0 1px 1px rgba(255,255,255,${isLight ? 0.5 : 0.08}),
            inset 0 -1px 2px rgba(0,0,0,${isLight ? 0.08 : 0.55})
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
            border: `1px solid rgba(${accentRgb}, ${innerRingAlpha})`,
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
                ? `drop-shadow(0 0 9px rgba(${accentRgb},0.55)) brightness(1.08)`
                : `drop-shadow(0 0 3px rgba(${accentRgb},${0.20 + breath * 0.10}))`,
              transition: 'filter 0.5s ease',
            }}
          />
        </picture>
      </div>
    </div>
  );
}
