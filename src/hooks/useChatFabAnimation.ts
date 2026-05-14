/**
 * useChatFabAnimation — Shake + Sparkle Particles Effect for ChatBot FAB
 *
 * Adds an attention-grabbing animation to the chatbot floating action button:
 * - Periodic shake animation (every 25 seconds, 3 shakes)
 * - Sparkle particles that burst outward from the button
 * - Respects reduced-motion preference
 * - Cleans up all timers and DOM elements on unmount
 *
 * Usage:
 *   const fabRef = useChatFabAnimation();
 *   <button ref={fabRef}>...</button>
 */

import { useEffect, useRef, useCallback } from "react";

interface UseChatFabAnimationOptions {
  /** Interval between shake animations in ms (default: 25000) */
  shakeIntervalMs?: number;
  /** Number of sparkle particles per burst (default: 8) */
  sparklesPerBurst?: number;
  /** Whether the animation is enabled (default: true) */
  enabled?: boolean;
}

const SHAKE_INTERVAL_MS = 25_000; // 25 seconds
const SPARKLES_PER_BURST = 8;
const SPARKLE_LIFETIME_MS = 1_200; // 1.2 seconds

const SPARKLE_COLORS = [
  "#06b6d4", // cyan-500
  "#22d3ee", // cyan-400
  "#67e8f9", // cyan-300
  "#a5f3fc", // cyan-200
  "#ffffff", // white
  "#fbbf24", // amber-400
];

export function useChatFabAnimation({
  shakeIntervalMs = SHAKE_INTERVAL_MS,
  sparklesPerBurst = SPARKLES_PER_BURST,
  enabled = true,
}: UseChatFabAnimationOptions = {}) {
  const fabRef = useRef<HTMLButtonElement>(null);
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Create a single sparkle particle ───
  const createSparkle = useCallback(() => {
    const fab = fabRef.current;
    if (!fab) return;

    const sparkle = document.createElement("span");

    // Random angle (0-360 degrees) and distance (30-70px)
    const angle = Math.random() * 360;
    const distance = 30 + Math.random() * 40;
    const rad = (angle * Math.PI) / 180;
    const tx = Math.cos(rad) * distance;
    const ty = Math.sin(rad) * distance;

    // Random sparkle properties
    const size = 3 + Math.random() * 4;
    const color =
      SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)];
    const rotation = Math.random() * 180;
    const scale = 0.5 + Math.random() * 0.8;

    Object.assign(sparkle.style, {
      position: "absolute",
      top: "50%",
      left: "50%",
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: "50%",
      backgroundColor: color,
      boxShadow: `0 0 ${size * 2}px ${color}`,
      pointerEvents: "none",
      zIndex: "9999",
      opacity: "0",
      transform: `translate(-50%, -50%) scale(0) rotate(${rotation}deg)`,
      transition: `all ${SPARKLE_LIFETIME_MS}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`,
    });

    // Wrap in a container positioned relative to the FAB
    // Use the FAB itself as positioning context (it's already fixed/absolute)
    let container = fab.querySelector(
      ".sparkle-container"
    ) as HTMLElement | null;

    if (!container) {
      container = document.createElement("span");
      container.className = "sparkle-container";
      Object.assign(container.style, {
        position: "absolute",
        inset: "0",
        overflow: "visible",
        pointerEvents: "none",
        borderRadius: "inherit",
      });
      fab.appendChild(container);
    }

    container.appendChild(sparkle);

    // Trigger animation on next frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        Object.assign(sparkle.style, {
          opacity: "1",
          transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(${scale}) rotate(${rotation + 90}deg)`,
        });
      });
    });

    // Fade out and remove
    setTimeout(() => {
      Object.assign(sparkle.style, {
        opacity: "0",
        transform: `translate(calc(-50% + ${tx * 1.3}px), calc(-50% + ${ty * 1.3}px)) scale(0) rotate(${rotation + 180}deg)`,
      });
      setTimeout(() => {
        sparkle.remove();
        // Clean up empty container
        if (container && container.children.length === 0) {
          container.remove();
        }
      }, SPARKLE_LIFETIME_MS);
    }, SPARKLE_LIFETIME_MS * 0.5);
  }, []);

  // ─── Burst sparkles around the button ───
  const burstSparkles = useCallback(() => {
    for (let i = 0; i < sparklesPerBurst; i++) {
      setTimeout(() => createSparkle(), i * 60); // Stagger each sparkle by 60ms
    }
  }, [createSparkle, sparklesPerBurst]);

  // ─── Shake animation using Web Animations API ───
  const triggerShake = useCallback(() => {
    const fab = fabRef.current;
    if (!fab) return;

    // Check for reduced-motion preference
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    // Add chatbot-shake class
    fab.classList.add("chatbot-fab-shake");

    // Burst sparkles at the same time
    burstSparkles();

    // Remove class after animation ends (700ms)
    setTimeout(() => {
      fab.classList.remove("chatbot-fab-shake");
    }, 700);
  }, [burstSparkles]);

  // ─── Start periodic animation ───
  useEffect(() => {
    if (!enabled) return;

    // Initial shake after 5 seconds (let the page settle first)
    const initialDelay = setTimeout(() => {
      triggerShake();
      // Then repeat every shakeIntervalMs
      shakeTimerRef.current = setInterval(triggerShake, shakeIntervalMs);
    }, 5_000);

    return () => {
      clearTimeout(initialDelay);
      if (shakeTimerRef.current) {
        clearInterval(shakeTimerRef.current);
        shakeTimerRef.current = null;
      }
      // Clean up any remaining sparkle containers
      const fab = fabRef.current;
      if (fab) {
        const container = fab.querySelector(".sparkle-container");
        if (container) container.remove();
        fab.classList.remove("chatbot-fab-shake");
      }
    };
  }, [enabled, shakeIntervalMs, triggerShake]);

  return fabRef;
}
