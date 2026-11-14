// End-to-end check of Phase 4 (docs/CLOUD.md) against the deployed Worker, with the fake model and
// the fake Claude Code only, and a real container:
//   node scripts/e2e-machine.mjs [--url https://app.colmena.team] [--env ../.local/cloud-phase1.env,../.local/cloud-phase3.env] [--sleep 1]
// Needs ADMIN_BOOTSTRAP_TOKEN (dev mail of test addresses) and FAKE_MODEL_TOKEN (test flag and routes).
// Test people use example.com only; the repository is a local fixture sent as a git bundle and its
// «origin» is a bare repository inside the container; the browser only visits this Worker's /prueba/ pages.
// Checks: the machine starts on demand (cold start measured); «Código» imports the repo, the engine
// fixes it and runs its tests, the diff, the terminal and the live events reach the web; a dev server
// previews through its capability link (sandboxed); run_command waits for approval and runs in the
// container; the browser reads a page and fills a form, frames and «tomar el control»; an Office
// preview renders; routines at 9:00 Europe/Madrid land on the right UTC instant and one fires at its
// minute; the quota refuses; the machine sleeps (work kept in R2) and comes back with it.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const arg = (name, fallback) => { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg("url", "https://app.colmena.team").replace(/\/$/, "");
const here = (p) => new URL(p, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const envFiles = arg("env", here("../../.local/cloud-phase1.env") + "," + here("../../.local/cloud-phase3.env")).split(",");
const fromEnv = (name) => process.env[name] || envFiles.map((f) => (existsSync(f) ? new RegExp("^" + name + "=(\\S+)$", "m").exec(readFileSync(f, "utf8"))?.[1] : null)).find(Boolean) || null;
const ADMIN = fromEnv("ADMIN_BOOTSTRAP_TOKEN");
const FAKE = fromEnv("FAKE_MODEL_TOKEN");
if (!ADMIN || !FAKE) throw Error("ADMIN_BOOTSTRAP_TOKEN and FAKE_MODEL_TOKEN are needed.");
const SLEEP_TEST = arg("sleep", "1") !== "0";
const OUT = arg("out", null);
const run = randomBytes(3).toString("hex");
const results = [], numbers = {};
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok }); console.log((ok ? "  ok   " : "  FAIL ") + name + (detail && !ok ? " — " + String(detail).slice(0, 500) : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeout = 60000, step = 750 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - start > timeout) return null;
    await sleep(step);
  }
}

