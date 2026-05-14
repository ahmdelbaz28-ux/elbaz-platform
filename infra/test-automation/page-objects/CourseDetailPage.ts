import { Page, expect } from "@playwright/test";

export interface Module {
  title: string;
  lessons: string[];
}

export class CourseDetailPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async navigate(courseId: string) {
    await this.page.goto(`/courses/${courseId}`);
    await this.page.waitForLoadState("networkidle");
  }

  async getTitle(): Promise<string> {
    const selectors = [
      '[data-testid="course-title"]',
      'h1',
      '[class*="course-title"]',
      'h1[class*="title"]',
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

  async getDescription(): Promise<string> {
    const selectors = [
      '[data-testid="course-description"]',
      '[class*="description"]',
      '[class*="about"] p',
      'p[class*="lead"]',
      '.course-description',
    ];
    for (const selector of selectors) {
      const element = this.page.locator(selector).first();
      const text = await element.textContent().catch(() => null);
      if (text && text.trim() && text.trim().length > 10) {
        return text.trim();
      }
    }
    return "";
  }

  async getModules(): Promise<Module[]> {
    const modules: Module[] = [];
    const moduleElements = this.page.locator(
      '[data-testid="module"], [class*="module"], [class*="section"], details, .accordion-item'
    );
    const moduleCount = await moduleElements.count();

    for (let i = 0; i < moduleCount; i++) {
      const moduleEl = moduleElements.nth(i);
      const title = (
        await moduleEl
          .locator('h2, h3, h4, summary, [class*="module-title"], [class*="section-title"], [data-testid="module-title"]')
          .first()
          .textContent()
          .catch(() => "")
      )?.trim() ?? "";

      const lessons: string[] = [];
      const lessonElements = moduleEl.locator(
        'li, [class*="lesson"], [class*="item"], [data-testid="lesson"], a[href*="lesson"]'
      );
      const lessonCount = await lessonElements.count();
      for (let j = 0; j < lessonCount; j++) {
        const lessonText = (
          await lessonElements.nth(j).textContent().catch(() => "")
        )?.trim() ?? "";
        if (lessonText) lessons.push(lessonText);
      }

      if (title) {
        modules.push({ title, lessons });
      }
    }
    return modules;
  }

  async enroll() {
    const enrollButton = this.page.locator(
      'button:has-text("Enroll"), button:has-text("enroll"), button:has-text("Register"), ' +
      'button:has-text("Join"), [data-testid="enroll-button"], [class*="enroll"] button, ' +
      'button[class*="enroll"], a:has-text("Enroll"), a:has-text("Join")'
    ).first();

    await expect(enrollButton).toBeVisible({ timeout: 5000 });
    await enrollButton.click();
    await this.page.waitForLoadState("networkidle");
    await this.page.waitForTimeout(1000);
  }

  async getVideoPlayer(): Promise<boolean> {
    const videoSelectors = [
      'video',
      'iframe[src*="youtube"]',
      'iframe[src*="vimeo"]',
      'iframe[src*="player"]',
      '[data-testid="video-player"]',
      '[class*="video-player"]',
      '[class*="video-container"]',
    ];
    for (const selector of videoSelectors) {
      if (await this.page.locator(selector).first().isVisible().catch(() => false)) {
        return true;
      }
    }
    return false;
  }

  async verifyLesson(index: number) {
    const lessonElements = this.page.locator(
      'li[class*="lesson"], [data-testid="lesson"], a[href*="lesson"], [class*="lesson-item"]'
    );
    const count = await lessonElements.count();
    if (index >= count) {
      throw new Error(`Lesson index ${index} out of bounds. Only ${count} lessons available.`);
    }
    await expect(lessonElements.nth(index)).toBeVisible();
    await lessonElements.nth(index).click();
    await this.page.waitForLoadState("networkidle");
  }

  async isLoaded(): Promise<boolean> {
    await this.page.waitForLoadState("networkidle");
    const title = await this.getTitle();
    return title.length > 0;
  }
}
