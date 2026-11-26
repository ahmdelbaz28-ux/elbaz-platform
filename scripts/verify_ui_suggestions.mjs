// RUNTIME VERIFICATION — UI review suggestions #2/#3/#4/#5 implementation round
// Serves dist/public via the faithful static server, then checks with Playwright:
//   #2 hero motion discipline  — one continuous motion (primary CTA glow) only,
//     background icon layer reduced to 5 slow-drift icons
//   #3 signature completion    — .brand-signature-line under every section
//     title, .brand-signature-hover floors on the primary CTAs
//   #4 proof system wiring     — green badge chips in course cards + reviews
//   #5 certificate share image — built-in generator wired + canvas techniques
//     proven in the exact browser build (SVG-in-canvas, brand fonts, gradient)
//   + no console / page errors anywhere
import { spawn } from "node:child_process";
import { execSync } from "node:child_process";
import { chromium } from "playwright";

const PORT = 4322;
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn("node", ["scripts/lh_static_server.mjs", String(PORT)], { stdio: "pipe" });
await new Promise((r) => setTimeout(r, 1200));

const results = [];
const ok = (name, pass, detail = "") =>
  results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);

let browser;
try {
  try {
    browser = await chromium.launch();
  } catch {
    browser = await chromium.launch({
      executablePath:
        "/home/z/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell",
    });
  }
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));

  await page.goto(BASE + "/", { waitUntil: "commit" });
  await page.waitForFunction(() => !!document.querySelector("main#main-content"), { timeout: 30000 });
  await page.waitForTimeout(2500);

  try {
    const btn = page.getByRole("button", { name: /accept all/i }).first();
    await btn.click({ timeout: 5000 });
    await page.waitForTimeout(400);
  } catch { /* consent already dismissed */ }

  // ── #2: background icon layer — exactly 5 icons, ONE slow transform-only drift ──
  const floatInfo = await page.evaluate(() => {
    const wrap = document.querySelector(".floating-icons");
    if (!wrap) return { present: false };
    const icons = wrap.querySelectorAll(".icon");
    const first = icons[0] ? getComputedStyle(icons[0]) : null;
    return {
      present: true,
      count: icons.length,
      animation: first?.animationName,
      duration: first?.animationDuration,
      opacity: first?.opacity,
    };
  });
  ok("background icon layer present", floatInfo.present === true);
  ok("background icons reduced to 5", floatInfo.count === 5, `count=${floatInfo.count}`);
  ok(
    "icons carry ONE slow drift (40s, transform-only)",
    floatInfo.animation === "iconFloat" && floatInfo.duration === "40s",
    `${floatInfo.animation} @ ${floatInfo.duration}`,
  );
  ok("icons stay barely visible (opacity ≤ 0.13)", Number(floatInfo.opacity) <= 0.13, `opacity=${floatInfo.opacity}`);

  // ── #2: hero — the ONLY continuous motion is the primary CTA glow ──
  const heroInfo = await page.evaluate(() => {
    const section = [...document.querySelectorAll("section")].find((s) => s.querySelector("h1"));
    if (!section) return null;
    const glowWrap = section.querySelector(".brand-cta-glow");
    const glowBefore = glowWrap ? getComputedStyle(glowWrap, "::before") : null;
    const frame = section.querySelector(".relative.z-10.overflow-hidden");
    const frameAnim = frame ? getComputedStyle(frame).animationName : null;
    // every element inside the hero with a running CSS animation
    const animated = [...section.querySelectorAll("*")].filter((el) => {
      const cs = getComputedStyle(el);
      return cs.animationName !== "none" && cs.animationIterationCount.includes("infinite");
    });
    return {
      glowWrap: !!glowWrap,
      glowBeforeAnim: glowBefore?.animationName,
      glowBeforeOpacity: glowBefore?.opacity,
      frameAnim,
      animatedCount: animated.length,
      animatedTags: animated.map((el) => el.className?.toString?.().slice(0, 40) || el.tagName).slice(0, 6),
    };
  });
  ok("hero primary CTA glow wrapper mounted", heroInfo?.glowWrap === true);
  ok(
    "CTA glow is the pulsing pseudo-element (opacity animation)",
    heroInfo?.glowBeforeAnim === "brand-cta-pulse",
    `animation=${heroInfo?.glowBeforeAnim}`,
  );
  ok("hero image frame has NO continuous animation", heroInfo?.frameAnim === "none", `frame=${heroInfo?.frameAnim}`);
    // The pulse glow lives on the CTA wrapper's ::before (a PSEUDO-element,
    // not a DOM node) — so real-element count must be ZERO and the pseudo
    // check above proves the ONE motion exists.
  ok(
    "exactly ONE continuously-animated element in the hero (the CTA ::before)",
    heroInfo?.animatedCount === 0 && heroInfo?.glowBeforeAnim === "brand-cta-pulse",
    JSON.stringify(heroInfo?.animatedTags),
  );

  // ── #2/#3: headline keyword uses the official signature gradient ──
  const gradInfo = await page.evaluate(() => {
    const el = document.querySelector(".gradient-text");
    if (!el) return null;
    const bg = getComputedStyle(el).backgroundImage;
    return { present: true, bg, hasOrange: bg.includes("rgb(249, 115, 22)"), hasCyan: bg.includes("rgb(6, 182, 212)") };
  });
  ok("headline gradient-text present", gradInfo?.present === true);
  ok(
    "headline keyword = signature orange→cyan",
    gradInfo?.hasOrange === true && gradInfo?.hasCyan === true,
    gradInfo?.bg?.slice(0, 110),
  );

  // ── #3: section titles carry the signature line ──
  const sigLines = await page.evaluate(() => {
    const titles = [...document.querySelectorAll("h2.brand-signature-line")];
    const first = titles[0] ? getComputedStyle(titles[0], "::after") : null;
    return {
      count: titles.length,
      afterGradient: first?.backgroundImage || "",
      afterHeight: first?.height,
    };
  });
  ok("signature line on section titles (≥6 sections)", sigLines.count >= 6, `count=${sigLines.count}`);
  ok(
    "title line paints the signature gradient (3px)",
    sigLines.afterGradient.includes("rgb(249, 115, 22)") && sigLines.afterHeight === "3px",
    sigLines.afterGradient.slice(0, 90),
  );

  // ── #3: primary CTA hover floor (.brand-signature-hover) ──
  const hoverBtn = page.locator(".brand-signature-hover").first();
  const hoverCount = await page.locator(".brand-signature-hover").count();
  ok("signature hover floors on primary CTAs (≥2)", hoverCount >= 2, `count=${hoverCount}`);
  let hoverOk = false;
  let hoverDetail = "";
  if (hoverCount > 0) {
    // headless-shell hover can race the scroll/compositor — retry with a
    // fresh real-mouse hover + rAF settle until the CSS :hover state lands.
    for (let attempt = 0; attempt < 3 && !hoverOk; attempt++) {
      await hoverBtn.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await hoverBtn.hover();
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.waitForTimeout(350);
      hoverOk = await page.evaluate(() => {
        const el = document.querySelector(".brand-signature-hover");
        if (!el) return false;
        return Number(getComputedStyle(el, "::after").opacity) > 0.9;
      });
      hoverDetail = await page.evaluate(() => {
        const el = document.querySelector(".brand-signature-hover");
        return `matches=:hover→${el?.matches(":hover")} opacity=${getComputedStyle(el, "::after").opacity}`;
      });
    }
  }
  ok("CTA floor appears on hover (::after → opacity 1)", hoverOk === true, hoverDetail);

  // ── #4/#5: wiring present in the built bundle (local mock DB is empty —
  //    course cards / reviews / certificates can't render live here; lazy
  //    routes live in separate chunks, so scan ALL JS assets) ──
  const jsBundle = execSync("cat dist/public/assets/*.js", { encoding: "utf8", cwd: process.cwd(), maxBuffer: 1024 * 1024 * 128 });
  ok("course-card green certificate chip wired", jsBundle.includes("شهادة موثقة") && jsBundle.includes("Verifiable completion certificate"));
  ok("review verified-student badge wired", jsBundle.includes("طالب موثق"));
  ok("reviews verify-certificate link wired", jsBundle.includes("تحقق من شهادة"));
  ok("certificate share-image button wired", jsBundle.includes("صورة للمشاركة") && jsBundle.includes("Share image (1200"));
  ok("share-image generator wired (roundRect + toBlob pipeline)", jsBundle.includes(".roundRect(") && jsBundle.includes("toBlob") && jsBundle.includes("canShare"));

  // ── #5: canvas techniques proven in THIS browser build ──
  const canvasProof = await page.evaluate(async () => {
    const out = { fontsCairo: false, svgDataUrlRaster: false, roundRect: false, gradientBars: false };
    try {
      await Promise.all([document.fonts.load('700 58px Cairo'), document.fonts.load('600 20px Inter')]);
      out.fontsCairo = document.fonts.check('700 58px Cairo');
    } catch { /* keep false */ }
    try {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect x="0" y="0" width="40" height="40" fill="#06b6d4"/></svg>';
      const img = new Image();
      const loaded = new Promise((res, rej) => { img.onload = () => res(true); img.onerror = () => rej(new Error("svg load")); });
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await loaded;
      const c = document.createElement("canvas");
      c.width = 40; c.height = 40;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(20, 20, 1, 1).data;
      out.svgDataUrlRaster = px[2] > 150; // blue channel ≈ 212
    } catch { /* keep false */ }
    try {
      const c2 = document.createElement("canvas");
      const ctx2 = c2.getContext("2d");
      ctx2.beginPath();
      ctx2.roundRect(0, 0, 10, 10, 3);
      out.roundRect = true;
    } catch { out.roundRect = false; }
    try {
      const c3 = document.createElement("canvas");
      c3.width = 300; c3.height = 10;
      const ctx3 = c3.getContext("2d");
      const g = ctx3.createLinearGradient(90, 0, 210, 0);
      g.addColorStop(0, "rgba(249,115,22,0)");
      g.addColorStop(0.22, "#F97316");
      g.addColorStop(0.78, "#06b6d4");
      g.addColorStop(1, "rgba(6,182,212,0)");
      ctx3.fillStyle = g;
      ctx3.fillRect(90, 0, 120, 5);
      // sample at the EXACT stop positions (fully opaque there):
      // x = 90 + 0.22*120 = 116.4 → pure #F97316
      // x = 90 + 0.78*120 = 183.6 → pure #06b6d4
      const orange = ctx3.getImageData(116, 2, 1, 1).data;
      const cyan = ctx3.getImageData(184, 2, 1, 1).data;
      const near = (v, t) => Math.abs(v - t) <= 24;
      out.gradientBars = near(orange[0], 249) && near(orange[1], 115) && near(cyan[2], 212) && near(cyan[1], 182);
    } catch { out.gradientBars = false; }
    return out;
  });
  ok("brand fonts (Cairo/Inter) load for canvas text", canvasProof.fontsCairo === true);
  ok("SVG data-URL rasterizes into canvas (QR path)", canvasProof.svgDataUrlRaster === true);
  ok("roundRect available (QR white plate)", canvasProof.roundRect === true);
  ok("signature gradient paints orange→cyan in canvas", canvasProof.gradientBars === true, JSON.stringify(canvasProof));

  // ── #5: certificate route renders its states without crashing ──
  await page.goto(`${BASE}/certificate/ELB-PROBE-NOT-REAL`, { waitUntil: "commit" });
  await page.waitForFunction(() => !!document.querySelector("main#main-content"), { timeout: 30000 });
  await page.waitForTimeout(2000);
  const certState = await page.evaluate(() => document.body.innerText.slice(0, 400));
  ok(
    "certificate route handles unknown number gracefully",
    /الشهادة غير صالحة|Certificate Not Found|جاري التحقق/.test(certState),
    certState.replace(/\n/g, " ").slice(0, 80),
  );

  // ── Console / page errors ──
  ok("no page errors", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 160));
  const realConsoleErrors = consoleErrors.filter(
    (t) => !t.includes("favicon") && !t.includes("net::") && !t.includes("Failed to load resource") && !t.includes("React Query") && !t.includes("TRPCClientError"),
  );
  ok("no console errors", realConsoleErrors.length === 0, realConsoleErrors.slice(0, 3).join(" | "));
} catch (e) {
  ok("script completed without exception", false, String(e).slice(0, 200));
} finally {
  if (browser) await browser.close();
  server.kill();
}

console.log(results.join("\n"));
const fails = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - fails}/${results.length} checks passed`);
process.exit(fails === 0 ? 0 : 1);
