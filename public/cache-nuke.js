/**
 * cache-nuke.js — THE single owner of client-side recovery.
 *
 * Responsibilities (v3, hardened after the 2026-11-16 "desktop won't load"
 * incident — see DEPLOYMENT.md §9):
 *
 *   1. Deploy-drift detection: /api/version buildId vs localStorage —
 *      a changed build clears Cache-API entries + Service Workers and
 *      reloads once.
 *
 *   2. Stale-HTML detection (NEW): compares the `?v=` token baked into THIS
 *      page's own <script src="/cache-nuke.js?v=..."> tag against the live
 *      /api/version buildId. The old logic trusted localStorage only, so a
 *      browser that already stored the NEW buildId while an OLD HTML shell
 *      was still being served (SW precache / cached shell) passed the check
 *      forever: the stale shell referenced dead hashed chunks, the app never
 *      booted, and NO recovery ever fired — the user's desktop was stuck
 *      dark across reloads. The token check closes that trap: a stale shell
 *      can NEVER pass, no matter what localStorage holds.
 *
 *   3. Loop firewall (NEW): at most MAX_NUKES_PER_SESSION nukes per tab
 *      session. When the cap is hit the recovery banner renders instead of
 *      reloading forever — reload loops are impossible by construction.
 *
 *   4. Edge-challenge recovery (NEW): the tRPC client dispatches
 *      `elbaz:edge-challenge` when the provider edge answers API calls with
 *      a Cloudflare challenge (403 + cf-mitigated: challenge). One full
 *      navigation lets the challenge platform run and mint cf_clearance;
 *      if challenges persist the guidance banner renders — never a loop.
 *
 *   5. globalThis.__nukeAndReload — consumed by the early self-heal listener
 *      in index.html (resource/chunk/unhandledrejection failures). This
 *      assignment is what makes that listener actually WORK; previously the
 *      function was never exported and the whole self-heal path was dead
 *      code.
 *
 * This file MUST be served fresh (no-cache) and stays excluded from Workbox
 * precache (vite.config.ts PRECACHE_EXCLUDE) so every page load runs the
 * latest recovery logic.
 */
