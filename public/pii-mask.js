/**
 * PII Masking for Microsoft Clarity
 * Automatically masks sensitive input fields from Clarity recordings
 * External script to avoid 'unsafe-inline' in CSP
 */
document.addEventListener('DOMContentLoaded', function() {
  var selectors = 'input[type="password"], input[type="tel"], input[type="email"], input[name*="phone"], input[name*="email"], input[name*="password"], input[name*="username"], input[name*="name"], input[placeholder*="010"], input[placeholder*="phone"], input[placeholder*="موبايل"], input[placeholder*="username"], input[placeholder*="كلمة المرور"], input[placeholder*="email"]';
  function maskAll() {
    document.querySelectorAll(selectors).forEach(function(el) {
      if (!el.hasAttribute('data-clarity-mask')) el.setAttribute('data-clarity-mask', '');
    });
  }
  maskAll();
  var observer = new MutationObserver(maskAll);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['type', 'name'] });
});
