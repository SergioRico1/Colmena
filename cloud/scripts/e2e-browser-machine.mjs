// Screens of Phase 4 (docs/CLOUD.md) in Chromium, on a laptop and a 375 px phone, after
// e2e-machine.mjs has made its company (it reads that run's JSON for the test person and ids):
//   node scripts/e2e-browser-machine.mjs --url https://app.colmena.team --from ../.local/shots/cloud-phase4/e2e-machine.json \
//     [--env …] [--shots ../.local/shots/cloud-phase4]
// Shots: a «Código» task (timeline and diff), the bots' browser live view in its room, an Office
// preview, Empresa › Hora y máquina. Checks: no script errors, no sideways scroll.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const arg = (name, fallback) => { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg("url", "https://app.colmena.team").replace(/\/$/, "");
const envFiles = arg("env", "../.local/cloud-phase1.env,../.local/cloud-phase3.env").split(",");
const fromEnv = (name) => process.env[name] || envFiles.map((f) => (existsSync(f) ? new RegExp("^" + name + "=(\\S+)$", "m").exec(readFileSync(f, "utf8"))?.[1] : null)).find(Boolean) || null;
const ADMIN = fromEnv("ADMIN_BOOTSTRAP_TOKEN");
const SHOTS = arg("shots", "../.local/shots/cloud-phase4");
const FROM = JSON.parse(readFileSync(arg("from", path.join(SHOTS, "e2e-machine.json")), "utf8"));
const PW = process.env.PLAYWRIGHT_CORE || "C:/Users/giori/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core";
const EXE = process.env.PW_EXE || "C:/Users/giori/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const { chromium } = require(PW);
mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log((ok ? "  ok   " : "  FAIL ") + name + (detail && !ok ? " — " + String(detail).slice(0, 300) : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cookies = new Map();
const keep = (r) => { for (const line of r.headers.getSetCookie?.() || []) { const [pair] = line.split(";"); const at = pair.indexOf("="); const n = pair.slice(0, at), v = pair.slice(at + 1); if (/Max-Age=0/i.test(line) || !v) cookies.delete(n); else cookies.set(n, v); } };
let csrf = null;
const req = async (p, { method = "GET", body } = {}) => {
  const h = { ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => k + "=" + v).join("; ") } : {}) };
  if (method !== "GET") Object.assign(h, { "Content-Type": "application/json", Origin: BASE, ...(csrf ? { "X-Colmena-Token": csrf } : {}) });
  const r = await fetch(BASE + p, { method, headers: h, redirect: "manual", ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  keep(r);
  return { status: r.status, data: await r.json().catch(() => null) };
};
const email = `ana.p4.${FROM.run}@example.com`;
await req("/auth/link", { method: "POST", body: { email } });
let token = null;
for (let i = 0; i < 12 && !token; i++) {
  const list = await (await fetch(BASE + "/auth/dev/mail?email=" + encodeURIComponent(email), { headers: { Authorization: "Bearer " + ADMIN } })).json().catch(() => []);
  const mail = (Array.isArray(list) ? list : []).find((m) => m.kind === "signin");
  if (mail) token = new URL(mail.url).hash.slice(3); else await sleep(500);
}
await req("/auth/verify", { method: "POST", body: { token } });
csrf = (await req("/auth/me")).data?.csrf;
await req("/auth/workspaces/select", { method: "POST", body: { id: FROM.workspace } });
csrf = (await req("/auth/me")).data?.csrf;
// The room of the browser test: a page open again (frames live in memory) and taken over, so the
// live view shows; and an Office document in its files.
const ROOM = FROM.numbers?.browserMission;
if (ROOM) {
  const { Document, Packer, Paragraph, TextRun } = require("docx");
  const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun({ text: "Informe trimestral", bold: true, size: 40 })] }), new Paragraph("Ventas de octubre: 1.240 cajas, un 8 % más que en septiembre."), new Paragraph("Preparado por Nora en la nube de la empresa.")] }] });
  const bytes = await Packer.toBuffer(doc);
  const up = await req("/api/missions/" + ROOM + "/attachments", { method: "POST", body: { attachments: [{ name: "informe.docx", content: bytes.toString("base64"), encoding: "base64" }] } });
  check("an Office document in the room's files", up.status === 201, JSON.stringify(up.data).slice(0, 200));
  const general = (await req("/api/chat/bootstrap")).data.channels.find((c) => c.name === "general");
  await req(`/api/chat/channels/${general.id}/messages`, { method: "POST", body: { text: `<@bot:nora> abre el formulario [[tool:browser_open|{"url":"${BASE}/prueba/formulario"}]] [[tool:browser_fill|{"fields":[{"ref":"e1","value":"Ana Prueba"}]}]]` } });
  let mission = null;
  for (let i = 0; i < 40 && !mission; i++) {
    await sleep(1500);
    const st = (await req("/api/state")).data;
    mission = (st.missions || []).filter((m) => /abre-el-formulario|abre el formulario/.test((m.title || "") + (m.room || "") + (m.prompt || "")) && m.status === "completed").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]?.id || null;
  }
  FROM.numbers.liveMission = mission;
  const take = mission ? await req("/api/computer/takeover", { method: "POST", body: { missionId: mission, action: "take" } }) : { status: 0 };
  check("the browser is open and taken over for the shots", take.status === 200, JSON.stringify(take.data));
}
const code = (await req("/api/code")).data;
const project = code?.projects?.[0];
check("signed in to the e2e company, its project is there", !!project, JSON.stringify(code).slice(0, 200));

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const ctxs = {
  laptop: await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light", locale: "es-ES", timezoneId: "Europe/Madrid" }),
  phone: await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark", locale: "es-ES", timezoneId: "Europe/Madrid" }),
};
const errors = [];
const shot = async (page, name) => { await sleep(800); await page.screenshot({ path: path.join(SHOTS, name + ".png") }); };
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const settle = (page) => page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
try {
  for (const [who, ctx] of Object.entries(ctxs)) {
    await ctx.addCookies([...cookies].filter(([, v]) => v).map(([name, value]) => ({ name, value, url: BASE })));
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(who + ": " + e.message));
    // «Código»: the home with its cloud note, then the task the fake engine fixed.
    await page.goto(BASE + "/codigo"); await settle(page);
    await page.getByText(/clave de API/).first().waitFor({ timeout: 20000 }).catch(() => {});
    await shot(page, who + "-01-codigo");
    check(who + ": «Código» says it uses your API key", await page.getByText(/clave de API/).first().isVisible().catch(() => false));
    const task = page.getByText(/arregla la suma/).first();
    if (await task.isVisible().catch(() => false)) {
      await task.click(); await settle(page);
      await page.getByText(/pruebas pasan/).first().waitFor({ timeout: 20000 }).catch(() => {});
      await shot(page, who + "-02-codigo-tarea");
      check(who + ": the task's answer is on screen", await page.getByText(/pruebas pasan/).first().isVisible().catch(() => false));
    }
    check(who + ": «Código» has no sideways scroll", (await overflow(page)) <= 2);
    // The bots' browser: its room with the live view.
    if (FROM.numbers?.liveMission) {
      await page.goto(BASE + "/sala/" + FROM.numbers.liveMission); await settle(page);
      // The «Navegador» panel (it opens by itself while a bot browses; here the bot has finished).
      if (!(await page.locator("article[aria-label^='Vista en vivo']").first().isVisible().catch(() => false))) {
        if (who === "phone") await page.getByRole("button", { name: /Más opciones de/ }).first().click().catch(() => {});
        else await page.keyboard.press("Control+Alt+Shift+U").catch(() => {});
        if (who === "phone") { await page.getByText("Panel lateral").first().click().catch(() => {}); await page.getByText("Navegador").last().click().catch(() => {}); }
      }
      await page.locator("article[aria-label^='Vista en vivo']").first().waitFor({ timeout: 20000 }).catch(() => {});
      await page.locator("article[aria-label^='Vista en vivo']").first().scrollIntoViewIfNeeded().catch(() => {});
      await shot(page, who + "-03-navegador-en-vivo");
      check(who + ": the live view of the cloud browser", await page.locator("article[aria-label^='Vista en vivo'] img").first().isVisible().catch(() => false));
    }
    // An Office preview: the room of the document, its file opened.
    if (ROOM) {
      await page.goto(BASE + "/sala/" + ROOM); await settle(page);
      const files = page.getByText("Archivos de la sala").first();
      if (!(await files.isVisible().catch(() => false))) await page.getByRole("button", { name: /miembros|personas|detalles|panel/i }).first().click().catch(() => {});
      await files.click().catch(() => {});
      await settle(page);
      const file = page.getByText("informe.docx").first();
      await file.waitFor({ timeout: 20000 }).catch(() => {});
      if (await file.isVisible().catch(() => false)) { await file.click().catch(() => {}); await settle(page); await page.locator("img[src*='/workfiles/page/']").first().waitFor({ timeout: 45000 }).catch(() => {}); await sleep(1500); }
      await shot(page, who + "-04-vista-office");
      check(who + ": an Office page is drawn", await page.locator("img[src*='/workfiles/page/']").first().isVisible().catch(() => false));
    }
    await page.goto(BASE + "/admin/maquina"); await settle(page);
    await page.getByText(/Zona horaria de la empresa/).first().waitFor({ timeout: 20000 }).catch(() => {});
    await shot(page, who + "-05-hora-y-maquina");
    check(who + ": Empresa › Hora y máquina", await page.getByText(/Máquina en la nube/).first().isVisible().catch(() => false));
    check(who + ": no sideways scroll there", (await overflow(page)) <= 2);
  }
} finally {
  await browser.close();
}
check("no script errors", !errors.length, errors.join(" | "));
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
