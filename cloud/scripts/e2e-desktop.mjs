// End-to-end check of the desktop app in cloud mode (docs/CLOUD.md › Phase 5): a real Electron
// instance (desktop/main.cjs) with its own profile and data under .local/, against the deployed
// Worker (or `npm run dev`), a test person on a reserved domain and the fake model. A Chromium page
// plays the person's system browser. Screenshots in --shots.
//   node scripts/e2e-desktop.mjs [--url https://…] [--env a.env,b.env] [--shots ../.local/shots/cloud-phase5] [--dir ../.local/cloud-phase5/desktop]
// Story: the first-run choice → «Usar Colmena en la nube» → the desktop sign-in (code in the app,
// approval in the browser, the hand-back by a colmena:// link to a second instance) → «Tus
// dispositivos»: add this computer, approve it → «Este ordenador»: lend a test folder to Nora →
// a cloud bot reads a file there through the agent; a folder not lent is refused → «Llevar mis
// datos a la nube» with seeded test data → the app closes and the bot says the computer is off.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../../server/store.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, fallback) => { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg("url", "http://127.0.0.1:8790").replace(/\/$/, "");
const envFiles = arg("env", "../.local/cloud-phase1.env,../.local/cloud-phase3.env").split(",");
const fromEnv = (name) => process.env[name] || envFiles.map((f) => (existsSync(f) ? new RegExp("^" + name + "=(\\S+)$", "m").exec(readFileSync(f, "utf8"))?.[1] : null)).find(Boolean) || null;
const ADMIN = fromEnv("ADMIN_BOOTSTRAP_TOKEN"), FAKE = fromEnv("FAKE_MODEL_TOKEN");
if (!ADMIN || !FAKE) throw Error("ADMIN_BOOTSTRAP_TOKEN and FAKE_MODEL_TOKEN are needed.");
const SHOTS = path.resolve(arg("shots", "../.local/shots/cloud-phase5"));
const DIR = path.resolve(arg("dir", "../.local/cloud-phase5/desktop"));
const PW = process.env.PLAYWRIGHT_CORE || "C:/Users/giori/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core";
const CHROME = process.env.PW_EXE || "C:/Users/giori/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const { _electron, chromium } = require(PW);
const ELECTRON = require(path.join(ROOT, "node_modules", "electron"));
const run = randomBytes(3).toString("hex");
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log((ok ? "  ok   " : "  FAIL ") + name + (detail && !ok ? " — " + String(detail).slice(0, 400) : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeout = 45000, step = 400 } = {}) {
  const start = Date.now();
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - start > timeout) return null; await sleep(step); }
}
const shot = async (page, name) => { await page.screenshot({ path: path.join(SHOTS, name) }); console.log("       · " + name); };

