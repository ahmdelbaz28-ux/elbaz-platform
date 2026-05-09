import devServer from "@hono/vite-dev-server"
import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { VitePWA } from 'vite-plugin-pwa'
import viteCompression from 'vite-plugin-compression'

// https://vite.dev/config/
export default defineConfig({
  root: __dirname,
  plugins: [
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/).*$/] }),
    react(),
    viteCompression({ algorithm: 'gzip', threshold: 1024 }),
    viteCompression({ algorithm: 'brotliCompress', threshold: 1024, ext: '.br' }),
    VitePWA({
      registerType: 'autoUpdate',
      // CRITICAL: Prevent browser from caching sw.js itself.
      // Without this, the browser serves stale sw.js → stale precache → white screen.
      updateViaCache: 'none',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2,json}'],
        // Skip waiting: new SW activates immediately instead of waiting for old tabs to close
        skipWaiting: true,
        // Clients claim: new SW takes control of all open pages immediately
        clientsClaim: true,
        // Maximum file size for precache (skip large files like HLS)
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigationPreload: false,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/api\/trpc\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
      manifest: false, // Using custom manifest.webmanifest in public/
    }),
  ],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      "db": path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    sourcemap: false,
    cssMinify: 'esbuild',
    rollupOptions: {
      output: {
        // ⚠️ Vite 7 CRITICAL: Do NOT use manualChunks.
        // Vite 7's tree-shaking inlines imports that manualChunks references.
        // This creates orphan 1-byte chunks that break the Service Worker precache.
        // Let Vite handle all chunking automatically.
      },
      treeshake: {
        moduleSideEffects: false,
      },
    },
  },
});
