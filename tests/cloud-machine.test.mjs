// Phase 4 (docs/CLOUD.md): the process seam and the company's machine. A real machine server
// (server/machine/serve.mjs) runs here on a loopback port, as it runs in the container, and the
// hosted workspace reaches it through the seam (server/machine/seam.mjs): «Código» with the fake
// engine on a fixture repository sent as a git bundle, the API-key rule, previews behind a
// capability link, run_command with its approval, Office previews and the monthly quota.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Store } from "../server/store.mjs";
import { DoDriver } from "../server/store-driver.mjs";
import { FakeDurableStorage } from "../server/do-sql-fake.mjs";
import { hostWorkspace } from "../server/cloud/host.mjs";
import { SqlFiles } from "../server/file-store.mjs";
import { bootServer, createMachine, API_KEY_ONLY } from "../server/machine/serve.mjs";
import { machineClient, localMachine } from "../server/machine/seam.mjs";
import { runProgram } from "../server/computer/system.mjs";
import { planComputerCall, executeComputerTool } from "../server/computer/tools.mjs";
import { usedMs, quotaRefusal, stopped, quotaMinutes, monthOf } from "../server/cloud/machine-quota.mjs";
import { remoteOfficeConverter } from "../server/officepdf.mjs";

const ANA = { id: "11111111-1111-4111-8111-111111111111", name: "Ana", email: "ana@example.com", role: "owner" };
const GIL = { id: "33333333-3333-4333-8333-333333333333", name: "Gil", email: "gil@example.com", role: "guest" };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeout = 30000, step = 100 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw Error("timed out");
    await wait(step);
  }
}
const FAKE_PDF = Buffer.from("%PDF-1.4\n% prueba\n");

/** A machine server on a loopback port and a seam client to it. */
async function machine(t, { office = null } = {}) {
  const work = await mkdtemp(path.join(os.tmpdir(), "colmena-machine-"));
  const token = randomBytes(16).toString("hex");
  // bootServer opens createMachine on /machine/begin (with a test office converter when given).
  const real = bootServer({ work, token, storeKey: randomBytes(32), create: (o) => createMachine({ ...o, ...(office ? { office } : {}), log: () => {} }) });
  await new Promise((r) => real.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + real.server.address().port;
  const client = machineClient({ fetch: (url, init) => fetch(url, init), base, headers: () => ({ "X-Machine-Token": token }) });
  t.after(async () => {
    real.close();
    real.server.closeAllConnections();
    await new Promise((r) => real.server.close(r));
    await rm(work, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  });
  return { work, token, base, client, boot: real };
}

/** A fixture repository with one bug (a - b) and a test that catches it, as a git bundle. */
async function fixtureBundle() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-repo-"));
  await mkdir(path.join(dir, "src"));
  await mkdir(path.join(dir, "test"));
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "suma", type: "module", scripts: { test: "node --test" } }));
  await writeFile(path.join(dir, "src", "suma.js"), "export const suma = (a, b) => a - b;\n");
  await writeFile(path.join(dir, "test", "suma.test.mjs"), 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { suma } from "../src/suma.js";\ntest("suma", () => assert.equal(suma(2, 3), 5));\n');
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("-c", "user.email=t@example.com", "-c", "user.name=T", "add", ".");
  git("-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-q", "-m", "inicio");
  git("bundle", "create", "repo.bundle", "--all");
  const bundle = await readFile(path.join(dir, "repo.bundle"));
  await rm(dir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  return bundle;
}

async function company(t, m) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-mhost-"));
  const storage = new FakeDurableStorage(path.join(dir, "do.sqlite"));
  const store = new Store(path.join(dir, "virtual-root"), { driver: new DoDriver(storage), keyProvider: () => randomBytes(32).fill(7) });
  const workspace = { id: "0a0b0c0d-1111-4222-8333-444455556666", name: "Pruebas" };
  const host = hostWorkspace({ store, workspace, masters: [{ kid: "m1", secret: randomBytes(32).toString("hex") }], files: new SqlFiles(storage.sql), log: () => {}, testing: true, previews: false, machine: m.client });
  host.syncMembers([ANA, GIL], { name: "Pruebas" });
  t.after(async () => {
    host.bots.close();
    await host.runtime.shutdown();
    try { storage.close?.(); } catch {}
    await rm(dir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  });
  const call = async (person, method, p, body, extra = {}) => {
    const r = await host.machineProxy({ method, path: p, search: extra.search || "", headers: { "content-type": extra.type || "application/json" }, body: body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)), person });
    let data = null;
    try { data = await r.json(); } catch {}
    return { status: r.status, data };
  };
  return { host, store, call };
}

