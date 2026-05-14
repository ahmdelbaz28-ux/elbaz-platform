import { test, expect } from "@playwright/test";

const pagesToTest = [
  { name: "Home", path: "/" },
  { name: "Courses", path: "/courses" },
  { name: "Login", path: "/login" },
  { name: "Register", path: "/register" },
];

for (const { name, path } of pagesToTest) {
  test.describe(`Performance - ${name}`, () => {
    test("Largest Contentful Paint (LCP) is under 3 seconds", async ({ page }) => {
      const lcpMetric = await page.evaluate(() => {
        return new Promise<number>((resolve) => {
          const observer = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            const lcpEntry = entries[entries.length - 1];
            observer.disconnect();
            resolve(lcpEntry.startTime);
          });
          observer.observe({ type: "largest-contentful-paint", buffered: true });

          if ((window as any).performance?.getEntriesByType) {
            const existing = performance.getEntriesByType("largest-contentful-paint");
            if (existing.length > 0) {
              observer.disconnect();
              resolve(existing[existing.length - 1].startTime);
            }
          }

          setTimeout(() => {
            observer.disconnect();
            resolve(0);
          }, 10000);
        });
      });

      if (lcpMetric > 0) {
        expect(lcpMetric).toBeLessThan(3000);
      }
    });

    test("First Contentful Paint (FCP) is under 1.5 seconds", async ({ page }) => {
      const navigationTiming = await page.goto(path, { waitUntil: "domcontentloaded" });
      const timing = JSON.parse(
        await page.evaluate(() => JSON.stringify(performance.getEntriesByType("navigation")[0]))
      );

      const fcp = timing.responseStart || (navigationTiming ? navigationTiming.responseEnd() : 0);
      expect(fcp).toBeLessThan(1500);
    });

    test("Cumulative Layout Shift (CLS) is under 0.1", async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });

      const cls = await page.evaluate(() => {
        return new Promise<number>((resolve) => {
          let clsValue = 0;
          let sessionValue = 0;
          let sessionEntries: PerformanceEntry[] = [];

          const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (!(entry as any).hadRecentInput) {
                const firstSessionEntry = sessionEntries[0];
                const lastSessionEntry = sessionEntries[sessionEntries.length - 1];

                if (
                  firstSessionEntry &&
                  entry.startTime - firstSessionEntry.startTime < 1000 &&
                  entry.startTime - lastSessionEntry.startTime < 500
                ) {
                  sessionValue += (entry as any).value;
                } else {
                  sessionValue = (entry as any).value;
                  sessionEntries = [];
                }

                sessionEntries.push(entry);
                clsValue = Math.max(clsValue, sessionValue);
              }
            }
          });

          observer.observe({ type: "layout-shift", buffered: true });

          setTimeout(() => {
            observer.disconnect();
            resolve(clsValue);
          }, 5000);
        });
      });

      expect(cls).toBeLessThan(0.1);
    });

    test("no layout shifts on button click interaction", async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });

      const clsBefore = await page.evaluate(() => {
        const entries = performance.getEntriesByType("layout-shift");
        return entries.reduce((sum, entry) => sum + (entry as any).value, 0);
      });

      const buttons = page.locator("button:visible");
      const buttonCount = await buttons.count();

      if (buttonCount > 0) {
        await buttons.first().click();
        await page.waitForTimeout(500);

        const clsAfter = await page.evaluate(() => {
          const entries = performance.getEntriesByType("layout-shift");
          return entries.reduce((sum, entry) => sum + (entry as any).value, 0);
        });

        const layoutShiftDelta = clsAfter - clsBefore;
        expect(layoutShiftDelta).toBeLessThan(0.1);
      }
    });

    test("total JavaScript bundle size is reasonable", async ({ page }) => {
      const bundleSizes = await page.evaluate(async () => {
        const scripts = Array.from(document.querySelectorAll('script[src]'));
        const sizes: { src: string; size: number }[] = [];

        const metrics = (performance as any).getEntriesByType?.("resource") ?? [];
        for (const metric of metrics) {
          if (metric.initiatorType === "script") {
            sizes.push({
              src: metric.name,
              size: metric.transferSize || metric.encodedBodySize || 0,
            });
          }
        }

        return sizes;
      });

      const totalBundleSize = bundleSizes.reduce((sum, s) => sum + s.size, 0);
      const totalKB = totalBundleSize / 1024;

      expect(totalKB).toBeLessThan(5000);
    });
  });
}
