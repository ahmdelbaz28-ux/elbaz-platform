import React from 'react';

/**
 * BackgroundStars renders a subtle animated star‑like particle effect.
 * Each particle is a small circle that rises from the bottom of the screen,
 * gently glows and then fades away. The component is positioned absolutely
 * with a negative z‑index so it never intercepts UI interactions.
 */
export default function BackgroundStars() {
  const stars = Array.from({ length: 30 }); // adjust count for performance
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* Inline keyframes – no Tailwind config needed */}
      <style>{`@keyframes rise {\n        0% { transform: translateY(100vh) scale(0.5); opacity: 0; }\n        30% { opacity: 0.8; }\n        100% { transform: translateY(-10vh) scale(1); opacity: 0; }\n      }`}</style>
      {stars.map((_, i) => {
        const size = Math.random() * 3 + 2; // 2‑5px
        const left = Math.random() * 100; // %
        const duration = 12 + Math.random() * 8; // 12‑20s
        const delay = Math.random() * 5; // stagger start
        const opacity = 0.2 + Math.random() * 0.6; // 0.2‑0.8
        const style: React.CSSProperties = {
          position: 'absolute',
          bottom: '-5px',
          left: `${left}%`,
          width: `${size}px`,
          height: `${size}px`,
          background: 'rgba(255,255,255,0.8)',
          borderRadius: '50%',
          opacity,
          animation: `rise ${duration}s linear ${delay}s infinite`,
        };
        return <div key={i} style={style} />;
      })}
    </div>
  );
}
