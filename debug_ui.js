import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', error => console.log(`[Browser Page Error] ${error.message}`));
  
  console.log("Navigating to http://localhost:3000...");
  try {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 15000 });
    console.log("Page loaded. Waiting 3 seconds to see if it crashes...");
    await page.waitForTimeout(3000);
    
    // Check if error boundary is visible
    const errorText = await page.getByText('Something went wrong').count();
    if (errorText > 0) {
      console.log("❌ Error Boundary detected!");
    } else {
      console.log("✅ Page seems stable.");
    }
  } catch (err) {
    console.error("Navigation failed:", err);
  } finally {
    await browser.close();
  }
})();
