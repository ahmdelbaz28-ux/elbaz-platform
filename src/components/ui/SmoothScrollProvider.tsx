import { useEffect, useRef } from "react";
import { ScrollTrigger, ScrollSmoother } from "@/gsap-setup";

interface SmoothScrollProviderProps {
  children: React.ReactNode;
}

export default function SmoothScrollProvider({ children }: SmoothScrollProviderProps) {
  const mainRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!mainRef.current || !scrollerRef.current) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const smoother = ScrollSmoother.create({
      wrapper: mainRef.current,
      content: scrollerRef.current,
      smooth: 1.5,
      normalizeScroll: true,
    });

    return () => {
      smoother.kill();
      ScrollTrigger.getAll().forEach((trigger) => { trigger.kill(); });
    };
  }, []);

  return (
    <div ref={mainRef}>
      <div ref={scrollerRef}>{children}</div>
    </div>
  );
}
