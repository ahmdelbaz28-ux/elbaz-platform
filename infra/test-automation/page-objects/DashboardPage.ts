import { Page, expect, Locator } from "@playwright/test";

export class DashboardPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async navigate() {
    await this.page.goto("/dashboard");
    await this.page.waitForLoadState("networkidle");
  }

  async getUserName(): Promise<string> {
    const selectors = [
      '[data-testid="user-name"]',
      '.user-name',
      '.user-greeting',
      'h1',
      'h2:has-text("Welcome")',
      '[class*="avatar"] + span',
      '.profile-name',
    ];
    for (const selector of selectors) {
      const element = this.page.locator(selector).first();
      const text = await element.textContent().catch(() => null);
      if (text && text.trim()) {
        return text.trim();
      }
    }
    return "";
  }

  async getEnrolledCoursesCount(): Promise<number> {
    const selectors = [
      '[data-testid="enrolled-courses-count"]',
      '.enrolled-courses-count',
      '.courses-count',
      '[class*="stat"] [class*="number"]',
      '.stat-value',
      'text=/\\d+\\s*courses?/i',
    ];
    for (const selector of selectors) {
      if (selector.startsWith("text=")) {
        const textMatch = await this.page.locator(selector).first().textContent().catch(() => null);
        if (textMatch) {
          const match = textMatch.match(/\d+/);
          if (match) return parseInt(match[0], 10);
        }
        continue;
      }
      const element = this.page.locator(selector).first();
      const text = await element.textContent().catch(() => null);
      if (text) {
        const match = text.match(/\d+/);
        if (match) return parseInt(match[0], 10);
      }
    }
    const courseCards = this.page.locator('[class*="course"], [data-testid="course-card"], .enrolled-course');
    return await courseCards.count();
  }

  async navigateToCourse(index: number) {
    const courseCards = this.page.locator('a[href*="/courses/"], [data-testid="course-card"], [class*="course-card"]');
    const count = await courseCards.count();
    if (index >= count) {
      throw new Error(`Course index ${index} out of bounds. Only ${count} courses available.`);
    }
    await courseCards.nth(index).click();
    await this.page.waitForLoadState("networkidle");
  }

  async isLoaded(): Promise<boolean> {
    await this.page.waitForLoadState("networkidle");
    return this.page.url().includes("/dashboard");
  }
}
