import { useState, useEffect } from "react";
import { ArrowUp } from "lucide-react";

export default function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setVisible(window.scrollY > 400);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <button
      onClick={scrollToTop}
      aria-label="Scroll to top"
      className="fixed z-[95] group transform-gpu will-change-transform"
      style={{
        bottom: 'max(env(safe-area-inset-bottom, 0px) + 1.5rem, 1.5rem)',
        left: '1.25rem',
      }}
    >
      <span
        className={`flex h-12 w-12 items-center justify-center transition-all duration-500 ease-out ${
          visible
            ? "translate-y-0 opacity-100 scale-100"
            : "pointer-events-none translate-y-6 opacity-0 scale-75"
        }`}
      >
        {/* Outer glowing ring */}
        <span
          className="absolute inset-0 rounded-full opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100"
          style={{
            background: "radial-gradient(circle, rgba(6,182,212,0.35) 0%, transparent 70%)",
          }}
        />

        {/* Glass button body */}
        <span
          className="relative flex h-12 w-12 items-center justify-center rounded-full transition-all duration-300 ease-out"
          style={{
            background: "linear-gradient(135deg, rgba(6,182,212,0.12) 0%, rgba(6,182,212,0.06) 50%, rgba(255,255,255,0.03) 100%)",
            backdropFilter: "blur(16px) saturate(180%)",
            WebkitBackdropFilter: "blur(16px) saturate(180%)",
            border: "1px solid rgba(6,182,212,0.2)",
            boxShadow: `
              0 0 20px rgba(6,182,212,0.08),
              0 8px 32px rgba(0,0,0,0.3),
              inset 0 1px 0 rgba(255,255,255,0.06)
            `,
          }}
        >
          {/* Animated shimmer effect */}
          <span
            className="absolute inset-0 rounded-full opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            style={{
              background: "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.08) 45%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.08) 55%, transparent 60%)",
              backgroundSize: "200% 100%",
              animation: "scroll-top-shimmer 2s ease-in-out infinite",
            }}
          />

          {/* Inner ring highlight */}
          <span
            className="absolute inset-[2px] rounded-full"
            style={{
              border: "1px solid rgba(6,182,212,0.08)",
            }}
          />

          {/* Arrow icon */}
          <ArrowUp
            className="relative z-10 h-5 w-5 transition-all duration-300"
            style={{
              color: "#06b6d4",
              filter: "drop-shadow(0 0 4px rgba(6,182,212,0.4))",
            }}
          />
        </span>

        {/* Hover glow border */}
        <span
          className="absolute inset-0 rounded-full transition-all duration-300 opacity-0 group-hover:opacity-100"
          style={{
            border: "1.5px solid rgba(6,182,212,0.4)",
            boxShadow: `
              0 0 30px rgba(6,182,212,0.2),
              0 0 60px rgba(6,182,212,0.1),
              inset 0 0 20px rgba(6,182,212,0.05)
            `,
          }}
        />
      </span>

      {/* CSS animation for shimmer */}
      <style>{`
        @keyframes scroll-top-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </button>
  );
}
