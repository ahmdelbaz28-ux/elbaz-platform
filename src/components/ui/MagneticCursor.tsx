import { useEffect, useState, useRef } from "react";
import { motion, useSpring } from "framer-motion";

interface MagneticCursorProps {
  enabled?: boolean;
  color?: string;
  size?: number;
  intensity?: number;
}

export default function MagneticCursor({
  enabled = true,
  color = "rgba(6, 182, 212, 0.06)",
  size = 300,
  intensity = 0.3,
}: MagneticCursorProps) {
  const [position, setPosition] = useState({ x: -500, y: -500 });
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const springX = useSpring(position.x, { stiffness: 150, damping: 20, mass: 0.5 });
  const springY = useSpring(position.y, { stiffness: 150, damping: 20, mass: 0.5 });

  useEffect(() => {
    if (!enabled) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPosition({ x: e.clientX, y: e.clientY });
      if (!isVisible) setIsVisible(true);
    };

    const handleMouseLeave = () => {
      setPosition({ x: -500, y: -500 });
      setIsVisible(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [enabled, isVisible]);

  if (!enabled) return null;

  return (
    <motion.div
      ref={ref}
      className="fixed pointer-events-none z-0"
      style={{
        left: springX,
        top: springY,
        width: size,
        height: size,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
        transform: "translate(-50%, -50%)",
        opacity: isVisible ? 1 : 0,
        transition: { opacity: 0.3 },
      }}
    />
  );
}
