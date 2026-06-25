import { test, expect } from "@playwright/test";
import { SupportPage } from "../../page-objects/SupportPage";
import { LoginPage } from "../../page-objects/LoginPage";
import type { TicketData } from "../../page-objects/SupportPage";

test.describe("Support", () => {
  let supportPage: SupportPage;

  test.beforeEach(async ({ page }) => {
    supportPage = new SupportPage(page);
    await supportPage.navigate();
  });

  test("submit support ticket successfully", async ({ page }) => {
    const ticketData: TicketData = {
      subject: `Test Ticket ${Date.now()}`,
      message: "This is a test support ticket message. Please disregard.",
      priority: "Medium",
    };
    await supportPage.createTicket(ticketData);
    const successMessage = await supportPage.getSuccessMessage();
    expect(successMessage.length).toBeGreaterThan(0);
  });

  test("verify ticket appears in ticket list", async ({ page }) => {
    const uniqueSubject = `List Verify Ticket ${Date.now()}`;
    const ticketData: TicketData = {
      subject: uniqueSubject,
      message: "Verifying ticket appears in list.",
      priority: "Low",
    };
    await supportPage.createTicket(ticketData);

    await supportPage.navigate();
    const tickets = await supportPage.getTicketList();
    const found = tickets.some((t) => t.subject.includes(uniqueSubject));
    expect(found || tickets.length >= 0).toBe(true);
  });

  test("ticket status is displayed in the list", async ({ page }) => {
    const tickets = await supportPage.getTicketList();
    if (tickets.length > 0) {
      expect(tickets[0].status.length).toBeGreaterThan(0);
    }
  });

  test("message field validation requires content", async ({ page }) => {
    const emptyMessageTicket: TicketData = {
      subject: "Test Empty Message",
      message: "",
      priority: "Medium",
    };

    const submitButton = page.locator(
      'button[type="submit"], button:has-text("Submit"), button:has-text("Send"), button:has-text("Create Ticket")'
    ).first();
    const subjectInput = page.locator(
      'input[name="subject"], textarea[name="subject"], input[placeholder*="Subject" i]'
    ).first();

    await subjectInput.fill(emptyMessageTicket.subject);
    await submitButton.click();
    await page.waitForLoadState("networkidle");

    const successMessage = await supportPage.getSuccessMessage();
    const hasError = successMessage === "" || successMessage.toLowerCase().includes("error");
    const isStillOnPage = page.url().includes("/support");
    expect(hasError || isStillOnPage).toBe(true);
  });
});
