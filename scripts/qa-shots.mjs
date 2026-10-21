// Visual QA: full-page screenshots of each live route next to its approved design.
// Usage: node scripts/qa-shots.mjs <baseUrl> [filter]   (needs a playwright-core install)
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pw = process.env.PLAYWRIGHT_CORE || "playwright-core";
const { chromium } = require(pw);
const base = process.argv[2] || "http://localhost:4319";
const filter = process.argv[3] || "";
const pages = [
  ["Main", "/"], ["Bandeja", "/bandeja"], ["EditarEnvio", "/bandeja/ap-send/editar"], ["Chat", "/chat/nora?c=m-chat"],
  ["Sala", "/sala/m-q3"], ["Debate", "/sala/m-camp/debate"], ["EnVivo", "/sala/m-fact/directo"], ["Misiones", "/misiones"],
  ["Mision", "/misiones/m-q3"], ["Automatizaciones", "/automatizaciones"], ["Disparadores", "/automatizaciones/disparadores"],
  ["Equipo", "/equipo"], ["NuevoBot", "/equipo/nuevo"], ["NuevoBotAjusta", "/equipo/nuevo/ajusta"], ["Bot", "/equipo/tomas"],
  ["Biblioteca", "/biblioteca"], ["Ajustes", "/ajustes"], ["AjustesIA", "/ajustes/ia"], ["Bienvenida", "/bienvenida"],
  ["Connections", "/ajustes/conexiones"], ["Objetivos", "/objetivos"], ["Comandos", null],
].filter(([n]) => !filter || filter.split(",").includes(n));
mkdirSync("output/qa", { recursive: true });
const browser = await chromium.launch(process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
for (const [name, route] of pages) {
  if (!["Objetivos"].includes(name)) { await page.goto(base + "/_design/" + name, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `output/qa/${name}-design.png`, fullPage: true }); }
  if (!route) continue;
  errors.length = 0;
  await page.goto(base + route, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `output/qa/${name}-live.png`, fullPage: true });
  console.log(name, page.url().replace(base, ""), errors.length ? "ERRORES: " + errors.join(" | ") : "ok");
}
await browser.close();
