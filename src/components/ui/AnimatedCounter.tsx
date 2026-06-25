import { motion, useInView, useAnimation } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/components/ui/motion";

interface AnimatedCounterProps {
  value: number;
  label?: string;
  suffix?: string;
  prefix?: string;
  duration?: number;
  className?: string;
  valueClassName?: string;
  labelClassName?: string;
  decimals?: number;
  color?: string;
}

export default function AnimatedCounter({
  value,
  label,
  suffix = "",
  prefix = "",
  duration = 2000,
  className,
  valueClassName,
  labelClassName,
  decimals = 0,
  color = "#06b6d4",
}: AnimatedCounterProps) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });
  const controls = useAnimation();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (isInView) {
      controls.start("visible");
      let startTime: number;
      let animationFrame: number;

      const animate = (timestamp: number) => {
        if (!startTime) startTime = timestamp;
        const progress = Math.min((timestamp - startTime) / duration, 1);
        const eased = easeOutExpo(progress);
        setCount(eased * value);

        if (progress < 1) {
          animationFrame = requestAnimationFrame(animate);
        }
      };

      animationFrame = requestAnimationFrame(animate);
      return () => cancelAnimationFrame(animationFrame);
    }
  }, [isInView, value, duration, controls]);

  const formattedValue = decimals > 0 ? count.toFixed(decimals) : Math.floor(count).toLocaleString();

  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={controls}
      variants={{
        hidden: { opacity: 0, y: 20 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.6, ease: "easeOut" },
        },
      }}
      className={cn("flex flex-col items-center gap-1", className)}
    >
      <div className="flex items-baseline gap-1">
        {prefix && <span className="text-lg font-medium" style={{ color }}>{prefix}</span>}
        <motion.span
          className={cn("text-4xl font-bold tabular-nums", valueClassName)}
          style={{ color }}
        >
          {formattedValue}
        </motion.span>
        {suffix && <span className="text-lg font-medium" style={{ color }}>{suffix}</span>}
      </div>
      {label && (
        <motion.span
          className={cn("text-sm text-[#94a3b8] text-center", labelClassName)}
          variants={{
            hidden: { opacity: 0 },
            visible: { opacity: 1, transition: { delay: 0.3 } },
          }}
        >
          {label}
        </motion.span>
      )}
    </motion.div>
  );
}

function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}
