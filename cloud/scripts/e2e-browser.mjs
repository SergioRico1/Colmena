// The hosted pages and the app in a real browser (Playwright, as scripts/ uses it), with test
// addresses only: one person on a laptop, another on a phone. Signs both in with the dev mail,
// creates a company, invites, accepts, talks in a room in real time and signs out, taking
// screenshots of each step into --shots.
//   node scripts/e2e-browser.mjs [--url …] [--env ../.local/cloud.env] [--shots ../.local/shots/cloud-phase1]
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import path from "node:path";

const require = createRequire(import.meta.url);
const arg = (name, fallback) => { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg("url", "http://127.0.0.1:8790").replace(/\/$/, "");
const envFile = arg("env", "../.local/cloud.env");
const SHOTS = arg("shots", "../.local/shots/cloud-phase1");
const ADMIN = process.env.ADMIN_BOOTSTRAP_TOKEN || (existsSync(envFile) ? /^ADMIN_BOOTSTRAP_TOKEN=(\S+)$/m.exec(readFileSync(envFile, "utf8"))?.[1] : null);
const PW = process.env.PLAYWRIGHT_CORE || "C:/Users/giori/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core";
const EXE = process.env.PW_EXE || "C:/Users/giori/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const { chromium } = require(PW);
mkdirSync(SHOTS, { recursive: true });
const run = randomBytes(3).toString("hex");
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log((ok ? "  ok   " : "  FAIL ") + name + (detail && !ok ? " — " + detail : "")); };
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + ".png") });
/** «Tu nombre», asked once by /empresa and /invitacion while the account has only its address. */
const nameIfAsked = async (page, name) => { const f = page.locator("input[autocomplete='name']"); if (await f.count()) await f.fill(name); };

