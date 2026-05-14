import React from "react";
import { motion, type MotionProps } from "framer-motion";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Utility for Tailwind classes
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── Animation Variants ───

export const FADE_UP_ANIMATION_VARIANTS = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } as const },
};

export const FADE_IN_ANIMATION_VARIANTS = {
  hidden: { opacity: 0, filter: "blur(10px)" },
  show: { opacity: 1, filter: "blur(0px)", transition: { duration: 0.5, ease: "easeOut" } as const },
};

// ─── Components ───

export function FadeUp({
  children,
  className,
  delay = 0,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & MotionProps & { delay?: number }) {
  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-50px" }}
      variants={{
        hidden: { opacity: 0, y: 30 },
        show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24, delay } as const },
      }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function FadeIn({
  children,
  className,
  delay = 0,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & MotionProps & { delay?: number }) {
  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-50px" }}
      variants={{
        hidden: { opacity: 0, filter: "blur(10px)" },
        show: { opacity: 1, filter: "blur(0px)", transition: { duration: 0.6, ease: "easeOut", delay } as const },
      }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function StaggerContainer({
  children,
  className,
  delayChildren = 0.1,
  staggerChildren = 0.1,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & MotionProps & { delayChildren?: number; staggerChildren?: number }) {
  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-50px" }}
      variants={{
        hidden: {},
        show: {
          transition: {
            staggerChildren,
            delayChildren,
          },
        },
      }}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export const StaggerItem = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & MotionProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <motion.div ref={ref} variants={FADE_UP_ANIMATION_VARIANTS} className={className} {...props}>
        {children}
      </motion.div>
    );
  }
);
StaggerItem.displayName = "StaggerItem";

export function HoverSpring({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement> & MotionProps) {
  return (
    <motion.div
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 17 } as const}
      className={className}
      {...props}
    >
      {children}
    </motion.div>
  );
}

// ─── Elite "Master Class" Components ───

/**
 * 3D Tilt Card Effect
 * Adds professional depth that follows mouse movement.
 */
export function TiltCard({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement> & MotionProps) {
  const [rotateX, setRotateX] = React.useState(0);
  const [rotateY, setRotateY] = React.useState(0);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateX = ((y - centerY) / centerY) * -10;
    const rotateY = ((x - centerX) / centerX) * 10;

    setRotateX(rotateX);
    setRotateY(rotateY);
  };

  const handleMouseLeave = () => {
    setRotateX(0);
    setRotateY(0);
  };

  return (
    <motion.div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      animate={{ rotateX, rotateY }}
      transition={{ type: "spring", stiffness: 150, damping: 20 }}
      style={{ perspective: 1000, transformStyle: "preserve-3d" }}
      className={cn("relative transition-all duration-200", className)}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/**
 * Magnetic Attraction Effect
 * Elements feel "alive" by subtly gravitating towards the cursor.
 */
export function Magnetic({ children, ...props }: { children: React.ReactElement }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState({ x: 0, y: 0 });

  const handleMouseMove = (e: MouseEvent) => {
    const { clientX, clientY } = e;
    const { left, top, width, height } = ref.current!.getBoundingClientRect();
    const x = clientX - (left + width / 2);
    const y = clientY - (top + height / 2);
    setPosition({ x: x * 0.2, y: y * 0.2 });
  };

  const handleMouseLeave = () => {
    setPosition({ x: 0, y: 0 });
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove as any}
      onMouseLeave={handleMouseLeave}
      animate={{ x: position.x, y: position.y }}
      transition={{ type: "spring", stiffness: 150, damping: 15, mass: 0.1 }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Electric Pulse Aura
 * Subtle breathing neon glow for premium elements.
 */
export function NeonGlow({ children, className, color = "#06b6d4", ...props }: { children: React.ReactNode, className?: string, color?: string }) {
  return (
    <motion.div
      animate={{ 
        boxShadow: [
          `0 0 0px ${color}33`, 
          `0 0 20px ${color}66`, 
          `0 0 0px ${color}33`
        ] 
      }}
      transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      className={cn("rounded-xl", className)}
      {...props}
    >
      {children}
    </motion.div>
  );
}

