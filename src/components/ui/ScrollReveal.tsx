import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/ui/motion";

interface ScrollRevealProps {
  children: ReactNode;
  className?: string;
  direction?: "up" | "left" | "right" | "scale" | "none";
  delay?: number;
  threshold?: number;
  once?: boolean;
}

export default function ScrollReveal({
  children,
  className,
  direction = "up",
  delay = 0,
  threshold = 0.1,
  once = true,
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => setRevealed(true), delay * 1000);
          if (once) observer.disconnect();
        } else if (!once) {
          setRevealed(false);
        }
      },
      { threshold }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [delay, once, threshold]);

  const directionClass =
    direction === "up"
      ? "scroll-reveal"
      : direction === "left"
      ? "scroll-reveal-left"
      : direction === "right"
      ? "scroll-reveal-right"
      : direction === "scale"
      ? "scroll-reveal-scale"
      : "";

  return (
    <div ref={ref} className={cn(directionClass, revealed ? "revealed" : "", className)}>
      {children}
    </div>
  );
}