async function mailLink(email, kind) {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(BASE + "/auth/dev/mail?email=" + encodeURIComponent(email), { headers: { Authorization: "Bearer " + ADMIN } })).json();
    const m = Array.isArray(list) ? list.find((x) => x.kind === kind) : null;
    if (m) return m.url;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw Error("no mail for " + email);
}
async function signIn(page, email, prefix, { fromInvite = false } = {}) {
  if (!fromInvite) await page.goto(BASE + "/entrar");
  await page.waitForSelector("input[type=email]");
  if (prefix) await shot(page, prefix + "-1-entrar");
  await page.fill("input[type=email]", email);
  await page.click("button[type=submit]");
  await page.getByRole("heading", { name: "Revisa tu correo" }).waitFor();
  if (prefix) await shot(page, prefix + "-2-revisa-tu-correo");
  await page.goto(await mailLink(email, "signin"));
  await page.getByRole("button", { name: "Entrar en Colmena" }).click();
}

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const laptop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "light", locale: "es-ES" });
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark", locale: "es-ES" });
const A = await laptop.newPage(), B = await phone.newPage();
const errors = [];
for (const [who, p] of [["laptop", A], ["phone", B]]) p.on("pageerror", (e) => errors.push(who + ": " + e.message));
const ana = `ana.${run}@example.com`, beto = `beto.${run}@example.com`;
try {
  // ---- Ana, laptop: sign in, create the company
  await signIn(A, ana, "laptop");
  await A.waitForURL(/\/empresa/);
  await A.getByRole("heading", { name: "Crea tu empresa" }).waitFor();
  await nameIfAsked(A, "Ana Prueba");
  await A.fill("input[maxlength='60']", "Estudio de prueba " + run);
  await shot(A, "laptop-3-crear-empresa");
  await A.getByRole("button", { name: "Crear y entrar" }).click();
  await A.waitForURL((u) => new URL(u).pathname === "/" || new URL(u).pathname.startsWith("/bienvenida"), { timeout: 20000 });
  check("Ana signs in and creates a company", true);

  // ---- invitation from the company page
  await A.goto(BASE + "/empresa");
  await A.getByRole("heading", { name: /Personas de/ }).waitFor();
  await A.fill("form input[type=email]", beto);
  await A.getByRole("button", { name: "Invitar" }).click();
  const link = await A.locator("code[aria-label='Enlace de invitación']").textContent({ timeout: 10000 });
  await shot(A, "laptop-4-empresa-invitar");
  check("Ana invites Beto", /\/invitacion#t=/.test(link || ""));

  // ---- Beto, phone: open the invitation, sign in from it, accept
  await B.goto(link);
  await B.getByRole("heading", { name: /te invita a/ }).waitFor();
  await shot(B, "phone-1-invitacion");
  await B.getByRole("link", { name: /Entrar con/ }).click();
  await signIn(B, beto, "phone", { fromInvite: true });
  await B.waitForURL(/\/invitacion/);
  await nameIfAsked(B, "Beto Prueba");
  await B.getByRole("button", { name: "Aceptar y entrar" }).click();
  await B.waitForURL((u) => !/invitacion|entrar/.test(new URL(u).pathname), { timeout: 20000 });
  check("Beto accepts from his phone", true);
  await B.goto(BASE + "/empresa");
  await B.getByRole("heading", { name: /Personas de/ }).waitFor();
  await shot(B, "phone-3-empresa");

  // ---- a shared room: made by Ana, opened by both
  const room = await A.evaluate(async () => {
    const { csrf } = await (await fetch("/api/bootstrap")).json();
    const r = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: JSON.stringify({ title: "Proyecto Norte" }) });
    return r.json();
  });
  check("a room is made", !!room?.missionId, JSON.stringify(room).slice(0, 200));
  await A.goto(BASE + "/sala/" + room.missionId);
  await B.goto(BASE + "/sala/" + room.missionId);
  const composer = (p) => p.locator("textarea").last();
  await composer(A).waitFor({ timeout: 20000 });
  await composer(B).waitFor({ timeout: 20000 });
  // On a phone the sidebar is a closed drawer and side panels start closed (responsive shell);
  // close the room panel if a wider layout left it open.
  const panel = B.getByRole("button", { name: "Ocultar el panel lateral" });
  if (await panel.count()) await panel.first().click();
  await composer(A).fill("Buenos días, ¿revisamos el presupuesto a las 12?");
  await composer(A).press("Enter");
  const t0 = Date.now();
  await B.getByText("Buenos días, ¿revisamos el presupuesto a las 12?").waitFor({ state: "attached", timeout: 10000 });
  check("Beto sees Ana's message live", true);
  console.log(`       (on the phone in ${Date.now() - t0} ms)`);
  await composer(B).fill("Perfecto, allí estaré.");
  await composer(B).press("Enter");
  await A.getByText("Perfecto, allí estaré.").waitFor({ timeout: 10000 });
  check("Ana sees Beto's answer live", true);
  await A.waitForTimeout(600);
  await shot(A, "laptop-5-sala-compartida");
  await shot(B, "phone-4-sala-compartida");
  const named = await A.getByText(`beto.${run}`, { exact: false }).count();
  check("Ana's screen names Beto as the author", named > 0);

  // ---- sign out (Beto)
  await B.goto(BASE + "/empresa");
  await B.getByRole("button", { name: "Cerrar sesión" }).click();
  await B.waitForURL(/\/entrar\?salir/);
  await shot(B, "phone-5-sesion-cerrada");
  const after = await B.evaluate(async () => (await fetch("/api/state")).status);
  check("Beto signs out", after === 401);

  // ---- Cora, phone (light): a company of her own, which sees nothing of the first one
  const light = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "light", locale: "es-ES" });
  const C = await light.newPage();
  C.on("pageerror", (e) => errors.push("phone2: " + e.message));
  await signIn(C, `cora.${run}@example.org`, null);
  await C.getByRole("heading", { name: "Crea tu empresa" }).waitFor();
  await nameIfAsked(C, "Cora Prueba");
  await C.fill("input[maxlength='60']", "Taller Sur " + run);
  await shot(C, "phone-6-crear-empresa");
  await C.getByRole("button", { name: "Crear y entrar" }).click();
  await C.waitForURL((u) => new URL(u).pathname === "/", { timeout: 20000 });
  const isolated = await C.evaluate(async (id) => { const s = await (await fetch("/api/state")).json(); return !s.missions.some((m) => m.id === id); }, room.missionId);
  check("another company sees nothing of the first", isolated);
  await C.waitForTimeout(800);
  await shot(C, "phone-7-app-otra-empresa");
} catch (error) {
  check("browser flow", false, error.message);
  await shot(A, "fail-laptop").catch(() => {});
  await shot(B, "fail-phone").catch(() => {});
}
check("no page errors", !errors.length, errors.join(" | ").slice(0, 400));
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed · screenshots in ${SHOTS}`);
process.exit(results.every(Boolean) ? 0 : 1);
