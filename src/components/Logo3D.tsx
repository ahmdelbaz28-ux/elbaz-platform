import { useState } from 'react';

/* -------------------------------------------------------------------------- */
/*  Logo3D                                                                     */
/*  ─────────────────────────────────────────────────────────────────────────  */
/*  The site logo rendered as its own circular shape — nothing else.           */
/*                                                                             */
/*  Design intent (owner directive — applies to EVERY logo on the site):        */
/*    • Only the logo's own circular outline — NO white rectangle, NO badge     */
/*      backing, NO border, NO halo or rings.                                   */
/*    • The asset (/logo-circle.png) is pre-cropped edge-to-edge to the logo's  */
/*      own circle with a transparent background, so its edge IS the logo edge. */
/*    • Size map keeps proportions harmonious on mobile and desktop.            */
/*    • Subtle hover glow on the image only (no added shapes).                  */
/*    • Accessibility: respects prefers-reduced-motion; decorative-free markup. */
/* -------------------------------------------------------------------------- */

interface Logo3DProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  interactive?: boolean;
}

const ACCENT_RGB_DARK = '6,182,212';
const ACCENT_RGB_LIGHT = '8,145,178';

const SIZE_MAP: Record<NonNullable<Logo3DProps['size']>, number> = {
  sm: 28,
  md: 40,
  lg: 56,
  xl: 80,
};

export default function Logo3D({
  size = 'md',
  className = '',
  interactive = true,
}: Logo3DProps) {
  const px = SIZE_MAP[size];
  const [isHovered, setIsHovered] = useState(false);

  /* Theme-aware accent (light/dark) without re-render loops */
  const isLight =
    typeof document !== 'undefined' &&
    document.documentElement.dataset.theme === 'light';
  const accentRgb = isLight ? ACCENT_RGB_LIGHT : ACCENT_RGB_DARK;

  return (
    <span
      role="img"
      aria-label="Elbaz Platform Logo"
      className={`select-none inline-block ${className}`}
      style={{
        width: px,
        height: px,
        flexShrink: 0,
        cursor: interactive ? 'pointer' : 'default',
      }}
      onMouseEnter={() => interactive && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <img
        src="/logo-circle.png"
        alt=""
        draggable={false}
        loading="eager"
        decoding="async"
        fetchPriority="high"
        className="block h-full w-full rounded-full object-cover"
        style={{
          filter: isHovered && interactive
            ? `drop-shadow(0 0 9px rgba(${accentRgb},0.55)) brightness(1.06)`
            : `drop-shadow(0 1px 3px rgba(0,0,0,0.25))`,
          transition: 'filter 0.4s ease',
        }}
      />
    </span>
  );
}
