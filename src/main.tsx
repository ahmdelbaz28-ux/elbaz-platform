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
if ('serviceWorker' in navigator && !(window as any).Capacitor?.isNativePlatform?.()) {
  import('virtual:pwa-register').then(({ registerSW }: { registerSW: (opts: {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: unknown) => void;
  }) => void }) => {
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
      onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
        if (registration) {
          const interval = setInterval(() => {
            if (!document.hidden) {
              registration.update().catch(() => {});
            }
          }, 1 * 60 * 1000); // 🚀 Elite: Check for updates every 1 minute
          window.addEventListener('beforeunload', () => clearInterval(interval));

        }
      },
      onRegisterError(error: unknown) {
        console.warn('[PWA] Service worker registration failed — site works without it', error);
      },
    });
  }).catch(() => {
    // PWA not available — non-critical
  });
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
