import { motion, useInView, useAnimation, useScroll, useTransform } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/ui/motion";

/* -------------------------------------------------------------------------- */
/*  AnimatedIcon                                                               */
/*  ─────────────────────────────────────────────────────────────────────────  */
/*  Modern icon component with powerful, contemporary animations.              */
/*  Variants:                                                                  */
/*    • default — gentle fade-up + scale-in                                    */
/*    • glow    — pulsing accent halo around the icon                          */
/*    • orbit   — small satellite dot orbiting the icon                        */
/*    • morph   — shape-shifting background (rounded square → circle)          */
/*    • flip    — 3D Y-axis flip on hover                                      */
/*    • bounce  — vertical bounce on hover                                      */
/*    • pulse   — continuous soft scale pulse                                  */
/*    • ripple  — concentric ripple on hover                                   */
/*    • tilt    — 3D tilt that follows hover position                          */
/*    • float   — scroll-triggered floating animation (NEW)                    */
/* -------------------------------------------------------------------------- */

interface AnimatedIconProps {
  icon: ReactNode;
  label?: string;
  className?: string;
  labelClassName?: string;
  variant?: "default" | "glow" | "orbit" | "morph" | "flip" | "bounce" | "pulse" | "ripple" | "tilt" | "float";
  delay?: number;
  size?: "sm" | "md" | "lg" | "xl";
  color?: string;
  onClick?: () => void;
  /** Enable parallax floating effect on scroll */
  parallax?: boolean;
  /** Custom parallax intensity (default: 0.5) */
  parallaxIntensity?: number;
}

const sizeMap = {
  sm: "h-10 w-10",
  md: "h-14 w-14",
  lg: "h-20 w-20",
  xl: "h-28 w-28",
};

const iconSizeMap = {
  sm: "h-5 w-5",
  md: "h-7 w-7",
  lg: "h-10 w-10",
  xl: "h-14 w-14",
};

