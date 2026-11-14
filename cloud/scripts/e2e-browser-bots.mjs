// Bots in hosted Colmena in a real browser (Playwright, as e2e-browser-chat.mjs), test addresses
// and the fake model only: Ana on a laptop (light), Beto on a phone (375 px, dark). The company,
// a bot's answer in a channel and a routine's approval are made over the API; then the screens:
// «Tu cuenta de IA», the admin's «IA y apps», the channel with the bot's answer in its thread and
// the approval in the Bandeja. Screenshots in --shots; script errors and sideways overflow checked.
//   node scripts/e2e-browser-bots.mjs [--url …] [--env a.env,b.env] [--shots ../.local/shots/cloud-phase3]
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import path from "node:path";

const require = createRequire(import.meta.url);
const arg = (name, fallback) => { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg("url", "http://127.0.0.1:8790").replace(/\/$/, "");
const envFiles = arg("env", "../.local/cloud-phase1.env,../.local/cloud-phase3.env").split(",");
const fromEnv = (name) => process.env[name] || envFiles.map((f) => (existsSync(f) ? new RegExp("^" + name + "=(\\S+)$", "m").exec(readFileSync(f, "utf8"))?.[1] : null)).find(Boolean) || null;
const ADMIN = fromEnv("ADMIN_BOOTSTRAP_TOKEN"), FAKE = fromEnv("FAKE_MODEL_TOKEN");
const SHOTS = arg("shots", "../.local/shots/cloud-phase3");
const PW = process.env.PLAYWRIGHT_CORE || "C:/Users/giori/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core";
const EXE = process.env.PW_EXE || "C:/Users/giori/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const { chromium } = require(PW);
mkdirSync(SHOTS, { recursive: true });
const run = randomBytes(3).toString("hex");
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log((ok ? "  ok   " : "  FAIL ") + name + (detail && !ok ? " — " + String(detail).slice(0, 300) : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Person {
  constructor(label, email) { this.label = label; this.email = email; this.cookies = new Map(); this.csrf = null; }
  cookieHeader() { return [...this.cookies].map(([k, v]) => k + "=" + v).join("; "); }
  keep(r) { for (const line of r.headers.getSetCookie?.() || []) { const [pair] = line.split(";"); const at = pair.indexOf("="); const n = pair.slice(0, at), v = pair.slice(at + 1); if (/Max-Age=0/i.test(line) || !v) this.cookies.delete(n); else this.cookies.set(n, v); } }
  async req(p, { method = "GET", body } = {}) {
    const h = {};
    if (this.cookies.size) h.Cookie = this.cookieHeader();
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
    if (v.status !== 200) throw Error("verify " + v.status);
    this.csrf = (await this.req("/auth/me")).data?.csrf || null;
  }
}
async function mailToken(email) {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(BASE + "/auth/dev/mail?email=" + encodeURIComponent(email), { headers: { Authorization: "Bearer " + ADMIN } })).json();
    const m = Array.isArray(list) ? list.find((x) => x.kind === "signin") : null;
    if (m) return new URL(m.url).hash.slice(3);
    await sleep(300);
  }
  throw Error("no mail for " + email);
}
async function until(fn, timeout = 60000) {
  const start = Date.now();
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - start > timeout) return null; await sleep(700); }
}

