/**
 * Self-Healing Service Worker Manager
 * ─────────────────────────────────────
 * Prevents white screen after deployments by:
 * 1. Detecting version changes via /api/version
 * 2. Force-unregistering stale service workers
 * 3. Clearing all caches when version changes
 * 4. Forcing a clean reload
 *
 * This runs BEFORE React loads, so it can fix cache issues
 * before they cause a white screen.
 */
(function() {
  'use strict';

  var CURRENT_VERSION = '2026.05.09-v6';
  var VERSION_KEY = 'elbaz-app-version';
  var NUKED_KEY = 'elbaz-cache-nuked';

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

    // Step 1: Clear all caches
    if ('caches' in window) {
      caches.keys().then(function(names) {
        console.log('[Cache-Nuke] Clearing ' + names.length + ' caches:', names);
        return Promise.all(names.map(function(n) { return caches.delete(n); }));
      }).catch(function() { /* noop */ });
    }

    // Step 2: Unregister all service workers
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(regs) {
        console.log('[Cache-Nuke] Unregistering ' + regs.length + ' service workers');
        return Promise.all(regs.map(function(r) { return r.unregister(); }));
      }).catch(function() { /* noop */ });
    }

    // Step 3: Mark as nuked and update stored version
    try { localStorage.setItem(NUKED_KEY, String(Date.now())); } catch(e) {}
    setStoredVersion(CURRENT_VERSION);

    // Step 4: Force full reload (bypass all caches)
    window.location.reload();
    return; // Stop here — page will reload
  }

  // Set version if not set yet
  if (!stored) {
    setStoredVersion(CURRENT_VERSION);
  }

  // Periodically check for version updates (every 2 minutes)
  // This catches deployments that happen while the tab is open
  setInterval(function() {
    fetch('/api/version', { cache: 'no-store' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var remote = data.version;
        if (remote && remote !== getStoredVersion()) {
          console.log('[Cache-Nuke] New version detected: ' + remote);
          setStoredVersion(remote);
          // Clear caches and unregister SW
          if ('caches' in window) {
            caches.keys().then(function(names) {
              return Promise.all(names.map(function(n) { return caches.delete(n); }));
            }).catch(function() {});
          }
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(regs) {
              return Promise.all(regs.map(function(r) { return r.unregister(); }));
            }).catch(function() {});
          }
          // Small delay to let cleanup finish, then reload
          setTimeout(function() { window.location.reload(); }, 500);
        }
      })
      .catch(function() { /* offline or server down — ignore */ });
  }, 2 * 60 * 1000);
})();