export default function AnimatedIcon({
  icon,
  label,
  className,
  labelClassName,
  variant = "default",
  delay = 0,
  size = "md",
  color = "#06b6d4",
  onClick,
  parallax = false,
  parallaxIntensity = 0.5,
}: AnimatedIconProps) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });
  const controls = useAnimation();

  // Scroll-based parallax effect
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"]
  });
  const y = useTransform(scrollYProgress, [0, 1], [30 * parallaxIntensity, -30 * parallaxIntensity]);
  const rotate = useTransform(scrollYProgress, [0, 1], [2 * parallaxIntensity, -2 * parallaxIntensity]);
  const scale = useTransform(scrollYProgress, [0, 0.5, 1], [0.95, 1.05, 0.95]);

  useEffect(() => {
    if (isInView) {
      controls.start("visible");
    }
  }, [isInView, controls]);

  const containerVariants = {
    hidden: { opacity: 0, y: 30, scale: 0.9 },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        type: "spring" as const,
        stiffness: 300,
        damping: 20,
        delay,
      },
    },
  };

  const iconVariants = {
    hidden: { rotate: -180, scale: 0 },
    visible: {
      rotate: 0,
      scale: 1,
      transition: {
        type: "spring" as const,
        stiffness: 200,
        damping: 15,
        delay: delay + 0.15,
      },
    },
  };

  const renderIcon = () => (
    <motion.div
      variants={iconVariants}
      className={cn(sizeMap[size], "flex items-center justify-center rounded-xl relative")}
      style={{
        background: `rgba(${hexToRgb(color)}, 0.1)`,
        border: `1px solid rgba(${hexToRgb(color)}, 0.2)`,
      }}
    >
      {variant === "glow" && (
        <motion.div
          className="absolute inset-0 rounded-xl"
          animate={{
            boxShadow: [
              `0 0 0px ${color}00`,
              `0 0 20px ${color}40`,
              `0 0 0px ${color}00`,
            ],
          }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      {variant === "orbit" && (
        <>
          <div className="absolute inset-0 rounded-full border border-dashed opacity-20" style={{ borderColor: color }} />
          <motion.div
            className="absolute w-1.5 h-1.5 rounded-full"
            style={{ background: color }}
            animate={{ rotate: 360 }}
            transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
            originX="50%"
            originY="50%"
          />
        </>
      )}
      {variant === "morph" && (
        <motion.div
          className="absolute inset-0 rounded-xl"
          style={{ background: `rgba(${hexToRgb(color)}, 0.05)` }}
          animate={{
            borderRadius: ["12px", "50%", "12px"],
            rotate: [0, 180, 360],
          }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      {variant === "pulse" && (
        <motion.div
          className="absolute inset-0 rounded-xl"
          style={{ background: `rgba(${hexToRgb(color)}, 0.06)` }}
          animate={{
            scale: [1, 1.08, 1],
            opacity: [0.6, 1, 0.6],
          }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      {variant === "ripple" && (
        <>
          {[0, 0.6, 1.2].map((t) => (
            <motion.span
              key={t}
              className="absolute inset-0 rounded-xl"
              style={{ border: `1px solid ${color}` }}
              initial={{ scale: 1, opacity: 0 }}
              whileHover={{ scale: [1, 1.4], opacity: [0.5, 0], transition: { duration: 1.2, repeat: Infinity, delay: t, ease: "easeOut" } }}
            />
          ))}
        </>
      )}
      <motion.div
        className={cn(iconSizeMap[size], "relative z-10")}
        style={{ color }}
        whileHover={{ scale: 1.18, rotate: [0, -10, 10, -5, 5, 0] }}
        whileTap={{ scale: 0.9 }}
        transition={{ duration: 0.45 }}
      >
        {icon}
      </motion.div>
    </motion.div>
  );

  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={controls}
      variants={containerVariants}
      className={cn("flex flex-col items-center gap-3 cursor-pointer group", className)}
      onClick={onClick}
    >
      {variant === "flip" ? (
        <motion.div
          className="relative"
          whileHover={{ rotateY: 180 }}
          transition={{ type: "spring", stiffness: 200, damping: 15 }}
          style={{ perspective: 600 }}
        >
          {renderIcon()}
        </motion.div>
      ) : variant === "bounce" ? (
        <motion.div
          className="relative"
          whileHover={{ y: [-4, -8, -4, 0], transition: { duration: 0.5 } }}
        >
          {renderIcon()}
        </motion.div>
      ) : variant === "tilt" ? (
        <motion.div
          className="relative"
          whileHover={{
            rotateX: [0, -15, 0],
            rotateY: [0, 15, 0],
            transition: { duration: 0.6, ease: "easeInOut" },
          }}
          style={{ perspective: 800, transformStyle: "preserve-3d" }}
        >
          {renderIcon()}
        </motion.div>
      ) : variant === "float" ? (
        // Float variant: continuous floating animation with scroll parallax
        <motion.div
          className="relative"
          animate={parallax ? {
            y: [0, -12, 0, -8, 0],
            rotate: [0, 2, 0, -2, 0],
            scale: [1, 1.02, 1, 1.02, 1],
          } : {
            y: [0, -12, 0, -8, 0],
            rotate: [0, 2, 0, -2, 0],
          }}
          transition={parallax ? {
            duration: 6,
            repeat: Infinity,
            ease: "easeInOut",
          } : {
            duration: 4,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          style={parallax ? {
            y,
            rotate,
            scale,
          } : undefined}
        >
          {renderIcon()}
        </motion.div>
      ) : (
        renderIcon()
      )}
      {label && (
        <motion.span
          className={cn("text-sm font-medium text-[#94a3b8] text-center transition-colors group-hover:text-[#06b6d4]", labelClassName)}
          initial={{ opacity: 0 }}
          animate={controls}
          variants={{
            hidden: { opacity: 0, y: 10 },
            visible: { opacity: 1, y: 0, transition: { delay: delay + 0.3 } },
          }}
        >
          {label}
        </motion.span>
      )}
    </motion.div>
  );
}

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : "6, 182, 212";
}
