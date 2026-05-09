/**
 * Self-Healing Service Worker Manager
 * ─────────────────────────────────────
 * Prevents white screen after deployments by:
 * 1. Detecting version changes via /api/version
 * 2. Force-unregistering stale service workers
 * 3. Clearing all caches when version changes
 * 4. Forcing a clean reload AFTER cleanup finishes
 *
 * This runs BEFORE React loads, so it can fix cache issues
 * before they cause a white screen.
 */
(function() {
  'use strict';

  var CURRENT_VERSION = '2026.05.09-v7';
  var VERSION_KEY = 'elbaz-app-version';

  function getStoredVersion() {
    try { return localStorage.getItem(VERSION_KEY); } catch(e) { return null; }
  }

  function setStoredVersion(v) {
    try { localStorage.setItem(VERSION_KEY, v); } catch(e) { /* noop */ }
  }

  // If version changed, we need to nuke everything
  var stored = getStoredVersion();
  if (stored && stored !== CURRENT_VERSION) {
    console.log('[Cache-Nuke] Version changed: ' + stored + ' → ' + CURRENT_VERSION);

    // Build cleanup promises — wait for ALL to finish before reloading
    var cleanupPromises = [];

    // Step 1: Clear all caches
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

    // Step 2: Unregister all service workers
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
      console.log('[Cache-Nuke] Cleanup complete — reloading');
      setStoredVersion(CURRENT_VERSION);
      window.location.reload();
    }).catch(function() {
      // Even if cleanup failed, update version and reload
      setStoredVersion(CURRENT_VERSION);
      window.location.reload();
    });
    return; // Stop here — cleanup will trigger reload
  }

  // Set version if not set yet
  if (!stored) {
    setStoredVersion(CURRENT_VERSION);
  }

  // Periodically check for version updates (every 2 minutes)
  // This catches deployments that happen while the tab is open
  setInterval(function() {
    try {
      fetch('/api/version', { cache: 'no-store' })
        .then(function(r) {
          if (!r.ok) return null;
          return r.json();
        })
        .then(function(data) {
          if (!data || !data.version) return;
          var remote = data.version;
          if (remote !== getStoredVersion()) {
            console.log('[Cache-Nuke] New version detected: ' + remote);
            // Update stored version first (prevent loops)
            setStoredVersion(remote);
            // Clear caches and unregister SW
            var cleanupPromises = [];
            if ('caches' in window) {
              cleanupPromises.push(
                caches.keys().then(function(names) {
                  return Promise.all(names.map(function(n) { return caches.delete(n); }));
                }).catch(function() {})
              );
            }
            if ('serviceWorker' in navigator) {
              cleanupPromises.push(
                navigator.serviceWorker.getRegistrations().then(function(regs) {
                  return Promise.all(regs.map(function(r) { return r.unregister(); }));
                }).catch(function() {})
              );
            }
            Promise.all(cleanupPromises).then(function() {
              window.location.reload();
            }).catch(function() {
              window.location.reload();
            });
          }
        })
        .catch(function() { /* offline or server down — ignore */ });
    } catch(e) { /* CSP or other error — ignore */ }
  }, 2 * 60 * 1000);
})();