test("seam: a program runs the same on this computer and through the machine", async (t) => {
  const m = await machine(t);
  await fetch(m.base + "/machine/begin", { method: "POST", headers: { "X-Machine-Token": m.token } });
  const args = ["-e", "process.stdout.write('hola'); process.stderr.write('aviso'); process.exit(3)"];
  const local = await runProgram(process.execPath, args, { cwd: os.tmpdir(), spawnImpl: localMachine.spawn });
  const remote = await m.client.run({ file: process.execPath, args, cwd: "missions/m1" });
  for (const r of [local, remote]) { assert.equal(r.exitCode, 3); assert.equal(r.stdout, "hola"); assert.equal(r.stderr, "aviso"); assert.equal(r.truncated, false); }
  // The seam's spawn is a ChildProcess look-alike: runProgram drives it unchanged.
  const viaSpawn = await runProgram(process.execPath, ["-e", "console.log(process.cwd())"], { cwd: "missions/m2", spawnImpl: m.client.spawn });
  assert.equal(viaSpawn.exitCode, 0);
  assert.match(viaSpawn.stdout.trim(), /missions[\\/]m2$/);
  // Folders outside the work folder are refused; a missing program is an error, not a hang.
  const out = await m.client.run({ file: process.execPath, args: ["-e", "1"], cwd: "../../fuera" }).catch((e) => e);
  assert.match(String(out.message || out), /fuera de la máquina|Carpeta/);
  await assert.rejects(m.client.run({ file: "programa-que-no-existe-xyz", args: [] }), /No se pudo/);
  // A bad token gets nothing.
  const bad = await fetch(m.base + "/machine/health", { headers: { "X-Machine-Token": "x" } });
  assert.equal(bad.status, 401);
  // Program names: bare names or system paths; npm and scripts refused.
  assert.equal(m.client.resolve("git"), "git");
  assert.throws(() => m.client.resolve("npm"), /npm/);
  assert.throws(() => m.client.resolve("../evil"), /nombre del programa/);
  assert.throws(() => m.client.resolve("hack.sh"), /scripts|nombre/);
});

test("seam: the machine opens only after its work folder is back (restore before begin)", async (t) => {
  const m = await machine(t);
  const health = await (await fetch(m.base + "/machine/health", { headers: { "X-Machine-Token": m.token } })).json();
  assert.equal(health.ready, false);
  const early = await fetch(m.base + "/api/code", { headers: { "X-Machine-Token": m.token } });
  assert.equal(early.status, 503);
  const begin = await fetch(m.base + "/machine/begin", { method: "POST", headers: { "X-Machine-Token": m.token } });
  assert.equal(begin.status, 200);
  const after = await (await fetch(m.base + "/machine/health", { headers: { "X-Machine-Token": m.token } })).json();
  assert.equal(after.ok, true);
  assert.equal(after.busy, false);
});

