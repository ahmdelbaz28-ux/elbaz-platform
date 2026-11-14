// Visual verification: WhatsApp FAB removed, chatbot + scroll-top FABs present and well-placed.
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const results = [];
const ok = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const browser = await chromium.launch();
try {
  // ── Desktop ──
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await desktop.goto(BASE + "/", { waitUntil: "networkidle" });
  await desktop.waitForTimeout(4000); // old FAB had a 3s entrance delay — give UI time to settle

  const waDesktop = await desktop.locator(".whatsapp-fab, .whatsapp-fab-wrap, [aria-label*='WhatsApp' i], [aria-label*='واتساب']").count();
  ok("desktop: no WhatsApp FAB in DOM", waDesktop === 0, `count=${waDesktop}`);

  const botDesktop = await desktop.locator("button.chatbot-fab").count();
  ok("desktop: chatbot FAB present", botDesktop === 1, `count=${botDesktop}`);

  const botBox = botDesktop ? await desktop.locator("button.chatbot-fab").boundingBox() : null;
  ok("desktop: chatbot FAB in bottom-right corner",
    !!botBox && botBox.y + botBox.height > 800 - 120 && botBox.x + botBox.width > 1280 - 160,
    botBox ? JSON.stringify(botBox) : "missing");

  await desktop.evaluate(() => window.scrollTo(0, 1200));
  await desktop.waitForTimeout(700);
  const stDesktop = await desktop.locator("button.scroll-top-fab").count();
  const stBox = stDesktop ? await desktop.locator("button.scroll-top-fab").boundingBox() : null;
  ok("desktop: scroll-top FAB appears after scrolling (bottom-left)",
    stDesktop === 1 && !!stBox && stBox.x < 200 && stBox.y + stBox.height > 800 - 160,
    stBox ? JSON.stringify(stBox) : "missing");
  await desktop.screenshot({ path: "/tmp/fab-desktop.png" });

  // ── Mobile ──
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.goto(BASE + "/", { waitUntil: "networkidle" });
  await mobile.waitForTimeout(4000);

  const waMobile = await mobile.locator(".whatsapp-fab, .whatsapp-fab-wrap, [aria-label*='WhatsApp' i], [aria-label*='واتساب']").count();
  ok("mobile: no WhatsApp FAB in DOM", waMobile === 0, `count=${waMobile}`);

  const botMobile = await mobile.locator("button.chatbot-fab").count();
  ok("mobile: chatbot FAB present", botMobile === 1, `count=${botMobile}`);
  const botM = botMobile ? await mobile.locator("button.chatbot-fab").boundingBox() : null;
  // bottom-most slot: y+height within ~28px of the bottom edge (fab-edge = 0.75rem=12px)
  ok("mobile: chatbot FAB is the BOTTOM-MOST button (old WhatsApp slot)",
    !!botM && botM.y + botM.height > 844 - 28, botM ? JSON.stringify(botM) : "missing");

  await mobile.evaluate(() => window.scrollTo(0, 1200));
  await mobile.waitForTimeout(700);
  const stM = await mobile.locator("button.scroll-top-fab").count();
  const stMBox = stM ? await mobile.locator("button.scroll-top-fab").boundingBox() : null;
  ok("mobile: scroll-top FAB stacked directly ABOVE the chatbot FAB",
    stM === 1 && !!stMBox && !!botM && Math.abs((botM.y - (stMBox.y + stMBox.height)) - 10) <= 14,
    stMBox && botM ? `gap=${Math.round(botM.y - (stMBox.y + stMBox.height))}px (expect ~10)` : "missing");
  await mobile.screenshot({ path: "/tmp/fab-mobile.png" });

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
} finally {
  await browser.close();
}
