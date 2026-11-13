/**
 * LIVE PROD E2E — ⏹ stop button (owner request 2026-11-14).
 *
 * Registers a throwaway user, logs in against the REAL deployed backend,
 * then drives the REAL deployed UI on the HF Space:
 *   send → the send button transforms into the stop button → click STOP
 *   while the assistant is responding → the response truly stops:
 *   the button reverts, no new request is ever fired (no silent-retry
 *   resurrection, no non-stream fallback), no soft-busy noise.
 *
 * Run: npx tsx scripts/chat-stop-prod-e2e.ts
 */
import { chromium, type BrowserContext } from "playwright";

const BASE = "https://ahmdelbaz28-ahmdrtap.hf.space";
const FWD: Record<string, string> = {
  "x-forwarded-host": "ahmedelbaz.qzz.io",
  "x-forwarded-proto": "https",
};

// ── 1) Fresh throwaway user: register + login (same contract as final-e2e-check.ts) ──
const stamp = Date.now().toString(36);
const USERNAME = `stop${stamp}`.slice(0, 20);
const PASSWORD = `Stop${stamp}Pass1`;
const jar: Record<string, string> = {};

function cookieFrom(res: Response): void {
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const pair = sc.split(";")[0];
    const name = pair.split("=")[0];
    jar[name] = pair.slice(name.length + 1);
  }
}

function cookieHeader(): Record<string, string> {
  return Object.keys(jar).length
    ? { Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ") }
    : {};
}

async function mut(proc: string, input: unknown): Promise<number> {
  const res = await fetch(`${BASE}/api/trpc/${proc}?batch=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...FWD, ...cookieHeader() },
    body: JSON.stringify({ 0: { json: input } }),
  });
  cookieFrom(res);
  return res.status;
}

console.log("register:", await mut("auth.register", { username: USERNAME, password: PASSWORD, name: "stop e2e" }));
console.log("login:", await mut("auth.login", { username: USERNAME, password: PASSWORD, remember: true }));
console.log("session cookies:", Object.keys(jar).join(", ") || "NONE");

// ── 2) Browser journey against the deployed UI ──
const browser = await chromium.launch();
const context: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
// The Space expects the prod host header (same contract as every live E2E).
await context.route("**/*", (route) => {
  const headers = { ...route.request().headers(), ...FWD };
  void route.continue({ headers });
});
for (const [name, value] of Object.entries(jar)) {
  await context.addCookies([{ name, value, url: BASE }]);
}
const page = await context.newPage();
// Pre-accept the cookie banner (prod shows it after 800ms and its backdrop
// would otherwise intercept the FAB click).
await page.addInitScript(() => {
  try {
    localStorage.setItem(
      "elbaz_cookie_consent",
      JSON.stringify({ necessary: true, analytics: false, marketing: false }),
    );
  } catch { /* storage unavailable */ }
});

let chatbotPosts = 0;
page.on("request", (req) => {
  if (req.url().includes("/api/chatbot") && req.method() === "POST") chatbotPosts++;
});
page.on("pageerror", (err) => console.log("pageerror:", err.message.slice(0, 200)));

const results: Array<[string, boolean]> = [];
const check = (name: string, ok: boolean) => {
  results.push([name, ok]);
  console.log(ok ? "PASS" : "FAIL", "-", name);
};

try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90_000 });

  await page.getByRole("button", { name: "Open AI Assistant" }).click({ timeout: 45_000 });
  const input = page.getByLabel("Type your message");
  await input.waitFor({ state: "visible", timeout: 30_000 });
  check("chat opens with composer", true);

  await input.fill("ما هو تحليل القصر الكهربي؟");
  await page.getByRole("button", { name: "Send" }).click();

  // The send button transforms into the stop button the moment the message goes out.
  const stop = page.getByRole("button", { name: "Stop the assistant's response" });
  await stop.waitFor({ state: "visible", timeout: 15_000 });
  check("send button transformed into STOP", true);

  // Wait for the first streamed words (real provider — generous ceiling).
  // The blinking caret only renders inside the live streaming bubble.
  let sawText = false;
  try {
    await page.locator(".animate-typing-cursor").waitFor({ state: "visible", timeout: 90_000 });
    sawText = true;
    console.log("streaming text reached the UI");
  } catch {
    console.log("no streamed text within 90s (provider latency) — stopping during thinking phase");
  }

  await stop.click();

  const send = page.getByRole("button", { name: "Send" });
  await send.waitFor({ state: "visible", timeout: 10_000 });
  check("STOP reverted to send (loading cleared)", true);

  if (sawText) {
    const partial = page.getByText("القصر").first();
    await partial.waitFor({ state: "visible", timeout: 5_000 }).then(
      () => check("partial streamed text frozen as the reply", true),
      () => check("partial streamed text frozen as the reply", false),
    );
  }

  // ✅ ROOT-CURE GUARD: after the full silent-retry window, no new chat POST
  // may have fired (pre-cure, the killed request was resurrected).
  await page.waitForTimeout(8_000);
  check(`no resurrection: chat POSTs === 1 (observed ${chatbotPosts})`, chatbotPosts === 1);

  const busy = await page.getByText("under heavy load").count()
    + await page.getByText("الخدمة تمر بضغط عالٍ").count();
  check("no soft-busy noise after a deliberate stop", busy === 0);

  // ✅ S5443: artifacts go to the project-owned (gitignored) test-results
  // directory — never to publicly writable system directories like /tmp.
  await page.screenshot({ path: "test-results/chat-stop-prod/final.png" });
} catch (err) {
  check(`journey error: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`, false);
  await page.screenshot({ path: "test-results/chat-stop-prod/error.png" }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
process.exit(failed.length ? 1 : 0);
