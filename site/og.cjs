// Renders the Open Graph card (.local/site/_og.html, written by site/build.mjs) into
// site/static/og.png over a running copy of the site, so its fonts and images load.
//   node site/og.cjs [siteUrl]     then rebuild: node site/build.mjs
const fs = require("node:fs");
const path = require("node:path");
const PW = process.env.PLAYWRIGHT_CORE || "C:/Users/giori/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core";
const EXE = process.env.PW_EXE || "C:/Users/giori/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const { chromium } = require(PW);
const site = process.argv[2] || "http://127.0.0.1:8788/";

(async () => {
  const html = fs.readFileSync(path.join(__dirname, "..", ".local", "site", "_og.html"), "utf8");
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, colorScheme: "light" });
  await page.goto(site, { waitUntil: "networkidle" });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(__dirname, "static", "og.png") });
  await browser.close();
  console.log("wrote site/static/og.png");
})();
