import webdriver from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";

const opts = new chrome.Options();
opts.setChromeBinaryPath("/home/z/.agent-browser/browsers/chrome-149.0.7827.115/chrome");
opts.addArguments("--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu");

const driver = await new webdriver.Builder()
  .forBrowser("chrome")
  .setChromeOptions(opts)
  .build();

console.log("Session created");
console.log("Calling driver.get...");
await driver.get("https://ahmedelbaz.qzz.io/");
console.log("driver.get completed");
const title = await driver.getTitle();
console.log("Title:", title);
await driver.quit();
process.exit(0);
