// Measures how a long chat opens and scrolls (seed it with scripts/seed-long-chat.mjs).
// Usage: node scripts/measure-long-chat.mjs <baseUrl> [route=/chat/nora] [label]
// Needs PLAYWRIGHT_CORE (and PW_EXE) like scripts/qa-shots.mjs. Prints one JSON line.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const base = process.argv[2] || "http://localhost:4323";
const route = process.argv[3] || "/chat/nora";
const label = process.argv[4] || "run";
const browser = await chromium.launch(process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : {});
const runs = [];
for (let r = 0; r < 3; r++) {
  // A fresh context each time: nothing cached in the page (localStorage snapshot is per context).
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  let detailBytes = 0;
  page.on("response", async (res) => {
    if (/\/api\/missions\/m-larga(\?|$)/.test(res.url())) detailBytes += (await res.body().catch(() => Buffer.alloc(0))).length;
  });
  await page.goto(base + "/hoy", { waitUntil: "networkidle" });
  const t0 = Date.now();
  await page.goto(base + route, { waitUntil: "commit" });
  // Open = the last answer is on screen.
  await page.waitForSelector('[data-message-id="m-larga-a399"]', { timeout: 60000 });
  const openMs = Date.now() - t0;
  await page.waitForTimeout(800);
  const dom = await page.evaluate(() => document.getElementsByTagName("*").length);
  // Scroll up through the whole history with the wheel, 120 frames, and time every frame.
  const scroll = await page.evaluate(async () => {
    const el = [...document.querySelectorAll("div")].find((d) => getComputedStyle(d).overflowY === "auto" && d.querySelector("[data-message-id]"));
    if (!el) return null;
    const frames = [];
    let last = performance.now();
    for (let i = 0; i < 120; i++) {
      el.scrollTop = Math.max(0, el.scrollTop - 900);
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      frames.push(now - last);
      last = now;
    }
    frames.sort((a, b) => a - b);
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    return { avgFrameMs: +avg.toFixed(1), p95FrameMs: +frames[Math.floor(frames.length * 0.95)].toFixed(1), worstFrameMs: +frames.at(-1).toFixed(1), slowFrames: frames.filter((f) => f > 50).length };
  });
  // Reach the very first message: the old «Ver N mensajes anteriores» button, or paging up.
  const t1 = Date.now();
  let first = false;
  await page.mouse.move(700, 500);
  for (let i = 0; i < 800 && !first; i++) {
    const older = page.getByRole("button", { name: /^Ver \d+ mensajes? anteriores?/ });
    if (await older.count()) await older.first().click().catch(() => {});
    await page.mouse.wheel(0, -1500);
    first = await page.waitForSelector('[data-message-id="m-larga-u0"]', { timeout: 30 }).then(() => true, () => false);
  }
  const historyMs = first ? Date.now() - t1 : null;
  const domAfter = await page.evaluate(() => document.getElementsByTagName("*").length);
  const shown = await page.evaluate(() => document.querySelectorAll("[data-message-id]").length);
  // And back down through all of it.
  const scrollAll = await page.evaluate(async () => {
    const el = [...document.querySelectorAll("div")].find((d) => getComputedStyle(d).overflowY === "auto" && d.querySelector("[data-message-id]"));
    if (!el) return null;
    const frames = [];
    let last = performance.now();
    for (let i = 0; i < 200; i++) {
      el.scrollTop = el.scrollTop + 900;
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      frames.push(now - last);
      last = now;
    }
    frames.sort((a, b) => a - b);
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    return { allAvgFrameMs: +avg.toFixed(1), allP95FrameMs: +frames[Math.floor(frames.length * 0.95)].toFixed(1), allWorstFrameMs: +frames.at(-1).toFixed(1) };
  });
  runs.push({ openMs, detailKB: Math.round(detailBytes / 1024), domNodes: dom, historyMs, domNodesAfterScroll: domAfter, messageNodesAfterScroll: shown, ...scroll, ...scrollAll });
  await context.close();
}
await browser.close();
const median = (k) => runs.map((x) => x[k]).sort((a, b) => a - b)[1];
const out = { label, route, ...Object.fromEntries(Object.keys(runs[0]).map((k) => [k, median(k)])), runs };
mkdirSync("output/perf", { recursive: true });
writeFileSync(`output/perf/long-chat-${label}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, runs: undefined }));
