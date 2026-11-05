// Client performance budgets of a long chat (DeepSeek Harness benchmarks/long-session-browser
// and active-stream-reconnect, in Colmena's terms). It starts scripts/perf-chat-server.mjs
// (the built bundle, isolated temporary data, a synthetic chat of 240 turns, a scripted model)
// and measures in Chromium:
//   - open: the chat from inside the app (and on a reload) until its newest answer is drawn;
//   - load earlier: scrolling to the top until the page before is in the list;
//   - typing: keystrokes in the composer while a reply streams (Event Timing durations).
// Usage: npm run perf:chat            (builds first)
//        node scripts/perf-chat.cjs [--turns=240] [--runs=3] [--headed]
// Exits 1 when a budget fails. Needs playwright-core and Chromium (see scripts/v3-shot.cjs).
const { spawn } = require("node:child_process");
const { rmSync } = require("node:fs");
const path = require("node:path");

const PW = process.env.PLAYWRIGHT_CORE || "C:/Users/giori/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core";
const EXE = process.env.PW_EXE || "C:/Users/giori/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const { chromium } = require(PW);

const BUDGET = { openMs: 1200, olderMs: 900, keyP95Ms: 50, keyMaxMs: 100 };
const args = process.argv.slice(2);
const flag = (name, def) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.split("=").slice(1).join("=") : def; };
const turns = Number(flag("turns", 240));
const runs = Math.max(1, Number(flag("runs", 3)));
const median = (list) => { const s = [...list].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };
const pct = (list, p) => { if (!list.length) return 0; const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };

function startServer() {
  const child = spawn(process.execPath, [path.join(__dirname, "perf-chat-server.mjs"), "--turns=" + turns], { cwd: path.join(__dirname, ".."), stdio: ["pipe", "pipe", "inherit"] });
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(Error("El servidor no arrancó a tiempo.")), 30000);
    child.on("exit", (code) => reject(Error("El servidor se cerró (" + code + ").")));
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const line = buffer.split("\n").find((l) => l.startsWith("PERF_READY "));
      if (!line) return;
      clearTimeout(timer);
      resolve({ child, ...JSON.parse(line.slice("PERF_READY ".length)) });
    });
  });
}

