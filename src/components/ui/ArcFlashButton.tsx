import { visualRandom } from "@/lib/random";
import { useState, useEffect, useRef } from "react";

interface ArcFlashButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly children: React.ReactNode;
  readonly variant?: "primary" | "outline";
  readonly arcColor?: string;
}

// Module-scope helper: fade out arcs by 0.3 and drop any that reach 0.
// Extracted so the .map/.filter callbacks are not nested 5+ levels deep
// inside useEffect → setTimeout → setArcs → .map (SonarCloud S2004).
function fadeArcs(prev: ReadonlyArray<{ id: number; d: string; opacity: number }>) {
  return prev
    .map(a => ({ ...a, opacity: a.opacity - 0.3 }))
    .filter(a => a.opacity > 0);
}

function generateArcPath(cx: number, cy: number, length: number): string {
  const points = [];
  const steps = 8;
  let x = cx, y = cy;
  // Note: `angle` was previously computed here but never used — the arc
  // points are generated with visualRandom() offsets below. Removed to
  // satisfy SonarCloud S2933 / tsc TS6133.
  for (let i = 0; i < steps; i++) {
    x += (visualRandom() - 0.5) * length * 0.4;
    y += (visualRandom() - 0.5) * length * 0.4;
    points.push(`${x},${y}`);
  }
  return `M ${cx} ${cy} L ${points.join(" L ")}`;
}

export default function ArcFlashButton({
  children,
  variant = "primary",
  arcColor = "#06b6d4",
  className = "",
  ...props
}: ArcFlashButtonProps) {
  const [arcs, setArcs] = useState<{ id: number; d: string; opacity: number }[]>([]);
  const [hovering, setHovering] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const arcId = useRef(0);

  useEffect(() => {
    if (!hovering) { setArcs([]); return; }

    const spawn = setInterval(() => {
      if (!containerRef.current) return;
      const w = containerRef.current.offsetWidth;
      const h = containerRef.current.offsetHeight;
      // Spawn arc from random edge point
      const edge = Math.floor(visualRandom() * 4);
      let cx = 0, cy = 0;
      if (edge === 0) { cx = visualRandom() * w; }
      else if (edge === 1) { cx = w; cy = visualRandom() * h; }
      else if (edge === 2) { cx = visualRandom() * w; cy = h; }
      else { cy = visualRandom() * h; }

      const newArc = { id: arcId.current++, d: generateArcPath(cx, cy, 30), opacity: 1 };
      setArcs(prev => [...prev.slice(-8), newArc]);
    }, 80);

    return () => clearInterval(spawn);
  }, [hovering]);

  // Fade arcs
  useEffect(() => {
    if (arcs.length === 0) return;
    const t = setTimeout(() => {
      setArcs(fadeArcs);
    }, 60);
    return () => clearTimeout(t);
  }, [arcs]);

  const baseClass = variant === "primary"
    ? `bg-gradient-to-r from-[#06b6d4] to-[#0891b2] text-[#0a0e17] font-semibold`
    : `border border-[#1f2d44] bg-transparent text-[#f0f4f8]`;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: wrapper div for visual hover effects only; the inner <button> handles all interaction
    <div
      ref={containerRef}
      className="relative inline-block"
      role="presentation"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <button
        {...props}
        className={`relative h-12 gap-2 overflow-hidden rounded-lg px-7 text-sm transition-all duration-200 ${baseClass} ${
          hovering
            ? "shadow-[0_0_20px_rgba(6,182,212,0.5),0_0_40px_rgba(6,182,212,0.2)]"
            : "shadow-none"
        } ${className}`}
      >
        {children}
      </button>
      {/* Arc Flash SVG overlay */}
      {hovering && (
        <svg
          className="pointer-events-none absolute inset-0 w-full h-full overflow-visible"
          style={{ zIndex: 10 }}
          aria-hidden="true"
        >
          {arcs.map(arc => (
            <path
              key={arc.id}
              d={arc.d}
              stroke={arcColor}
              strokeWidth={1.5}
              fill="none"
              opacity={arc.opacity}
              filter="url(#arc-glow)"
              strokeLinecap="round"
            />
          ))}
          <defs>
            <filter id="arc-glow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
        </svg>
      )}
    </div>
  );
}
