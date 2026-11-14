// Responsive QA: screenshots of every main place at phone, tablet and laptop sizes, in light and
// dark, plus a horizontal-overflow check (document.documentElement.scrollWidth <= innerWidth).
// Usage: node scripts/responsive-shots.cjs [--base=http://localhost:4319] [--out=.local/shots/responsive]
//          [--sizes=375x812,768x1024,1280x800,1440x960] [--themes=light,dark] [--only=Inicio,Sala] [--all] [--desktop] [--wait=ms]
// Needs a server on isolated QA data (scripts/seed-qa.mjs) and playwright-core (PLAYWRIGHT_CORE,
// PW_EXE as in scripts/v3-shot.cjs). Phone and tablet sizes run with touch and a coarse pointer.
// Prints one line per page and exits 1 when a page scrolls sideways or throws.
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const PW = process.env.PLAYWRIGHT_CORE || "C:/Users/giori/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core";
const EXE = process.env.PW_EXE || "C:/Users/giori/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const { chromium } = require(PW);
const args = process.argv.slice(2);
const flag = (name, def) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.split("=").slice(1).join("=") : def; };
const base = flag("base", "http://localhost:4319");
const out = flag("out", ".local/shots/responsive");
const sizes = flag("sizes", "375x812,768x1024,1280x800,1440x960").split(",").map((s) => s.split("x").map(Number));
const themes = flag("themes", "light,dark").split(",");
const only = flag("only", "").split(",").filter(Boolean);
// --desktop: a stand-in for the Electron bridge (desktop/preload-window.cjs), so the page renders as
// in the desktop app (window dots, no web-only chrome). For before/after comparisons at 1440×960.
const desktop = args.includes("--desktop");
const fakeBridge = () => {
  const noop = () => {};
  const none = async () => null;
  window.colmenaWindow = { minimize: noop, toggleMaximize: noop, close: noop, onState: () => noop, onSound: () => noop, setTheme: noop, edit: noop, openLog: noop,
    pickFolder: none, captureRect: none, revealPath: none, capture: { windows: async () => [], window: none, screen: none, area: none },
    quick: { hide: noop, open: noop, size: noop, source: none, readText: none, windows: async () => [], captureWindow: none, captureArea: none, paste: none, onShown: () => noop },
    updates: { state: none, check: none, restart: none, cancelWait: none, download: none, setChannel: none, onState: () => noop },
    dragFile: { warm: noop, drag: async () => ({ ok: false }) } };
};

/** The main places, on the records scripts/seed-qa.mjs writes. `then` runs after the load. */
const PAGES = [
  ["Inicio", "/"],
  ["Actividad", "/actividad"],
  ["Trabajo", "/trabajo"],
  ["Rutinas", "/trabajo/rutinas"],
  ["Objetivos", "/trabajo/objetivos"],
  ["Encargo", "/encargo/m-q3"],
  ["Revisar", "/revisar/ap-send"],
  ["Chat", "/chat/nora?c=m-chat"],
  ["Sala", "/sala/m-q3"],
  ["Debate", "/debate/m-camp"],
  ["Codigo", "/codigo"],
  ["Equipo", "/equipo"],
  ["Bot", "/equipo/tomas"],
  ["Archivos", "/biblioteca"],
  ["Memoria", "/biblioteca/memoria"],
  ["Ajustes", "/ajustes"],
  ["AjustesGeneral", "/ajustes/general"],
  ["AjustesIA", "/ajustes/ia"],
  ["Personas", "/personas/como-funciona"],
  ["Paleta", "/", async (page) => { await page.keyboard.press("Control+k"); await page.waitForTimeout(400); }],
  ["Nuevo", "/", async (page) => { await page.keyboard.press("Control+n"); await page.waitForTimeout(400); }],
  ...(args.includes("--all") ? [
    // --all: every Ajustes section and the deeper pages too (the overflow check, mostly).
    ...["avisos", "contactos", "permisos", "apps", "uso", "privacidad", "copias", "sistema", "ayuda"].map((s) => ["Ajustes-" + s, "/ajustes/" + s]),
    ["Ajustes-avanzado", "/ajustes/avanzado?experto=1"],
    ["Notas", "/biblioteca/notas"], ["Habilidades", "/biblioteca/habilidades"],
    ["NuevoBot", "/equipo/nuevo"], ["NuevaTarea", "/trabajo?nueva=1"], ["NuevaRutina", "/trabajo/rutinas?nueva=1"],
    ["Rutina", "/trabajo/rutinas?id=au-1"], ["Panel", "/panel"], ["ChatExperto", "/chat/nora?c=m-chat&experto=1"],
    ["Bienvenida", "/bienvenida"],
  ] : []),
  ["SalaPanel", "/sala/m-q3", async (page) => { await page.locator("[aria-controls=sala-miembros]").first().click(); await page.waitForTimeout(400); }],
  ["ChatMenu", "/chat/nora?c=m-chat", async (page) => { await page.locator("[aria-label='Más opciones'], [aria-label^='Más']").first().click().catch(() => {}); await page.waitForTimeout(400); }],
  ["Menu", "/", async (page) => {
    // The phone's drawer, or the tablet's rail opened whole (Ctrl B); a laptop has neither.
    const btn = page.locator("[data-mobile-menu]");
    if (await btn.isVisible().catch(() => false)) await btn.click();
    else if (page.viewportSize().width < 1024) await page.keyboard.press("Control+b");
    await page.waitForTimeout(400);
  }],
];

