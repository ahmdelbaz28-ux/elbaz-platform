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
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
