/**
 * rtl-detect.js — Early RTL detection to prevent FOUC (Flash of Unstyled Content).
 *
 * Reads the user's saved language preference from localStorage and sets
 * the `dir` and `lang` attributes on <html> BEFORE React hydrates.
 * This prevents the page from flashing LTR then switching to RTL.
 *
 * This file MUST be loaded synchronously in <head> before React mounts.
 * It's excluded from Workbox precache in vite.config.ts.
 */
(function () {
  "use strict";

  try {
    var lang = localStorage.getItem("elbaz-lang") || "ar";
    var isRtl = lang === "ar";

    // Set direction + language on <html> immediately
    var html = document.documentElement;
    html.setAttribute("dir", isRtl ? "rtl" : "ltr");
    html.setAttribute("lang", lang);

    // Also set a data attribute so CSS can target RTL/LTR before React loads
    html.setAttribute("data-lang", lang);
  } catch (err) {
    // localStorage might be blocked (private mode) — default to RTL (Arabic)
    document.documentElement.setAttribute("dir", "rtl");
    document.documentElement.setAttribute("lang", "ar");
  }
})();
