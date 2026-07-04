#!/usr/bin/env node
/**
 * Selenium IDE .side File Runner (Direct WebDriver Mode)
 *
 * WHY THIS EXISTS:
 *   selenium-side-runner 4.0.13 has a bug where playback hangs in jest
 *   execution context (works fine in standalone scripts). The root cause
 *   appears to be an interaction between jest's test isolation and the
 *   playback promise chain in @seleniumhq/side-runtime.
 *
 * WHAT THIS DOES:
 *   Reads .side files (Selenium IDE JSON format) and executes their tests
 *   using selenium-webdriver directly. This bypasses the buggy runner
 *   while preserving the .side file format (so tests remain portable
 *   and can be opened/edited in Selenium IDE browser extension).
 *
 * USAGE:
 *   node scripts/run-side-files.mjs [path-to-.side-or-directory]
 *
 *   Default: runs all .side files in tests/selenium-side/
 */
import { Builder, By, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import fs from "node:fs";
import path from "node:path";
import { globSync } from "node:fs";

const CHROME_BIN = "/home/z/.agent-browser/browsers/chrome-149.0.7827.115/chrome";
const CHROMEDRIVER_PATH = "/home/z/my-project/bin/chromedriver";
const DEFAULT_DIR = "tests/selenium-side";

// Parse command-line args
const inputPath = process.argv[2] || DEFAULT_DIR;
let sideFiles = [];
if (fs.statSync(inputPath).isFile()) {
  sideFiles = [inputPath];
} else {
  sideFiles = globSync(`${inputPath}/*.side`).sort();
}

if (sideFiles.length === 0) {
  console.error("No .side files found in", inputPath);
  process.exit(1);
}

console.log("═══════════════════════════════════════════════════════════════");
console.log("  Selenium IDE .side File Runner (Direct WebDriver Mode)");
console.log("═══════════════════════════════════════════════════════════════");
console.log(`  Files:   ${sideFiles.length}`);
console.log(`  Browser: Chrome 149 (headless)`);
console.log("");

// Configure Chrome
const chromeOptions = new chrome.Options();
chromeOptions.setChromeBinaryPath(CHROME_BIN);
chromeOptions.addArguments(
  "--headless=new",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--window-size=1920,1080",
  "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
);
const service = new chrome.ServiceBuilder(CHROMEDRIVER_PATH);

const driver = await new Builder()
  .forBrowser("chrome")
  .setChromeOptions(chromeOptions)
  .setChromeService(service)
  .build();

const results = [];
let totalPassed = 0;
let totalFailed = 0;

for (const sideFile of sideFiles) {
  const sideName = path.basename(sideFile, ".side");
  const sideData = JSON.parse(fs.readFileSync(sideFile, "utf8"));
  const baseUrl = sideData.url;
  let testsPassed = 0;
  let testsFailed = 0;

  process.stdout.write(`  → ${sideName.padEnd(30)} `);

  for (const test of sideData.tests) {
    const result = { name: test.name, passed: false, error: null };
    try {
      for (const cmd of test.commands) {
        await executeCommand(driver, cmd, baseUrl);
      }
      result.passed = true;
      testsPassed++;
    } catch (err) {
      result.error = err.message;
      testsFailed++;
    }
    results.push({ file: sideName, ...result });
  }

  if (testsFailed === 0) {
    console.log(`✅ PASS  (${testsPassed}/${testsPassed + testsFailed})`);
    totalPassed += testsPassed;
  } else {
    console.log(`❌ FAIL  (${testsPassed} passed, ${testsFailed} failed)`);
    totalPassed += testsPassed;
    totalFailed += testsFailed;
  }
}

try {
  await driver.quit();
} catch {
  // ignore
}

console.log("");
console.log("═══════════════════════════════════════════════════════════════");
console.log("  Final Summary");
console.log("═══════════════════════════════════════════════════════════════");
console.log(`  Total:   ${results.length}`);
console.log(`  ✅ Passed: ${totalPassed}`);
console.log(`  ❌ Failed: ${totalFailed}`);

if (totalFailed > 0) {
  console.log("");
  console.log("  Failed tests:");
  results.filter(r => !r.passed).forEach(r => {
    console.log(`    • ${r.file}/${r.name}: ${r.error}`);
  });
}

// Save report
const report = {
  timestamp: new Date().toISOString(),
  total: results.length,
  passed: totalPassed,
  failed: totalFailed,
  results,
};
fs.writeFileSync("/tmp/selenium-side-results.json", JSON.stringify(report, null, 2));
console.log(`\n  Report: /tmp/selenium-side-results.json`);

process.exit(totalFailed > 0 ? 1 : 0);

// ═══════════════════════════════════════════════════════════════
// Command executors — implement Selenium IDE commands
// ═══════════════════════════════════════════════════════════════
async function executeCommand(driver, cmd, baseUrl) {
  const { command, target, value } = cmd;
  switch (command) {
    case "open":
      await driver.get(new URL(target, baseUrl).href);
      // Wait for Cloudflare challenge to resolve (if present)
      // Cloudflare's "Just a moment..." page takes 5-8s to auto-solve
      // in headless mode. 8s sleep + 20s assert wait = 28s total.
      await driver.sleep(8000);
      // Check if Cloudflare challenge is still showing; if so, wait more
      try {
        const title = await driver.getTitle();
        if (title.includes("Just a moment") || title.includes("Attention Required")) {
          await driver.sleep(10000); // Wait 10 more seconds for challenge to resolve
        }
      } catch {
        // ignore title check errors
      }
      break;
    case "click":
      await driver.findElement(parseLocator(target)).click();
      break;
    case "type":
      await driver.findElement(parseLocator(target)).sendKeys(value);
      break;
    case "waitForElementVisible":
      await driver.wait(
        until.elementIsVisible(driver.findElement(parseLocator(target))),
        parseInt(value) || 15000
      );
      break;
    case "waitForElementPresent":
      await driver.wait(
        until.elementLocated(parseLocator(target)),
        parseInt(value) || 15000
      );
      break;
    case "assertElementPresent":
      // Wait up to 10s for element to appear (handles Cloudflare delay)
      await driver.wait(until.elementLocated(parseLocator(target)), 20000);
      break;
    case "assertText":
      const elem = await driver.findElement(parseLocator(target));
      const text = await elem.getText();
      if (!matchPattern(text, value)) {
        throw new Error(`assertText failed: expected "${value}" but got "${text}"`);
      }
      break;
    case "assertTitle":
      const title = await driver.getTitle();
      if (!matchPattern(title, value)) {
        throw new Error(`assertTitle failed: expected "${value}" but got "${title}"`);
      }
      break;
    case "echo":
      // no-op (logging only)
      break;
    case "pause":
      await driver.sleep(parseInt(value) || 1000);
      break;
    default:
      throw new Error(`Unsupported command: ${command}`);
  }
}

function parseLocator(locator) {
  if (locator.startsWith("css=")) return By.css(locator.substring(4));
  if (locator.startsWith("xpath=")) return By.xpath(locator.substring(6));
  if (locator.startsWith("id=")) return By.id(locator.substring(3));
  if (locator.startsWith("name=")) return By.name(locator.substring(5));
  if (locator.startsWith("link=")) return By.linkText(locator.substring(5));
  // Default to CSS
  return By.css(locator);
}

function matchPattern(text, pattern) {
  if (pattern.startsWith("glob:")) {
    const glob = pattern.substring(5);
    // Convert glob to regex: * → .*
    const regex = glob.replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${regex}$`).test(text);
  }
  if (pattern.startsWith("regex:")) {
    return new RegExp(pattern.substring(6)).test(text);
  }
  // Exact match
  return text === pattern;
}
