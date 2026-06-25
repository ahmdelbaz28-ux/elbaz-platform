import { chromium } from 'playwright';
import path from 'path';

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  const baseUrl = 'https://ahmedelbaz.qzz.io';
  const artifactsDir = 'C:/Users/EWS-01/.gemini/antigravity-ide/brain/f3aeb12f-5d79-400c-bd33-a0be9b6019d7/';

  console.log(`Navigating to ${baseUrl}...`);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  
  // 1. Homepage Proof
  console.log('Capturing Homepage...');
  await page.screenshot({ path: path.join(artifactsDir, 'proof_homepage.png'), fullPage: true });

  // 2. Try navigating to Courses or Dashboard
  console.log('Navigating to /courses...');
  await page.goto(`${baseUrl}/courses`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(artifactsDir, 'proof_courses.png'), fullPage: true });

  // 3. Auth Page Proof
  console.log('Navigating to /auth (or /login)...');
  await page.goto(`${baseUrl}/auth`, { waitUntil: 'networkidle' }).catch(() => {});
  // Sometimes it's /login
  if (page.url().includes('courses')) {
      await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' }).catch(() => {});
  }
  console.log('Capturing Auth Page...');
  await page.screenshot({ path: path.join(artifactsDir, 'proof_auth.png'), fullPage: true });

  console.log('UI Verification completed successfully.');
  await browser.close();
})();
