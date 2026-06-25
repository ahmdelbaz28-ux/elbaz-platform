import { useState, useEffect, useRef } from "react";

interface ArcFlashButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: "primary" | "outline";
  arcColor?: string;
}

function generateArcPath(cx: number, cy: number, length: number): string {
  const points = [];
  const steps = 8;
  let x = cx, y = cy;
  const angle = Math.random() * Math.PI * 2;
  for (let i = 0; i < steps; i++) {
    x += (Math.random() - 0.5) * length * 0.4;
    y += (Math.random() - 0.5) * length * 0.4;
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
      const edge = Math.floor(Math.random() * 4);
      let cx = 0, cy = 0;
      if (edge === 0) { cx = Math.random() * w; cy = 0; }
      else if (edge === 1) { cx = w; cy = Math.random() * h; }
      else if (edge === 2) { cx = Math.random() * w; cy = h; }
      else { cx = 0; cy = Math.random() * h; }

      const newArc = { id: arcId.current++, d: generateArcPath(cx, cy, 30), opacity: 1 };
      setArcs(prev => [...prev.slice(-8), newArc]);
    }, 80);

    return () => clearInterval(spawn);
  }, [hovering]);

  // Fade arcs
  useEffect(() => {
    if (arcs.length === 0) return;
    const t = setTimeout(() => {
      setArcs(prev => prev.map(a => ({ ...a, opacity: a.opacity - 0.3 })).filter(a => a.opacity > 0));
    }, 60);
    return () => clearTimeout(t);
  }, [arcs]);

  const baseClass = variant === "primary"
    ? `bg-gradient-to-r from-[#06b6d4] to-[#0891b2] text-[#0a0e17] font-semibold`
    : `border border-[#1f2d44] bg-transparent text-[#f0f4f8]`;

  return (
    <div
      ref={containerRef}
      className="relative inline-block"
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
