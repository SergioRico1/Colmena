// Visual QA for Colmena 3: a screenshot of a design board or a live route on the QA server.
// Usage: node scripts/v3-shot.cjs <path> <out.png> [--w=1440] [--h=1000] [--full] [--expert] [--dark] [--base=http://localhost:4319]
//   node scripts/v3-shot.cjs /_design/V3Inicio output/v3/inicio-design.png --full
//   node scripts/v3-shot.cjs / output/v3/inicio-live.png --full --expert
// --expert adds ?experto=1 (src/lib/expert.js honours it, only in this browser tab).
// Prints «ok» or the page errors it saw.
const { mkdirSync } = require("node:fs");
const { dirname } = require("node:path");

const PW = process.env.PLAYWRIGHT_CORE || "C:/Users/giori/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core";
const EXE = process.env.PW_EXE || "C:/Users/giori/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const { chromium } = require(PW);
const args = process.argv.slice(2);
const flag = (name, def) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.split("=").slice(1).join("=") : def; };
const [path, out] = args.filter((a) => !a.startsWith("--"));
if (!path || !out) { console.error("usage: node scripts/v3-shot.cjs <path> <out.png> [--w] [--h] [--full] [--expert]"); process.exit(2); }
const base = flag("base", "http://localhost:4319");
let url = base + path;
if (args.includes("--expert")) url += (url.includes("?") ? "&" : "?") + "experto=1";

(async () => {
  mkdirSync(dirname(out), { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: Number(flag("w", 1440)), height: Number(flag("h", 1000)) }, colorScheme: args.includes("--dark") ? "dark" : "light" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.screenshot({ path: out, fullPage: args.includes("--full") });
  console.log(errors.length ? "ERRORES: " + errors.join(" | ") : "ok", "→", out);
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
