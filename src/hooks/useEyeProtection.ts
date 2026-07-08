import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'elbaz-eye-protection';

function getInitialState(): boolean {
  if (globalThis === undefined) return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * useEyeProtection — Blue light filter toggle
 *
 * Persists the eye protection state in localStorage and applies a
 * `data-eye-protection` attribute on <html> for CSS-based warm overlay.
 */
export function useEyeProtection() {
  const [isActive, setIsActive] = useState<boolean>(getInitialState);

  // Apply to <html> on mount and whenever state changes
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.eyeProtection = isActive ? 'true' : 'false';
  }, [isActive]);

  const toggleEyeProtection = useCallback(() => {
    setIsActive((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false');
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  const setEyeProtection = useCallback((next: boolean) => {
    setIsActive(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false');
    } catch { /* ignore */ }
  }, []);

  return {
    isEyeProtectionActive: isActive,
    toggleEyeProtection,
    setEyeProtection,
  };
}
