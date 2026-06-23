import React, { useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";

interface ElectricalIconProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  variant?: "arc" | "shock" | "ripple" | "glow";
  color?: string;
  size?: "sm" | "md" | "lg";
}

export function ElectricalIcon({
  children,
  variant = "glow",
  color = "#06b6d4",
  size = "md",
  className = "",
  ...props
}: ElectricalIconProps) {
  const [arcs, setArcs] = useState<{ id: number; x: number; y: number; opacity: number }[]>([]);
  const [ripples, setRipples] = useState<{ id: number; size: number; opacity: number }[]>([]);
  const [glowIntensity, setGlowIntensity] = useState(0);
  const idRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const sizeMap = { sm: 28, md: 44, lg: 64 };
  const iconSizes = { sm: 14, md: 20, lg: 28 };

  const spawnArc = useCallback((e: React.MouseEvent) => {
    if (variant !== "arc") return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const newArc = {
      id: idRef.current++,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      opacity: 1,
    };
    setArcs(prev => [...prev.slice(-8), newArc]);
    setGlowIntensity(1);
    setTimeout(() => {
      setArcs(prev => prev.map(a => a.id === newArc.id ? { ...a, opacity: a.opacity - 0.2 } : a).filter(a => a.opacity > 0));
      setGlowIntensity(0);
    }, 200);
  }, [variant]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (variant === "ripple") {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const newRipple = { id: idRef.current++, size: 0, opacity: 0.6 };
      setRipples(prev => [...prev, newRipple]);
      setTimeout(() => {
        setRipples(prev => prev.map(r => r.id === newRipple.id ? { ...r, size: r.size + 60, opacity: r.opacity - 0.15 } : r).filter(r => r.opacity > 0));
      }, 10);
    }
    if (variant === "shock") {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const newArc = {
        id: idRef.current++,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        opacity: 1,
      };
      setArcs(prev => [...prev.slice(-12), newArc]);
      setGlowIntensity(1);
      setTimeout(() => {
        setArcs(prev => prev.map(a => a.id === newArc.id ? { ...a, opacity: a.opacity - 0.15 } : a).filter(a => a.opacity > 0));
        setGlowIntensity(0);
      }, 300);
    }
  }, [variant]);

  return (
    <motion.div
      ref={containerRef}
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: sizeMap[size], height: sizeMap[size] }}
      onMouseDown={handleMouseDown}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
      {...props}
    >
      {/* Glow layer */}
      <motion.div
        className="absolute inset-0 rounded-full"
        animate={{
          boxShadow: glowIntensity > 0
            ? `0 0 20px ${color}, 0 0 40px ${color}80`
            : `0 0 ${4 + glowIntensity * 16}px ${color}40`,
        }}
        transition={{ duration: 0.15 }}
        style={{ pointerEvents: "none" }}
      />

      {/* Ripple effects */}
      {ripples?.map(r => (
        <div
          key={r.id}
          className="absolute rounded-full pointer-events-none"
          style={{
            width: r.size, height: r.size,
            left: `calc(50% - ${r.size / 2}px)`,
            top: `calc(50% - ${r.size / 2}px)`,
            border: `1.5px solid ${color}`,
            opacity: r.opacity,
          }}
        />
      ))}

      {/* Arc flash SVGs */}
      {arcs?.map(arc => (
        <svg
          key={arc.id}
          className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
          style={{ opacity: arc.opacity }}
          aria-hidden="true"
        >
          <path
            d={`M ${arc.x} ${arc.y} Q ${arc.x + (Math.random() - 0.5) * 30} ${arc.y + (Math.random() - 0.5) * 30} ${arc.x + (Math.random() - 0.5) * 40} ${arc.y + (Math.random() - 0.5) * 40}`}
            stroke={color}
            strokeWidth={2}
            fill="none"
            filter={`url(#arc-glow-${arc.id})`}
          />
          <defs>
            <filter id={`arc-glow-${arc.id}`}>
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
        </svg>
      ))}

      {/* Icon container */}
      <div className="relative z-10" style={{ color }}>
        {React.isValidElement(children)
          ? React.cloneElement(children as React.ReactElement<any>, {
              style: {
                ...((children as React.ReactElement<any>).props?.style || {}),
                width: iconSizes[size],
                height: iconSizes[size],
                strokeWidth: 1.5,
              }
            })
          : children}
      </div>
    </motion.div>
  );
}

export default ElectricalIcon;