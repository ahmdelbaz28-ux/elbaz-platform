import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import App from './App.tsx'

// Register PWA Service Worker with aggressive update strategy
// Note: cache-nuke.js handles VERSION changes (full cleanup + reload).
// Here we handle IN-PLACE SW updates (new precache manifest, same version).
if ('serviceWorker' in navigator && !(window as any).Capacitor?.isNativePlatform?.()) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      immediate: true,
      onNeedRefresh() {
        // New SW downloaded but waiting to activate.
        // Don't prompt — just reload immediately.
        // cache-nuke.js handles the big version-change cleanup.
        console.log('[PWA] New content available — reloading');
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
        }
        setTimeout(function() { window.location.reload(); }, 300);
      },
      onOfflineReady() {
        console.log('[PWA] App ready for offline use');
      },
      onRegisteredSW(_swUrl, registration) {
        if (registration) {
          // Check for updates every 60 seconds
          const interval = setInterval(() => {
            registration.update().catch(() => {});
          }, 60 * 1000);
          window.addEventListener('beforeunload', () => clearInterval(interval));
        }
      },
      onRegisterError(error) {
        console.warn('[PWA] Service worker registration failed — site works without it');
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
