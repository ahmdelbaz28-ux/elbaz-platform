import { useEffect } from "react";
import type { RefObject } from "react";
import { gsap } from "@/gsap-setup";

export function useGSAPParallax(ref: RefObject<HTMLElement>, speed: number = 0.1) {
  useEffect(() => {
    if (!ref.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const element = ref.current;
    const tween = gsap.to(element, {
      y: `${speed * 100}%`,
      ease: "none",
      scrollTrigger: {
        trigger: element,
        start: "top bottom",
        end: "bottom top",
        scrub: 0.5,
      },
    });

    return () => { void tween.kill(); };
  }, [ref, speed]);
}

export function useGSAPReveal(
  ref: RefObject<HTMLElement>,
  options: {
    x?: number;
    y?: number;
    opacity?: number;
    duration?: number;
    delay?: number;
    ease?: string;
  } = {}
) {
  useEffect(() => {
    if (!ref.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const element = ref.current;
    element.style.visibility = "visible";

    const tween = gsap.from(element, {
      x: options.x ?? 0,
      y: options.y ?? 50,
      opacity: options.opacity ?? 0,
      duration: options.duration ?? 0.8,
      delay: options.delay ?? 0,
      ease: options.ease ?? "power3.out",
      scrollTrigger: {
        trigger: element,
        start: "top 85%",
        toggleActions: "play none none reverse",
      },
    });

    return () => { void tween.kill(); };
  }, [ref, options]);
}

export function useGSAPStagger(
  ref: RefObject<HTMLElement>,
  selector: string,
  options: {
    y?: number;
    opacity?: number;
    stagger?: number;
    duration?: number;
    ease?: string;
  } = {}
) {
  useEffect(() => {
    if (!ref.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const container = ref.current;
    const elements = container.querySelectorAll(selector);

    const tween = gsap.from(elements, {
      y: options.y ?? 30,
      opacity: options.opacity ?? 0,
      stagger: options.stagger ?? 0.1,
      duration: options.duration ?? 0.8,
      ease: options.ease ?? "power3.out",
      scrollTrigger: {
        trigger: container,
        start: "top 85%",
        toggleActions: "play none none reverse",
      },
    });

    return () => { void tween.kill(); };
  }, [ref, selector, options]);
}