const A = new Person("Ana", `ana.shots.${run}@example.com`), B = new Person("Beto", `beto.shots.${run}@example.com`);
await A.signIn(); await B.signIn();
await A.req("/auth/workspaces", { method: "POST", body: { name: "Estudio Norte " + run } });
const inv = await A.req("/auth/workspace/invitations", { method: "POST", body: { email: B.email, role: "member" } });
await B.req("/auth/invitations/accept", { method: "POST", body: { token: new URL(inv.data.link).hash.slice(3) } });
B.csrf = (await B.req("/auth/me")).data?.csrf || null;
await A.req("/auth/me", { method: "PATCH", body: { name: "Ana Ruiz" } });
await B.req("/auth/me", { method: "PATCH", body: { name: "Beto Sanz" } });
const boot = (await A.req("/api/chat/bootstrap")).data;
const WS = boot.workspace.id;
const idB = (await B.req("/api/chat/bootstrap")).data.me.id;
await fetch(BASE + "/auth/dev/test/fake-model", { method: "POST", headers: { Authorization: "Bearer " + FAKE, "Content-Type": "application/json" }, body: JSON.stringify({ workspace: WS, on: true }) });
const general = boot.channels.find((c) => c.name === "general");
const say = (P, text, extra = {}) => P.req(`/api/chat/channels/${general.id}/messages`, { method: "POST", body: { text, ...extra } }).then((r) => r.data.message);
await say(A, "Buenos días. Esta semana cerramos el presupuesto del local de la calle Norte.");
const ask = await say(B, "<@bot:nora> ¿me resumes en tres puntos lo que falta para cerrar el presupuesto?");
await until(async () => ((await B.req(`/api/chat/messages/${ask.id}/thread`)).data?.replies || []).some((m) => m.author === "bot:nora"));
// A routine whose red line waits for Ana and Beto.
const rule = (await A.req("/api/automations", { method: "POST", body: { name: "Limpiar agenda del viernes", prompt: "Borra el evento de prueba del viernes [[app:GOOGLECALENDAR_DELETE_EVENT]]", botId: "nora", trigger: { type: "semana", config: { semDia: 5, semHora: "09:00" } } } })).data;
await A.req(`/api/automations/${rule.id}/approver`, { method: "PUT", body: { contactId: idB } });
await A.req(`/api/automations/${rule.id}/test`, { method: "POST", body: {} });
const pending = await until(async () => ((await B.req("/api/state")).data.approvals || []).find((a) => a.status === "pending"));
check("the approval reached Beto", !!pending);
// The admin has turned ChatGPT sign-in on for this company (the warning is part of the screen).
await A.req("/api/cloud/ai/policy", { method: "PUT", body: { chatgptLogin: true } });

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const laptop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "light", locale: "es-ES", timezoneId: "Europe/Madrid" });
const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark", locale: "es-ES", timezoneId: "Europe/Madrid" });
const cookieFor = (P) => [...P.cookies].filter(([name, value]) => value && (BASE.startsWith("https:") || !/^__(Host|Secure)-/.test(name))).map(([name, value]) => ({ name, value, url: BASE }));
await laptop.addCookies(cookieFor(A));
await phone.addCookies(cookieFor(B));
const pa = await laptop.newPage(), pb = await phone.newPage();
const errors = [];
for (const [who, p] of [["laptop", pa], ["phone", pb]]) {
  p.on("pageerror", (e) => errors.push(who + ": " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource|Push API/.test(m.text())) errors.push(who + " console: " + m.text()); });
}
const shot = async (page, name) => { await sleep(600); await page.screenshot({ path: path.join(SHOTS, name + ".png") }); };
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const settle = (page) => page.waitForLoadState("networkidle").catch(() => {});
try {
  for (const [page, who] of [[pa, "laptop"], [pb, "phone"]]) {
    await page.goto(BASE + "/ajustes/ia"); await settle(page);
    await page.getByText("Tu cuenta de IA").first().waitFor({ timeout: 15000 });
    await shot(page, who + "-01-tu-cuenta-de-ia");
    check(who + ": «Tu cuenta de IA» has no sideways scroll", (await overflow(page)) <= 0);
    const code = page.getByText(/Iniciar sesión con ChatGPT/).first();
    if (await code.isVisible().catch(() => false)) { await code.scrollIntoViewIfNeeded(); await shot(page, who + "-02-chatgpt-por-codigo-aviso"); }
  }
  await pa.goto(BASE + "/admin/ia"); await settle(pa);
  await pa.getByText(/suscripción/i).first().waitFor({ timeout: 15000 }).catch(() => {});
  await shot(pa, "laptop-03-admin-ia-y-apps");
  for (const [page, who] of [[pa, "laptop"], [pb, "phone"]]) {
    await page.goto(BASE + "/canal/" + general.id + "?hilo=" + ask.id); await settle(page);
    await page.getByText(/modelo de prueba/).first().waitFor({ timeout: 15000 });
    await shot(page, who + "-04-bot-responde-en-el-canal");
    check(who + ": the channel with the bot's answer has no sideways scroll", (await overflow(page)) <= 0);
  }
  await pa.goto(BASE + "/canal/" + general.id); await settle(pa);
  await pa.locator(".cv-composer textarea").fill("@No");
  await pa.locator(".cp-mentions").waitFor({ timeout: 10000 });
  check("the composer offers bots after «@»", await pa.locator(".cp-mentions").getByText("Nora").first().isVisible());
  await shot(pa, "laptop-05-mencionar-bot");
  for (const [page, who] of [[pa, "laptop"], [pb, "phone"]]) {
    await page.goto(BASE + "/bandeja"); await settle(page);
    await page.getByText(/Nora|evento|GOOGLECALENDAR/i).first().waitFor({ timeout: 15000 }).catch(() => {});
    await shot(page, who + "-06-aprobacion-en-la-bandeja");
    check(who + ": the Bandeja has no sideways scroll", (await overflow(page)) <= 0);
  }
} catch (error) {
  check("the screens", false, error.message);
  await shot(pa, "laptop-error").catch(() => {});
  await shot(pb, "phone-error").catch(() => {});
} finally {
  check("no script errors", !errors.length, errors.join("\n"));
  await fetch(BASE + "/auth/dev/test/fake-model", { method: "POST", headers: { Authorization: "Bearer " + FAKE, "Content-Type": "application/json" }, body: JSON.stringify({ workspace: WS, on: false }) });
  await browser.close();
}
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed; screenshots in ${SHOTS}`);
process.exit(results.every(Boolean) ? 0 : 1);
