import { motion, AnimatePresence } from 'framer-motion';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

/* -------------------------------------------------------------------------- */
/*  ThemeToggle                                                                */
/*  ─────────────────────────────────────────────────────────────────────────  */
/*  Dark/Light mode toggle button with smooth sun↔moon icon animation.        */
/*  Designed to sit next to the language switcher in the Navbar.              */
/*  Matches the existing button styling (border + rounded-lg + small).        */
/* -------------------------------------------------------------------------- */

interface ThemeToggleProps {
  /** "compact" = navbar pill style, "full" = mobile menu pill style */
  variant?: 'compact' | 'full';
}

export default function ThemeToggle({ variant = 'compact' }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  const ariaLabel = isDark
    ? 'Switch to light mode'
    : 'Switch to dark mode';

  if (variant === 'full') {
    // Mobile menu version — wider, more padding
    return (
      <button
        data-testid="theme-toggle-mobile"
        onClick={toggleTheme}
        aria-label={ariaLabel}
        className="flex items-center justify-center gap-2 rounded-xl border border-[#1e2d3d] px-6 py-2.5 text-base font-medium text-[#64748b] transition-all hover:border-[#06b6d4] hover:text-[#06b6d4]"
      >
        <AnimatePresence mode="wait" initial={false}>
          {isDark ? (
            <motion.span
              key="moon"
              initial={{ rotate: -90, opacity: 0, scale: 0.5 }}
              animate={{ rotate: 0, opacity: 1, scale: 1 }}
              exit={{ rotate: 90, opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.2 }}
            >
              <Moon className="h-5 w-5" />
            </motion.span>
          ) : (
            <motion.span
              key="sun"
              initial={{ rotate: 90, opacity: 0, scale: 0.5 }}
              animate={{ rotate: 0, opacity: 1, scale: 1 }}
              exit={{ rotate: -90, opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.2 }}
            >
              <Sun className="h-5 w-5" />
            </motion.span>
          )}
        </AnimatePresence>
        {isDark ? 'Light Mode' : 'وضع داكن'}
      </button>
    );
  }

  // Compact (desktop navbar) version — icon-only, same size as language toggle
  return (
    <button
      data-testid="theme-toggle"
      onClick={toggleTheme}
      aria-label={ariaLabel}
      title={ariaLabel}
      className="relative flex items-center justify-center rounded-lg border border-[#1e2d3d] bg-[#0d1420] px-2.5 py-1.5 text-[#64748b] transition-all hover:border-[#06b6d4] hover:text-[#06b6d4]"
      style={{ minWidth: '32px', minHeight: '32px' }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {isDark ? (
          <motion.span
            key="moon"
            initial={{ rotate: -90, opacity: 0, scale: 0.5 }}
            animate={{ rotate: 0, opacity: 1, scale: 1 }}
            exit={{ rotate: 90, opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.2 }}
          >
            <Moon className="h-4 w-4" />
          </motion.span>
        ) : (
          <motion.span
            key="sun"
            initial={{ rotate: 90, opacity: 0, scale: 0.5 }}
            animate={{ rotate: 0, opacity: 1, scale: 1 }}
            exit={{ rotate: -90, opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.2 }}
          >
            <Sun className="h-4 w-4" />
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}
