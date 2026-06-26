import devServer from "@hono/vite-dev-server"
import path from "path"
import { randomBytes } from "node:crypto"
import { writeFile } from "node:fs/promises"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { VitePWA } from 'vite-plugin-pwa'
import viteCompression from 'vite-plugin-compression'

/**
 * Build ID Plugin — generates a unique build-id.json on every build.
 *
 * Why: cache-nuke.js fetches /api/version → server reads build-id.json →
 * returns buildId. If buildId changed vs localStorage → nuke cache + reload.
 *
 * This means EVERY deploy automatically triggers a cache clear for all users,
 * without anyone needing to manually bump a version number.
 */
function buildIdPlugin(): Plugin {
  let buildId = ''

  return {
    name: 'elbaz-build-id',
    apply: 'build',

    buildStart() {
      // Generate a unique build ID: timestamp (base36) + 8 random hex chars
      const ts = Date.now().toString(36)
      const rand = randomBytes(4).toString('hex')
      buildId = `${ts}-${rand}`
      console.log(`[Build ID] ${buildId}`)
    },

    // Replace %%CACHE_BUST%% in index.html to bust Cloudflare/CDN caches
    transformIndexHtml(html: string) {
      return html.replace(/%%CACHE_BUST%%/g, buildId)
    },

    async writeBundle() {
      const outDir = path.resolve(__dirname, 'dist/public')
      const filePath = path.join(outDir, 'build-id.json')

      const content = JSON.stringify({
        buildId,
        version: process.env.npm_package_version || 'unknown',
        timestamp: new Date().toISOString(),
      }, null, 2)

      await writeFile(filePath, content, 'utf-8')
      console.log(`[Build ID] Written to ${filePath}`)
    },
  }
}

// Files that must NEVER be precached by the Service Worker.
// These files need to be fetched fresh from the server on every page load:
// - cache-nuke.js: detects version changes, must be fresh to detect new deploys
// - clarity.js / pii-mask.js: analytics scripts, should always be latest
// - rtl-detect.js: early detection script
// - build-id.json: build identifier
// - manifest.webmanifest: PWA manifest (browser manages its own cache)
const PRECACHE_EXCLUDE = [
  'cache-nuke.js',
  'clarity.js',
  'pii-mask.js',
  'rtl-detect.js',
  'build-id.json',
  'manifest.webmanifest',
]

// https://vite.dev/config/
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/).*$/] }),
    react(),
    viteCompression({ algorithm: 'gzip', threshold: 1024 }),
    viteCompression({ algorithm: 'brotliCompress', threshold: 1024, ext: '.br' }),
    buildIdPlugin(),
    VitePWA({
      // CRITICAL: 'prompt' means VitePWA only generates the SW file.
      // We register it manually in main.tsx to avoid double-registration.
      registerType: 'prompt',
      workbox: {
        // Include common static assets in precache, but EXCLUDE critical files
        // that must always be fetched fresh from the server.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2,json}'],
        // Exclude critical files from precache — they're served with no-cache headers
        // and must always come fresh from the server to detect new deploys.
        globIgnores: PRECACHE_EXCLUDE.map(f => `**/${f}`),
        // Skip waiting: new SW activates immediately instead of waiting for old tabs to close
        skipWaiting: true,
        // Clients claim: new SW takes control of all open pages immediately
        clientsClaim: true,
        // Maximum file size for precache (Increased to 25MB for engineering assets)
        maximumFileSizeToCacheInBytes: 25 * 1024 * 1024,
        navigationPreload: false,

        // PWA offline fallback page
        navigateFallback: '/index.html',
        runtimeCaching: [
          // ── External Fonts: Cache-first with 1-year expiry ──
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
          // ── Static Assets: Cache-first with 30-day expiry ──
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|webp|ico|woff2?|ttf|eot)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-assets-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // ── JS/CSS bundles: Stale-while-revalidate ──
          // Serve from cache immediately, update in background
          {
            urlPattern: /\/(?:assets|src)\/.+\.(?:js|css)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'js-css-cache',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // ── tRPC API: Network-only (always fresh data) ──
          {
            urlPattern: /\/api\/trpc\/.*/i,
            handler: 'NetworkOnly',
          },
          // ── Google OAuth: Network-only, NEVER cache ──
          // 🔧 FIX: /api/google-auth/redirect returns a 302, which the SW
          // was trying to cache as a "0" status response (opaque) and serving
          // a blank page on subsequent visits. This pattern must be matched
          // BEFORE the generic /api/* pattern below.
          {
            urlPattern: /\/api\/google-auth\/.*/i,
            handler: 'NetworkOnly',
          },
          // ── Other API routes: Network-first with 5-minute cache fallback ──
          {
            urlPattern: /\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 },
              networkTimeoutSeconds: 5,
              cacheableResponse: { statuses: [0, 200] },
            },
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
    target: 'es2022',
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@trpc') || id.includes('@tanstack/react-query')) return 'trpc-vendor';
            if (id.includes('sonner') || id.includes('superjson')) return 'ui-vendor';
            if (id.includes('@radix-ui')) return 'radix-vendor';
            if (id.includes('hls.js')) return 'hls-vendor';
            if (id.includes('@aws-sdk')) return 'aws-vendor';
            if (id.includes('lucide-react')) return 'lucide-vendor';
          }
        },
      },
      treeshake: {
        moduleSideEffects: false,
      },
    },
  },
});
