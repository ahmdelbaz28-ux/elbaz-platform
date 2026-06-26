import { useCallback, useEffect, useState } from 'react';

/* -------------------------------------------------------------------------- */
/*  useTheme                                                                   */
/*  ─────────────────────────────────────────────────────────────────────────  */
/*  Dark/Light theme hook with localStorage persistence.                      */
/*                                                                             */
/*  - Default: Dark Mode (always — site is designed dark-first)               */
/*  - Persists choice in localStorage under 'elbaz-theme'                     */
/*  - Sets data-theme attribute on <html> for CSS override selectors          */
/*  - Exposes current theme + toggle function                                 */
/*  - User can switch to Light Mode via the theme toggle button               */
/* -------------------------------------------------------------------------- */

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'elbaz-theme';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';

  // ✅ FIX: Dark Mode is ALWAYS the default.
  // Only switch to Light if user EXPLICITLY chose it.
  // Previously used prefers-color-scheme which caused invisible text
  // on browsers that default to light mode.
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light') return 'light';
  } catch {
    // localStorage might be blocked (private mode) — fall through
  }

  // Default: dark (matches the site's original design)
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

  // ✅ NOTE: System preference listener removed.
  // Dark Mode is always the default. User must explicitly toggle to Light.
  // This prevents the "invisible text" bug where browsers defaulting to
  // light mode would override the site's dark design.

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
  }, []);

  return { theme, toggleTheme, setTheme };
}