test("run_command in the cloud: approval first, then the machine runs it (never this host)", async (t) => {
  const m = await machine(t);
  await fetch(m.base + "/machine/begin", { method: "POST", headers: { "X-Machine-Token": m.token } });
  const ctx = { missionId: "mis-1", botId: "atlas", bot: { id: "atlas", name: "Atlas" }, machine: m.client, settings: {} };
  const args = { program: process.execPath, args: ["-e", "console.log('desde la máquina')"], folderId: null, reason: "Probar la máquina" };
  // Absolute paths outside /usr, /bin, /opt are not programs of the machine.
  await assert.rejects(planComputerCall("run_command", args, ctx), /nombre del programa/);
  const named = { ...args, program: "node" };
  const plan = await planComputerCall("run_command", named, ctx);
  assert.notEqual(plan.policy, "free");
  assert.equal(plan.approval.computer.folder, "la carpeta de la misión (en la nube)");
  await assert.rejects(executeComputerTool("run_command", named, ctx), /aprobación/);
  const out = await executeComputerTool("run_command", named, { ...ctx, approved: true, approval: { computer: plan.approval.computer } });
  assert.equal(out.exitCode, 0);
  assert.match(out.stdout, /desde la máquina/);
  assert.match(out.where, /nube/);
});

test("Código in the cloud: a bundled repo, the fake engine fixes it and runs its tests, diff and API-key rule", { timeout: 120000 }, async (t) => {
  const m = await machine(t);
  await fetch(m.base + "/machine/begin", { method: "POST", headers: { "X-Machine-Token": m.token } });
  const { host, call } = await company(t, m);
  // Guests never reach the machine.
  assert.equal((await call(GIL, "GET", "/api/code")).status, 403);
  // A folder of someone's computer does not exist here.
  assert.equal((await call(ANA, "POST", "/api/code/projects", { folder: "C:\\Users\\x" })).status, 400);
  const imported = await call(ANA, "POST", "/api/code/cloud/import", await fixtureBundle(), { search: "?name=suma&origin=local", type: "application/octet-stream" });
  assert.equal(imported.status, 200, JSON.stringify(imported.data));
  const project = imported.data.project;
  assert.equal(project.repo, true);

  // Without an API key (and no fake engine) a turn fails with the plain cloud rule.
  const noKey = await call(ANA, "POST", "/api/code/tasks", { projectId: project.id, text: "arregla la suma", engine: "claude-code", isolated: true });
  assert.equal(noKey.status, 200);
  const failed = await until(async () => {
    const d = (await call(ANA, "GET", "/api/code/tasks/" + noKey.data.task.id)).data;
    return (d?.items || []).find((i) => String(i.text || "").includes("clave de API")) ? d : null;
  });
  assert.ok(failed.items.some((i) => String(i.text || "").includes(API_KEY_ONLY.slice(0, 40))));

  // With the workspace's test flag: the fake Claude Code edits the file and runs the tests for real.
  host.setTestFlags({ fakeModel: true });
  const made = await call(ANA, "POST", "/api/code/tasks", { projectId: project.id, text: "arregla la suma y prueba", engine: "claude-code", isolated: true, access: "full" });
  const id = made.data.task.id;
  const done = await until(async () => {
    const d = (await call(ANA, "GET", "/api/code/tasks/" + id)).data;
    return (d?.items || []).some((i) => /pruebas pasan|no pasan/.test(String(i.text || ""))) && !["working", "waiting"].includes(d.task?.status) ? d : null;
  }, { timeout: 90000 });
  assert.ok(done.items.some((i) => /He arreglado la suma y las pruebas pasan/.test(String(i.text || ""))), JSON.stringify(done.items.map((i) => i.text).slice(-5)));
  const diff = await call(ANA, "GET", "/api/code/tasks/" + id + "/diff");
  assert.equal(diff.status, 200);
  assert.match(JSON.stringify(diff.data), /a \+ b/);
  // The live channel of «Código» streams through the proxy as SSE.
  const live = await host.machineProxy({ method: "GET", path: "/api/code/events", person: ANA });
  assert.match(live.headers.get("content-type") || "", /event-stream/);
  const reader = live.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /event: ready/);
  await reader.cancel();
});

