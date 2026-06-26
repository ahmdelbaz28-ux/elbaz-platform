import { useEffect } from "react";
import { trpc } from "@/providers/trpc";

// Default light mode colors (fallback when API doesn't return)
const DEFAULT_LIGHT = {
  bg: "#f8fafc",
  bgDarker: "#f1f5f9",
  card: "#ffffff",
  primary: "#0891b2",
  secondary: "#0e7490",
  text: "#0f172a",
  muted: "#64748b",
  border: "#e2e8f0",
};

const DEFAULT_DARK = {
  bg: "#0a0e17",
  bgDarker: "#070b12",
  card: "#111827",
  primary: "#06b6d4",
  secondary: "#0891b2",
  text: "#f0f4f8",
  muted: "#94a3b8",
  border: "#1f2d44",
};

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { data: activeTheme } = trpc.settings.getActiveTheme.useQuery(undefined, {
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Inject CSS variables to override hardcoded Tailwind arbitrary classes
  // This allows the entire site to be themeable without rewriting thousands of classes!
  useEffect(() => {
    const root = document.documentElement;
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    const defaults = isLight ? DEFAULT_LIGHT : DEFAULT_DARK;

    // Use API values if available, otherwise use defaults
    const bg = activeTheme?.bgColor || defaults.bg;
    const bgDarker = isLight ? "#f1f5f9" : defaults.bgDarker;
    const card = activeTheme?.cardBgColor || defaults.card;
    const primary = activeTheme?.primaryColor || defaults.primary;
    const secondary = activeTheme?.secondaryColor || defaults.secondary;
    const text = activeTheme?.textColor || defaults.text;
    const muted = activeTheme?.mutedTextColor || defaults.muted;
    const border = activeTheme?.borderColor || defaults.border;

    root.style.setProperty("--theme-bg", bg);
    root.style.setProperty("--theme-bg-darker", bgDarker);
    root.style.setProperty("--theme-card", card);
    root.style.setProperty("--theme-primary", primary);
    root.style.setProperty("--theme-secondary", secondary);
    root.style.setProperty("--theme-text", text);
    root.style.setProperty("--theme-muted", muted);
    root.style.setProperty("--theme-border", border);
  }, [activeTheme]);

  return (
    <>
      <style>{`
        /* Dynamic Theme Overrides for Tailwind Arbitrary Values */
        /* Backgrounds */
        .bg-\\[\\#0a0e17\\] { background-color: var(--theme-bg) !important; }
        .bg-\\[\\#070b12\\] { background-color: var(--theme-bg-darker) !important; }
        .bg-\\[\\#111827\\] { background-color: var(--theme-card) !important; }
        .bg-\\[\\#1a2233\\] { background-color: var(--theme-card) !important; }
        
        /* Primary accent (cyan) */
        .text-\\[\\#06b6d4\\] { color: var(--theme-primary) !important; }
        .border-\\[\\#06b6d4\\] { border-color: var(--theme-primary) !important; }
        .bg-\\[\\#06b6d4\\] { background-color: var(--theme-primary) !important; }
        .from-\\[\\#06b6d4\\] { --tw-gradient-from: var(--theme-primary) var(--tw-gradient-from-position) !important; --tw-gradient-to: rgb(6 182 212 / 0) var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to) !important; }
        
        /* Secondary accent */
        .text-\\[\\#0891b2\\] { color: var(--theme-secondary) !important; }
        .bg-\\[\\#0891b2\\] { background-color: var(--theme-secondary) !important; }
        .to-\\[\\#0891b2\\] { --tw-gradient-to: var(--theme-secondary) var(--tw-gradient-to-position) !important; }
        
        /* Borders */
        .border-\\[\\#1f2d44\\] { border-color: var(--theme-border) !important; }
        .border-\\[\\#1e2d3d\\] { border-color: var(--theme-border) !important; }
        .border-\\[\\#2d3f52\\] { border-color: var(--theme-border) !important; }
        
        /* Primary text (headings, important text) */
        .text-\\[\\#f0f4f8\\] { color: var(--theme-text) !important; }
        .text-\\[\\#e8f0fe\\] { color: var(--theme-text) !important; }
        .text-\\[\\#eaf0ff\\] { color: var(--theme-text) !important; }
        
        /* Muted/secondary text */
        .text-\\[\\#94a3b8\\] { color: var(--theme-muted) !important; }
        .text-\\[\\#64748b\\] { color: var(--theme-muted) !important; }
        .text-\\[\\#475569\\] { color: var(--theme-muted) !important; }
        
        /* General document resets */
        body { background-color: var(--theme-bg) !important; color: var(--theme-text) !important; }
      `}</style>
      {children}
    </>
  );
}