class Person {
  constructor(label, email) { this.label = label; this.email = email; this.cookies = new Map(); this.csrf = null; }
  keep(r) { for (const line of r.headers.getSetCookie?.() || []) { const [pair] = line.split(";"); const at = pair.indexOf("="); const n = pair.slice(0, at), v = pair.slice(at + 1); if (/Max-Age=0/i.test(line) || !v) this.cookies.delete(n); else this.cookies.set(n, v); } }
  async req(p, { method = "GET", body } = {}) {
    const h = {};
    if (this.cookies.size) h.Cookie = [...this.cookies].map(([k, v]) => k + "=" + v).join("; ");
    if (method !== "GET") { h["Content-Type"] = "application/json"; h.Origin = BASE; if (this.csrf) h["X-Colmena-Token"] = this.csrf; }
    const r = await fetch(BASE + p, { method, headers: h, redirect: "manual", ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    this.keep(r);
    let data = null;
    try { data = await r.json(); } catch {}
    return { status: r.status, data };
  }
  async signIn() {
    await this.req("/auth/link", { method: "POST", body: { email: this.email } });
    const v = await this.req("/auth/verify", { method: "POST", body: { token: await mailToken(this.email) } });
    if (v.status !== 200) throw Error(this.label + " verify " + v.status);
    this.csrf = (await this.req("/auth/me")).data?.csrf || null;
  }
  thread(id) { return this.req(`/api/chat/messages/${id}/thread`).then((r) => r.data?.replies || r.data?.messages || []); }
}
async function mailToken(email, after = 0) {
  for (let i = 0; i < 25; i++) {
    const list = await (await fetch(BASE + "/auth/dev/mail?email=" + encodeURIComponent(email), { headers: { Authorization: "Bearer " + ADMIN } })).json().catch(() => []);
    const m = Array.isArray(list) ? list.find((x) => x.kind === "signin" && x.at > after) : null;
    if (m) return new URL(m.url).hash.slice(3);
    await sleep(400);
  }
  throw Error("no mail for " + email);
}
async function ask(P, channel, text) {
  const sent = (await P.req(`/api/chat/channels/${channel}/messages`, { method: "POST", body: { text } })).data?.message;
  const bots = await until(async () => { const r = (await P.thread(sent.id)).filter((m) => String(m.author).startsWith("bot:")); return r.length ? r : null; }, { timeout: 60000 });
  return { id: sent.id, text: (bots || []).map((m) => m.text).join("\n") };
}

console.log("Colmena desktop (cloud mode) e2e against " + BASE + " (run " + run + ")");
rmSync(DIR, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });
const USER_DATA = path.join(DIR, "perfil"), DATA = path.join(DIR, "datos"), FOLDER = path.join(DIR, "Informes"), PRIVATE = path.join(DIR, "Privado"), EXTERNAL = path.join(DIR, "enlaces.txt");
for (const d of [USER_DATA, DATA, FOLDER, PRIVATE]) mkdirSync(d, { recursive: true });
writeFileSync(path.join(FOLDER, "ventas-octubre.txt"), "Ventas de octubre: 42 cajas de miel de romero.");
writeFileSync(path.join(PRIVATE, "nominas.txt"), "Esto no se presta a nadie.");
// Test data of a «local» Colmena on this test profile (never the person's real data).
{
  const local = new Store(DATA);
  local.put("bots", { id: "lola", name: "Lola", role: "Contable", instructions: "Lleva las cuentas de la tienda.", color: "#8A5CF6", createdAt: new Date().toISOString() });
  local.put("memories", { id: "mem-1", text: "Ana prefiere informes de una página", botId: "nora", scope: "bot", createdAt: new Date().toISOString() });
  local.put("missions", { id: "conv-1-" + run, title: "Pedidos de noviembre", status: "completed", botIds: ["lola"], createdAt: new Date().toISOString() });
  local.put("messages", { id: "msg-1-" + run, missionId: "conv-1-" + run, role: "user", text: "Apunta los pedidos de noviembre", createdAt: new Date().toISOString() });
  local.put("automations", { id: "rut-1-" + run, name: "Resumen de los lunes", enabled: true, botId: "lola", trigger: { type: "semana" } });
  local.put("vault", { id: "v-1", domain: "banco.example", password: "no-viaja" });
  local.close();
}

// The person and her company (as if made earlier, on the web).
const A = new Person("Ana", `ana.escritorio.${run}@example.com`);
await A.signIn();
await A.req("/auth/workspaces", { method: "POST", body: { name: "Miel del Sur " + run } });
const boot = (await A.req("/api/chat/bootstrap")).data;
const WS = boot.workspace.id;
const general = boot.channels.find((c) => c.name === "general");
await fetch(BASE + "/auth/dev/test/fake-model", { method: "POST", headers: { Authorization: "Bearer " + FAKE, "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ workspace: WS, on: true }) });

const env = { ...process.env, COLMENA_USER_DATA: USER_DATA, COLMENA_DATA_DIR: DATA, COLMENA_CLOUD_URL: BASE, COLMENA_EXTERNAL_LOG: EXTERNAL };
delete env.ELECTRON_RUN_AS_NODE;
const launch = (extra = {}) => _electron.launch({ executablePath: ELECTRON, args: [path.join(ROOT, "desktop", "main.cjs")], cwd: ROOT, env: { ...env, ...extra } });
const windowAt = async (app, test, timeout = 30000) => until(async () => app.windows().find((w) => { try { return test(w.url()); } catch { return false; } }) || null, { timeout });

// ---- 1. the first-run choice
let app = await launch({ COLMENA_MODE: "ask" });
const modeWin = await app.firstWindow();
await modeWin.waitForSelector("#go");
await modeWin.setViewportSize?.({ width: 760, height: 560 }).catch(() => {});
await shot(modeWin, "01-eleccion-de-modo.png");
check("first run: the choice between the cloud and this computer", (await modeWin.locator(".option").count()) === 2);
await modeWin.click("#go");
const win = await windowAt(app, (u) => u.startsWith(BASE + "/entrar/escritorio"));
check("cloud mode: the window opens the desktop sign-in", !!win);
check("the choice is kept in the profile", JSON.parse(readFileSync(path.join(USER_DATA, "colmena-mode.json"), "utf8")).mode === "cloud");
await win.waitForSelector(".cl-desk-code");
const code = (await win.textContent(".cl-desk-code")).trim();
check("the app shows a code", /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code), code);
await sleep(400);
await shot(win, "02-entrar-desde-el-escritorio.png");
const approvalUrl = await until(async () => (existsSync(EXTERNAL) ? readFileSync(EXTERNAL, "utf8").split("\n").find((l) => l.includes("/entrar/escritorio/aprobar?c=")) : null));
check("the app opened the system browser at the approval page", !!approvalUrl, approvalUrl);

// ---- 2. the system browser: Ana signs in there (link by mail) and approves
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
const since = Date.now();
await page.goto(approvalUrl);
await page.waitForURL(/\/entrar\?next=/);
await page.fill("input[type=email]", A.email);
await page.click("button[type=submit]");
await page.waitForSelector(".cl-sent");
await page.goto(BASE + "/entrar/verificar#t=" + (await mailToken(A.email, since - 5000)));
await page.click("button.cl-btn");
await page.waitForURL(/\/entrar\/escritorio\/aprobar/);
await page.waitForSelector(".cl-desk-code");
check("the browser shows the same code", (await page.textContent(".cl-desk-code")).trim() === code);
await shot(page, "03-navegador-confirma.png");
page.on("framenavigated", () => {});
await page.click("text=Sí, es mi ordenador");
await page.waitForSelector("text=Vuelve a Colmena");
const handback = (await page.textContent(".cl-desk-code")).trim();
await shot(page, "04-navegador-devuelve-el-codigo.png");
check("the browser hands a code back", /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(handback) && handback !== code, handback);

// ---- 3. the colmena:// link reaches the running app (a second instance passes it on and quits)
const link = "colmena://entrar?c=" + new URL(approvalUrl).searchParams.get("c") + "&k=" + handback;
const second = spawn(ELECTRON, [path.join(ROOT, "desktop", "main.cjs"), link], { cwd: ROOT, env, stdio: "ignore" });
await new Promise((r) => second.on("exit", r));
const inside = await until(async () => { const u = new URL(win.url()); return u.pathname === "/" || u.pathname.startsWith("/inicio") ? u : null; }, { timeout: 30000 });
check("the hand-back signs the app in (its own session, in its own partition)", !!inside, win.url());
await win.waitForLoadState("networkidle").catch(() => {});

// ---- 4. «Tus dispositivos»: add this computer, approve it
await win.evaluate(() => { history.pushState(null, "", "/ajustes/dispositivos"); dispatchEvent(new Event("colmena:navigate")); });
await win.waitForSelector("text=Añadir este ordenador", { timeout: 30000 });
await win.click("text=Añadir este ordenador");
await win.waitForSelector("text=Esperando tu aprobación", { timeout: 20000 });
await sleep(600);
await shot(win, "05-tus-dispositivos-por-aprobar.png");
const devices = (await A.req("/api/agent/devices")).data?.devices || [];
check("the device is registered, pending", devices.length === 1 && devices[0].status === "pending", JSON.stringify(devices));
await win.click("button:has-text('Aprobar')");
const online = await until(async () => (await A.req("/api/agent/devices")).data?.devices?.[0]?.online === true, { timeout: 40000 });
check("approved: the local agent is online", !!online);
await win.waitForSelector("text=Encendido", { timeout: 20000 }).catch(() => {});
await sleep(800);
await shot(win, "06-tus-dispositivos-encendido.png");

// ---- 5. «Este ordenador»: what it lends (the local window; the cloud page cannot reach it)
await win.click("text=Elegir qué presta");
const agentWin = await windowAt(app, (u) => u.startsWith("file:") && u.endsWith("agent.html"));
check("«Este ordenador» opens as a local window", !!agentWin);
await agentWin.waitForSelector("h1");
check("the cloud page has no way to the allowlist", await win.evaluate(() => typeof window.colmenaAgent === "undefined" && typeof window.colmenaWindow?.cloud?.setPolicy === "undefined"));
// The folder dialog is the OS's: the test lends its folders through the same call the page makes after it.
await agentWin.evaluate(async ([folder, priv]) => {
  const s = await window.colmenaAgent.status();
  await window.colmenaAgent.setPolicy({ ...s.policy, folders: [{ id: "inf", path: folder, label: "Informes", access: "lee", bots: [] }, { id: "priv", path: priv, label: "Privado", access: "lee", bots: [] }] });
}, [FOLDER, PRIVATE]);
await agentWin.reload();
await agentWin.waitForSelector("button[data-bot='nora']");
await agentWin.locator("button[data-key='folder:inf'][data-bot='nora']").click();
await agentWin.locator("button[data-key='folder:priv'][data-bot='vera']").click();
await agentWin.waitForSelector("text=Guardado");
await sleep(600);
await shot(agentWin, "07-este-ordenador.png");
const lent = await until(async () => { const d = (await A.req("/api/agent/devices")).data?.devices?.[0]; return d?.lends?.folders?.find((f) => f.id === "inf")?.bots?.includes("nora") ? d : null; });
check("what it lends reaches «Tus dispositivos» (labels and bots, no paths)", !!lent && !JSON.stringify(lent).includes("Informes\\\\"), JSON.stringify(lent?.lends));

// ---- 6. a cloud bot reads a file on this computer through the agent
const dev = lent?.id || devices[0]?.id;
const read = await ask(A, general.id, `<@bot:nora> ¿cuántas cajas vendimos en octubre? [[tool:read_folder_file {"folderId":"pc.${dev}.inf","path":"ventas-octubre.txt","page":1}]]`);
check("a cloud bot reads a file in the enabled local folder through the agent", /42 cajas de miel/.test(read.text), read.text);
await win.evaluate((to) => { history.pushState(null, "", to); dispatchEvent(new Event("colmena:navigate")); }, `/canal/${general.id}?hilo=${read.id}`);
await win.waitForSelector("text=42 cajas", { timeout: 30000 }).catch(() => {});
await sleep(1200);
await shot(win, "08-un-bot-usa-tu-ordenador.png");
const refused = await ask(A, general.id, `<@bot:nora> lee las nóminas [[tool:read_folder_file {"folderId":"pc.${dev}.priv","path":"nominas.txt","page":1}]]`);
check("the agent refuses a folder that is not enabled for that bot", /presta eso|no ha prestado|no está prestada/.test(refused.text) && !/no se presta a nadie/.test(refused.text), refused.text);

// ---- 7. «Llevar mis datos a la nube» (seeded test data of this test profile)
await agentWin.click("#preview");
await agentWin.waitForSelector("#upload", { timeout: 30000 });
await agentWin.click("#upload");
await agentWin.waitForSelector("text=Hecho:", { timeout: 60000 });
await sleep(400);
await shot(agentWin, "09-llevar-mis-datos.png");
const state = (await A.req("/api/state")).data;
check("the local bots, conversations and routines arrived; the vault did not", state.bots?.some((b) => b.id === "lola") && state.missions?.some((m) => m.id === "conv-1-" + run) && !JSON.stringify(state).includes("no-viaja"));
await agentWin.click("#upload");
await agentWin.waitForSelector("text=0 nuevos", { timeout: 60000 }).catch(() => {});
check("uploading again changes nothing", /0 nuevos, 0 actualizados/.test(await agentWin.textContent("body")));

// ---- 8. the computer goes off: said plainly
await app.close();
const off = await ask(A, general.id, `<@bot:nora> léelo otra vez [[tool:read_folder_file {"folderId":"pc.${dev}.inf","path":"ventas-octubre.txt","page":1}]]`);
check("going offline is reported", /apagado o sin conexión/.test(off.text), off.text);
await page.goto(BASE + "/ajustes/dispositivos");
await page.waitForSelector("text=Apagado", { timeout: 30000 }).catch(() => {});
await sleep(800);
await shot(page, "10-tus-dispositivos-apagado.png");
await page.goto(`${BASE}/canal/${general.id}?hilo=${off.id}`);
await page.waitForSelector("text=apagado o sin conexión", { timeout: 30000 }).catch(() => {});
await sleep(800);
await shot(page, "11-el-bot-dice-que-esta-apagado.png");
await browser.close();

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed · screenshots in ${SHOTS}`);
process.exit(passed === results.length ? 0 : 1);