class Person {
  constructor(label, email) { this.label = label; this.email = email; this.cookies = new Map(); this.csrf = null; }
  cookieHeader() { return [...this.cookies].map(([k, v]) => k + "=" + v).join("; "); }
  keep(response) {
    for (const line of response.headers.getSetCookie?.() || []) {
      const [pair] = line.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at), value = pair.slice(at + 1);
      if (/Max-Age=0/i.test(line) || !value) this.cookies.delete(name); else this.cookies.set(name, value);
    }
  }
  async raw(p, { method = "GET", body, type = "application/json", headers = {} } = {}) {
    const h = { ...headers };
    if (this.cookies.size) h.Cookie = this.cookieHeader();
    if (method !== "GET") { h["Content-Type"] = type; h.Origin = BASE; if (this.csrf) h["X-Colmena-Token"] = this.csrf; }
    const response = await fetch(BASE + p, { method, headers: h, redirect: "manual", ...(body !== undefined ? { body } : {}) });
    this.keep(response);
    return response;
  }
  async req(p, { method = "GET", body, headers } = {}) {
    const r = await this.raw(p, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    let data = null;
    try { data = await r.json(); } catch {}
    return { status: r.status, data };
  }
  async signIn() {
    const r = await this.req("/auth/link", { method: "POST", body: { email: this.email } });
    if (r.status !== 202) throw Error(this.label + " link: " + r.status);
    const token = await mailToken(this.email, "signin");
    const v = await this.req("/auth/verify", { method: "POST", body: { token } });
    if (v.status !== 200) throw Error(this.label + " verify: " + v.status);
    await this.refresh();
  }
  async refresh() { const m = await this.req("/auth/me"); this.csrf = m.data?.csrf || null; return m; }
  post(channel, text, thread = null) { return this.req(`/api/chat/channels/${channel}/messages`, { method: "POST", body: { text, ...(thread ? { thread } : {}) } }); }
  thread(id) { return this.req(`/api/chat/messages/${id}/thread`).then((r) => (r.data?.replies || r.data?.messages || [])); }
}
async function mailToken(email, kind) {
  for (let i = 0; i < 12; i++) {
    const r = await fetch(BASE + "/auth/dev/mail?email=" + encodeURIComponent(email), { headers: { Authorization: "Bearer " + ADMIN } });
    const list = await r.json().catch(() => []);
    const mail = (Array.isArray(list) ? list : []).find((m) => m.kind === kind);
    if (mail) return new URL(mail.url).hash.slice(3);
    await sleep(500);
  }
  throw Error("no " + kind + " mail for " + email);
}
const dev = async (what, { method = "POST", body = null, query = "" } = {}) => {
  const r = await fetch(BASE + "/auth/dev/test/" + what + query, { method, headers: { Authorization: "Bearer " + FAKE, ...(body ? { "Content-Type": "application/json", Origin: BASE } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, data: await r.json().catch(() => null) };
};
async function fixtureBundle() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-e2e-repo-"));
  await mkdir(path.join(dir, "src")); await mkdir(path.join(dir, "test"));
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "suma", type: "module", scripts: { test: "node --test", dev: "node server.mjs" } }, null, 2));
  await writeFile(path.join(dir, "src", "suma.js"), "export const suma = (a, b) => a - b;\n");
  await writeFile(path.join(dir, "test", "suma.test.mjs"), 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { suma } from "../src/suma.js";\ntest("suma", () => assert.equal(suma(2, 3), 5));\n');
  await writeFile(path.join(dir, "server.mjs"), 'import http from "node:http";\nhttp.createServer((q, s) => { s.setHeader("Content-Type", "text/html; charset=utf-8"); s.end("<!doctype html><title>Suma</title><h1>Hola desde la vista previa</h1><p>2 + 3 = 5</p>"); }).listen(5173, "127.0.0.1");\n');
  const git = (...a) => execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=T", ...a], { cwd: dir, stdio: "pipe" });
  git("init", "-q", "-b", "main"); git("add", "."); git("commit", "-q", "-m", "inicio"); git("bundle", "create", "repo.bundle", "--all");
  const bundle = await readFile(path.join(dir, "repo.bundle"));
  await rm(dir, { recursive: true, force: true });
  return bundle;
}
/** A tiny .docx (stored ZIP) without dependencies: the same bytes Word writes, minus the extras. */
function tinyDocx() {
  const files = {
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Informe de prueba de Colmena en la nube</w:t></w:r></w:p></w:body></w:document>',
  };
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), n = Buffer.from(name), c = crc(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(c, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    parts.push(local, n, data);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt32LE(c, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(cd, n);
    offset += 30 + n.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

const A = new Person("Ana", `ana.p4.${run}@example.com`);
const G = new Person("Gil", `gil.p4.${run}@example.com`);
console.log("Colmena phase 4 e2e against " + BASE + " (run " + run + ")");
await A.signIn(); await G.signIn();
const made = await A.req("/auth/workspaces", { method: "POST", body: { name: "Pruebas fase 4 " + run } });
check("a company", made.status === 201, JSON.stringify(made.data));
{
  const inv = await A.req("/auth/workspace/invitations", { method: "POST", body: { email: G.email, role: "guest" } });
  const acc = await G.req("/auth/invitations/accept", { method: "POST", body: { token: new URL(inv.data.link).hash.slice(3) } });
  check("a guest joins", acc.status === 200, JSON.stringify(acc.data));
  await G.refresh();
}
const boot = (await A.req("/api/chat/bootstrap")).data;
const WS = boot.workspace.id;
const general = boot.channels.find((c) => c.name === "general");
check("the test flag on", (await dev("fake-model", { body: { workspace: WS, on: true } })).data?.fakeModel === true);
const state0 = (await A.req("/api/state", { headers: { "X-Colmena-Time-Zone": "Europe/Madrid" } })).data;
check("«Código» is a place of the hosted app now", !state0.cloud.hidden.includes("codigo") && state0.cloud.machine === true, JSON.stringify(state0.cloud));
check("the company's zone came from its owner's browser", state0.cloud.timezone === "Europe/Madrid", state0.cloud.timezone);
check("a guest cannot use «Código»", (await G.req("/api/code")).status === 403);
const m0 = await dev("machine", { method: "GET", query: "?workspace=" + WS });
check("the machine starts asleep", m0.data?.configured === true && m0.data?.running === false, JSON.stringify(m0.data));

// ---- 1. «Código»: cold start, import, the engine fixes and tests, diff, terminal, events
let project = null, taskId = null;
{
  const t0 = performance.now();
  const first = await A.req("/api/code");
  numbers.coldStartFirstRequestMs = Math.round(performance.now() - t0);
  check(`the machine starts on demand (${numbers.coldStartFirstRequestMs} ms to the first answer)`, first.status === 200 && Array.isArray(first.data?.projects), JSON.stringify(first.data).slice(0, 300));
  const t1 = performance.now();
  const warm = await A.req("/api/code");
  numbers.warmRequestMs = Math.round(performance.now() - t1);
  const bundle = await fixtureBundle();
  const r = await A.raw("/api/code/cloud/import?name=suma&origin=local", { method: "POST", type: "application/octet-stream", body: bundle });
  const imported = await r.json().catch(() => null);
  project = imported?.project;
  check("a fixture repository goes into the container (git bundle, local bare origin)", r.status === 200 && project?.repo === true, JSON.stringify(imported));
  check("a folder of someone's computer is refused", (await A.req("/api/code/projects", { method: "POST", body: { folder: "C:\\Users\\x" } })).status === 400);
  const events = await A.raw("/api/code/events");
  const reader = events.body.getReader();
  const firstEvent = new TextDecoder().decode((await reader.read()).value || new Uint8Array());
  check("the live events of «Código» stream to the web", events.status === 200 && /event: ready/.test(firstEvent), firstEvent);
  const seen = [];
  void (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; seen.push(new TextDecoder().decode(value)); } } catch {} })();
  const t2 = performance.now();
  const task = await A.req("/api/code/tasks", { method: "POST", body: { projectId: project.id, text: "arregla la suma y prueba", engine: "claude-code", isolated: true, access: "full" } });
  taskId = task.data?.task?.id;
  check("a task starts", task.status === 200 && !!taskId, JSON.stringify(task.data));
  const detail = await until(async () => {
    const d = (await A.req("/api/code/tasks/" + taskId)).data;
    return (d?.items || []).some((i) => /pruebas pasan|no pasan/.test(String(i.text || ""))) && !["working", "waiting"].includes(d.task?.status) ? d : null;
  }, { timeout: 120000, step: 1000 });
  numbers.codeTaskMs = Math.round(performance.now() - t2);
  check("the engine fixed the bug and the tests pass in the container", (detail?.items || []).some((i) => /pruebas pasan/.test(String(i.text || ""))), JSON.stringify((detail?.items || []).map((i) => i.text).slice(-4)));
  check("the task's live events reached the web", seen.join("").length > 0);
  await reader.cancel().catch(() => {});
  const diff = await A.req("/api/code/tasks/" + taskId + "/diff");
  check("the person sees the diff", /a \+ b/.test(JSON.stringify(diff.data)), JSON.stringify(diff.data).slice(0, 300));
  const term = await A.req("/api/code/tasks/" + taskId + "/terminals", { method: "POST", body: {} });
  const termId = term.data?.terminal?.id;
  check("a terminal opens in the container", term.status === 200 && !!termId, JSON.stringify(term.data));
  const stream = await A.raw(`/api/code/tasks/${taskId}/terminals/${termId}/stream`);
  const sr = stream.body.getReader();
  let out = "";
  const reading = (async () => { const end = Date.now() + 15000; while (Date.now() < end && !/v24|v22/.test(out)) { const { value, done } = await sr.read(); if (done) break; out += new TextDecoder().decode(value); } })();
  await A.req(`/api/code/tasks/${taskId}/terminals/${termId}/input`, { method: "POST", body: { data: "node --version && (node server.mjs &) \r" } });
  await Promise.race([reading, sleep(16000)]);
  await sr.cancel().catch(() => {});
  check("the terminal answers on the web (node --version)", /v2\d\./.test(out), out.slice(-300));
  numbers.machineAfterTask = (await dev("machine", { method: "GET", query: "?workspace=" + WS })).data;
}

