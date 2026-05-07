import { Page, expect } from "@playwright/test";

export interface CourseCard {
  title: string;
  price: string;
  rating: string;
  category: string;
  url: string;
}

export class CoursesPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async navigate() {
    await this.page.goto("/courses");
    await this.page.waitForLoadState("networkidle");
  }

  async getCourses(): Promise<CourseCard[]> {
    const cards = this.page.locator('[data-testid="course-card"], [class*="course-card"], article[class*="course"], .course-item');
    const count = await cards.count();
    const courses: CourseCard[] = [];

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const title = (await card.locator('h2, h3, [class*="title"], [data-testid="course-title"]').first().textContent().catch(() => ""))?.trim() ?? "";
      const price = (await card.locator('[class*="price"], [data-testid="course-price"], .amount').first().textContent().catch(() => ""))?.trim() ?? "";
      const rating = (await card.locator('[class*="rating"], [data-testid="course-rating"], .stars').first().getAttribute("aria-label").catch(() => null))
        ?? (await card.locator('[class*="rating"], [data-testid="course-rating"], .stars').first().textContent().catch(() => ""))?.trim() ?? "";
      const category = (await card.locator('[class*="category"], [data-testid="course-category"], .badge, .tag').first().textContent().catch(() => ""))?.trim() ?? "";
      const url = (await card.locator("a").first().getAttribute("href").catch(() => "")) ?? "";

      courses.push({ title, price, rating, category, url });
    }
    return courses;
  }

  async filterByCategory(category: string) {
    const categoryButton = this.page.locator(`button:has-text("${category}"), a:has-text("${category}"), [data-testid="category-${category.toLowerCase()}"], option[value="${category}"]`).first();
    await categoryButton.click();
    await this.page.waitForLoadState("networkidle");
    await this.page.waitForTimeout(500);
  }

  async searchCourse(query: string) {
    const searchInput = this.page.locator('input[name="search"], input[type="search"], input[placeholder*="Search" i], input[placeholder*="search" i], [data-testid="search-input"]').first();
    await searchInput.fill(query);
    await searchInput.press("Enter");
    await this.page.waitForLoadState("networkidle");
    await this.page.waitForTimeout(500);
  }

  async navigateToCourse(index: number) {
    const cards = this.page.locator('[data-testid="course-card"], [class*="course-card"], article[class*="course"], a[href*="/courses/"]');
    const count = await cards.count();
    if (index >= count) {
      throw new Error(`Course index ${index} out of bounds. Only ${count} courses available.`);
    }
    const card = cards.nth(index);
    const link = card.locator("a").first();
    if ((await link.count()) > 0) {
      await link.click();
    } else {
      await card.click();
    }
    await this.page.waitForLoadState("networkidle");
  }

  async verifyCourseCardElements(index: number) {
    const cards = this.page.locator('[data-testid="course-card"], [class*="course-card"], article[class*="course"]');
    const card = cards.nth(index);

    await expect(card.locator('h2, h3, [class*="title"], [data-testid="course-title"]').first()).toBeVisible();
    await expect(card.locator('[class*="price"], [data-testid="course-price"]').first()).toBeVisible();
    await expect(card.locator('[class*="rating"], [data-testid="course-rating"], img[alt*="star" i]').first()).toBeVisible();
    await expect(card.locator("a").first()).toHaveAttribute("href", /\/courses\//);
  }

  async isLoaded(): Promise<boolean> {
    await this.page.waitForLoadState("networkidle");
    return this.page.url().includes("/courses");
  }
}
