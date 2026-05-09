import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import App from './App.tsx'

// Register PWA Service Worker with aggressive update strategy
if ('serviceWorker' in navigator && !(window as any).Capacitor?.isNativePlatform?.()) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      immediate: true,
      onNeedRefresh() {
        // New content available — force reload immediately.
        // This is better than showing a prompt because:
        // 1. The cache-nuke.js script already handles graceful version detection
        // 2. Stale content causes white screen, not just outdated UI
        // 3. Users don't need to manually click "update"
        console.log('[PWA] New content available — reloading');
        window.location.reload();
      },
      onOfflineReady() {
        console.log('[PWA] App ready for offline use');
      },
      onRegisteredSW(swUrl, registration) {
        // Check for updates every 60 seconds (aggressive — catches deploys fast)
        if (registration) {
          const updateInterval = setInterval(() => {
            registration.update();
          }, 60 * 1000);
          // Cleanup interval on page unload
          window.addEventListener('beforeunload', () => clearInterval(updateInterval));
        }
      },
      onRegisterError(error) {
        console.warn('[PWA] Service worker registration error — site works without it:', error);
      },
    });
  }).catch(() => {
    // PWA registration failed — non-critical, site works without it
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