// ---- 2. a dev server preview loads, through its link only
{
  const ports = await until(async () => { const p = (await A.req("/api/code/tasks/" + taskId + "/ports")).data?.ports || []; return p.length ? p : null; }, { timeout: 30000, step: 1500 });
  const port = ports?.[0]?.port || 5173;
  const link = await A.req("/api/code/tasks/" + taskId + "/preview-link", { method: "POST", body: { port } });
  check("a preview link for the task's server", link.status === 200 && /^\/vista\//.test(link.data?.url || ""), JSON.stringify([ports, link.data]));
  const t0 = performance.now();
  const page = await fetch(BASE + link.data.url);
  const html = await page.text();
  numbers.previewMs = Math.round(performance.now() - t0);
  check("the dev server preview loads (no session needed, sandboxed)", page.status === 200 && /Hola desde la vista previa/.test(html) && /^sandbox/.test(page.headers.get("content-security-policy") || ""), page.status + " " + html.slice(0, 200));
  check("a made-up preview link shows nothing", (await fetch(BASE + link.data.url.replace(/\/[^/]+\/$/, "/" + "x".repeat(32) + "/"))).status === 404);
  numbers.previewUrl = BASE + link.data.url;
}

// ---- 3. run_command with approval, in the container
{
  const sent = await A.post(general.id, '<@bot:atlas> comprueba la máquina [[tool:run_command|{"program":"node","args":["-e","console.log(require(\'os\').platform(), 2+3)"],"folderId":null,"reason":"Comprobar la máquina de la nube"}]]');
  const root = sent.data?.message?.id;
  const approval = await until(async () => ((await A.req("/api/state")).data.approvals || []).find((a) => a.status === "pending" && a.computer), { timeout: 60000, step: 1500 });
  check("run_command waits for the person's approval", !!approval, JSON.stringify(((await A.req("/api/state")).data.approvals || []).map((a) => [a.title, a.status, a.computer])));
  if (approval) {
    const t0 = performance.now();
    const ok = await A.req("/api/approvals/" + encodeURIComponent(approval.id), { method: "POST", body: { decision: "approved", revision: approval.revision } });
    check("the person approves it", ok.status === 200, JSON.stringify(ok.data));
    const replies = await until(async () => { const r = (await A.thread(root)).filter((m) => m.author === "bot:atlas" && /resultado/.test(m.text)); return r.length ? r : null; }, { timeout: 90000, step: 1500 });
    numbers.runCommandAfterApprovalMs = Math.round(performance.now() - t0);
    check("it ran in the container (linux, 5)", (replies || []).some((m) => /linux 5/.test(m.text)), JSON.stringify(replies));
  }
}

// ---- 4. the bots' browser: a public test page, a local fixture form, frames, take control
let browserMission = null;
{
  const t0 = performance.now();
  const sent = await A.post(general.id, `<@bot:nora> lee la página de prueba [[tool:browser_open|{"url":"${BASE}/prueba/pagina"}]] [[tool:browser_read|{"mode":"texto","query":""}]]`);
  const replies = await until(async () => { const r = (await A.thread(sent.data.message.id)).filter((m) => m.author === "bot:nora" && /resultado/.test(m.text)); return r.length ? r : null; }, { timeout: 120000, step: 1500 });
  numbers.browserReadMs = Math.round(performance.now() - t0);
  check("the browser reads a public test page", (replies || []).some((m) => /COLMENA-4242/.test(m.text)), JSON.stringify(replies || (await A.thread(sent.data.message.id)).map((m) => [m.author, m.text])));
  const t1 = performance.now();
  const form = await A.post(general.id, `<@bot:nora> rellena el formulario [[tool:browser_open|{"url":"${BASE}/prueba/formulario"}]] [[tool:browser_fill|{"fields":[{"ref":"e1","value":"Ana Prueba"},{"ref":"e2","value":"ana@example.com"}]}]] [[tool:browser_read|{"mode":"elementos","query":""}]]`);
  const filled = await until(async () => { const r = (await A.thread(form.data.message.id)).filter((m) => m.author === "bot:nora" && /resultado/.test(m.text)); return r.length ? r : null; }, { timeout: 120000, step: 1500 });
  numbers.browserFormMs = Math.round(performance.now() - t1);
  check("the browser fills the local fixture form (no submit without approval)", (filled || []).some((m) => /Ana Prueba/.test(m.text) && /ana@example\.com/.test(m.text)), JSON.stringify(filled));
  const st = (await A.req("/api/state")).data;
  browserMission = (st.missions || []).filter((m) => /rellena el formulario/.test(m.title || m.prompt || "")).at(-1)?.id || (st.missions || []).at(-1)?.id;
  const frame = await A.req("/api/computer/frame/" + encodeURIComponent(browserMission));
  check("a live frame of the browser", frame.data?.available === true && /^data:image\/jpeg;base64,/.test(frame.data?.frame?.image || ""), JSON.stringify(frame.data).slice(0, 200));
  if (OUT && frame.data?.frame?.image) { mkdirSync(OUT, { recursive: true }); writeFileSync(path.join(OUT, "browser-frame.jpg"), Buffer.from(frame.data.frame.image.split(",")[1], "base64")); }
  const take = await A.req("/api/computer/takeover", { method: "POST", body: { missionId: browserMission, action: "take" } });
  check("«tomar el control» from the web", take.status === 200 && take.data?.tab?.takeover === true, JSON.stringify(take.data));
  const typed = await A.req("/api/computer/input", { method: "POST", body: { missionId: browserMission, kind: "click", x: 300, y: 240 } });
  check("the person's click reaches the cloud browser", typed.status === 200, JSON.stringify(typed.data));
  const back = await A.req("/api/computer/takeover", { method: "POST", body: { missionId: browserMission, action: "return", note: "Ya está." } });
  check("and gives it back", back.status === 200, JSON.stringify(back.data));
  numbers.browserMission = browserMission;
}

// ---- 5. an Office preview renders (LibreOffice in the container)
{
  const room = await A.req("/api/missions", { method: "POST", body: { prompt: "Revisa el informe adjunto " + run, mode: "solo", botIds: ["nora"], attachments: [{ name: "informe.docx", content: tinyDocx().toString("base64"), encoding: "base64" }] } });
  const missionId = room.data?.id;
  const list = (await A.req("/api/missions/" + missionId + "/workfiles")).data;
  const rel = (list?.files || []).map((f) => f.path).find((n) => /informe\.docx$/.test(n || "")) || "adjuntos/informe.docx";
  const t0 = performance.now();
  const visual = await A.req("/api/missions/" + missionId + "/workfiles/visual?path=" + encodeURIComponent(rel));
  numbers.officeConvertMs = Math.round(performance.now() - t0);
  check("an Office file is converted with LibreOffice in the container", visual.data?.available === true && visual.data.pages >= 1, JSON.stringify([room.status, list, visual]).slice(0, 500));
  const t1 = performance.now();
  const page = await A.raw("/api/missions/" + missionId + "/workfiles/page/1?width=900&path=" + encodeURIComponent(rel));
  const png = Buffer.from(await page.arrayBuffer());
  numbers.officePageMs = Math.round(performance.now() - t1);
  check("its first page renders as an image", page.status === 200 && png.subarray(1, 4).toString() === "PNG", page.status + " " + png.subarray(0, 200).toString());
  if (OUT && page.status === 200) { mkdirSync(OUT, { recursive: true }); writeFileSync(path.join(OUT, "office-page-1.png"), png); }
  numbers.officeMission = missionId;
  numbers.officeFile = rel;
}

// ---- 6. routines in the company's time zone
{
  const daily = await A.req("/api/automations", { method: "POST", body: { name: "Buenos días " + run, prompt: "Resumen de la mañana", botId: "nora", trigger: { type: "dia", config: { hora: "09:00", dias: [0, 1, 2, 3, 4, 5, 6], festivo: "igual" } } } });
  const rule = ((await A.req("/api/state")).data.automations || []).find((r) => r.id === daily.data?.id);
  const next = new Date(rule?.nextRun || 0);
  const madrid = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(next);
  check(`a routine at 9:00 Europe/Madrid runs at ${next.toISOString()} (09:00 in Madrid)`, madrid === "09:00" && [7, 8].includes(next.getUTCHours()), JSON.stringify(rule));
  numbers.nineMadridNextRunUtc = next.toISOString();
  // One at the next minute in Madrid: it fires at that minute, with nobody connected.
  const at = new Date(Date.now() + 150_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((p) => [p.type, p.value]));
  const once = await A.req("/api/automations", { method: "POST", body: { name: "Al minuto " + run, prompt: "Hola desde la rutina", botId: "nora", trigger: { type: "vez", config: { vezFecha: `${parts.year}-${parts.month}-${parts.day}`, vezHora: `${parts.hour}:${parts.minute}`, vezAviso: false } } } });
  const expected = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), at.getUTCHours(), at.getUTCMinutes());
  const planned = ((await A.req("/api/state")).data.automations || []).find((r) => r.id === once.data?.id)?.nextRun;
  check("a one-off routine in Madrid time is planned at that UTC minute", Date.parse(planned) === expected, planned + " vs " + new Date(expected).toISOString());
  const fired = await until(async () => { const r = ((await A.req("/api/state")).data.automations || []).find((x) => x.id === once.data?.id); return r?.lastRun ? r : null; }, { timeout: 240000, step: 5000 });
  numbers.routineFiredLateMs = fired ? Date.parse(fired.lastRun) - expected : null;
  check(`it fired at its minute (${numbers.routineFiredLateMs} ms after)`, fired && numbers.routineFiredLateMs >= 0 && numbers.routineFiredLateMs < 90000, JSON.stringify(fired));
}

