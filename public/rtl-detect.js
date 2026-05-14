// Early RTL detection — prevents Flash of Unstyled Content (FOUC)
// Must execute BEFORE React hydrates to avoid layout shift
(function () {
  try {
    const lang = localStorage.getItem("language") || "en";
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.style.fontFamily =
      lang === "ar"
        ? "'Cairo', 'Inter', system-ui, sans-serif"
        : "'Inter', system-ui, sans-serif";
  } catch (e) {
    // localStorage unavailable (incognito, Safari ITP)
  }
})();
