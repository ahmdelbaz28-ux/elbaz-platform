// Cookie/session diagnostic: real UI login through the proxy, then inspect
// what cookies the browser actually stored and what auth.sessionProbe says.
import { chromium } from "playwright";

const BASE = "http://localhost:4174";
const PASS = process.argv[2] || "";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("elbaz_cookie_consent",
      JSON.stringify({ necessary: true, analytics: false, marketing: false }));
  } catch { /* storage unavailable */ }
});
const page = await ctx.newPage();

const trpcResponses = [];
page.on("response", (res) => {
  if (res.url().includes("/api/trpc/")) {
    trpcResponses.push({ url: res.url().slice(0, 100), status: res.status(), setCookie: res.headers()["set-cookie"]?.slice(0, 120) });
  }
});

await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 45000 });
await page.waitForTimeout(2000);

// fill the login form
const user = page.locator("input[name='username'], input#username, input[type='text']").first();
const pass = page.locator("input[type='password']").first();
await user.fill("admin");
await pass.fill(PASS);
await page.locator("button[type='submit']").first().click();
await page.waitForTimeout(5000);

console.log("URL after login:", page.url());
console.log("\ntrpc responses seen:");
for (const r of trpcResponses) console.log("  ", r.status, r.url, r.setCookie ? "SET-COOKIE PRESENT" : "(no set-cookie)");

console.log("\nbrowser cookies:");
for (const c of await ctx.cookies()) console.log("  ", c.name, "secure=" + c.secure, "sameSite=" + c.sameSite, "domain=" + c.domain);

const flag = await page.evaluate(() => document.cookie);
console.log("\ndocument.cookie (JS-readable):", flag.slice(0, 120));

const probe = await page.evaluate(async () => {
  const r = await fetch("/api/trpc/auth.sessionProbe?batch=1", { method: "GET", credentials: "include" });
  return { status: r.status, body: await r.text() };
});
console.log("\nauth.sessionProbe:", probe.status, probe.body.slice(0, 200));

await browser.close();
