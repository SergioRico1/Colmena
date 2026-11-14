// Screenshots of the home page at the widths it ships at, light and dark, with an overflow check
// and the page's weight and LCP (dev only; needs playwright-core and a Chromium as in
// scripts/a11y-scan.mjs: PLAYWRIGHT_CORE, PW_EXE).
//   node site/shots.cjs <url> [outDir]
const path = require("node:path");
const fs = require("node:fs");
const PW = process.env.PLAYWRIGHT_CORE || "C:/Users/giori/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core";
const EXE = process.env.PW_EXE || "C:/Users/giori/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const { chromium } = require(PW);

const url = process.argv[2] || "http://127.0.0.1:8788/";
const out = process.argv[3] || path.join(__dirname, "..", ".local", "shots", "home");
const WIDTHS = [375, 768, 1280, 1440];

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const report = [];
  for (const scheme of ["light", "dark"]) {
    for (const w of WIDTHS) {
      const page = await browser.newPage({ viewport: { width: w, height: 900 }, colorScheme: scheme, reducedMotion: "reduce", ...(w < 768 ? { isMobile: true, hasTouch: true } : {}) });
      await page.goto(url, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const over = await page.evaluate(() => {
        const W = document.documentElement.clientWidth;
        const bad = [...document.querySelectorAll("body *")].filter((el) => {
          const r = el.getBoundingClientRect();
          if (!r.width) return false;
          for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "hidden" || o === "scroll" || o === "clip") return false; }
          return r.right > W + 1 || r.left < -1;
        }).slice(0, 5).map((el) => el.tagName.toLowerCase() + "." + el.className + " " + Math.round(el.getBoundingClientRect().right));
        return { scrollW: document.documentElement.scrollWidth, W, bad };
      });
      await page.screenshot({ path: path.join(out, `home-${w}-${scheme}.png`), fullPage: true });
      await page.screenshot({ path: path.join(out, `home-${w}-${scheme}-first.png`) });
      report.push({ scheme, w, overflow: over.scrollW > over.W, ...over });
      await page.close();
    }
  }
  // Weight and LCP: a cold load at 1440 and at 375.
  for (const w of [1440, 375]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    let bytes = 0; const files = [];
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    cdp.on("Network.loadingFinished", (e) => { bytes += e.encodedDataLength; files.push(e.encodedDataLength); });
    await page.addInitScript(() => {
      window.__lcp = 0; window.__cls = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const m = await page.evaluate(() => ({ lcp: Math.round(window.__lcp), cls: +window.__cls.toFixed(4), el: performance.getEntriesByType("navigation")[0].domContentLoadedEventEnd | 0 }));
    report.push({ metrics: w, transferredKB: +(bytes / 1024).toFixed(1), requests: files.length, ...m });
    await ctx.close();
  }
  // The hero demo playing: one frame a second through a whole loop, light, at 1440.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const stage = page.locator(".stage");
    for (let i = 0; i < 16; i++) {
      await stage.screenshot({ path: path.join(out, `hero-frame-${String(i).padStart(2, "0")}.png`) });
      await page.waitForTimeout(1000);
    }
    await page.close();
  }
  await browser.close();
  console.log(JSON.stringify(report, null, 1));
})();
