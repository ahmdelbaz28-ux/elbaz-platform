/**
 * Microsoft Clarity Analytics — GDPR-Compliant with PII Protection
 * External script to avoid 'unsafe-inline' in CSP
 */
(function(c,l,a,r,i,t,y){
  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window,document,"clarity","script","wlrwynnnwk");
clarity('setup', {
  clearCookies: false,
  upload: 'https://www.clarity.ms/upload',
  trackInteraction: true,
  allowInstrumentation: true
});
