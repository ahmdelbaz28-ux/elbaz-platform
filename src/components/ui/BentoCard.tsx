import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useRef, type ReactNode } from "react";
import { cn } from "@/components/ui/motion";

interface BentoCardProps {
  children: ReactNode;
  className?: string;
  span?: 1 | 2 | 3;
  rowSpan?: 1 | 2;
  delay?: number;
  glowColor?: string;
  onClick?: () => void;
}

export default function BentoCard({
  children,
  className,
  span = 1,
  rowSpan = 1,
  delay = 0,
  glowColor = "rgba(6, 182, 212, 0.08)",
  onClick,
}: BentoCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const mouseXSpring = useSpring(x, { stiffness: 500, damping: 100 });
  const mouseYSpring = useSpring(y, { stiffness: 500, damping: 100 });

  const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], ["8deg", "-8deg"]);
  const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], ["-8deg", "8deg"]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const xPct = mouseX / width - 0.5;
    const yPct = mouseY / height - 0.5;
    x.set(xPct);
    y.set(yPct);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  const spanClass = span === 2 ? "bento-span-2" : span === 3 ? "bento-span-3" : "";
  const rowSpanClass = rowSpan === 2 ? "bento-row-2" : "";

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30, scale: 0.95 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 25,
        delay,
      }}
      style={{
        rotateX,
        rotateY,
        transformStyle: "preserve-3d",
        perspective: 1000,
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "bento-card relative group",
        spanClass,
        rowSpanClass,
        className
      )}
      onClick={onClick}
    >
      {/* Spotlight effect */}
      <motion.div
        className="absolute inset-0 rounded-[inherit] pointer-events-none"
        style={{
          background: useTransform(
            [mouseXSpring, mouseYSpring],
            ([mx, my]) => {
              if (!ref.current) return "transparent";
              const rect = ref.current.getBoundingClientRect();
              const x = mx * rect.width + rect.width / 2;
              const y = my * rect.height + rect.height / 2;
              return `radial-gradient(300px circle at ${x}px ${y}px, ${glowColor}, transparent 60%)`;
            }
          ),
        }}
      />

      {/* Content */}
      <div className="relative z-10 h-full" style={{ transform: "translateZ(20px)" }}>
        {children}
      </div>

      {/* Reflection overlay */}
      <div className="tilt-reflection" />
    </motion.div>
  );
}
