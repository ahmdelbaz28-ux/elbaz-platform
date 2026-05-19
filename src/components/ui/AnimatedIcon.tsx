import { motion, useInView, useAnimation } from "framer-motion";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/components/ui/motion";

interface AnimatedIconProps {
  icon: ReactNode;
  label?: string;
  className?: string;
  iconClassName?: string;
  labelClassName?: string;
  variant?: "default" | "glow" | "orbit" | "morph" | "flip" | "bounce";
  delay?: number;
  size?: "sm" | "md" | "lg" | "xl";
  color?: string;
  onClick?: () => void;
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
  iconClassName,
  labelClassName,
  variant = "default",
  delay = 0,
  size = "md",
  color = "#06b6d4",
  onClick,
}: AnimatedIconProps) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });
  const controls = useAnimation();

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
      <motion.div
        className={cn(iconSizeMap[size], "relative z-10")}
        style={{ color }}
        whileHover={{ scale: 1.15, rotate: [0, -10, 10, -5, 5, 0] }}
        whileTap={{ scale: 0.9 }}
        transition={{ duration: 0.4 }}
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
