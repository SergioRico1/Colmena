// Layout shift of a 1:1 chat through a whole turn: send → thinking → writing → done. It starts
// scripts/chat-shift-server.mjs (the real app in dev mode, isolated temporary data, a scripted
// model) and, in Chromium, records on every frame:
//   - CLS: the browser's own «layout-shift» entries (all of them, and those without recent input);
//   - earlier messages: how far each one moves inside the list (relative to the first message,
//     so scrolling and the bottom anchoring do not count) and how much its height changes;
//   - downward jumps: an earlier message moving down on screen while you sit at the end (the list
//     should only ever move up as the answer grows);
//   - the composer: how much its top and its height change;
//   - the answer's slot: where its text starts (x) and how far below the face it sits, while it
//     thinks, while it writes and once it is done — the three should be the same;
//   - reading further up: whether anything moves under you while the answer arrives, and whether
//     «Nuevos» / «Ir al final» shows.
// Usage: node scripts/chat-shift.cjs [--label=before] [--w=1280 --h=860] [--theme=light|dark] [--shots] [--headed]
// Writes .local/shots/chat-ux/shift-<label>-<w>-<theme>.json (and frames with --shots).
const { spawn } = require("node:child_process");
const { mkdirSync, writeFileSync, rmSync } = require("node:fs");
const path = require("node:path");

const PW = process.env.PLAYWRIGHT_CORE || "C:/Users/giori/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core";
const EXE = process.env.PW_EXE || "C:/Users/giori/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const { chromium } = require(PW);

const args = process.argv.slice(2);
const flag = (name, def) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.split("=").slice(1).join("=") : def; };
const label = flag("label", "run");
const W = Number(flag("w", 1280)), H = Number(flag("h", 860));
const theme = flag("theme", "light");
const shots = args.includes("--shots");
const out = path.join(__dirname, "..", ".local", "shots", "chat-ux");
mkdirSync(out, { recursive: true });

function startServer() {
  const child = spawn(process.execPath, [path.join(__dirname, "chat-shift-server.mjs")], { cwd: path.join(__dirname, ".."), stdio: ["pipe", "pipe", "inherit"] });
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(Error("El servidor no arrancó a tiempo.")), 60000);
    child.on("exit", (code) => reject(Error("El servidor se cerró (" + code + ").")));
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const line = buffer.split("\n").find((l) => l.startsWith("SHIFT_READY "));
      if (!line) return;
      clearTimeout(timer);
      resolve({ child, ...JSON.parse(line.slice("SHIFT_READY ".length)) });
    });
  });
}

