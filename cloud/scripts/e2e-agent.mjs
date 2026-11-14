// End-to-end check of the local agent link (docs/CLOUD.md › Phase 5) against the deployed Worker
// (or `npm run dev`), test addresses and the fake model only. A real LocalAgent
// (server/agent-link/agent.mjs) runs here in Node with its own Ed25519 key, over a real WebSocket:
//   node scripts/e2e-agent.mjs [--url https://…] [--env a.env,b.env] [--dir ../.local/cloud-phase5/agent-e2e]
// Checks: the desktop sign-in hand-off (start, approve in a "browser", poll, the hand-back code,
// a session of its own); device registration and approval, and that only its person sees it;
// the signed hello (a forged key refused); a cloud bot reading a file in a lent folder through the
// agent; a folder not lent refused by the agent's own allowlist; another member never reaching
// that computer; going offline said plainly; data migration twice (idempotent); revocation.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import path from "node:path";
import { LocalAgent, normalizePolicy } from "../../server/agent-link/agent.mjs";
import { listFolder, readFolderFile } from "../../server/tools.mjs";
import { Store } from "../../server/store.mjs";
import { exportBatches } from "../../server/agent-link/migrate.mjs";

const arg = (name, fallback) => { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg("url", "http://127.0.0.1:8790").replace(/\/$/, "");
const envFiles = arg("env", "../.local/cloud-phase1.env,../.local/cloud-phase3.env").split(",");
const fromEnv = (name) => process.env[name] || envFiles.map((f) => (existsSync(f) ? new RegExp("^" + name + "=(\\S+)$", "m").exec(readFileSync(f, "utf8"))?.[1] : null)).find(Boolean) || null;
const ADMIN = fromEnv("ADMIN_BOOTSTRAP_TOKEN"), FAKE = fromEnv("FAKE_MODEL_TOKEN");
if (!ADMIN || !FAKE) throw Error("ADMIN_BOOTSTRAP_TOKEN and FAKE_MODEL_TOKEN are needed.");
const DIR = path.resolve(arg("dir", "../.local/cloud-phase5/agent-e2e"));
const run = randomBytes(3).toString("hex");
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log((ok ? "  ok   " : "  FAIL ") + name + (detail && !ok ? " — " + String(detail).slice(0, 400) : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeout = 45000, step = 500 } = {}) {
  const start = Date.now();
  for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() - start > timeout) return null; await sleep(step); }
}

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
    await this.refresh();
  }
  async refresh() { this.csrf = (await this.req("/auth/me")).data?.csrf || null; }
  thread(id) { return this.req(`/api/chat/messages/${id}/thread`).then((r) => r.data?.replies || r.data?.messages || []); }
}
async function mailToken(email) {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(BASE + "/auth/dev/mail?email=" + encodeURIComponent(email), { headers: { Authorization: "Bearer " + ADMIN } })).json().catch(() => []);
    const m = Array.isArray(list) ? list.find((x) => x.kind === "signin") : null;
    if (m) return new URL(m.url).hash.slice(3);
    await sleep(400);
  }
  throw Error("no mail for " + email);
}
const deviceKeys = () => { const { publicKey, privateKey } = generateKeyPairSync("ed25519"); return { publicKey: publicKey.export({ format: "jwk" }).x, privateKey: privateKey.export({ format: "pem", type: "pkcs8" }) }; };
async function ask(P, channel, text) {
  const sent = (await P.req(`/api/chat/channels/${channel}/messages`, { method: "POST", body: { text } })).data?.message;
  const t0 = performance.now();
  const bots = await until(async () => { const r = (await P.thread(sent.id)).filter((m) => String(m.author).startsWith("bot:")); return r.length ? r : null; }, { timeout: 60000, step: 400 });
  return { text: (bots || []).map((m) => m.text).join("\n"), ms: Math.round(performance.now() - t0) };
}

