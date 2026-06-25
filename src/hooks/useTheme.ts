import { useCallback, useEffect, useState } from 'react';

/* -------------------------------------------------------------------------- */
/*  useTheme                                                                   */
/*  ─────────────────────────────────────────────────────────────────────────  */
/*  Dark/Light theme hook with localStorage persistence + system preference.  */
/*                                                                             */
/*  - Default: respects prefers-color-scheme on first visit                   */
/*  - Persists choice in localStorage under 'elbaz-theme'                     */
/*  - Sets data-theme attribute on <html> for CSS override selectors          */
/*  - Exposes current theme + toggle function                                 */
/* -------------------------------------------------------------------------- */

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'elbaz-theme';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';

  // 1. Check localStorage first (user's explicit choice)
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // localStorage might be blocked (private mode) — fall through
  }

  // 2. Fall back to system preference
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light';
  }

  // 3. Default: dark (matches the site's original design)
  return 'dark';
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  // Apply theme to <html> + persist to localStorage
  const applyTheme = useCallback((next: Theme) => {
    const root = document.documentElement;

    // Add transitioning class for smooth color change (removed after 300ms)
    root.classList.add('theme-transitioning');

    root.setAttribute('data-theme', next);
    // Update the theme-color meta tag for mobile browser chrome
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', next === 'light' ? '#f8fafc' : '#06b6d4');
    }
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage errors (private mode)
    }

    // Remove transitioning class after the animation completes
    window.setTimeout(() => {
      root.classList.remove('theme-transitioning');
    }, 300);
  }, []);

  // Apply on mount + whenever theme changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme, applyTheme]);

  // Listen to system preference changes (only if user hasn't explicitly chosen)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        // Only follow system if user hasn't explicitly set a preference
        if (!saved) {
          setThemeState(e.matches ? 'dark' : 'light');
        }
      } catch {
        // Ignore
      }
    };
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
  }, []);

  return { theme, toggleTheme, setTheme };
}