/* Runs in the page: records a sample on every frame until stopped. */
function recorder() {
  const w = window;
  w.__shift = { samples: [], cls: [], on: true };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) w.__shift.cls.push({ t: e.startTime, value: e.value, input: e.hadRecentInput, nodes: (e.sources || []).map((s) => (s.node && s.node.nodeType === 1 ? (s.node.getAttribute("data-message-id") || s.node.getAttribute("data-kind") || s.node.tagName) : "#text")).slice(0, 4) });
  }).observe({ type: "layout-shift", buffered: false });
  const earlier = [...document.querySelectorAll("[data-message-id]")].map((n) => n.getAttribute("data-message-id"));
  w.__shift.earlier = earlier;
  const textStart = (row) => {
    if (!row) return null;
    const walk = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!/^\s*(Pensando|Sí: tienes|Sí:)/.test(n.nodeValue) && !n.parentElement.closest("[data-live-text]")) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (!r.width) continue;
      return { x: Math.round(r.left), y: r.top };
    }
    return null;
  };
  const tick = () => {
    if (!w.__shift.on) return;
    const form = document.querySelector("form.r-composer");
    const fr = form?.getBoundingClientRect();
    const first = document.querySelector(`[data-message-id="${earlier[0]}"]`)?.getBoundingClientRect();
    const msgs = {};
    for (const id of earlier) {
      const r = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`)?.closest("[data-index]")?.getBoundingClientRect();
      const own = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`)?.getBoundingClientRect();
      if (r && own && first) msgs[id] = { top: own.top, rel: own.top - first.top, h: r.height };
    }
    const nowRow = document.querySelector('[data-kind="now"]');
    const answers = [...document.querySelectorAll('[data-kind="answer"]')];
    const last = answers[answers.length - 1];
    const fresh = last && !earlier.includes(last.querySelector("[data-message-id]")?.getAttribute("data-message-id")) ? last : null;
    const slotRow = nowRow || fresh;
    const face = slotRow?.querySelector("svg, img, canvas, [data-face]")?.getBoundingClientRect();
    const text = textStart(slotRow);
    const scroller = document.querySelector('[role="log"]')?.parentElement;
    w.__shift.samples.push({
      t: performance.now(),
      phase: nowRow ? (nowRow.querySelector("[data-live-text]") || /Sí:/.test(nowRow.textContent) ? "writing" : "thinking") : fresh ? "done" : "idle",
      composer: fr ? { top: fr.top, h: fr.height } : null,
      msgs,
      slot: slotRow ? { textX: text?.x ?? null, textDy: text && face ? Math.round(text.y - face.top) : null, h: Math.round(slotRow.getBoundingClientRect().height) } : null,
      scrollTop: scroller?.scrollTop ?? null,
      toEnd: !!document.querySelector('[aria-label^="Ir a los mensajes nuevos"], [aria-label="Ir al final de la conversación"]'),
    });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function summarize(samples, cls, earlier) {
  const r1 = (n) => Math.round(n * 10) / 10;
  let relMax = 0, hMax = 0, down = 0, downMax = 0;
  const downs = [];
  const base = {};
  for (const s of samples) for (const [id, m] of Object.entries(s.msgs)) {
    if (!base[id]) { base[id] = m; continue; }
    relMax = Math.max(relMax, Math.abs(m.rel - base[id].rel));
    hMax = Math.max(hMax, Math.abs(m.h - base[id].h));
  }
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    // Downward motion of the last earlier message that is on screen in both frames.
    const id = earlier[earlier.length - 1];
    if (a.msgs[id] && b.msgs[id]) { const d = b.msgs[id].top - a.msgs[id].top; if (d > 0.5) { down += d; downMax = Math.max(downMax, d); downs.push({ px: r1(d), phase: `${a.phase}→${b.phase}`, scroll: [a.scrollTop, b.scrollTop] }); } }
  }
  const comp = samples.filter((s) => s.composer);
  const c0 = comp[0]?.composer;
  const composer = { topMax: r1(Math.max(0, ...comp.map((s) => Math.abs(s.composer.top - c0.top)))), heightMax: r1(Math.max(0, ...comp.map((s) => Math.abs(s.composer.h - c0.h)))) };
  const byPhase = {};
  for (const s of samples) if (s.slot && s.slot.textX != null) { const p = (byPhase[s.phase] ||= { textX: new Set(), textDy: new Set() }); p.textX.add(s.slot.textX); if (s.slot.textDy != null) p.textDy.add(s.slot.textDy); }
  const slot = Object.fromEntries(Object.entries(byPhase).map(([k, v]) => [k, { textX: [...v.textX], textDy: [...v.textDy] }]));
  const xs = Object.values(slot).flatMap((v) => v.textX);
  const dys = Object.values(slot).flatMap((v) => v.textDy);
  return {
    cls: r1(cls.reduce((n, e) => n + e.value, 0) * 1000) / 1000,
    clsNoInput: r1(cls.filter((e) => !e.input).reduce((n, e) => n + e.value, 0) * 1000) / 1000,
    shiftsNoInput: cls.filter((e) => !e.input).length,
    earlierMovePx: r1(relMax),
    earlierHeightPx: r1(hMax),
    downwardJumpPx: r1(down),
    downwardJumpMaxPx: r1(downMax),
    downwardJumps: downs.slice(0, 8),
    composer,
    slotTextXSpreadPx: xs.length ? Math.max(...xs) - Math.min(...xs) : null,
    slotTextDySpreadPx: dys.length ? Math.max(...dys) - Math.min(...dys) : null,
    slot,
    phases: [...new Set(samples.map((s) => s.phase))],
  };
}

