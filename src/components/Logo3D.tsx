import { useEffect, useState } from 'react';

/* -------------------------------------------------------------------------- */
/*  Logo3D                                                                     */
/*  ─────────────────────────────────────────────────────────────────────────  */
/*  Professional rounded-square logo badge — modern, clean, theme-aware.      */
/*                                                                             */
/*  Design intent:                                                             */
/*    • Rounded-square (squircle) container instead of circle — more modern    */
/*    • Clean gradient backing + subtle border — no inner decorative rings     */
/*    • Slow 6s breathing glow halo via CSS animation (no JS re-renders)       */
/*    • On hover: subtle lift + brighter halo, NO tilt, NO sweep               */
/*    • Accessibility: respects prefers-reduced-motion                          */
/*    • Performance: CSS-driven animation — zero React re-renders while idle   */
/*    • Matching aesthetic with BackgroundLogoWatermark                         */
/* -------------------------------------------------------------------------- */

interface Logo3DProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  interactive?: boolean;
}

const ACCENT_RGB_DARK = '6,182,212';
const ACCENT_RGB_LIGHT = '8,145,178';
const BADGE_TOP_DARK = '#0f1729';
const BADGE_BOTTOM_DARK = '#070b12';
const BADGE_TOP_LIGHT = '#ffffff';
const BADGE_BOTTOM_LIGHT = '#f1f5f9';

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
  const [isLight, setIsLight] = useState(false);

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

  /* ── Derived values ───────────────────────────────────────────────────── */
  const accentRgb = isLight ? ACCENT_RGB_LIGHT : ACCENT_RGB_DARK;
  const badgeTop = isLight ? BADGE_TOP_LIGHT : BADGE_TOP_DARK;
  const badgeBottom = isLight ? BADGE_BOTTOM_LIGHT : BADGE_BOTTOM_DARK;
  const lift = isHovered && interactive ? -1 : 0;
  const haloBlur = Math.max(4, Math.round(px * 0.22));
  const ringWidth = Math.max(1, Math.round(px * 0.025));
  const borderRadiusPx = Math.round(px * 0.22);

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <div
      role="img"
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
      {/* ── Ambient halo (CSS-driven breathing glow — no JS re-renders) ─── */}
      <div
        aria-hidden="true"
        className="logo-halo"
        style={{
          position: 'absolute',
          inset: -Math.round(px * 0.08),
          borderRadius: borderRadiusPx + Math.round(px * 0.08),
          background: `radial-gradient(circle at 40% 30%, rgba(${accentRgb},0.24) 0%, rgba(${accentRgb},0.08) 30%, transparent 70%)`,
          transition: 'background 0.6s ease',
          pointerEvents: 'none',
          filter: `blur(${haloBlur * 0.6}px)`,
          willChange: 'opacity',
          opacity: isHovered ? 1 : 0.6,
          animation: !interactive || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
            ? 'none'
            : 'logoBreath 6s ease-in-out infinite',
        }}
      />

      {/* ── Main rounded-square badge ───────────────────────────────────── */}
      <div
        className="logo-badge"
        data-hovered={isHovered ? '' : undefined}
        style={{
          position: 'relative',
          width: px,
          height: px,
          borderRadius: borderRadiusPx,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `translateY(${lift}px)`,
          transition: 'transform 0.45s cubic-bezier(.2,.8,.2,1)',
          willChange: 'transform',
          background: `
            radial-gradient(circle at 30% 25%, rgba(255,255,255,${isLight ? 0.9 : 0.08}) 0%, transparent 50%),
            linear-gradient(155deg, ${badgeTop} 0%, ${badgeBottom} 100%)
          `,
          border: `${ringWidth}px solid rgba(${accentRgb}, 0.36)`,
          boxShadow: `
            0 ${Math.max(2, Math.round(px * 0.05))}px ${Math.round(px * 0.18)}px rgba(0,0,0,${isLight ? 0.12 : 0.5}),
            0 0 ${Math.round(px * 0.28)}px rgba(${accentRgb}, 0.12),
            inset 0 1px 1px rgba(255,255,255,${isLight ? 0.5 : 0.08}),
            inset 0 -1px 2px rgba(0,0,0,${isLight ? 0.08 : 0.55})
          `,
        }}
      >
        {/* ── Subtle inner highlight (top edge only, no full ring) ──────── */}
        <div
          aria-hidden="true"
          className="logo-highlight"
          style={{
            position: 'absolute',
            top: 0,
            left: '12%',
            right: '12%',
            height: '1px',
            borderRadius: '1px',
            background: `linear-gradient(90deg, transparent, rgba(${accentRgb}, ${isHovered ? 0.3 : 0.12}), transparent)`,
            pointerEvents: 'none',
          }}
        />

        {/* ── Logo image — loaded from SVG for instant, crisp rendering ─── */}
        <picture
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
          {/* JPG logo — optimized for fast rendering */}
          <img
            src="/logo.jpg"
            alt="Elbaz Platform Logo"
            draggable={false}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            className="logo-img"
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              width: 'auto',
              height: 'auto',
              objectFit: 'contain',
              filter: isHovered
                ? `drop-shadow(0 0 9px rgba(${accentRgb},0.55)) brightness(1.08)`
                : `drop-shadow(0 0 3px rgba(${accentRgb},0.25))`,
              transition: 'filter 0.5s ease',
            }}
          />
        </picture>
      </div>
    </div>
  );
}