(async () => {
  mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE });
  const report = [];
  let bad = 0;
  for (const theme of themes) {
    for (const [w, h] of sizes) {
      const touch = w < 1024;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, hasTouch: touch, isMobile: w < 640, deviceScaleFactor: 1 });
      if (desktop) await ctx.addInitScript(fakeBridge);
      for (const [name, path, then] of PAGES) {
        if (only.length && !only.includes(name)) continue;
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(base + path, { waitUntil: "networkidle" }).catch((e) => errors.push(e.message));
        // The screen's code loads lazily (and compiles on first use in dev): wait for it to draw.
        await page.waitForFunction(() => document.querySelector("#contenido > *, main, [role=dialog], h1"), null, { timeout: 15000 }).catch(() => errors.push("the screen did not draw"));
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(Number(flag("wait", 900))); // --wait=ms: longer for pixel comparisons (lazy chrome, fonts)
        if (then) await then(page).catch((e) => errors.push(e.message));
        // The page itself must not scroll sideways; and since the shell clips, nothing visible may
        // reach past the right edge either (unless it sits in a box that scrolls sideways on purpose).
        const m = await page.evaluate(() => {
          const iw = innerWidth;
          // A strip that scrolls sideways on purpose (chips, tabs, a code block, a wide table) has no
          // vertical scroll of its own. A box that scrolls vertically and also sideways (a pane) is overflow.
          const scrollsX = (p) => { const s = getComputedStyle(p); return /(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1; };
          const strip = (p) => p.matches("pre,table,[data-scroll-x],.r-scroll-x,[role=tablist]") || !/(auto|scroll)/.test(getComputedStyle(p).overflowY) || p.scrollHeight <= p.clientHeight + 1;
          const sideways = (el) => { for (let p = el.parentElement; p; p = p.parentElement) if (scrollsX(p) && strip(p)) return true; return false; };
          const panes = [...document.querySelectorAll("body *")].filter((p) => !p.matches("textarea,input") && scrollsX(p) && !strip(p) && p.getBoundingClientRect().width > 0).map((p) => `pane:${p.tagName.toLowerCase()}#${p.id || ""}[${p.clientWidth}<${p.scrollWidth}]`);
          const wide = [];
          for (const el of document.querySelectorAll("body *")) {
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2 || r.right <= iw + 1 || r.left >= iw) continue;
            const s = getComputedStyle(el);
            if (s.visibility === "hidden" || s.position === "fixed" && r.left >= iw - 1) continue;
            if (el.closest("[aria-hidden=true],[inert]") || sideways(el)) continue;
            if ([...el.children].some((c) => c.getBoundingClientRect().right > iw + 1)) continue; // report the innermost
            wide.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""}[${Math.round(r.left)}→${Math.round(r.right)}] ${String(el.textContent || "").trim().slice(0, 30)}`);
          }
          wide.unshift(...panes);
          return { sw: document.documentElement.scrollWidth, iw, wide: wide.slice(0, 6), wideCount: wide.length };
        });
        const file = join(out, `${name}-${w}x${h}-${theme}.png`);
        await page.screenshot({ path: file });
        const over = m.sw > m.iw;
        if (over || m.wideCount || errors.length) bad++;
        const row = { name, w, h, theme, scrollWidth: m.sw, innerWidth: m.iw, overflow: over, clipped: m.wideCount, clippedSample: m.wide, errors };
        report.push(row);
        console.log(`${over ? "OVERFLOW" : m.wideCount ? "CLIPPED " : "ok      "} ${name} ${w}x${h} ${theme} scrollWidth=${m.sw} clipped=${m.wideCount}${m.wideCount ? " " + m.wide.join(" ; ") : ""}${errors.length ? " ERR " + errors.join(" | ") : ""}`);
        await page.close();
      }
      await ctx.close();
    }
  }
  writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