async function main() {
  const srv = await startServer();
  const browser = await chromium.launch({ executablePath: EXE, headless: !args.includes("--headed") });
  const result = { label, viewport: [W, H], theme };
  try {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: theme, reducedMotion: "no-preference" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message || e)));
    await page.goto(srv.origin + srv.chat, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-message-id="a4"]', { timeout: 60000 });
    await page.waitForTimeout(1200);
    const box = page.locator("form.r-composer textarea");
    let frame = 0;
    const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(out, `frames-${label}-${W}-${theme}-${String(frame++).padStart(2, "0")}-${name}.png`) }); };
    await shot("idle");

    // 1 · At the end: type, send, and watch the whole turn.
    await box.click();
    await box.type("¿Tengo algo pendiente?", { delay: 15 });
    await page.evaluate(recorder);
    await page.keyboard.press("Enter");
    const deadline = Date.now() + 30000;
    let seen = { thinking: false, writing: false };
    while (Date.now() < deadline) {
      const phase = await page.evaluate(() => window.__shift.samples.at(-1)?.phase);
      if (phase === "thinking" && !seen.thinking) { seen.thinking = true; await page.waitForTimeout(300); await shot("thinking"); }
      if (phase === "writing" && !seen.writing) {
        seen.writing = true;
        await page.waitForTimeout(300);
        await shot("writing");
        // Typing while it writes: the «Cuando acabe / Pasárselo ya» choice shows, and nothing moves.
        await box.fill("y lo del banco");
        await page.waitForTimeout(200);
        await shot("typing-while-working");
        await box.fill("");
      }
      if (phase === "done") break;
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(1500); // the end of the turn settles (actions, receipts, «Visto»)
    await shot("done");
    const pinned = await page.evaluate(() => { window.__shift.on = false; return window.__shift; });
    if (shots) {
      // The actions of a message, on hover: the latest answer, then your latest message.
      const answer = page.locator('[data-kind="answer"]').last();
      await answer.hover({ position: { x: 200, y: 40 } });
      await page.waitForTimeout(250);
      await shot("hover-answer");
      const mine = page.locator('[data-kind="user"] .v4-bubble, [data-kind="user"] [class*="bubble"]').last();
      await mine.hover();
      await page.waitForTimeout(250);
      await shot("hover-mine");
      await page.mouse.move(2, 2);
    }
    result.pinned = summarize(pinned.samples, pinned.cls, pinned.earlier);
    result.pinned.frames = pinned.samples.length;

    // 2 · Reading further up: send, scroll up, and nothing may move under you.
    await page.evaluate(async () => {
      const { csrf } = await (await fetch("/api/bootstrap")).json();
      const r = await fetch("/api/missions/shift/messages", { method: "POST", headers: { "content-type": "application/json", "X-Colmena-Token": csrf }, body: JSON.stringify({ text: "¿Y para mañana?" }) });
      if (!r.ok) throw new Error("POST " + r.status);
    });
    await page.waitForSelector('[data-kind="now"]', { timeout: 10000 });
    await page.evaluate(() => { const s = document.querySelector('[role="log"]').parentElement; s.scrollTop = Math.max(0, s.scrollTop - 260); });
    await page.waitForTimeout(250);
    await page.evaluate(recorder);
    await shot("reading-up");
    const until = Date.now() + 30000;
    while (Date.now() < until) {
      const done = await page.evaluate(() => !document.querySelector('[data-kind="now"]'));
      if (done) break;
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(1500);
    await shot("reading-up-done");
    const up = await page.evaluate(() => { window.__shift.on = false; return window.__shift; });
    const ids = up.earlier;
    let screenMax = 0;
    const first = up.samples[0];
    for (const s of up.samples) for (const id of ids) if (first.msgs[id] && s.msgs[id]) screenMax = Math.max(screenMax, Math.abs(s.msgs[id].top - first.msgs[id].top));
    result.readingUp = { onScreenMovePx: Math.round(screenMax * 10) / 10, toEndShown: up.samples.some((s) => s.toEnd), composer: summarize(up.samples, up.cls, ids).composer, clsNoInput: summarize(up.samples, up.cls, ids).clsNoInput };
    result.errors = errors;
  } finally {
    await browser.close();
    srv.child.stdin.end();
    setTimeout(() => { try { rmSync(srv.directory, { recursive: true, force: true }); } catch {} }, 1500);
  }
  const file = path.join(out, `shift-${label}-${W}-${theme}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
