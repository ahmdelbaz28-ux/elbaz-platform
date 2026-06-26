/**
 * cache-nuke.js — Detects version changes and force-reloads stale caches.
 *
 * Fetches /api/version → compares buildId with the one stored in localStorage.
 * If different, clears all caches + service workers + reloads.
 *
 * This file MUST be served fresh (no-cache) so it always runs the latest version.
 * It's excluded from Workbox precache in vite.config.ts.
 */
(function () {
  "use strict";

  var BUILD_ID_KEY = "elbaz_build_id";
  var RELOAD_FLAG = "elbaz_cache_nuked";

  async function nukeAndReload(reason) {
    console.warn("[Cache-Nuke] Triggering full cache clear:", reason);
    try {
      // 1. Clear all caches (Cache API)
      if ("caches" in window) {
        var keys = await caches.keys();
        await Promise.all(keys.map(function (k) { return caches.delete(k); }));
      }
      // 2. Unregister all service workers
      if ("serviceWorker" in navigator) {
        var regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(function (r) { return r.unregister(); }));
      }
      // 3. Set flag so we don't loop
      sessionStorage.setItem(RELOAD_FLAG, "1");
      // 4. Force reload (bypass cache)
      window.location.reload();
    } catch (err) {
      console.error("[Cache-Nuke] Failed:", err);
    }
  }

  async function checkVersion() {
    try {
      // 🔧 ROOT CAUSE FIX: Read buildId from window.__ENV__ first.
      // This is injected by the server into the HTML, so it's always available
      // without a network fetch. The /api/version fetch was being blocked by
      // Cloudflare Bot Management on some browsers, causing stale CSS/JS
      // to persist and making page elements invisible.
      var newBuildId = null;

      // 1. Try window.__ENV__.buildId (injected by server, always available)
      if (window.__ENV__ && window.__ENV__.buildId) {
        newBuildId = window.__ENV__.buildId;
      }

      // 2. Fallback: fetch /api/version (may be blocked by Cloudflare)
      if (!newBuildId) {
        try {
          var resp = await fetch("/api/version", { cache: "no-store" });
          if (!resp.ok) return;
          var data = await resp.json();
          newBuildId = data.buildId;
        } catch (fetchErr) {
          console.warn("[Cache-Nuke] Could not fetch /api/version (likely Cloudflare challenge):", fetchErr.message);
          // Can't determine version — don't nuke, just continue
          return;
        }
      }

      if (!newBuildId) return;

      var oldBuildId = localStorage.getItem(BUILD_ID_KEY);
      if (!oldBuildId) {
        // First visit — just store the build ID
        localStorage.setItem(BUILD_ID_KEY, newBuildId);
        return;
      }

      if (oldBuildId !== newBuildId) {
        // Version changed! Nuke everything and reload.
        localStorage.setItem(BUILD_ID_KEY, newBuildId);
        await nukeAndReload("build changed: " + oldBuildId + " → " + newBuildId);
      }
    } catch (err) {
      // Network error or server down — can't check, just continue
      console.warn("[Cache-Nuke] Could not check version:", err.message);
    }
  }

  // Don't run if we just nuked (prevent reload loop)
  if (sessionStorage.getItem(RELOAD_FLAG)) {
    sessionStorage.removeItem(RELOAD_FLAG);
  } else {
    // Run after DOM is ready
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", checkVersion);
    } else {
      checkVersion();
    }
  }
})();
