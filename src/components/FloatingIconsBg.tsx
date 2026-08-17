import { useEffect, useRef } from "react";

/* ─────────────────────────────────────────────────────────────────────────────
   FloatingIconsBg
   ─────────────────────────────────────────────────────────────────────────────
   Animated SVG icons scattered across the background — floating gently with
   slow CSS drift and subtle opacity pulses. Renders on every page behind
   content (z-index: -1, fixed), respects prefers-reduced-motion.

   Each icon is a detailed AI-generative-style SVG (circuit traces, network
   nodes, hexagons, waveforms) — not just basic shapes.
   ────────────────────────────────────────────────────────────────────────── */

interface IconParticle {
  id: number;
  svg: string;
  size: number;
  x: number;
  y: number;
  duration: number;
  delay: number;
  opacity: number;
  amplitude: number;
  hue: number;
}

const AI_ICONS: string[] = [
  // Circuit trace node
  `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M24 4C25.1 4 26 4.9 26 6C26 7.1 25.1 8 24 8C22.9 8 22 7.1 22 6C22 4.9 22.9 4 24 4Z"/><path d="M24 14C26.21 14 28 15.79 28 18C28 20.21 26.21 22 24 22C21.79 22 20 20.21 20 18C20 15.79 21.79 14 24 14ZM24 14L24 28" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M22 26C22 26 18 26 18 30C18 34 22 38 22 38" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M26 26C26 26 30 26 30 30C30 34 26 38 26 38" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="24" cy="38" r="2" fill="currentColor"/></svg>`,
  // Hexagonal network node
  `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 8L12 14V22L20 28L28 22V14L20 8Z" stroke="currentColor" stroke-width="1.5"/><path d="M12 14L6 18V26L12 30V14Z" stroke="currentColor" stroke-width="1.5"/><path d="M20 28L12 34V42L20 46L28 42V34L20 28Z" stroke="currentColor" stroke-width="1.5"/><circle cx="24" cy="28" r="2" fill="currentColor"/></svg>`,
  // Waveform / signal
  `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 32C6 28 10 24 14 22C18 20 22 21 26 20C30 19 34 21 38 18C42 15 44 10 44 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 30C6 26 10 22 14 20C18 18 22 19 26 18C30 17 34 19 38 16C42 13 44 8 44 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="8" cy="36" r="2.5" fill="currentColor"/></svg>`,
  // Neural network node
  `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="16" r="3" fill="currentColor"/><circle cx="36" cy="16" r="3" fill="currentColor"/><circle cx="24" cy="34" r="3" fill="currentColor"/><line x1="12" y1="16" x2="24" y2="34" stroke="currentColor" stroke-width="1" stroke-opacity="0.4"/><line x1="36" y1="16" x2="24" y2="34" stroke="currentColor" stroke-width="1" stroke-opacity="0.4"/><path d="M14 12L10 8M34 12L38 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  // Abstract data flow
  `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="8" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="34" y="8" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="21" y="34" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M14 14L24 14L34 14" stroke="currentColor" stroke-width="1" stroke-opacity="0.3" stroke-dasharray="2 2"/><path d="M11 11L11 24L11 33" stroke="currentColor" stroke-width="1" stroke-opacity="0.3" stroke-dasharray="2 2"/><path d="M37 11L37 24L37 33" stroke="currentColor" stroke-width="1" stroke-opacity="0.3" stroke-dasharray="2 2"/></svg>`,
];

function generateParticles(count: number): IconParticle[] {
  const particles: IconParticle[] = [];
  for (let i = 0; i < count; i++) {
    particles.push({
      id: i,
      svg: AI_ICONS[Math.floor(Math.random() * AI_ICONS.length)],
      size: Math.random() * 20 + 16,
      x: Math.random() * 100,
      y: Math.random() * 100,
      duration: Math.random() * 25 + 15,
      delay: Math.random() * -15,
      opacity: Math.random() * 0.1 + 0.03,
      amplitude: Math.random() * 40 + 30,
      hue: Math.random() * 40 + 180,
    });
  }
  return particles;
}

export default function FloatingIconsBg() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReduced =
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      containerRef.current?.classList.add("reduced-motion");
    }
  }, []);

  const particles = generateParticles(25);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="floating-icons pointer-events-none fixed inset-0 z-[-1] overflow-hidden"
    >
      <style>{`
        .floating-icons .icon {
          position: absolute;
          width: var(--size);
          height: var(--size);
          opacity: var(--opacity);
          color: hsla(var(--hue), 100%, 75%, 0.4);
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
          animation-direction: alternate;
          will-change: transform, opacity;
          filter: blur(0.5px);
        }

        @keyframes iconFloat {
          0% {
            transform: translate(0, 0) scale(1) rotate(0deg);
            opacity: var(--opacity);
          }
          20% {
            transform: translate(calc(var(--amp) * 0.4px), calc(var(--amp) * -0.2px)) scale(1.03) rotate(1deg);
            opacity: calc(var(--opacity) * 1.4);
          }
          40% {
            transform: translate(calc(var(--amp) * -0.2px), calc(var(--amp) * 0.4px)) scale(0.97) rotate(-1deg);
            opacity: var(--opacity);
          }
          60% {
            transform: translate(calc(var(--amp) * 0.3px), calc(var(--amp) * 0.3px)) scale(1.02) rotate(1deg);
            opacity: calc(var(--opacity) * 1.3);
          }
          80% {
            transform: translate(calc(var(--amp) * -0.4px), calc(var(--amp) * -0.1px)) scale(0.98) rotate(-1deg);
            opacity: var(--opacity);
          }
          100% {
            transform: translate(0, 0) scale(1) rotate(0deg);
            opacity: var(--opacity);
          }
        }

        .floating-icons .icon {
          animation-name: iconFloat;
        }

        .floating-icons.reduced-motion .icon {
          animation: none !important;
        }

        @media (prefers-reduced-motion: reduce) {
          .floating-icons .icon {
            animation: none !important;
          }
        }

        /* Light mode: softer, less saturation */
        [data-theme="light"] .floating-icons .icon {
          color: hsla(var(--hue), 50%, 60%, 0.25);
          opacity: calc(var(--opacity) * 0.7);
        }
      `}</style>

      {particles.map((p) => (
        <span
          key={p.id}
          className="icon"
          style={{
            "--size": `${p.size}px`,
            "--opacity": p.opacity,
            "--hue": p.hue,
            "--amp": p.amplitude,
            left: `${p.x}%`,
            top: `${p.y}%`,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          } as React.CSSProperties}
          dangerouslySetInnerHTML={{ __html: p.svg }}
        />
      ))}
    </div>
  );
}
