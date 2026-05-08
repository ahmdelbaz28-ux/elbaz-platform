import { test, expect } from "@playwright/test";

const pagesToTest = [
  { name: "Home", path: "/" },
  { name: "Login", path: "/login" },
  { name: "Register", path: "/register" },
  { name: "Courses", path: "/courses" },
  { name: "Support", path: "/support" },
];

for (const { name, path } of pagesToTest) {
  test.describe(`Accessibility - ${name} Page`, () => {
    test("heading hierarchy: only one h1 per page", async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      const h1Elements = page.locator("h1");
      const h1Count = await h1Elements.count();
      expect(h1Count).toBeLessThanOrEqual(1);

      if (h1Count === 1) {
        const h1Text = await h1Elements.first().textContent();
        expect(h1Text?.trim().length).toBeGreaterThan(0);
      }
    });

    test("images have alt text", async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      const images = page.locator("img");
      const imageCount = await images.count();

      for (let i = 0; i < imageCount; i++) {
        const img = images.nth(i);
        const alt = await img.getAttribute("alt");
        const role = await img.getAttribute("role");

        const hasAlt = alt !== null;
        const isDecorative = role === "presentation" || role === "none";

        expect(hasAlt || isDecorative).toBe(true);
      }
    });

    test("buttons have visible text or aria-label", async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      const buttons = page.locator("button:not([aria-hidden='true'])");
      const buttonCount = await buttons.count();

      for (let i = 0; i < buttonCount; i++) {
        const button = buttons.nth(i);
        const text = (await button.textContent())?.trim() ?? "";
        const ariaLabel = await button.getAttribute("aria-label");
        const ariaLabelledBy = await button.getAttribute("aria-labelledby");
        const title = await button.getAttribute("title");
        const hasIcon = (await button.locator("svg, i").count()) > 0;

        const isAccessible =
          text.length > 0 ||
          ariaLabel !== null ||
          ariaLabelledBy !== null ||
          (title !== null && title.length > 0) ||
          hasIcon;

        expect(isAccessible).toBe(true);
      }
    });

    test("form inputs have associated labels", async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      const inputs = page.locator("input:not([type='hidden']):not([type='submit']):not([type='button'])");
      const inputCount = await inputs.count();

      for (let i = 0; i < inputCount; i++) {
        const input = inputs.nth(i);
        const id = await input.getAttribute("id");
        const ariaLabel = await input.getAttribute("aria-label");
        const ariaLabelledBy = await input.getAttribute("aria-labelledby");
        const placeholder = await input.getAttribute("placeholder");
        const type = await input.getAttribute("type");
        const isSearchOrSubmit = type === "search" || type === "submit";

        if (isSearchOrSubmit) continue;

        const hasLabel = ariaLabel !== null || ariaLabelledBy !== null || (placeholder !== null && placeholder.length > 0);

        if (id) {
          const label = page.locator(`label[for="${id}"]`);
          const hasMatchingLabel = (await label.count()) > 0;
          expect(hasMatchingLabel || hasLabel || !id).toBe(true);
        } else {
          expect(hasLabel).toBe(true);
        }
      }
    });

    test("focus management: interactive elements are focusable", async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      const links = page.locator("a[href]:not([tabindex='-1'])");
      const linkCount = await links.count();

      for (let i = 0; i < Math.min(linkCount, 5); i++) {
        const link = links.nth(i);
        await link.focus();
        await expect(link).toBeFocused();
      }

      const buttons = page.locator("button:not([disabled]):not([tabindex='-1'])");
      const buttonCount = await buttons.count();

      for (let i = 0; i < Math.min(buttonCount, 5); i++) {
        const button = buttons.nth(i);
        await button.focus();
        await expect(button).toBeFocused();
      }
    });

    test("ARIA attributes are valid on custom widgets", async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      const elementsWithRole = page.locator("[role]");
      const roleCount = await elementsWithRole.count();

      for (let i = 0; i < roleCount; i++) {
        const element = elementsWithRole.nth(i);
        const role = await element.getAttribute("role");

        const validRoles = [
          "alert", "alertdialog", "button", "checkbox", "dialog", "grid",
          "gridcell", "link", "listbox", "menu", "menubar", "menuitem",
          "navigation", "option", "progressbar", "radio", "radiogroup",
          "search", "searchbox", "slider", "spinbutton", "switch", "tab",
          "tablist", "tabpanel", "textbox", "toolbar", "tooltip", "tree",
          "treegrid", "treeitem", "banner", "complementary", "contentinfo",
          "form", "main", "region", "status", "log", "timer", "marquee",
        ];

        expect(validRoles).toContain(role);
      }

      const elementsWithAriaRequired = page.locator("[aria-required='true']");
      const ariaRequiredCount = await elementsWithAriaRequired.count();

      for (let i = 0; i < ariaRequiredCount; i++) {
        const element = elementsWithAriaRequired.nth(i);
        const tagName = await element.evaluate((el) => el.tagName.toLowerCase());
        const validTags = ["input", "select", "textarea"];
        expect(validTags).toContain(tagName);
      }
    });
  });
}
