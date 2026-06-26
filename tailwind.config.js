import tailwindcssAnimate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        accent: "#06b6d4",
        "accent-dim": "rgba(6,182,212,0.15)",
        surface: {
          DEFAULT: "#070b12",
          card: "#0d1420",
          border: "#1e2d3d",
          hover: "#1f2d44",
        },
        text: {
          primary: "#e8f0fe",
          secondary: "#94a3b8",
          muted: "#64748b",
          faint: "#475569",
        },
      },
      fontFamily: {
        sans: ["Inter", "Cairo", "system-ui", "-apple-system", "sans-serif"],
        arabic: ["Cairo", "Inter", "system-ui", "sans-serif"],
      },
      animation: {
        float: "float 3s ease-in-out infinite",
        "float-slow": "floatSlow 5s ease-in-out infinite",
        "float-icon": "floatIcon 2.5s ease-in-out infinite",
        "pulse-glow": "pulseGlow 3s ease-in-out infinite",
        "fade-in-up": "fadeInUp 0.6s ease-out forwards",
        "hero-float": "heroFloat 4s ease-in-out infinite",
        "hero-glow-pulse": "heroGlowPulse 3s ease-in-out infinite",
        "hero-shimmer": "heroShimmer 4s ease-in-out infinite",
        "whatsapp-pulse": "whatsappPulse 2s ease-out infinite",
        "notification-slide-in": "notificationSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "float-up": "floatUp 0.8s cubic-bezier(0.22, 1, 0.36, 1) forwards",
        "float-down": "floatDown 0.8s cubic-bezier(0.22, 1, 0.36, 1) forwards",
        "float-scale": "floatScale 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
        "float-drift": "floatDrift 6s ease-in-out infinite",
        "float-bounce": "floatBounce 4s ease-in-out infinite",
        "float-wave": "floatWave 3s ease-in-out infinite",
        "float-pulse": "floatPulse 2.5s ease-in-out infinite",
        "float-rotate": "floatRotate 4s ease-in-out infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        floatSlow: {
          "0%, 100%": { transform: "translateY(0) rotate(0deg)" },
          "33%": { transform: "translateY(-6px) rotate(1deg)" },
          "66%": { transform: "translateY(-3px) rotate(-1deg)" },
        },
        floatIcon: {
          "0%, 100%": { transform: "translateY(0) scale(1)" },
          "50%": { transform: "translateY(-5px) scale(1.05)" },
        },
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 8px rgba(6,182,212,0.2)" },
          "50%": { boxShadow: "0 0 20px rgba(6,182,212,0.4), 0 0 40px rgba(6,182,212,0.1)" },
        },
        fadeInUp: {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        heroFloat: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-12px)" },
        },
        heroGlowPulse: {
          "0%, 100%": { boxShadow: "0 0 30px rgba(6,182,212,0.4), 0 0 60px rgba(6,182,212,0.2), 0 0 100px rgba(6,182,212,0.1), inset 0 0 30px rgba(6,182,212,0.05)" },
          "50%": { boxShadow: "0 0 40px rgba(6,182,212,0.6), 0 0 80px rgba(6,182,212,0.3), 0 0 120px rgba(6,182,212,0.15), inset 0 0 40px rgba(6,182,212,0.08)" },
        },
        heroShimmer: {
          "0%": { transform: "translateX(-100%)" },
          "50%": { transform: "translateX(100%)" },
          "100%": { transform: "translateX(-100%)" },
        },
        whatsappPulse: {
          "0%": { transform: "scale(1)", opacity: "0.6" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        notificationSlideIn: {
          from: { transform: "translateY(12px) scale(0.95)", opacity: "0" },
          to: { transform: "translateY(0) scale(1)", opacity: "1" },
        },
        floatUp: {
          "0%": { transform: "translateY(40px) rotate(-2deg)", opacity: "0" },
          "60%": { transform: "translateY(-8px) rotate(1deg)", opacity: "1" },
          "100%": { transform: "translateY(0) rotate(0deg)", opacity: "1" },
        },
        floatDown: {
          "0%": { transform: "translateY(-40px) rotate(2deg)", opacity: "0" },
          "60%": { transform: "translateY(8px) rotate(-1deg)", opacity: "1" },
          "100%": { transform: "translateY(0) rotate(0deg)", opacity: "1" },
        },
        floatScale: {
          "0%": { transform: "scale(0.5) translateY(20px)", opacity: "0" },
          "70%": { transform: "scale(1.1) translateY(-5px)", opacity: "1" },
          "100%": { transform: "scale(1) translateY(0)", opacity: "1" },
        },
        floatDrift: {
          "0%, 100%": { transform: "translateY(0) translateX(0) rotate(0deg)" },
          "25%": { transform: "translateY(-12px) translateX(5px) rotate(1deg)" },
          "50%": { transform: "translateY(-6px) translateX(-3px) rotate(-0.5deg)" },
          "75%": { transform: "translateY(-15px) translateX(3px) rotate(0.5deg)" },
        },
        floatBounce: {
          "0%, 100%": { transform: "translateY(0)" },
          "15%": { transform: "translateY(-12px) scale(1.05)" },
          "30%": { transform: "translateY(-5px) scale(0.98)" },
          "45%": { transform: "translateY(-10px) scale(1.02)" },
          "60%": { transform: "translateY(-3px) scale(0.99)" },
          "75%": { transform: "translateY(-7px) scale(1.01)" },
        },
        floatWave: {
          "0%, 100%": { transform: "translateY(0) scale(1)" },
          "50%": { transform: "translateY(-8px) scale(1.02)" },
        },
        floatPulse: {
          "0%, 100%": { transform: "translateY(0) scale(1)", opacity: "1" },
          "50%": { transform: "translateY(-10px) scale(1.03)", opacity: "0.9" },
        },
        floatRotate: {
          "0%, 100%": { transform: "translateY(0) rotate(0deg)" },
          "33%": { transform: "translateY(-10px) rotate(5deg)" },
          "66%": { transform: "translateY(-5px) rotate(-3deg)" },
        },
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