test("previews: a capability link per task and port, served sandboxed, nothing without it", { timeout: 60000 }, async (t) => {
  const m = await machine(t);
  await fetch(m.base + "/machine/begin", { method: "POST", headers: { "X-Machine-Token": m.token } });
  const { host, call } = await company(t, m);
  const dev = http.createServer((req, res) => { res.setHeader("Set-Cookie", "x=1"); res.setHeader("Content-Type", "text/html"); res.end("<h1>Mi app " + req.url + "</h1>"); });
  await new Promise((r) => dev.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => dev.close(r)));
  const port = dev.address().port;
  const imported = await call(ANA, "POST", "/api/code/cloud/import", await fixtureBundle(), { search: "?name=vista", type: "application/octet-stream" });
  const task = (await call(ANA, "POST", "/api/code/tasks", { projectId: imported.data.project.id, text: "", engine: "claude-code" })).data.task;
  assert.equal((await call(ANA, "POST", "/api/code/tasks/" + task.id + "/preview-link", { port: 22 })).status, 400);
  assert.equal((await call(ANA, "POST", "/api/code/tasks/nope/preview-link", { port })).status, 404);
  const link = await call(ANA, "POST", "/api/code/tasks/" + task.id + "/preview-link", { port });
  assert.equal(link.status, 200);
  const token = /\/vista\/[^/]+\/([^/]+)\//.exec(link.data.url)[1];
  const page = await host.preview(token, "/hola", { search: "?a=1" });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Mi app \/hola\?a=1/);
  assert.match(page.headers.get("content-security-policy"), /^sandbox allow-scripts/);
  assert.equal(page.headers.get("set-cookie"), null);
  assert.equal((await host.preview("x".repeat(32), "/")).status, 404);
  host.store.patch("previewLinks", token, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await host.preview(token, "/")).status, 404);
});

test("Office previews: the machine converts, the workspace keeps the newest PDFs in memory", async (t) => {
  let conversions = 0;
  const office = remoteOfficeConverter({ convert: async () => { conversions++; return { pdf: FAKE_PDF, missingFonts: ["Aptos"], engine: "LibreOffice (prueba)" }; } });
  const m = await machine(t, { office });
  await fetch(m.base + "/machine/begin", { method: "POST", headers: { "X-Machine-Token": m.token } });
  const converter = m.client.office();
  const doc = Buffer.from("PK fake docx");
  const a = await converter.convert(doc, "docx");
  assert.equal(a.pdf.subarray(0, 5).toString(), "%PDF-");
  assert.deepEqual(a.missingFonts, ["Aptos"]);
  assert.equal(a.cached, false);
  const b = await converter.convert(doc, "docx");
  assert.equal(b.cached, true);
  assert.equal(conversions, 1);
  await assert.rejects(converter.convert(doc, "exe"), /no se convierte/);
});

