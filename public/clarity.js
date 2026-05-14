/**
 * Microsoft Clarity Analytics — GDPR-Compliant with PII Protection
 * External script to avoid 'unsafe-inline' in CSP.
 * 
 * ✅ ROOT FIX: This script now respects GDPR by checking for consent 
 * before enabling instrumentation. If 'elbaz_cookie_consent' is not 
 * found or analytics is false, it calls 'revoke' immediately.
 */
(function(c,l,a,r,i,t,y){
  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window,document,"clarity","script","wlrwynnnwk");

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
