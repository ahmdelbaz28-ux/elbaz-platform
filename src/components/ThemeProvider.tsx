import { useEffect } from "react";
import { trpc } from "@/providers/trpc";

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { data: activeTheme } = trpc.settings.getActiveTheme.useQuery(undefined, {
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Inject CSS variables to override hardcoded Tailwind arbitrary classes
  // This allows the entire site to be themeable without rewriting thousands of classes!
  useEffect(() => {
    if (!activeTheme) return;

    const root = document.documentElement;
    root.style.setProperty("--theme-bg", activeTheme.bgColor || "#0a0e17");
    root.style.setProperty("--theme-bg-darker", activeTheme.bgColor === "#ffffff" ? "#f8fafc" : "#070b12");
    root.style.setProperty("--theme-card", activeTheme.cardBgColor || "#111827");
    root.style.setProperty("--theme-primary", activeTheme.primaryColor || "#06b6d4");
    root.style.setProperty("--theme-secondary", activeTheme.secondaryColor || "#0891b2");
    root.style.setProperty("--theme-text", activeTheme.textColor || "#f0f4f8");
    root.style.setProperty("--theme-muted", activeTheme.mutedTextColor || "#94a3b8");
    root.style.setProperty("--theme-border", activeTheme.borderColor || "#1f2d44");

  }, [activeTheme]);

  if (!activeTheme) return <>{children}</>;

  return (
    <>
      <style>{`
        /* Dynamic Theme Overrides for Tailwind Arbitrary Values */
        .bg-\\[\\#0a0e17\\] { background-color: var(--theme-bg) !important; }
        .bg-\\[\\#070b12\\] { background-color: var(--theme-bg-darker) !important; }
        .bg-\\[\\#111827\\] { background-color: var(--theme-card) !important; }
        .text-\\[\\#06b6d4\\] { color: var(--theme-primary) !important; }
        .border-\\[\\#06b6d4\\] { border-color: var(--theme-primary) !important; }
        .bg-\\[\\#06b6d4\\] { background-color: var(--theme-primary) !important; }
        .text-\\[\\#0891b2\\] { color: var(--theme-secondary) !important; }
        .bg-\\[\\#0891b2\\] { background-color: var(--theme-secondary) !important; }
        .border-\\[\\#1f2d44\\] { border-color: var(--theme-border) !important; }
        .text-\\[\\#f0f4f8\\] { color: var(--theme-text) !important; }
        .text-\\[\\#94a3b8\\] { color: var(--theme-muted) !important; }
        .text-\\[\\#64748b\\] { color: var(--theme-muted) !important; }
        .from-\\[\\#06b6d4\\] { --tw-gradient-from: var(--theme-primary) var(--tw-gradient-from-position) !important; --tw-gradient-to: rgb(6 182 212 / 0) var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to) !important; }
        .to-\\[\\#0891b2\\] { --tw-gradient-to: var(--theme-secondary) var(--tw-gradient-to-position) !important; }
        
        /* General document resets for Light Themes */
        body { background-color: var(--theme-bg) !important; color: var(--theme-text) !important; }
      `}</style>
      {children}
    </>
  );
}