// ---- 7. quotas, sleep and wake with the work kept
if (SLEEP_TEST) {
  const t0 = performance.now();
  const slept = await dev("machine/sleep", { body: { workspace: WS } });
  numbers.sleepMs = Math.round(performance.now() - t0);
  numbers.backup = slept.data?.backup || null;
  check("the machine sleeps, its work packed into R2 first", slept.status === 200 && slept.data?.backup?.bytes > 0, JSON.stringify(slept.data));
  const asleep = await dev("machine", { method: "GET", query: "?workspace=" + WS });
  check("and is not running", asleep.data?.running === false, JSON.stringify(asleep.data));
  const q = await dev("machine/quota", { body: { workspace: WS, minutes: 0.01 } });
  const refused = await A.req("/api/code");
  check("past the monthly quota it does not start, with a clear message", refused.status === 429 && /minutos de máquina/.test(refused.data?.error || ""), JSON.stringify([q.data, refused]));
  await dev("machine/quota", { body: { workspace: WS, minutes: null } });
  const t1 = performance.now();
  const back = await A.req("/api/code");
  numbers.coldStartWithRestoreMs = Math.round(performance.now() - t1);
  check(`it wakes with the work kept (${numbers.coldStartWithRestoreMs} ms)`, back.status === 200 && (back.data?.projects || []).some((p) => p.id === project?.id), JSON.stringify(back.data).slice(0, 300));
  const st = await dev("machine", { method: "GET", query: "?workspace=" + WS });
  numbers.machine = st.data;
}

const passed = results.filter((r) => r.ok).length;
console.log("\nnumbers: " + JSON.stringify(numbers, null, 2));
console.log(`\n${passed}/${results.length} checks passed`);
if (OUT) writeFileSync(path.join(OUT, "e2e-machine.json"), JSON.stringify({ run, base: BASE, workspace: WS, passed, total: results.length, results, numbers }, null, 2));
process.exit(passed === results.length ? 0 : 1);
