import { useEffect, useRef, useState, useCallback } from "react";

interface SLDProps {
  color?: string;
  enabled?: boolean;
}

// Electrical network path segments (busbar + transformer + breaker layout)
const PATHS = [
  "M 50 80 L 700 80",           // Main busbar top
  "M 100 80 L 100 200",         // Feeder 1 down
  "M 250 80 L 250 200",         // Feeder 2 down
  "M 400 80 L 400 200",         // Feeder 3 down
  "M 550 80 L 550 200",         // Feeder 4 down
  "M 100 200 L 100 300",        // To transformer 1
  "M 250 200 L 250 300",        // To transformer 2
  "M 400 200 L 400 300",        // To transformer 3
  "M 550 200 L 550 300",        // To transformer 4
  "M 70 320 L 730 320",         // Secondary busbar
  "M 150 320 L 150 420",        // Load feeder 1
  "M 300 320 L 300 420",        // Load feeder 2
  "M 450 320 L 450 420",        // Load feeder 3
  "M 600 320 L 600 420",        // Load feeder 4
];

// Transformer symbols (circles at midpoint)
const TRANSFORMERS = [
  { x: 100, y: 250, r: 18 },
  { x: 250, y: 250, r: 18 },
  { x: 400, y: 250, r: 18 },
  { x: 550, y: 250, r: 18 },
];

// Breaker symbols (small rectangles)
const BREAKERS = [
  { x: 92, y: 170, w: 16, h: 22 },
  { x: 242, y: 170, w: 16, h: 22 },
  { x: 392, y: 170, w: 16, h: 22 },
  { x: 542, y: 170, w: 16, h: 22 },
];

// Load symbols (ground-like)
const LOADS = [
  { x: 150, y: 420 },
  { x: 300, y: 420 },
  { x: 450, y: 420 },
  { x: 600, y: 420 },
];

export default function SingleLineDiagram({ color = "#06b6d4", enabled = true }: SLDProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [particles, setParticles] = useState<{ id: number; progress: number; pathIndex: number }[]>([]);
  const [activePathIdx, setActivePathIdx] = useState<number | null>(null);
  const animFrameRef = useRef<number>();
  const particleId = useRef(0);

  // Animate particles along paths
  useEffect(() => {
    if (!enabled) return;
    const spawn = setInterval(() => {
      const pathIdx = Math.floor(Math.random() * PATHS.length);
      setParticles(prev => [
        ...prev.filter(p => p.progress < 1),
        { id: particleId.current++, progress: 0, pathIndex: pathIdx },
      ].slice(-24)); // max 24 particles
    }, 220);

    return () => clearInterval(spawn);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      setParticles(prev =>
        prev
          .map(p => ({ ...p, progress: p.progress + 0.014 }))
          .filter(p => p.progress <= 1)
      );
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, [enabled]);

  // Mouse proximity glow
  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 750;
    const my = ((e.clientY - rect.top) / rect.height) * 450;

    // Find closest path
    let closest = -1;
    let minDist = 999;
    PATHS.forEach((_, i) => {
      const pt = getPathPoint(i, 0.5);
      const d = Math.hypot(pt.x - mx, pt.y - my);
      if (d < minDist) { minDist = d; closest = i; }
    });
    setActivePathIdx(minDist < 80 ? closest : null);
  }, []);

  if (!enabled) return null;

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 750 450"
      className="absolute inset-0 w-full h-full pointer-events-auto select-none"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setActivePathIdx(null)}
      aria-hidden="true"
    >
      <defs>
        <filter id="sld-glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="sld-glow-strong">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Grid background dots */}
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <circle cx="20" cy="20" r="0.8" fill={color} opacity="0.15" />
      </pattern>
      <rect width="750" height="450" fill="url(#grid)" />

      {/* Lines */}
      {PATHS.map((d, i) => (
        <path
          key={i}
          d={d}
          stroke={color}
          strokeWidth={activePathIdx === i ? 2 : 1}
          fill="none"
          opacity={activePathIdx === i ? 0.7 : 0.18}
          filter={activePathIdx === i ? "url(#sld-glow)" : undefined}
          style={{ transition: "all 0.2s" }}
        />
      ))}

      {/* Transformer circles */}
      {TRANSFORMERS.map((t, i) => (
        <g key={i}>
          <circle cx={t.x} cy={t.y - 8} r={t.r} stroke={color} strokeWidth={1} fill="none" opacity={0.3} />
          <circle cx={t.x} cy={t.y + 8} r={t.r} stroke={color} strokeWidth={1} fill="none" opacity={0.3} />
        </g>
      ))}

      {/* Breakers */}
      {BREAKERS.map((b, i) => (
        <rect
          key={i}
          x={b.x} y={b.y} width={b.w} height={b.h}
          fill={`${color}22`}
          stroke={color}
          strokeWidth={1}
          rx={2}
          opacity={0.4}
        />
      ))}

      {/* Load symbols */}
      {LOADS.map((l, i) => (
        <g key={i} opacity={0.35}>
          <line x1={l.x - 14} y1={l.y} x2={l.x + 14} y2={l.y} stroke={color} strokeWidth={1.5} />
          <line x1={l.x - 10} y1={l.y + 7} x2={l.x + 10} y2={l.y + 7} stroke={color} strokeWidth={1.5} />
          <line x1={l.x - 5} y1={l.y + 14} x2={l.x + 5} y2={l.y + 14} stroke={color} strokeWidth={1.5} />
        </g>
      ))}

      {/* Animated current particles */}
      {particles.map(p => {
        const pt = getPathPoint(p.pathIndex, p.progress);
        return (
          <circle
            key={p.id}
            cx={pt.x}
            cy={pt.y}
            r={3}
            fill={color}
            opacity={0.9 - p.progress * 0.5}
            filter="url(#sld-glow-strong)"
          />
        );
      })}
    </svg>
  );
}

// Interpolate position along a path
function getPathPoint(pathIndex: number, t: number): { x: number; y: number } {
  const path = PATHS[pathIndex];
  const parts = path.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
  const [x1, y1, x2, y2] = parts;
  return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t };
}
