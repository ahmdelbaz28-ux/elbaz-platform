import { useEffect, useRef } from "react";

/* ─────────────────────────────────────────────────────────────────────────────
   AmbientOrbs
   ─────────────────────────────────────────────────────────────────────────────
   Floating, semi-transparent gradient orbs that drift slowly across the
   background — adding depth and visual richness without distraction.
   
   Features:
   • Theme-aware colors (cyan/purple for dark, soft gray/blue for light)
   • GPU-accelerated CSS animations (no JS per frame)
   • Respects prefers-reduced-motion
   • Multiple orbs with different sizes, speeds, and positions
   • Accessible (aria-hidden, pointer-events: none)
   ───────────────────────────────────────────────────────────────────────────── */

interface Orb {
  id: number;
  size: number;
  x: string;
  y: string;
  duration: number;
  delay: number;
  hue: string;
}

const DARK_MODE_ORBS: Orb[] = [
  { id: 1, size: 400, x: "10%", y: "20%", duration: 25, delay: 0, hue: "6, 182, 212" },
  { id: 2, size: 300, x: "70%", y: "60%", duration: 30, delay: -10, hue: "139, 92, 246" },
  { id: 3, size: 250, x: "30%", y: "70%", duration: 20, delay: -5, hue: "16, 185, 129" },
  { id: 4, size: 350, x: "80%", y: "10%", duration: 35, delay: -15, hue: "6, 182, 212" },
];

const LIGHT_MODE_ORBS: Orb[] = [
  { id: 1, size: 300, x: "15%", y: "25%", duration: 25, delay: 0, hue: "6, 182, 212" },
  { id: 2, size: 250, x: "75%", y: "55%", duration: 30, delay: -10, hue: "100, 116, 139" },
  { id: 3, size: 200, x: "40%", y: "65%", duration: 22, delay: -7, hue: "139, 92, 246" },
  { id: 4, size: 280, x: "85%", y: "15%", duration: 28, delay: -12, hue: "8, 145, 178" },
];

export default function AmbientOrbs() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    
    if (prefersReduced) {
      // Remove animation class if reduced motion is preferred
      containerRef.current?.classList.add("reduced-motion");
    }
  }, []);

  // Detect theme and select appropriate orbs
  const isLight = typeof document !== "undefined" 
    ? document.documentElement.getAttribute("data-theme") === "light"
    : false;
  
  const orbs = isLight ? LIGHT_MODE_ORBS : DARK_MODE_ORBS;

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="ambient-orbs pointer-events-none fixed inset-0 z-[-1] overflow-hidden"
    >
      <style>{`
        .ambient-orbs .orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.15;
          animation-timing-function: ease-in-out;
          animation-iteration-count: infinite;
          animation-direction: alternate;
          will-change: transform;
        }
        
        .ambient-orbs .orb-1 {
          animation: orbFloat1 var(--duration-1, 25s) infinite;
        }
        .ambient-orbs .orb-2 {
          animation: orbFloat2 var(--duration-2, 30s) infinite;
        }
        .ambient-orbs .orb-3 {
          animation: orbFloat3 var(--duration-3, 20s) infinite;
        }
        .ambient-orbs .orb-4 {
          animation: orbFloat4 var(--duration-4, 35s) infinite;
        }
        
        @keyframes orbFloat1 {
          0% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.05); }
          66% { transform: translate(-20px, 30px) scale(0.95); }
          100% { transform: translate(0, 0) scale(1); }
        }
        
        @keyframes orbFloat2 {
          0% { transform: translate(0, 0) scale(1); }
          25% { transform: translate(-40px, 20px) scale(1.08); }
          50% { transform: translate(20px, 40px) scale(0.92); }
          75% { transform: translate(30px, -30px) scale(1.03); }
          100% { transform: translate(0, 0) scale(1); }
        }
        
        @keyframes orbFloat3 {
          0% { transform: translate(0, 0) scale(1); }
          40% { transform: translate(25px, 35px) scale(1.06); }
          70% { transform: translate(-35px, -20px) scale(0.94); }
          100% { transform: translate(0, 0) scale(1); }
        }
        
        @keyframes orbFloat4 {
          0% { transform: translate(0, 0) scale(1); }
          30% { transform: translate(-25px, -40px) scale(1.04); }
          60% { transform: translate(40px, 25px) scale(0.96); }
          100% { transform: translate(0, 0) scale(1); }
        }
        
        /* Light mode: softer, more subtle */
        [data-theme="light"] .ambient-orbs .orb {
          opacity: 0.08;
          filter: blur(100px);
        }
        
        /* Reduced motion */
        .ambient-orbs.reduced-motion .orb {
          animation: none !important;
        }
        
        @media (prefers-reduced-motion: reduce) {
          .ambient-orbs .orb {
            animation: none !important;
          }
        }
      `}</style>
      
      {orbs.map((orb, index) => (
        <div
          key={orb.id}
          className={`orb orb-${index + 1}`}
          style={{
            width: orb.size,
            height: orb.size,
            left: orb.x,
            top: orb.y,
            background: `radial-gradient(circle, rgba(${orb.hue}, 0.5) 0%, rgba(${orb.hue}, 0.2) 50%, transparent 70%)`,
            animationDelay: `${orb.delay}s`,
            ["--duration-" + (index + 1)]: `${orb.duration}s`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
