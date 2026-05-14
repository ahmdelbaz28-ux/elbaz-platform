/**
 * Self-Healing Service Worker Manager v3
 * ─────────────────────────────────────
 * Prevents stale cache after deployments by:
 * 1. Fetching /api/version on EVERY page load (no hardcoded version)
 * 2. Comparing buildId with localStorage
 * 3. Force-unregistering stale service workers + clearing ALL caches
 * 4. Forcing a clean reload AFTER cleanup finishes
 *
 * v3 changes (PERMANENT FIX):
 * - REMOVED hardcoded version — now ALWAYS fetches from server
 * - Excluded from SW precache so it's never served from cache
 * - Server sets Cache-Control: no-cache for this file
 * - Uses buildId (unique per deploy) instead of npm version
 *
 * This runs BEFORE React loads, so it can fix cache issues
 * before they cause a white screen.
 */
(function() {
  'use strict';

  var VERSION_KEY = 'elbaz-app-version';
  var RELOAD_GUARD_KEY = 'elbaz-cache-nuke-reloading';
  var COOLDOWN_KEY = 'elbaz-cache-nuke-cooldown';
  var COOLDOWN_MS = 10000; // 10 second cooldown between reloads

  function getStoredVersion() {
    try { return localStorage.getItem(VERSION_KEY); } catch(e) { return null; }
  }

  function setStoredVersion(v) {
    try { localStorage.setItem(VERSION_KEY, v); } catch(e) { /* noop */ }
  }

  function isReloadGuarded() {
    try {
      var guardTime = parseInt(sessionStorage.getItem(RELOAD_GUARD_KEY), 10);
      if (!isNaN(guardTime) && Date.now() - guardTime < 30000) return true;
    } catch(e) { /* noop */ }
    return false;
  }

  function setReloadGuard() {
    try { sessionStorage.setItem(RELOAD_GUARD_KEY, Date.now().toString()); } catch(e) { /* noop */ }
  }

  function isOnCooldown() {
    try {
      var cdTime = parseInt(sessionStorage.getItem(COOLDOWN_KEY), 10);
      if (!isNaN(cdTime) && Date.now() - cdTime < COOLDOWN_MS) return true;
    } catch(e) { /* noop */ }
    return false;
  }

  function setCooldown() {
    try { sessionStorage.setItem(COOLDOWN_KEY, Date.now().toString()); } catch(e) { /* noop */ }
  }

  function performReload(reason) {
    setReloadGuard();
    setCooldown();
    console.log('[Cache-Nuke] Reloading: ' + reason);
    window.location.reload();
  }

  /**
   * Full cache cleanup: clear all caches + unregister all service workers
   * Then update version and reload
   */
  function nukeAndReload(newVersion, reason) {
    console.log('[Cache-Nuke] Triggering: ' + reason);

    var cleanupPromises = [];

    // Step 1: Clear ALL caches
    if ('caches' in window) {
      cleanupPromises.push(
        caches.keys().then(function(names) {
          console.log('[Cache-Nuke] Clearing ' + names.length + ' caches:', names);
          return Promise.all(names.map(function(n) { return caches.delete(n); }));
        }).catch(function(e) {
          console.warn('[Cache-Nuke] Cache clear failed:', e);
        })
      );
    }

    // Step 2: Unregister ALL service workers
    if ('serviceWorker' in navigator) {
      cleanupPromises.push(
        navigator.serviceWorker.getRegistrations().then(function(regs) {
          console.log('[Cache-Nuke] Unregistering ' + regs.length + ' service workers');
          return Promise.all(regs.map(function(r) { return r.unregister(); }));
        }).catch(function(e) {
          console.warn('[Cache-Nuke] SW unregister failed:', e);
        })
      );
    }

    // Step 3: Wait for ALL cleanup, then update version and reload
    Promise.all(cleanupPromises).then(function() {
      console.log('[Cache-Nuke] Cleanup complete, updating version to: ' + newVersion);
      setStoredVersion(newVersion);
      performReload(reason);
    }).catch(function() {
      // Even if cleanup fails, update version and reload
      setStoredVersion(newVersion);
      performReload('cleanup-finished ' + reason);
    });
  }

  // ✅ Expose globally for self-healing logic in index.html
  window.__nukeAndReload = nukeAndReload;

  // ── GUARD: If a reload was just done, skip all cache-nuke logic ──
  if (isReloadGuarded()) {
    console.log('[Cache-Nuke] Reload guard active — skipping');
    setTimeout(function() {
      try { sessionStorage.removeItem(RELOAD_GUARD_KEY); } catch(e) { /* noop */ }
    }, 35000);
    return;
  }

  // ── IMMEDIATE CHECK: Fetch /api/version on every page load ──
  // This file is excluded from SW precache and served with no-cache headers,
  // so it ALWAYS comes fresh from the server on every page load.
  // The server returns a unique buildId that changes on every deploy.
  try {
    fetch('/api/version', { cache: 'no-store' })
      .then(function(r) {
        if (!r.ok) return null;
        return r.json();
      })
      .then(function(data) {
        if (!data || !data.buildId) {
          console.warn('[Cache-Nuke] No buildId in /api/version response');
          return;
        }

        var remoteBuildId = data.buildId;
        var localBuildId = getStoredVersion();

        if (localBuildId && localBuildId !== remoteBuildId && !isOnCooldown()) {
          // Version changed! Nuke everything and reload.
          console.log('[Cache-Nuke] Build ID changed: ' + localBuildId + ' → ' + remoteBuildId);
          nukeAndReload(remoteBuildId, 'build changed ' + localBuildId + ' → ' + remoteBuildId);
        } else if (!localBuildId) {
          // First visit: store the build ID
          setStoredVersion(remoteBuildId);
          console.log('[Cache-Nuke] First visit, stored build ID: ' + remoteBuildId);
        } else {
          console.log('[Cache-Nuke] Build ID up to date: ' + remoteBuildId);
        }
      })
      .catch(function(err) {
        // Offline or server down — use cached version silently
        console.warn('[Cache-Nuke] Could not fetch /api/version:', err.message || err);
      });
  } catch(e) {
    // CSP or other error — silent fail
    console.warn('[Cache-Nuke] Fetch blocked or failed');
  }

  // ── PERIODIC CHECK: Every 3 minutes when tab is visible ──
  // Catches deploys that happen while the user has the tab open.
  var versionCheckInterval = setInterval(function() {
    if (document.hidden) return;
    if (isOnCooldown() || isReloadGuarded()) return;

    try {
      fetch('/api/version', { cache: 'no-store' })
        .then(function(r) {
          if (!r.ok) return null;
          return r.json();
        })
        .then(function(data) {
          if (!data || !data.buildId) return;
          var remoteBuildId = data.buildId;
          var localBuildId = getStoredVersion();
          if (remoteBuildId && localBuildId && remoteBuildId !== localBuildId) {
            console.log('[Cache-Nuke] New build detected (periodic): ' + localBuildId + ' → ' + remoteBuildId);
            nukeAndReload(remoteBuildId, 'periodic check ' + localBuildId + ' → ' + remoteBuildId);
          }
        })
        .catch(function() { /* offline or server down — ignore */ });
    } catch(e) { /* CSP or other error — ignore */ }
  }, 3 * 60 * 1000);
})();
