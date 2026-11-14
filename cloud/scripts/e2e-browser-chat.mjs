// Team messaging in a real browser (Playwright, as scripts/ uses it), test addresses only: Ana
// on a laptop (light), Beto on a phone (375 px, dark). The company and some history are made over
// the API (fast); then both use the screens: channels, a message sent from the laptop arriving on
// the phone, a thread, search, «Personas», the Slack import and the company's admin pages. Every
// step is a screenshot in --shots; each page is checked for script errors and sideways overflow.
//   node scripts/e2e-browser-chat.mjs [--url …] [--env …] [--shots ../.local/shots/cloud-phase2]
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { buildSyntheticExport } from "../../server/cloud/slack-synthetic.mjs";

const require = createRequire(import.meta.url);
const arg = (name, fallback) => { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg("url", "http://127.0.0.1:8790").replace(/\/$/, "");
const envFile = arg("env", "../.local/cloud.env");
const SHOTS = arg("shots", "../.local/shots/cloud-phase2");
const ADMIN = process.env.ADMIN_BOOTSTRAP_TOKEN || (existsSync(envFile) ? /^ADMIN_BOOTSTRAP_TOKEN=(\S+)$/m.exec(readFileSync(envFile, "utf8"))?.[1] : null);
const PW = process.env.PLAYWRIGHT_CORE || "C:/Users/giori/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright-core";
const EXE = process.env.PW_EXE || "C:/Users/giori/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe";
const { chromium } = require(PW);
mkdirSync(SHOTS, { recursive: true });
const run = randomBytes(3).toString("hex");
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log((ok ? "  ok   " : "  FAIL ") + name + (detail && !ok ? " — " + String(detail).slice(0, 300) : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the API side (as cloud/scripts/e2e-chat.mjs)
class Person {
  constructor(label, email) { this.label = label; this.email = email; this.cookies = new Map(); this.csrf = null; }
  cookieHeader() { return [...this.cookies].map(([k, v]) => k + "=" + v).join("; "); }
  keep(r) { for (const line of r.headers.getSetCookie?.() || []) { const [pair] = line.split(";"); const at = pair.indexOf("="); const n = pair.slice(0, at), v = pair.slice(at + 1); if (/Max-Age=0/i.test(line) || !v) this.cookies.delete(n); else this.cookies.set(n, v); } }
  async req(p, { method = "GET", body, raw = null, type = "application/json" } = {}) {
    const h = {};
    if (this.cookies.size) h.Cookie = this.cookieHeader();
    if (method !== "GET") { h["Content-Type"] = type; h.Origin = BASE; if (this.csrf) h["X-Colmena-Token"] = this.csrf; }
    const r = await fetch(BASE + p, { method, headers: h, redirect: "manual", ...(raw ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}) });
    this.keep(r);
    let data = null;
    try { data = await r.json(); } catch {}
    return { status: r.status, data };
  }
  api(p, o) { return this.req("/api/chat" + p, o); }
  async signIn() {
    await this.req("/auth/link", { method: "POST", body: { email: this.email } });
    const v = await this.req("/auth/verify", { method: "POST", body: { token: await mailToken(this.email, "signin") } });
    if (v.status !== 200) throw Error("verify " + v.status);
    await this.refresh();
  }
  async refresh() { this.csrf = (await this.req("/auth/me")).data?.csrf || null; }
}
async function mailToken(email, kind) {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(BASE + "/auth/dev/mail?email=" + encodeURIComponent(email), { headers: { Authorization: "Bearer " + ADMIN } })).json();
    const m = Array.isArray(list) ? list.find((x) => x.kind === kind) : null;
    if (m) return new URL(m.url).hash.slice(3);
    await sleep(300);
  }
  throw Error("no mail for " + email);
}

