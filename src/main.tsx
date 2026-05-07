import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import App from './App.tsx'

// Register PWA Service Worker with aggressive update
if ('serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      immediate: true,
      onRegisteredSW(swUrl, registration) {
        // Check for updates every 5 minutes
        if (registration) {
          const updateInterval = setInterval(() => {
            registration.update();
          }, 5 * 60 * 1000);
          // Cleanup interval on page unload to prevent memory leak
          window.addEventListener('beforeunload', () => clearInterval(updateInterval));
        }
      },
      onRegisterError(error) {
        console.error('[PWA] Service worker registration error:', error);
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
