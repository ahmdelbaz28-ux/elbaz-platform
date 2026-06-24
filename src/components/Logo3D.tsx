import React, { useEffect, useRef, useState } from 'react';

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface Logo3DProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** Enable mouse-tracking tilt on hover. Default `true`. */
  interactive?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const ACCENT = '#06b6d4';
const ACCENT_RGB = '6,182,212';
const DARK_BG = '#0a0e17';

const SIZE_MAP: Record<NonNullable<Logo3DProps['size']>, number> = {
  sm: 28,
  md: 40,
  lg: 56,
  xl: 80,
};

/** Outer ring / padding as a fraction of the logo size */
const RING_SCALE = 1.25;

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export default function Logo3D({
  size = 'md',
  className = '',
  interactive = true,
}: Logo3DProps) {
  const px = SIZE_MAP[size];
  const outerSize = Math.round(px * RING_SCALE);

  const [rotation, setRotation] = useState(0);
  const rafRef = useRef<number>(0);
  const isVisibleRef = useRef(true);

  useEffect(() => {
    const ROTATION_PERIOD = 5000;
    let startTimestamp: number | null = null;

    const animate = (timestamp: number) => {
      if (!isVisibleRef.current) {
        rafRef.current = requestAnimationFrame(animate);
        return;
      }
      if (startTimestamp === null) startTimestamp = timestamp;
      const elapsed = timestamp - startTimestamp;
      const angle = (elapsed / ROTATION_PERIOD) * 360;
      setRotation(angle);
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    const handleVisibility = () => {
      isVisibleRef.current = !document.hidden;
      if (!document.hidden) startTimestamp = null;
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  /* ---- Hover tilt state (applied to entire container for unified feel) ---- */
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const tiltRafRef = useRef<number>(0);

  const handleMouseMove = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!interactive) return;
      if (tiltRafRef.current) cancelAnimationFrame(tiltRafRef.current);

      tiltRafRef.current = requestAnimationFrame(() => {
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = (e.clientX - cx) / (rect.width / 2);
        const dy = (e.clientY - cy) / (rect.height / 2);
        const maxTilt = 12;
        setTilt({
          x: -dy * maxTilt,
          y: dx * maxTilt,
        });
      });
    },
    [interactive],
  );

  const handleMouseLeave = React.useCallback(() => {
    if (tiltRafRef.current) cancelAnimationFrame(tiltRafRef.current);
    setTilt({ x: 0, y: 0 });
    setIsHovered(false);
  }, []);

  const handleMouseEnter = React.useCallback(() => {
    setIsHovered(true);
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (tiltRafRef.current) cancelAnimationFrame(tiltRafRef.current);
    };
  }, []);

  /* ---- Derived visual values ----------------------------------------------- */
  const shadowSpread = Math.max(2, Math.round(px * 0.04));
  const glowBlur = Math.max(8, Math.round(px * 0.3));
  const hoverGlowBlur = Math.max(12, Math.round(px * 0.45));

  /* ---- Render -------------------------------------------------------------- */
  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`logo-3d-container select-none ${className}`}
      style={{
        perspective: `${px * 10}px`,
        width: outerSize,
        height: outerSize,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {/* ── Orbiting ring (auto-rotating conic gradient border) ── */}
      <div
        aria-hidden="true"
        className="logo-3d-ring"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          padding: 2,
          background: `conic-gradient(
            from 0deg,
            transparent 0%,
            ${ACCENT} 15%,
            transparent 30%,
            transparent 50%,
            ${ACCENT} 65%,
            transparent 80%,
            transparent 100%
          )`,
          WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
          opacity: isHovered ? 0.9 : 0.5,
          transition: 'opacity 0.4s ease',
          willChange: 'transform',
          transform: `rotate(${rotation}deg)`,
          pointerEvents: 'none',
        }}
      />

      {/* ── Outer glow halo ── */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: -4,
          borderRadius: '50%',
          background: `radial-gradient(circle, rgba(${ACCENT_RGB},${isHovered ? 0.2 : 0.1}) 0%, transparent 70%)`,
          transition: 'background 0.4s ease',
          pointerEvents: 'none',
        }}
      />

      {/* ── Static disc: holds the logo — NO auto-rotation, only hover tilt ── */}
      <div
        style={{
          position: 'relative',
          width: px,
          height: px,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          /* Only mouse-driven tilt — NO auto rotateY so logo stays centered */
          transform: `rotateY(${tilt.y}deg) rotateX(${tilt.x}deg) scale3d(${isHovered ? 1.15 : 1}, ${isHovered ? 1.15 : 1}, 1)`,
          transition: tilt.x === 0 && tilt.y === 0 ? 'transform 0.4s cubic-bezier(.175, .885, .32, 1.275)' : 'none',
          willChange: 'transform',
          transformStyle: 'preserve-3d',
          /* 3D depth / bevel shadows with "Electrical Blue" glow */
          boxShadow: `
            0 ${shadowSpread}px ${glowBlur}px rgba(${ACCENT_RGB}, ${isHovered ? 0.8 : 0.4}),
            ${Math.round(px * 0.1)}px ${Math.round(px * 0.1)}px ${Math.round(px * 0.15)}px rgba(0,0,0,0.5),
            inset 0 ${Math.round(px * 0.015)}px ${Math.round(px * 0.05)}px rgba(255,255,255,0.2),
            inset 0 -${Math.round(px * 0.02)}px ${Math.round(px * 0.05)}px rgba(0,0,0,0.6)
          `,
          /* 3D bevel gradient — More metallic / premium */
          background: `
            radial-gradient(circle at 30% 25%, rgba(255,255,255,0.15) 0%, transparent 50%),
            linear-gradient(160deg, rgba(255,255,255,0.1) 0%, rgba(0,0,0,0.3) 50%, rgba(0,0,0,0.6) 100%),
            ${DARK_BG}
          `,
          border: `2px solid rgba(${ACCENT_RGB}, ${isHovered ? 0.6 : 0.3})`,
        }}
      >
        {/* Holographic light sweep effect */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, transparent 45%, rgba(255,255,255,0.2) 50%, transparent 55%)',
            backgroundSize: '250% 250%',
            backgroundPosition: isHovered ? '0% 0%' : '100% 100%',
            transition: 'background-position 0.6s ease-in-out',
            pointerEvents: 'none',
            zIndex: 3,
          }}
        />

        {/* Inner bevel ring */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 1.5,
            borderRadius: '50%',
            boxShadow:
              'inset 0 1px 3px rgba(255,255,255,0.12), inset 0 -1px 4px rgba(0,0,0,0.4)',
            pointerEvents: 'none',
          }}
        />

        {/* Logo image — WebP-first with PNG fallback, optimized for crisp rendering */}
        <picture aria-hidden="true">
          <source srcSet="/logo.webp 1x, /logo@2x.webp 2x" type="image/webp" />
          <img
            src="/logo.png"
            srcSet="/logo.png 1x, /logo.png 2x"
            alt="Elbaz Platform Logo"
            width={Math.round(px * 0.85)}
            height={Math.round(px * 0.85)}
            draggable={false}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            style={{
              position: 'relative',
              zIndex: 2,
              filter: isHovered
                ? 'drop-shadow(0 0 12px rgba(6,182,212,0.8))'
                : 'drop-shadow(0 0 4px rgba(6,182,212,0.3))',
              transition: 'all 0.4s ease',
              objectFit: 'contain',
              transform: `translateZ(${px * 0.2}px)`, // 3D pop effect
            }}
          />
        </picture>
      </div>

      {/* ── Pulsing "Electrical" glow ring ── */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: -2,
          borderRadius: '50%',
          boxShadow: `0 0 ${isHovered ? hoverGlowBlur + 10 : glowBlur + 4}px ${isHovered ? Math.round(px * 0.18) : Math.round(px * 0.1)}px rgba(${ACCENT_RGB}, ${isHovered ? 0.5 : 0.25})`,
          transition: 'all 0.4s ease',
          willChange: 'box-shadow',
          pointerEvents: 'none',
          animation: isHovered ? 'none' : 'logo3d-glow-pulse 2s ease-in-out infinite',
        }}
      />

    </div>
  );
}
