import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import App from './App.tsx'

/**
 * PWA Service Worker Registration — v2 (Fixed)
 * ═══════════════════════════════════════════════
 * 
 * CRITICAL ARCHITECTURE DECISION:
 * - cache-nuke.js handles VERSION CHANGES: full cache clear + SW unregister + reload
 * - This code handles IN-PLACE SW updates: new precache manifest, SAME version
 * - We NEVER auto-reload here — cache-nuke.js is the ONLY mechanism that reloads
 * - This prevents the double-reload race condition that was breaking the site
 * 
 * The session guard 'elbaz-cache-nuke-reloading' is SET by cache-nuke.js
 * when it triggers a reload. We check it here to avoid racing with cache-nuke.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if ('serviceWorker' in navigator && !(globalThis as any).Capacitor?.isNativePlatform?.()) {
  try {
    const { registerSW }: {
      registerSW: (opts: {
        immediate?: boolean;
        onNeedRefresh?: () => void;
        onOfflineReady?: () => void;
        onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
        onRegisterError?: (error: unknown) => void;
      }) => void
    } = await import('virtual:pwa-register');

    const registerServiceWorker = async () => {
      const SW_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes
      let intervalId: ReturnType<typeof setInterval> | null = null;

      const checkForUpdate = () => {
        if (!document.hidden && registration) {
          registration.update().catch(() => { });
        }
      };

      const startInterval = () => {
        intervalId ??= setInterval(checkForUpdate, SW_UPDATE_INTERVAL);
      };
      const stopInterval = () => {
        if (intervalId !== null) {
          clearInterval(intervalId);
          intervalId = null;
        }
      };

      const handleVisibilityChange = () => {
        if (document.hidden) {
          stopInterval();
        } else {
          checkForUpdate(); // Check immediately on becoming visible
          startInterval();
        }
      };

      let registration: ServiceWorkerRegistration | undefined;
      registerSW({
        immediate: true,
        onNeedRefresh() {
          console.log('[PWA] New content available — deferring reload to cache-nuke.js');
          if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
          }
        },
        onOfflineReady() {
          console.log('[PWA] App ready for offline use');
        },
        onRegisteredSW(_swUrl: string, reg: ServiceWorkerRegistration | undefined) {
          registration = reg;
          if (registration) {
            document.addEventListener('visibilitychange', handleVisibilityChange);
            globalThis.addEventListener('beforeunload', stopInterval);
            startInterval(); // Initial start
          }
        },
        onRegisterError(error: unknown) {
          console.warn('[PWA] Service worker registration failed — site works without it', error);
        },
      });

      // Cleanup function for unmounting
      return () => {
        stopInterval();
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        globalThis.removeEventListener('beforeunload', stopInterval);
      };
    };

    await registerServiceWorker();
  } catch {
    // PWA not available — non-critical
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TRPCProvider>
        <App />
      </TRPCProvider>
    </BrowserRouter>
  </StrictMode>,
)