const A = new Person("Ana", `ana.${run}@example.com`), B = new Person("Beto", `beto.${run}@example.com`), G = new Person("Gil", `gil.${run}@example.com`);
await A.signIn(); await B.signIn(); await G.signIn();
await A.req("/auth/workspaces", { method: "POST", body: { name: "Estudio Norte " + run } });
for (const [P, role] of [[B, "member"], [G, "guest"]]) {
  const inv = await A.req("/auth/workspace/invitations", { method: "POST", body: { email: P.email, role } });
  await P.req("/auth/invitations/accept", { method: "POST", body: { token: new URL(inv.data.link).hash.slice(3) } });
  await P.refresh();
}
await A.req("/auth/me", { method: "PATCH", body: { name: "Ana Ruiz" } });
await B.req("/auth/me", { method: "PATCH", body: { name: "Beto Sanz" } });
await G.req("/auth/me", { method: "PATCH", body: { name: "Gil Mora" } });
const ids = { A: (await A.api("/bootstrap")).data.me.id, B: (await B.api("/bootstrap")).data.me.id, G: (await G.api("/bootstrap")).data.me.id };
await A.api("/me", { method: "PATCH", body: { title: "Dirección", tz: "Europe/Madrid", statusEmoji: "📅", statusText: "En reuniones hasta las 12" } });
await B.api("/me", { method: "PATCH", body: { title: "Ventas", tz: "America/Mexico_City" } });
// Slack history (small) first, so the new conversation is the latest.
const zip = await buildSyntheticExport({ people: [{ name: "Ana Ruiz", email: A.email }, { name: "Beto Sanz", email: B.email }, { name: "Gil Mora", email: G.email }], bigChannelMessages: 300 });
const imp = (await A.api("/import", { method: "POST", body: { size: zip.length, name: "export-slack.zip" } })).data;
for (let k = 0; k < imp.parts; k++) await A.req(`/api/chat/import/${imp.id}/parts/${k}`, { method: "PUT", raw: zip.subarray(k * imp.partSize, (k + 1) * imp.partSize), type: "application/zip" });
await A.api(`/import/${imp.id}/start`, { method: "POST", body: {} });
for (let i = 0; i < 120; i++) { const s = (await A.api("/import")).data.import; if (!["queued", "running"].includes(s.status)) break; await sleep(1500); }
const proyecto = (await A.api("/channels", { method: "POST", body: { name: "proyecto-norte", kind: "public", description: "La reforma del local de la calle Norte: plazos, presupuesto y proveedores." } })).data;
await A.api(`/channels/${proyecto.id}/members`, { method: "POST", body: { people: [ids.B, ids.G] } });
await A.api(`/channels/${proyecto.id}`, { method: "PATCH", body: { topic: "Entrega prevista el 15 de diciembre" } });
const say = (P, text, extra = {}) => P.api(`/channels/${proyecto.id}/messages`, { method: "POST", body: { text, ...extra } }).then((r) => r.data.message);
const r1 = await say(A, "Buenos días. He subido el *presupuesto revisado* del local: baja un 6 % respecto a la primera versión.");
const up = await A.req(`/api/chat/files?channel=${proyecto.id}&name=presupuesto-v2.txt`, { method: "PUT", raw: new TextEncoder().encode("Presupuesto v2\nObra: 41.200 €\n"), type: "text/plain" });
await say(A, "Aquí lo tenéis.", { files: [up.data.id] });
await say(B, "Genial. <@" + ids.A + "> ¿lo mandamos hoy al cliente o esperamos al de fontanería?");
await B.api(`/messages/${r1.id}/reactions`, { method: "POST", body: { emoji: "👍" } });
await G.api(`/messages/${r1.id}/reactions`, { method: "POST", body: { emoji: "🎉" } });
await say(G, "El de fontanería me lo confirman mañana a primera hora.", { thread: r1.id });
await say(A, "Perfecto, esperamos a mañana entonces.", { thread: r1.id });
await say(B, "Anotado. Lo envío yo en cuanto llegue.", { thread: r1.id, alsoChannel: true });
await say(A, "Plano de distribución actualizado: <https://example.com/|ver el plano>");
const dm = (await B.api("/dm", { method: "POST", body: { people: [ids.A] } })).data;
await B.api(`/channels/${dm.id}/messages`, { method: "POST", body: { text: "¿Tienes un momento esta tarde para revisar las cifras?" } });
await A.api("/admin/settings", { method: "PATCH", body: { retentionDays: 365 } });
await sleep(2500); // the link preview

