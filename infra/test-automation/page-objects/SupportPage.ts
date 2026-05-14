import { Page, expect } from "@playwright/test";

export interface TicketData {
  subject: string;
  message: string;
  priority: string;
}

export class SupportPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async navigate() {
    await this.page.goto("/support");
    await this.page.waitForLoadState("networkidle");
  }

  async createTicket(data: TicketData) {
    const subjectInput = this.page.locator(
      'input[name="subject"], textarea[name="subject"], input[placeholder*="Subject" i], [data-testid="ticket-subject"]'
    ).first();
    const messageInput = this.page.locator(
      'textarea[name="message"], textarea[name="body"], textarea[placeholder*="Message" i], textarea[placeholder*="Describe" i], [data-testid="ticket-message"]'
    ).first();
    const prioritySelect = this.page.locator(
      'select[name="priority"], [data-testid="ticket-priority"], label:has-text("Priority") + select, label:has-text("Priority") ~ select'
    ).first();
    const submitButton = this.page.locator(
      'button[type="submit"], button:has-text("Submit"), button:has-text("Send"), button:has-text("Create Ticket"), [data-testid="submit-ticket"]'
    ).first();

    await subjectInput.fill(data.subject);

    if ((await prioritySelect.count()) > 0) {
      await prioritySelect.selectOption({ label: data.priority });
    }

    await messageInput.fill(data.message);
    await submitButton.click();
    await this.page.waitForLoadState("networkidle");
    await this.page.waitForTimeout(1000);
  }

  async getSuccessMessage(): Promise<string> {
    const selectors = [
      '[role="alert"]',
      '[class*="success"]',
      '[class*="toast-success"]',
      '[data-testid="success-message"]',
      '.bg-green-100',
      '.text-green-600',
      '.alert-success',
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

  async getTicketList(): Promise<{ subject: string; status: string; priority: string; date: string }[]> {
    const tickets: { subject: string; status: string; priority: string; date: string }[] = [];
    const rows = this.page.locator(
      'table tbody tr, [data-testid="ticket-item"], [class*="ticket-card"], [class*="ticket-row"]'
    );
    const count = await rows.count();

    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const subject = (await row.locator('[class*="subject"], td:nth-child(1), [data-testid="ticket-subject"]').first().textContent().catch(() => ""))?.trim() ?? "";
      const status = (await row.locator('[class*="status"], td:nth-child(2), [data-testid="ticket-status"]').first().textContent().catch(() => ""))?.trim() ?? "";
      const priority = (await row.locator('[class*="priority"], td:nth-child(3), [data-testid="ticket-priority"]').first().textContent().catch(() => ""))?.trim() ?? "";
      const date = (await row.locator('[class*="date"], td:nth-child(4), [data-testid="ticket-date"], time').first().textContent().catch(() => ""))?.trim() ?? "";

      tickets.push({ subject, status, priority, date });
    }
    return tickets;
  }

  async isLoaded(): Promise<boolean> {
    await this.page.waitForLoadState("networkidle");
    return this.page.url().includes("/support");
  }
}