async function main() {
  const srv = await startServer();
  const newest = `[data-message-id="${srv.newest}"]`;
  const browser = await chromium.launch({ executablePath: EXE, headless: !args.includes("--headed") });
  const results = { open: [], reload: [], cold: null, older: [], keys: null };
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const bootstrap = await (await fetch(srv.origin + "/api/bootstrap")).json();

    // Cold: a fresh tab straight into the chat (bundle, state, chat page).
    let t0 = Date.now();
    await page.goto(srv.origin + srv.chat);
    await page.waitForSelector(newest, { timeout: 15000 });
    results.cold = Date.now() - t0;

    for (let i = 0; i < runs; i++) {
      // Open from inside the app: from «Hoy» to the chat, as a click in the sidebar does.
      await page.goto(srv.origin + "/");
      await page.waitForLoadState("networkidle");
      t0 = Date.now();
      await page.evaluate((to) => { history.pushState(null, "", to); window.dispatchEvent(new Event("colmena:navigate")); }, srv.chat);
      await page.waitForSelector(newest, { timeout: 15000 });
      results.open.push(Date.now() - t0);

      // A reload with the HTTP cache warm.
      t0 = Date.now();
      await page.reload();
      await page.waitForSelector(newest, { timeout: 15000 });
      results.reload.push(Date.now() - t0);

      // Load earlier: to the top of the list until the page before is in it.
      await page.waitForTimeout(400);
      const ms = await page.evaluate(async () => {
        const msg = document.querySelector("[data-message-id]");
        let el = msg?.parentElement;
        while (el && !(el.scrollHeight > el.clientHeight + 10 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
        if (!el) return -1;
        const before = el.scrollHeight;
        const start = performance.now();
        el.scrollTop = 0;
        el.dispatchEvent(new Event("scroll"));
        // Done when the list grew (the page before is in it) and nothing says «Cargando…».
        for (;;) {
          await new Promise((r) => requestAnimationFrame(r));
          const loading = [...document.querySelectorAll("[role=status]")].some((n) => /Cargando mensajes anteriores/.test(n.textContent));
          if (el.scrollHeight > before + 50 && !loading) break;
          if (performance.now() - start > 10000) return -2;
        }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return performance.now() - start;
      });
      if (ms < 0) throw Error(ms === -1 ? "No encontré la lista que se desplaza." : "La página anterior no llegó en 10 s.");
      results.older.push(Math.round(ms));
    }

    // Typing while a reply streams.
    await page.goto(srv.origin + srv.chat);
    await page.waitForSelector(newest, { timeout: 15000 });
    await page.evaluate(() => {
      window.__events = [];
      window.__long = [];
      new PerformanceObserver((list) => { for (const e of list.getEntries()) if (["keydown", "keypress", "keyup", "input", "beforeinput"].includes(e.name)) window.__events.push({ name: e.name, duration: e.duration, id: e.interactionId }); }).observe({ type: "event", durationThreshold: 16, buffered: false });
      try { new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__long.push(e.duration); }).observe({ type: "longtask" }); } catch {}
    });
    const sent = await fetch(srv.origin + "/api/missions/perf/messages", { method: "POST", headers: { "Content-Type": "application/json", "X-Colmena-Token": bootstrap.csrf }, body: JSON.stringify({ text: "Escríbeme el informe largo" }) });
    if (!sent.ok) throw Error("No pude enviar el mensaje: " + sent.status + " " + (await sent.text()));
    await page.waitForFunction(() => /Parte 2/.test(document.body.innerText), null, { timeout: 15000 });
    const box = page.locator("form textarea").last();
    await box.click();
    const typed = "Mientras escribe, sigo tecleando con normalidad 1234567890 sin esperar.";
    const keyTimes = [];
    for (const ch of typed) {
      const t = Date.now();
      await page.keyboard.type(ch);
      keyTimes.push(Date.now() - t);
      await page.waitForTimeout(25);
    }
    const value = await box.inputValue();
    // The reply was still being written when the last key went in.
    const still = ["running", "queued"].includes((await (await fetch(srv.origin + "/api/missions/perf")).json()).status);
    const { events, long } = await page.evaluate(() => ({ events: window.__events, long: window.__long }));
    // One interaction per key: its longest event.
    const byId = new Map();
    for (const e of events) if (e.id) byId.set(e.id, Math.max(byId.get(e.id) || 0, e.duration));
    const durations = [...byId.values()];
    const slow = durations.length; // only interactions over 16 ms are reported
    results.keys = {
      keys: typed.length, slowInteractions: slow,
      p95: Math.round(slow ? pct([...durations, ...Array(Math.max(0, typed.length - slow)).fill(0)], 95) : 0),
      max: Math.round(Math.max(0, ...durations)), roundTripMedian: median(keyTimes), longTasks: long.length, longestTask: Math.round(Math.max(0, ...long)),
      typedOk: value === typed, streamingAtEnd: still,
    };
    if (errors.length) results.errors = errors;
  } finally {
    await browser.close();
    srv.child.stdin.end();
    await new Promise((r) => { const t = setTimeout(() => { try { srv.child.kill(); } catch {} r(); }, 5000); srv.child.on("exit", () => { clearTimeout(t); r(); }); });
    try { rmSync(srv.directory, { recursive: true, force: true }); } catch {}
  }
  const report = {
    turns,
    openMs: median(results.open), openRuns: results.open, reloadMs: median(results.reload), reloadRuns: results.reload, coldMs: results.cold,
    olderMs: median(results.older), olderRuns: results.older, typing: results.keys, ...(results.errors ? { errors: results.errors } : {}),
  };
  const fails = [];
  if (report.openMs > BUDGET.openMs) fails.push(`abrir ${report.openMs} ms > ${BUDGET.openMs} ms`);
  if (report.reloadMs > BUDGET.openMs) fails.push(`recargar ${report.reloadMs} ms > ${BUDGET.openMs} ms`);
  if (report.olderMs > BUDGET.olderMs) fails.push(`cargar anteriores ${report.olderMs} ms > ${BUDGET.olderMs} ms`);
  if (report.typing.p95 > BUDGET.keyP95Ms) fails.push(`teclear p95 ${report.typing.p95} ms > ${BUDGET.keyP95Ms} ms`);
  if (report.typing.max > BUDGET.keyMaxMs) fails.push(`teclear máx. ${report.typing.max} ms > ${BUDGET.keyMaxMs} ms`);
  if (!report.typing.typedOk) fails.push("el texto escrito no quedó entero en la caja");
  if (!report.typing.streamingAtEnd) fails.push("la respuesta acabó antes que el tecleo: no se midió durante el directo");
  console.log(JSON.stringify({ budget: BUDGET, ...report }, null, 2));
  console.log(fails.length ? "FALLA: " + fails.join(" · ") : "ok: dentro de presupuesto");
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
