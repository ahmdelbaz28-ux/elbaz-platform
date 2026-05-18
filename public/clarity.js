/**
 * Microsoft Clarity Analytics — GDPR-Compliant with PII Protection
 * External script to avoid 'unsafe-inline' in CSP.
 *
 * Uses Clarity Project ID: 3311349506496452
 */
(function(c,l,a,r,i,t,y){
  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window,document,"clarity","script","3311349506496452");

// Initialize with setup but check for consent immediately
const hasConsent = (function() {
  try {
    const raw = localStorage.getItem("elbaz_cookie_consent");
    if (!raw) return false;
    return JSON.parse(raw).analytics === true;
  } catch (e) { return false; }
})();

if (!hasConsent) {
  window.clarity("revoke");
}

window.clarity('setup', {
  clearCookies: false,
  upload: 'https://www.clarity.ms/upload',
  trackInteraction: true,
  allowInstrumentation: hasConsent
});