console.log("Colmena agent e2e against " + BASE + " (run " + run + ")");
rmSync(DIR, { recursive: true, force: true });
const FOLDER = path.join(DIR, "Informes"), PRIVATE = path.join(DIR, "Privado");
mkdirSync(FOLDER, { recursive: true });
mkdirSync(PRIVATE, { recursive: true });
writeFileSync(path.join(FOLDER, "ventas-octubre.txt"), "Ventas de octubre: 42 cajas de miel de romero.");
writeFileSync(path.join(PRIVATE, "nominas.txt"), "Esto no se presta a nadie.");

const A = new Person("Ana", `ana.agente.${run}@example.com`);
const B = new Person("Beto", `beto.agente.${run}@example.com`);
await A.signIn(); await B.signIn();
const made = await A.req("/auth/workspaces", { method: "POST", body: { name: "Pruebas fase 5 " + run } });
check("a company", made.status === 201, JSON.stringify(made.data));
const inv = await A.req("/auth/workspace/invitations", { method: "POST", body: { email: B.email, role: "member" } });
await B.req("/auth/invitations/accept", { method: "POST", body: { token: new URL(inv.data.link).hash.slice(3) } });
await B.refresh();
const boot = (await A.req("/api/chat/bootstrap")).data;
const WS = boot.workspace.id;
const general = boot.channels.find((c) => c.name === "general");
const fake = await fetch(BASE + "/auth/dev/test/fake-model", { method: "POST", headers: { Authorization: "Bearer " + FAKE, "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ workspace: WS, on: true }) });
check("the test flag on", (await fake.json()).fakeModel === true);

// ---- 1. the desktop signs in through the browser (hand-off), without copying any cookie
{
  const app = new Person("App de Ana", A.email);
  const started = await app.req("/auth/desktop/start", { method: "POST", body: { name: "Portátil de Ana" } });
  check("the app starts a desktop sign-in (a code, an id, a poll token)", started.status === 200 && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(started.data?.code) && started.data?.poll, JSON.stringify(started.data));
  const { id, poll, code } = started.data;
  check("pending until approved", (await app.req("/auth/desktop/poll", { method: "POST", body: { id, poll } })).data?.pending === true);
  check("preview needs the browser signed in", (await new Person("x", "").req("/auth/desktop/preview?c=" + id)).status === 401);
  const preview = await A.req("/auth/desktop/preview?c=" + id);
  check("the browser shows the computer and the same code", preview.data?.name === "Portátil de Ana" && preview.data?.code === code, JSON.stringify(preview.data));
  const approved = await A.req("/auth/desktop/approve", { method: "POST", body: { id } });
  check("approved in the browser: a hand-back code", /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(approved.data?.handback || ""), JSON.stringify(approved.data));
  const without = await app.req("/auth/desktop/poll", { method: "POST", body: { id, poll } });
  check("approved but no session without the hand-back code (someone who sent you their code gets nothing)", without.data?.pending === true && without.data?.approved === true && !app.cookies.size);
  check("a wrong poll token is refused", (await new Person("x", "").req("/auth/desktop/poll", { method: "POST", body: { id, poll: randomBytes(32).toString("base64url"), handback: approved.data.handback } })).status === 403);
  check("a wrong hand-back code is refused", (await app.req("/auth/desktop/poll", { method: "POST", body: { id, poll, handback: "AAAA-AAAA" } })).status === 403);
  const done = await app.req("/auth/desktop/poll", { method: "POST", body: { id, poll, handback: approved.data.handback } });
  check("with both: the app's own session (an HttpOnly cookie)", done.status === 200 && done.data?.ok && app.cookies.size === 1 && done.data.workspaceId === WS, JSON.stringify(done.data));
  check("the app's session is a new one, not the browser's", [...app.cookies.values()][0] !== [...A.cookies.values()][0]);
  check("…and works", (await app.req("/auth/me")).data?.user?.email === A.email);
  check("used once", (await app.req("/auth/desktop/poll", { method: "POST", body: { id, poll, handback: approved.data.handback } })).status === 410);
}

// ---- 2. devices
const keys = deviceKeys();
const reg = await A.req("/api/agent/devices", { method: "POST", body: { name: "Portátil de Ana", publicKey: keys.publicKey, platform: "win32" } });
check("a device registers, pending", reg.status === 201 && reg.data?.device?.status === "pending" && /^[0-9A-F-]{14}$/.test(reg.data.device.fingerprint), JSON.stringify(reg.data));
const device = reg.data.device;
check("another member cannot approve it", (await B.req(`/api/agent/devices/${device.id}/approve`, { method: "POST", body: {} })).status === 404);
check("nor see it", (await B.req("/api/agent/devices")).data?.devices?.length === 0);
const policy = { current: normalizePolicy({
  folders: [{ id: "inf", path: FOLDER, label: "Informes", access: "lee", bots: ["nora"] }, { id: "priv", path: PRIVATE, label: "Privado", access: "lee", bots: ["vera"] }],
}) };
const execute = async (call, p) => {
  const f = p.folders.find((x) => x.id === call.args.folderId);
  return call.op === "list" ? listFolder(f, call.args.path || "") : readFolderFile(f, call.args.path, Number(call.args.page) || 1);
};
const states = [];
const agent = new LocalAgent({ url: BASE, identity: () => ({ workspaceId: WS, deviceId: device.id, privateKey: keys.privateKey }), policy: () => policy.current, execute, onStatus: (s) => states.push(s.status) });
agent.start();
check("before approval the agent waits (pending)", !!(await until(async () => agent.state.status === "pending", { timeout: 20000 })), states.join(","));
const t0 = performance.now();
check("Ana approves it", (await A.req(`/api/agent/devices/${device.id}/approve`, { method: "POST", body: {} })).data?.device?.status === "approved");
agent.restart();
check("the agent comes online (signed hello)", !!(await until(async () => agent.state.status === "online", { timeout: 30000 })), states.join(","));
const connectMs = Math.round(performance.now() - t0);
const listed = (await A.req("/api/agent/devices")).data?.devices?.[0];
check("«Tus dispositivos» shows it on, with what it lends (no paths)", listed?.online === true && listed.lends.folders.length === 2 && !JSON.stringify(listed).includes(DIR.replace(/\\/g, "\\\\")), JSON.stringify(listed));
// A forged key for the same device.
const thief = new LocalAgent({ url: BASE, identity: () => ({ workspaceId: WS, deviceId: device.id, privateKey: deviceKeys().privateKey }), policy: () => ({}), execute });
thief.start();
check("a forged key is refused", !!(await until(async () => /firma/.test(thief.state.error || ""), { timeout: 20000 })), JSON.stringify(thief.state));
thief.stop();
await until(async () => (await A.req("/api/agent/devices")).data?.devices?.[0]?.online !== undefined);
agent.restart();
await until(async () => agent.state.status === "online", { timeout: 30000 });

// ---- 3. a cloud bot reads a file in a lent folder through the agent
const fid = "pc." + device.id + ".inf";
const read = await ask(A, general.id, `<@bot:nora> lee las ventas [[tool:read_folder_file {"folderId":"${fid}","path":"ventas-octubre.txt","page":1}]]`);
check("a cloud bot reads a file of a lent local folder through the agent", /42 cajas de miel/.test(read.text), read.text);
const list = await ask(A, general.id, `<@bot:nora> mira la carpeta [[tool:list_folder {"folderId":"${fid}","path":""}]]`);
check("…and lists it", /ventas-octubre\.txt/.test(list.text), list.text);
const refused = await ask(A, general.id, `<@bot:nora> lee las nóminas [[tool:read_folder_file {"folderId":"pc.${device.id}.priv","path":"nominas.txt","page":1}]]`);
check("a folder not lent to that bot is refused", /presta eso|no ha prestado/.test(refused.text) && !/no se presta a nadie/.test(refused.text), refused.text);
// The cloud's view forged (the agent's allowlist is the last word): the agent refuses on its own.
policy.current = normalizePolicy({ ...policy.current, folders: policy.current.folders.map((f) => (f.id === "priv" ? { ...f, bots: ["nora"] } : f)) });
agent.sendLends();
await sleep(1200);
policy.current = normalizePolicy({ ...policy.current, folders: policy.current.folders.map((f) => (f.id === "priv" ? { ...f, bots: [] } : f)) });
const forged = await ask(A, general.id, `<@bot:nora> otra vez [[tool:read_folder_file {"folderId":"pc.${device.id}.priv","path":"nominas.txt","page":1}]]`);
check("even when the cloud thinks it is lent, the agent's own allowlist refuses", /no ha prestado|no está prestada/.test(forged.text) && !/no se presta a nadie/.test(forged.text), forged.text);
agent.sendLends();
const beto = await ask(B, general.id, `<@bot:nora> lee lo de Ana [[tool:read_folder_file {"folderId":"${fid}","path":"ventas-octubre.txt","page":1}]]`);
check("another member's request never reaches Ana's computer", !/42 cajas/.test(beto.text), beto.text);

// ---- 4. migration over the agent (idempotent)
{
  const local = new Store(path.join(DIR, "datos-locales"));
  local.put("bots", { id: "lola-" + run, name: "Lola", role: "Contable", instructions: "Lleva las cuentas.", apiKey: "sk-" + "z".repeat(40) });
  local.put("memories", { id: "mem-" + run, text: "Ana prefiere informes de una página", botId: "nora", scope: "bot" });
  local.put("missions", { id: "conv-" + run, title: "Ventas de octubre", status: "completed", botIds: ["nora"], createdAt: new Date().toISOString() });
  local.put("messages", { id: "msg-" + run, missionId: "conv-" + run, role: "user", text: "¿Cuántas cajas vendimos?", createdAt: new Date().toISOString() });
  local.put("automations", { id: "rut-" + run, name: "Resumen semanal", enabled: true, botId: "nora", trigger: { type: "semana" } });
  local.put("vault", { id: "v-" + run, domain: "banco.example", password: "no-viaja" });
  const { batches } = exportBatches(local);
  local.close();
  const first = await agent.upload(batches, { installId: "e2e" + run });
  check("«Llevar mis datos a la nube»: uploaded", first.created >= 5, JSON.stringify(first));
  const second = await agent.upload(batches, { installId: "e2e" + run });
  check("the same upload again changes nothing (idempotent)", second.created === 0 && second.updated === 0 && second.unchanged === first.created + first.skipped, JSON.stringify(second));
  const state = (await A.req("/api/state")).data;
  check("the bot came, without its key", state.bots?.some((b) => b.id === "lola-" + run) && !JSON.stringify(state).includes("zzzzzzzzzz"));
  check("Ana sees her old conversation; Beto does not", state.missions?.some((m) => m.id === "conv-" + run) && !(await B.req("/api/state")).data.missions?.some((m) => m.id === "conv-" + run));
  check("the routine arrived paused", (await A.req("/api/automations")).data?.find?.((r) => r.id === "rut-" + run)?.enabled === false || state.automations?.find?.((r) => r.id === "rut-" + run)?.enabled === false);
}

// ---- 5. offline, then revoked
agent.stop();
const off = await ask(A, general.id, `<@bot:nora> lee otra vez [[tool:read_folder_file {"folderId":"${fid}","path":"ventas-octubre.txt","page":1}]]`);
check("the computer is off: the bot says so plainly", /apagado o sin conexión/.test(off.text), off.text);
check("«Tus dispositivos» shows it off", (await A.req("/api/agent/devices")).data?.devices?.[0]?.online === false);
check("Ana removes it", (await A.req(`/api/agent/devices/${device.id}`, { method: "DELETE", body: {} })).data?.device?.status === "revoked");
const after = new LocalAgent({ url: BASE, identity: () => ({ workspaceId: WS, deviceId: device.id, privateKey: keys.privateKey }), policy: () => policy.current, execute });
after.start();
check("a removed computer never connects again", !!(await until(async () => after.state.status === "revoked", { timeout: 20000 })), JSON.stringify(after.state));
after.stop();

console.log(`\nTimes: device approved → agent online ${connectMs} ms · file read through the agent ${read.ms} ms (mention → answer in the thread)`);
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
