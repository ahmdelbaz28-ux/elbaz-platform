import { useEffect } from 'react';

interface SEOProps {
  title: string;
  description: string;
  image?: string;
  url?: string;
  type?: 'website' | 'article' | 'course';
  jsonLd?: Record<string, any>;
}

export default function SEO({ title, description, image, url, type = 'website', jsonLd }: SEOProps) {
  useEffect(() => {
    // 1. Update Title
    const fullTitle = `${title} | م. أحمد الباز`;
    document.title = fullTitle;

    // Helper to set meta tags
    const setMetaTag = (attr: string, key: string, content: string) => {
      let element = document.querySelector(`meta[${attr}="${key}"]`);
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attr, key);
        document.head.appendChild(element);
      }
      element.setAttribute('content', content);
    };

    // 2. Update Standard Meta
    setMetaTag('name', 'description', description);
    setMetaTag('name', 'title', fullTitle);

    // 3. Update Open Graph
    setMetaTag('property', 'og:title', fullTitle);
    setMetaTag('property', 'og:description', description);
    setMetaTag('property', 'og:type', type);
    if (image) setMetaTag('property', 'og:image', image);
    if (url) setMetaTag('property', 'og:url', url);

    // 4. Update Twitter Card
    setMetaTag('name', 'twitter:title', fullTitle);
    setMetaTag('name', 'twitter:description', description);
    if (image) setMetaTag('name', 'twitter:image', image);
    setMetaTag('name', 'twitter:card', 'summary_large_image');

    // 5. Inject JSON-LD if provided
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

    // Cleanup function when component unmounts
    return () => {
      if (script && document.head.contains(script)) {
        document.head.removeChild(script);
      }
    };
  }, [title, description, image, url, type, jsonLd]);

  return null;
}