test("company settings: time zone from the owner's browser, then the admin's; GitHub tokens and apps per person", async (t) => {
  const m = await machine(t);
  await fetch(m.base + "/machine/begin", { method: "POST", headers: { "X-Machine-Token": m.token } });
  const { host, store } = await company(t, m);
  const bots = host.bots;
  // A routine at 9:00 made before any zone: UTC; the first owner's browser says Madrid.
  store.put("automations", { id: "r1", name: "Buenos días", botId: "nora", prompt: "Hola", enabled: true, trigger: { type: "dia", config: { hora: "09:00", dias: [0, 1, 2, 3, 4, 5, 6], festivo: "igual" } }, createdAt: new Date().toISOString() });
  assert.equal(bots.adoptTimeZone("Europe/Madrid", GIL), null, "a guest never sets it");
  assert.equal(bots.adoptTimeZone("Europe/Madrid", ANA), "Europe/Madrid");
  const next = new Date(store.get("automations", "r1").nextRun);
  assert.equal(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(next), "09:00");
  assert.equal(bots.adoptTimeZone("America/New_York", ANA), null, "once set, only an admin changes it");
  assert.equal(bots.setTimeZone("America/New_York"), "America/New_York");
  assert.equal(new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(store.get("automations", "r1").nextRun)), "09:00");
  // GitHub: none yet; the person's token wins over the company's; neither is stored in the clear.
  assert.equal(await bots.githubToken(ANA.id), null);
  const server = http.createServer(host.app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => { server.closeAllConnections(); return new Promise((r) => server.close(r)); });
  const api = (person, method, p, body) => fetch("http://127.0.0.1:" + server.address().port + "/api" + p, { method, headers: { "Content-Type": "application/json", "X-Colmena-Person": JSON.stringify(person) }, ...(body ? { body: JSON.stringify(body) } : {}) }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
  const companyToken = "ghp_" + "c".repeat(36), mine = "github_pat_" + "m".repeat(40);
  assert.equal((await api(ANA, "PUT", "/cloud/github", { scope: "company", token: "nope" })).status, 400);
  assert.equal((await api(GIL, "PUT", "/cloud/github", { scope: "mine", token: mine })).status, 403);
  assert.equal((await api(ANA, "PUT", "/cloud/github", { scope: "company", token: companyToken })).status, 200);
  assert.equal(await bots.githubToken(ANA.id), companyToken);
  assert.equal((await api(ANA, "PUT", "/cloud/github", { scope: "mine", token: mine })).status, 200);
  assert.equal(await bots.githubToken(ANA.id), mine);
  assert.deepEqual((await api(ANA, "GET", "/cloud/github")).data, { mine: true, company: true });
  assert.equal(JSON.stringify(store.list("sealedSecrets")).includes("cccccccccc"), false);
  assert.equal((await api(ANA, "PUT", "/cloud/timezone", { timezone: "Mars/Base" })).status, 400);
  assert.equal((await api(ANA, "PUT", "/cloud/timezone", { timezone: "Europe/Madrid" })).data.timezone, "Europe/Madrid");
  // «Mis apps»: refused until the company has a Composio key; then a profile of one's own.
  await assert.rejects(bots.linkPersonalApps(ANA.id), /Primero/);
  const { asPerson } = await import("../server/identity.mjs");
  assert.equal(asPerson(ANA, () => bots.appProfile()), "default");
  store.put("cloud", { id: "apps-mine:" + ANA.id, on: true }, { silent: true });
  assert.match(asPerson(ANA, () => bots.appProfile()), /^p-/);
  assert.equal(asPerson(GIL, () => bots.appProfile()), "default");
});

test("quotas: minutes per month, counted while running, refused with a clear sentence", () => {
  const at = Date.parse("2026-11-14T12:00:00Z");
  assert.equal(quotaMinutes(null, "600"), 600);
  assert.equal(quotaMinutes(30, "600"), 30);
  assert.equal(quotaMinutes(undefined, undefined), 600);
  let meta = { usage: { month: "2026-11", ms: 29 * 60000 }, runningSince: at - 60000 };
  assert.equal(usedMs(meta, at, true), 30 * 60000);
  assert.equal(quotaRefusal({ ...meta, runningSince: null }, 30, at), null);
  meta = stopped(meta, at);
  assert.equal(meta.runningSince, null);
  assert.equal(meta.usage.ms, 30 * 60000);
  assert.match(quotaRefusal(meta, 30, at), /30 minutos de máquina de este mes/);
  // A new month starts from zero; a container running across midnight counts from the 1st.
  assert.equal(usedMs(meta, Date.parse("2026-12-01T00:10:00Z")), 0);
  assert.equal(usedMs({ usage: { month: "2026-11", ms: 5 }, runningSince: Date.parse("2026-11-30T23:00:00Z") }, Date.parse("2026-12-01T00:30:00Z"), true), 30 * 60000);
  assert.equal(monthOf(at), "2026-11");
});
