import { useEffect } from 'react';

interface SEOProps {
  title: string;
  description: string;
  image?: string;
  url?: string;
  canonical?: string;
  type?: 'website' | 'article' | 'course';
  jsonLd?: Record<string, any>;
  lang?: 'en' | 'ar';
}

/**
 * SEO helper component that injects essential meta tags, Open Graph/Twitter cards,
 * canonical link, hreflang alternates and optional JSON‑LD structured data.
 */
export default function SEO({
  title,
  description,
  image,
  url,
  canonical,
  type = 'website',
  jsonLd,
  lang = 'en',
}: SEOProps) {
  useEffect(() => {
    // 1. Update Document Title (site name in Arabic)
    const fullTitle = `${title} | م. أحمد الباز`;
    document.title = fullTitle;

    // Helper to set or update a meta tag
    const setMetaTag = (attr: string, key: string, content: string) => {
      let el = document.querySelector(`meta[${attr}="${key}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };

    // 2. Standard meta tags
    setMetaTag('name', 'description', description);
    setMetaTag('name', 'title', fullTitle);

    // 3. Open Graph tags
    setMetaTag('property', 'og:title', fullTitle);
    setMetaTag('property', 'og:description', description);
    setMetaTag('property', 'og:type', type);
    if (image) setMetaTag('property', 'og:image', image);
    if (url) setMetaTag('property', 'og:url', url);

    // 4. Twitter Card tags
    setMetaTag('name', 'twitter:title', fullTitle);
    setMetaTag('name', 'twitter:description', description);
    if (image) setMetaTag('name', 'twitter:image', image);
    setMetaTag('name', 'twitter:card', 'summary_large_image');

    // 5. Canonical link
    if (canonical) {
      let link = document.querySelector('link[rel="canonical"]');
      if (!link) {
        link = document.createElement('link');
        link.setAttribute('rel', 'canonical');
        document.head.appendChild(link);
      }
      link.setAttribute('href', canonical);
    }

    // 6. Hreflang alternates (EN & AR)
    const base = url || window.location.origin;
    const enHref = `${base}${lang === 'en' ? '' : ''}`; // default URL is EN version
    const arHref = `${base}${lang === 'ar' ? '' : '/ar'}`;
    const setAlternate = (href: string, hreflang: string) => {
      let alt = document.querySelector(`link[rel="alternate"][hreflang="${hreflang}"]`);
      if (!alt) {
        alt = document.createElement('link');
        alt.setAttribute('rel', 'alternate');
        alt.setAttribute('hreflang', hreflang);
        document.head.appendChild(alt);
      }
      alt.setAttribute('href', href);
    };
    setAlternate(enHref, 'en');
    setAlternate(arHref, 'ar');

    // 7. JSON‑LD injection
    let script: HTMLScriptElement | null = null;
    if (jsonLd) {
      script = document.querySelector('script[data-seo-jsonld]');
      if (!script) {
        script = document.createElement('script');
        script.setAttribute('type', 'application/ld+json');
        script.setAttribute('data-seo-jsonld', 'true');
        document.head.appendChild(script);
      }
      script.textContent = JSON.stringify(jsonLd);
    }

    // Cleanup on unmount
    return () => {
      if (script && document.head.contains(script)) {
        document.head.removeChild(script);
      }
    };
  }, [title, description, image, url, canonical, type, jsonLd, lang]);

  return null;
}

