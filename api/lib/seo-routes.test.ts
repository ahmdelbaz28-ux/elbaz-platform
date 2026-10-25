/**
 * REGRESSION TESTS — production-audit round: /articles deep-link fix
 *
 * The navbar links to /articles and App.tsx registers /articles + /articles/:slug
 * as public routes, but the server-side route whitelist (seo-meta) did not know
 * them — the SPA handler answered HTTP 404 (soft-404 prevention gone wrong for
 * a real route): humans saw the page after React booted, Google saw 404+noindex.
 */
import { describe, it, expect } from "vitest";

import { isKnownSpaRoute, isNoindexPath, resolveRouteSeo } from "./seo-meta";

describe("isKnownSpaRoute — /articles is a real public route", () => {
  it("accepts the articles listing", () => {
    expect(isKnownSpaRoute("/articles")).toBe(true);
  });

  it("accepts article detail slugs", () => {
    expect(isKnownSpaRoute("/articles/etap-load-flow-basics")).toBe(true);
  });

  it("still rejects unknown paths (soft-404 prevention intact)", () => {
    expect(isKnownSpaRoute("/not-a-real-route")).toBe(false);
    expect(isKnownSpaRoute("/articles/extra/deep")).toBe(false);
  });
});

describe("isNoindexPath — articles are indexable", () => {
  it("keeps /articles out of the noindex set", () => {
    expect(isNoindexPath("/articles")).toBe(false);
  });
});

describe("resolveRouteSeo — articles listing meta (no DB needed)", () => {
  it("returns Arabic-first articles meta with an exact canonical", async () => {
    const seo = await resolveRouteSeo("/articles");
    expect(seo.title).toContain("مقالات");
    expect(seo.canonical).toBe("https://ahmedelbaz.qzz.io/articles");
    expect(seo.description.length).toBeGreaterThan(50);
  });
});