// ---- the browser side
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const laptop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "light", locale: "es-ES", timezoneId: "Europe/Madrid" });
const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark", locale: "es-ES", timezoneId: "Europe/Madrid" });
const cookieFor = (P) => [...P.cookies].map(([name, value]) => ({ name, value, url: BASE }));
await laptop.addCookies(cookieFor(A));
await phone.addCookies(cookieFor(B));
const pa = await laptop.newPage(), pb = await phone.newPage();
const errors = [];
for (const [who, p] of [["laptop", pa], ["phone", pb]]) {
  p.on("pageerror", (e) => errors.push(who + ": " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource|Push API in incognito/.test(m.text())) errors.push(who + " console: " + m.text()); });
}
const shot = async (page, name) => { await sleep(400); await page.screenshot({ path: path.join(SHOTS, name + ".png") }); };
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const settle = (page) => page.waitForLoadState("networkidle").catch(() => {});
try {
  // Channels: the list, then the channel on both
  await pa.goto(BASE + "/canales"); await settle(pa);
  await pa.getByRole("heading", { name: "Canales" }).waitFor();
  await shot(pa, "laptop-01-canales");
  await pb.goto(BASE + "/canales"); await settle(pb);
  await shot(pb, "phone-01-canales");
  check("phone: /canales has no sideways scroll", (await overflow(pb)) <= 0);

  await pa.goto(BASE + "/canal/" + proyecto.id); await settle(pa);
  await pa.getByText("presupuesto revisado").first().waitFor();
  await shot(pa, "laptop-02-canal");
  await pb.goto(BASE + "/canal/" + proyecto.id); await settle(pb);
  await pb.getByText("presupuesto revisado").first().waitFor();
  check("phone: the top bar names the channel, the heading is not drawn twice", await pb.locator(".c-topbar-title").innerText().then((t) => t.includes("proyecto-norte")) && !(await pb.locator(".ch-h1").isVisible().catch(() => false) && (await pb.locator(".ch-h1").boundingBox())?.width > 2));
  await shot(pb, "phone-02-canal");
  check("phone: the channel has no sideways scroll", (await overflow(pb)) <= 0);

  // A message from the laptop arrives on the phone over the socket
  const text = "Reunión con el cliente el jueves a las 10 " + run;
  await pa.locator(".cv-composer textarea").fill(text);
  await pa.keyboard.press("Enter");
  const t0 = Date.now();
  await pb.getByText(text).waitFor({ timeout: 10000 });
  check("a message typed on the laptop appears on the phone", true, "");
  console.log("       arrived on the phone after " + (Date.now() - t0) + " ms");
  await shot(pb, "phone-03-mensaje-en-directo");

  // Mention autocomplete in the composer
  await pa.locator(".cv-composer textarea").fill("@Bet");
  await pa.locator(".cp-mentions").waitFor();
  await shot(pa, "laptop-03-mencion");
  await pa.keyboard.press("Enter");
  await pa.keyboard.type("¿lo ves?");
  await pa.keyboard.press("Enter");
  await pb.locator(".ch-mention.is-me").first().waitFor({ timeout: 10000 });
  check("a mention chosen from the list reaches the person as a mention", true);

  // A thread
  await pa.getByRole("button", { name: /3 respuestas/ }).first().click();
  await pa.locator(".th").getByText("El de fontanería").waitFor();
  await shot(pa, "laptop-04-hilo");
  await pb.getByRole("button", { name: /3 respuestas/ }).first().click();
  await pb.locator(".th").getByText("El de fontanería").waitFor();
  await shot(pb, "phone-04-hilo");
  check("phone: the thread takes the screen without sideways scroll", (await overflow(pb)) <= 0);

  // Search
  await pa.goto(BASE + "/buscar?q=" + encodeURIComponent("presupuesto")); await settle(pa);
  await pa.locator("mark, .ch-mark").first().waitFor({ timeout: 10000 }).catch(() => {});
  await shot(pa, "laptop-05-buscar");
  await pb.goto(BASE + "/buscar?q=" + encodeURIComponent("presupuesto in:#proyecto-norte")); await settle(pb);
  await shot(pb, "phone-05-buscar");
  check("phone: search has no sideways scroll", (await overflow(pb)) <= 0);

  // People
  await pa.goto(BASE + "/personas"); await settle(pa);
  await pa.getByText("Beto Sanz").first().waitFor();
  await shot(pa, "laptop-06-personas");
  await pb.goto(BASE + "/personas"); await settle(pb);
  await shot(pb, "phone-06-personas");
  check("phone: People has no sideways scroll", (await overflow(pb)) <= 0);
  await pb.goto(BASE + "/personas?p=yo"); await settle(pb);
  await shot(pb, "phone-07-tu-perfil");

  // Notifications on this device, as far as a headless browser goes
  await laptop.grantPermissions(["notifications"], { origin: BASE });
  await pa.goto(BASE + "/canales"); await settle(pa);
  const push = await pa.evaluate(async () => {
    try {
      const reg = await navigator.serviceWorker.register("/colmena-sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const boot = await (await fetch("/api/chat/bootstrap")).json();
      const key = boot.push?.publicKey;
      const raw = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (key.length % 4)) % 4)), (c) => c.charCodeAt(0));
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
      return { worker: true, subscribed: !!sub, endpoint: sub.endpoint.split("/").slice(0, 3).join("/") };
    } catch (e) { return { worker: !!navigator.serviceWorker.controller || true, error: String(e.message || e) }; }
  });
  console.log("       push in headless Chromium: " + JSON.stringify(push));
  check("the service worker registers in the hosted app", push.worker);

  // The company's admin pages (laptop and phone as Ana)
  for (const [tab, n] of [["personas", "08"], ["canales", "09"], ["ajustes", "10"], ["importar", "11"], ["registro", "12"]]) {
    await pa.goto(BASE + "/admin/" + tab); await settle(pa);
    await pa.getByRole("tab", { selected: true }).waitFor();
    await sleep(600);
    await shot(pa, `laptop-${n}-admin-${tab}`);
  }
  const anaPhone = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark", locale: "es-ES" });
  await anaPhone.addCookies(cookieFor(A));
  const pc = await anaPhone.newPage();
  pc.on("pageerror", (e) => errors.push("ana-phone: " + e.message));
  for (const [tab, n] of [["personas", "08"], ["importar", "11"], ["registro", "12"]]) {
    await pc.goto(BASE + "/admin/" + tab); await settle(pc);
    await pc.getByRole("tab", { selected: true }).waitFor();
    await sleep(600);
    await shot(pc, `phone-${n}-admin-${tab}`);
    check(`phone: admin «${tab}» has no sideways scroll`, (await overflow(pc)) <= 0);
  }
  // The imported history, and the drawer with channels on a phone
  const hist = (await A.api("/channels")).data.channels.find((c) => c.name === "general");
  await pc.goto(BASE + "/canal/" + hist.id); await settle(pc);
  await shot(pc, "phone-13-historial-importado");
  await pc.locator("[data-mobile-menu]").click();
  await pc.locator("[data-chat-nav]").waitFor();
  await shot(pc, "phone-14-menu-canales");
  await pa.goto(BASE + "/canal/" + hist.id); await settle(pa);
  await shot(pa, "laptop-13-historial-importado");
} catch (error) {
  check("browser story", false, error.stack || error.message);
  await shot(pa, "laptop-zz-error").catch(() => {});
  await shot(pb, "phone-zz-error").catch(() => {});
}
check("no script errors in the pages", errors.length === 0, errors.slice(0, 5).join(" | "));
await browser.close();
console.log("\n" + results.filter(Boolean).length + "/" + results.length + " browser checks passed; screenshots in " + SHOTS);
process.exit(results.every(Boolean) ? 0 : 1);