(function () {
  "use strict";

  var BUILD_ID_KEY = "elbaz_build_id";
  var RELOAD_FLAG = "elbaz_cache_nuked";
  var NUKE_COUNT_KEY = "elbaz_nuke_count";
  var CF_RELOAD_KEY = "elbaz_cf_challenge_reload";
  var MAX_NUKES_PER_SESSION = 2;
  var MAX_CF_RELOADS_PER_SESSION = 1;
  var BANNER_ID = "elbaz-recovery-banner";

  // Values that mean "this environment has no trustworthy build identity"
  // (local dev server, boot.ts fallback). Nuking on their mismatch would
  // reload every page load in those environments — always skipped.
  function isRealBuildId(id) {
    return !!id && !/^(dev|unknown|runtime-)/.test(String(id));
  }

  function sGet(key) {
    try { return sessionStorage.getItem(key); } catch (_) { return null; }
  }
  function sSet(key, value) {
    try { sessionStorage.setItem(key, value); } catch (_) { /* private mode */ }
  }
  function lGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function lSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) { /* private mode */ }
  }

  var bannerShown = false;

  /**
   * Last-resort guidance banner — pure inline JS so it works even when React
   * never boots (dead chunk shell). Never rendered while reloads still help.
   */
  function showRecoveryBanner(reason) {
    if (bannerShown) return;
    bannerShown = true;
    try {
      if (document.getElementById(BANNER_ID)) return;
      var el = document.createElement("div");
      el.setAttribute("id", BANNER_ID);
      el.setAttribute("dir", "rtl");
      el.style.cssText =
        "position:fixed;bottom:0;left:0;right:0;z-index:2147483001;" +
        "background:#111827;color:#f0f4f8;padding:14px 18px;" +
        "font-family:system-ui,'Segoe UI',Tahoma,sans-serif;font-size:14px;" +
        "line-height:1.8;box-shadow:0 -4px 20px rgba(0,0,0,.35);text-align:center;";
      el.innerHTML =
        "⚠️ الصفحة قابلت مشكلة في التحميل وتمت محاولة الإصلاح تلقائيًا أكثر من مرة." +
        "<br><b>جرّب:</b> عطّل مانع الإعلانات أو VPN، افتح الموقع في نافذة عادية (ليست خاصة)،" +
        " أو امسح بيانات الموقع من إعدادات المتصفح ثم أعد المحاولة." +
        '<button type="button" id="elbaz-recovery-reload" style="margin-inline-start:10px;' +
        "background:#06b6d4;color:#0a0e17;border:0;border-radius:8px;padding:8px 16px;" +
        'font-weight:700;font-size:14px;cursor:pointer;">إعادة المحاولة</button>';
      (document.body || document.documentElement).appendChild(el);
      var btn = document.getElementById("elbaz-recovery-reload");
      if (btn) {
        // CSP: no inline onclick attributes — always addEventListener.
        btn.addEventListener("click", function () {
          try { sessionStorage.clear(); } catch (_) { /* ignore */ }
          try { localStorage.removeItem(BUILD_ID_KEY); } catch (_) { /* ignore */ }
          window.location.reload();
        });
      }
      console.warn("[Cache-Nuke] Recovery banner shown:", reason);
    } catch (err) {
      // Banner is best-effort — never break the page from recovery itself.
      try { console.error("[Cache-Nuke] banner failed:", err && err.message); } catch (_) {}
    }
  }

  function clearCachesAndWorkers() {
    var jobs = [];
    try {
      if ("caches" in window) {
        jobs.push(
          caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (k) { return caches.delete(k); }));
          })
        );
      }
    } catch (_) { /* Cache API unavailable */ }
    try {
      if ("serviceWorker" in navigator) {
        jobs.push(
          navigator.serviceWorker.getRegistrations().then(function (regs) {
            return Promise.all(regs.map(function (r) { return r.unregister(); }));
          })
        );
      }
    } catch (_) { /* SW unavailable */ }
    return Promise.all(jobs);
  }

  function nukeCount() {
    return Number(sGet(NUKE_COUNT_KEY) || "0");
  }

  // One recovery per page turn: the resource-error listener AND the version
  // check can both detect the same stale shell within milliseconds of each
  // other — without this guard the double trigger would burn TWO cap slots
  // for a single reload.
  var nukeInflight = false;

  /**
   * Full recovery: clear Cache API + Service Workers, then reload ONCE.
   * Capped per session — after MAX_NUKES_PER_SESSION the banner renders and
   * reload loops become impossible.
   */
  function nukeAndReload(reason) {
    if (nukeInflight) return;
    console.warn("[Cache-Nuke] triggering full cache clear:", reason);
    var count = nukeCount();
    if (count >= MAX_NUKES_PER_SESSION) {
      showRecoveryBanner(reason);
      return;
    }
    nukeInflight = true;
    sSet(NUKE_COUNT_KEY, String(count + 1));
    sSet(RELOAD_FLAG, "1");
    Promise.resolve(clearCachesAndWorkers())
      .catch(function () { /* recovery must never reject */ })
      .then(function () {
        try { window.location.reload(); } catch (err) {
          try { console.error("[Cache-Nuke] reload failed:", err && err.message); } catch (_) {}
        }
      });
  }

  // ── Self-heal hook consumed by index.html's early error listener ──
  globalThis.__nukeAndReload = nukeAndReload;

  /**
   * Reads the cache-bust token baked into THIS page's own script tag —
   * the fingerprint of the HTML shell currently in the browser.
   */
  function readOwnToken() {
    try {
      var scripts = document.querySelectorAll("script[src*='cache-nuke.js']");
      if (!scripts || !scripts.length) return null;
      var src = scripts[scripts.length - 1].getAttribute("src") || "";
      var match = /cache-nuke\.js\?v=([^&"' ]+)/.exec(src);
      return match ? match[1] : null;
    } catch (_) {
      return null;
    }
  }

  function checkVersion() {
    var token = readOwnToken();
    fetch("/api/version", { cache: "no-store" })
      .then(function (resp) {
        if (!resp.ok) return null;
        return resp.json();
      })
      .then(function (data) {
        if (!data || !data.buildId) return;
        var serverId = String(data.buildId);
        if (!isRealBuildId(serverId)) return; // untrustworthy environment — skip

        var stored = lGet(BUILD_ID_KEY);
        var staleShell = isRealBuildId(token) && token !== serverId;
        var drift = isRealBuildId(stored) && stored !== serverId;

        if (!stored) {
          // First visit — just record the build identity.
          lSet(BUILD_ID_KEY, serverId);
          return;
        }
        if (staleShell || drift) {
          lSet(BUILD_ID_KEY, serverId); // post-reload check must be calm
          nukeAndReload(
            staleShell
              ? "stale HTML shell (token " + token + " != build " + serverId + ")"
              : "build changed: " + stored + " -> " + serverId
          );
        }
      })
      .catch(function (err) {
        // Network error or server down — can't check, just continue.
        try { console.warn("[Cache-Nuke] Could not check version:", err && err.message); } catch (_) {}
      });
  }

  // ── Edge-challenge recovery (event from src/providers/trpc.tsx) ──
  window.addEventListener("elbaz:edge-challenge", function () {
    var count = Number(sGet(CF_RELOAD_KEY) || "0");
    if (count < MAX_CF_RELOADS_PER_SESSION) {
      sSet(CF_RELOAD_KEY, String(count + 1));
      console.warn("[Cache-Nuke] edge challenge blocked API calls — one recovery navigation");
      setTimeout(function () {
        try { window.location.reload(); } catch (_) { /* ignore */ }
      }, 200);
    } else {
      showRecoveryBanner("edge challenge persisted after recovery navigation");
    }
  });

  // ── Boot ──
  // (No flag-skip before the check: the nuke counter is the loop firewall,
  // and skipping would leave a poisoned shell unhealed for a whole session.)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkVersion);
  } else {
    checkVersion();
  }
})();
