// Password managers feed the vault (server/managers): 1Password's `op` and Bitwarden's `bw` are
// fakes (tests/fixtures/fake-op.mjs, fake-bw.mjs) reached through COLMENA_OP_PATH /
// COLMENA_BW_PATH; no real CLI and no real site is touched.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../server/store.mjs";
import { SiteVault } from "../server/vault.mjs";
import { PasswordManagers } from "../server/managers/index.mjs";
import { registerManagerRoutes, signInGrants } from "../server/managers/routes.mjs";
import { BrowserSessions } from "../server/computer/sessions.mjs";
import { _listenOnce, BW_UNLOCK_HELPER } from "../server/managers/bw-window.mjs";
import { planComputerCall, executeComputerTool, forReceipt } from "../server/computer/tools.mjs";
import { computerExtraTools, passwordsAllowed } from "../server/computer/wire.mjs";
import { REQUEST_BY_CAPABILITY, requestToolAllowed } from "../server/request-turn.mjs";
import { z } from "zod";

const FAKE_OP = fileURLToPath(new URL("./fixtures/fake-op.mjs", import.meta.url));
const FAKE_BW = fileURLToPath(new URL("./fixtures/fake-bw.mjs", import.meta.url));
const OP_SECRET = "op-Pa55-" + randomBytes(6).toString("hex");
const BW_SECRET = "bw-Pa55-" + randomBytes(6).toString("hex");
const BW_KEY = "c2Vzc2lvbi1rZXktZmFrZQ" + randomBytes(8).toString("hex");

function memorySecrets() {
  const saved = new Map();
  return { load: async (b) => (saved.has(b.profile) ? structuredClone(saved.get(b.profile)) : null), save: async (b, data) => { saved.set(b.profile, structuredClone(data)); } };
}

async function setup(t, { op = {}, bw = {} } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-managers-"));
  const opState = path.join(directory, "op.json"), bwState = path.join(directory, "bw.json");
  await writeFile(opState, JSON.stringify({ accounts: [{ url: "my.1password.com" }], unlocked: true, items: [
    { id: "op1holded", title: "Holded", url: "https://app.holded.com/login", username: "marina@ejemplo.es", password: OP_SECRET },
    { id: "op2banco", title: "Banco", url: "https://www.banco.es", username: "marina", password: "otra-" + OP_SECRET },
    { id: "op3nourl", title: "Sin web", url: "", username: "x", password: "y" },
  ], ...op }));
  await writeFile(bwState, JSON.stringify({ loggedIn: true, sessionKey: BW_KEY, items: [
    { id: "bw-1-acme", name: "Acme", uri: "https://portal.acme.com", username: "sergio@acme.com", password: BW_SECRET },
  ], ...bw }));
  const store = new Store(directory);
  store.put("bots", { id: "nora", name: "Nora", autonomy: "avisa" });
  store.put("bots", { id: "leo", name: "Leo", autonomy: "avisa" });
  const env = { ...process.env, COLMENA_OP_PATH: FAKE_OP, COLMENA_BW_PATH: FAKE_BW, OP_FAKE_STATE: opState, BW_FAKE_STATE: bwState, BW_SESSION: "" };
  const managers = new PasswordManagers(store, { env, unlock: async () => BW_KEY });
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const state = (which) => JSON.parse(readFileSync(which === "op" ? opState : bwState, "utf8"));
  const patchState = async (which, changes) => writeFile(which === "op" ? opState : bwState, JSON.stringify({ ...state(which), ...changes }));
  return { directory, store, managers, env, state, patchState };
}

/** Every byte Colmena wrote to its data folder (SQLite, WAL…), as text. */
async function dataBytes(directory) {
  let all = "";
  for (const name of await readdir(directory, { recursive: true })) {
    if (/^(op|bw)\.json$/.test(path.basename(name))) continue; // the fakes' own state, not Colmena's
    try { all += (await readFile(path.join(directory, name))).toString("latin1"); } catch {}
  }
  return all;
}

/** Captures console output and process.stdout/stderr writes during fn. */
async function captureLogs(fn) {
  const lines = [];
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info, out: process.stdout.write, err: process.stderr.write };
  const grab = (...a) => { lines.push(a.map(String).join(" ")); };
  Object.assign(console, { log: grab, warn: grab, error: grab, info: grab });
  process.stdout.write = (c, ...r) => { lines.push(String(c)); return saved.out.call(process.stdout, c, ...r); };
  process.stderr.write = (c, ...r) => { lines.push(String(c)); return saved.err.call(process.stderr, c, ...r); };
  try { return { result: await fn(), lines }; } finally {
    Object.assign(console, { log: saved.log, warn: saved.warn, error: saved.error, info: saved.info });
    process.stdout.write = saved.out;
    process.stderr.write = saved.err;
  }
}

test("1Password: not installed, no account, locked and connected, with the exact op commands", async (t) => {
  const { managers, env, patchState, state } = await setup(t);
  const missing = new PasswordManagers(managers.store, { env: { ...env, COLMENA_OP_PATH: path.join(os.tmpdir(), "no-such-op.mjs") } });
  assert.equal((await missing.status("1password")).state, "missing");
  assert.match((await missing.status("1password")).install, /1password/);
  await patchState("op", { accounts: [] });
  const setupState = await managers.status("1password");
  assert.equal(setupState.state, "setup");
  assert.match(setupState.detail, /Integrar con 1Password CLI/);
  await patchState("op", { accounts: [{ url: "my.1password.com" }], unlocked: false });
  const locked = await managers.status("1password");
  assert.equal(locked.state, "locked");
  assert.equal(locked.detail, "Bloqueado — desbloquéalo en 1Password");
  await assert.rejects(managers.items("1password"), /bloqueado/);
  await patchState("op", { unlocked: true });
  assert.equal((await managers.status("1password")).state, "connected");
  const items = await managers.items("1password");
  assert.deepEqual(items.map((i) => [i.itemId, i.domain, i.user]), [["op1holded", "app.holded.com", "m…@ejemplo.es"], ["op2banco", "banco.es", "ma…"]], "a login without a web is left out; users are masked");
  assert.doesNotMatch(JSON.stringify(items), new RegExp(OP_SECRET));
  const calls = state("op").calls.map((c) => c.join(" "));
  assert.ok(calls.includes("account list --format json"));
  assert.ok(calls.includes("whoami --format json"));
  assert.ok(calls.includes("item list --categories Login --format json"));
  assert.ok(!calls.some((c) => c.startsWith("item get")), "nothing is read with --reveal until a bot signs in");
});

test("Bitwarden: unauthenticated, locked (one sentence to unlock), unlocked through the window, list without passwords", async (t) => {
  const { managers, patchState, state } = await setup(t);
  await patchState("bw", { loggedIn: false });
  assert.equal((await managers.status("bitwarden")).state, "setup");
  await patchState("bw", { loggedIn: true });
  const locked = await managers.status("bitwarden");
  assert.equal(locked.state, "locked");
  await assert.rejects(managers.items("bitwarden"), /bloqueado/);
  const unlocked = await managers.unlockBitwarden();
  assert.equal(unlocked.state, "connected", "the session key from bw's own prompt unlocks it");
  const items = await managers.items("bitwarden");
  assert.deepEqual(items.map((i) => [i.itemId, i.domain, i.user]), [["bw-1-acme", "portal.acme.com", "s…@acme.com"]]);
  assert.doesNotMatch(JSON.stringify(items), new RegExp(BW_SECRET), "bw's list carries passwords: none is kept");
  managers.lockBitwarden();
  assert.equal((await managers.status("bitwarden")).state, "locked");
  assert.ok(state("bw").calls.some((c) => c.join(" ") === "list items --nointeraction"));
  assert.ok(state("bw").calls.every((c) => !c.join(" ").includes(BW_KEY)), "the session key travels in the environment, never in argv");
});

test("the unlock window's helper hands back only bw's session key, through a local pipe", async (t) => {
  const { env } = await setup(t);
  const address = process.platform === "win32" ? "\\\\.\\pipe\\colmena-bw-test-" + randomBytes(6).toString("hex") : path.join(os.tmpdir(), "colmena-bw-test-" + randomBytes(6).toString("hex") + ".sock");
  const waiting = _listenOnce(address, 20000);
  const child = spawn(process.execPath, [BW_UNLOCK_HELPER, FAKE_BW, address], { env, stdio: ["ignore", "ignore", "pipe"] });
  let said = "";
  child.stderr.on("data", (d) => { said += d; });
  assert.equal(await waiting, BW_KEY);
  await new Promise((r) => child.on("close", r));
  assert.match(said, /Colmena no la ve/);
  assert.ok(!said.includes(BW_KEY), "the key is never printed in the window");
});

test("a chosen login stores only id, title, domain and masked user; the secret is read at fill time and reaches only the browser", async (t) => {
  const { directory, store, managers, state } = await setup(t);
  const login = await managers.choose("1password", "op1holded");
  assert.deepEqual(Object.keys(store.get("logins", login.id)).sort(), ["createdAt", "domain", "id", "itemId", "manager", "title", "user", "uses"]);
  await assert.rejects(managers.choose("1password", "no-such"), /ya no está/);
  // Not ticked for Nora: not offered, and refused if she names it.
  const vault = new SiteVault(store, { secrets: memorySecrets() });
  const runtime = { store, vault, managers, settings: () => ({}) };
  const computerCalls = [];
  let page = "https://app.holded.com/login";
  const computer = {
    available: true,
    call: async (op, args) => {
      computerCalls.push({ op, args: { ...args } });
      if (op === "status") return { sessions: [{ missionId: "m", botId: "nora", url: page }] };
      if (op === "screenshot") return { url: page, title: "Acceso", jpegBase64: "" };
      if (op === "signIn") return { url: "https://app.holded.com/home", title: "Inicio", filled: ["usuario", "contraseña"], submitted: true };
      throw Error("unexpected " + op);
    },
  };
  const tools = computerExtraTools(runtime, { computer });
  const nora = store.get("bots", "nora");
  const signIn = (bot, mission = { id: "m" }) => tools(bot, mission).find((d) => d.name === "browser_sign_in");
  assert.equal(signIn(nora), undefined, "no account a bot may use: not offered");
  const ctx = { missionId: "m", botId: "nora", bot: nora, computer, vault, managers, store, settings: {} };
  await assert.rejects(planComputerCall("browser_sign_in", { entry: login.id }, ctx), /no tiene permiso para usar ese inicio de sesión/);
  // The person ticks Nora (Ajustes or her page): only Nora.
  store.put("grants", { id: "g-nora", botId: "nora", tool: "browser_sign_in", kind: "permission", scope: "login:" + login.id, active: true, origin: "ajustes" });
  assert.match(signIn(nora).description, new RegExp(login.id + " = app.holded.com \\(«Holded»\\), usuario m…@ejemplo.es"));
  assert.equal(signIn(store.get("bots", "leo")), undefined, "Leo was not ticked");
  // Same-site check: a look-alike page is refused before anything is read.
  page = "https://app.holded.com.evil.io/login";
  await assert.rejects(planComputerCall("browser_sign_in", { entry: login.id }, ctx), /no de app\.holded\.com/);
  page = "https://app.holded.com/login";
  const { result: run, lines } = await captureLogs(async () => {
    const plan = await planComputerCall("browser_sign_in", { entry: login.id }, ctx);
    assert.equal(plan.approval.grantScope, "login:" + login.id);
    assert.match(plan.approval.summary, /de 1Password/);
    const result = await executeComputerTool("browser_sign_in", { entry: login.id }, { ...ctx, approved: true, approval: { computer: plan.approval.computer } });
    store.put("approvals", { id: "a1", tool: "browser_sign_in", args: { entry: login.id }, computer: plan.approval.computer, status: "executed", result: forReceipt(result) });
    store.event("m", "tool_result", { botId: "nora", text: JSON.stringify(result) });
    return { plan, result };
  });
  assert.equal(run.result.signedIn, true);
  const sent = computerCalls.find((c) => c.op === "signIn");
  assert.equal(sent.args.password, OP_SECRET, "only the browser fill gets it");
  assert.equal(sent.args.username, "marina@ejemplo.es");
  assert.ok(state("op").calls.some((c) => c.join(" ") === "item get op1holded --fields label=username,label=password --reveal --format json"), "read at fill time with the documented flags");
  for (const [what, text] of [["plan", JSON.stringify(run.plan)], ["tool result", JSON.stringify(run.result)], ["logs", lines.join("\n")], ["data folder", await dataBytes(directory)]])
    assert.ok(!text.includes(OP_SECRET), "the password is not in the " + what);
  assert.ok(!(await dataBytes(directory)).includes("marina@ejemplo.es"), "nor the full user name");
  assert.equal(managers.entry(login.id).uses, 1);
});

test("Bitwarden logins fill the same way, with bw get username/password", async (t) => {
  const { directory, store, managers, state } = await setup(t);
  await managers.unlockBitwarden();
  const login = await managers.choose("bitwarden", "bw-1-acme");
  store.put("grants", { id: "g1", botId: "nora", tool: "browser_sign_in", scope: "login:" + login.id, active: true });
  const computer = { available: true, call: async (op, args) => (op === "signIn" ? { submitted: true, url: "https://portal.acme.com/", sent: args } : op === "status" ? { sessions: [{ missionId: "m", botId: "nora", url: "https://portal.acme.com/login" }] } : { url: "https://portal.acme.com/login", jpegBase64: "" }) };
  let seen = null;
  const spy = { ...computer, call: async (op, args) => { if (op === "signIn") seen = { ...args }; return computer.call(op, args); } };
  const ctx = { missionId: "m", botId: "nora", bot: store.get("bots", "nora"), computer: spy, managers, store, vault: null, settings: {} };
  const result = await executeComputerTool("browser_sign_in", { entry: login.id }, { ...ctx, approved: true, approval: { computer: { domain: "portal.acme.com" } } });
  assert.equal(seen.password, BW_SECRET);
  assert.ok(!JSON.stringify(result).includes(BW_SECRET));
  assert.ok(!(await dataBytes(directory)).includes(BW_SECRET));
  const calls = state("bw").calls.map((c) => c.join(" "));
  assert.ok(calls.includes("get username bw-1-acme --nointeraction") && calls.includes("get password bw-1-acme --nointeraction"));
});

test("other people's request turns, separate sessions and incognito never use the owner's vault or managers", async (t) => {
  const { store, managers } = await setup(t);
  const login = await managers.choose("1password", "op1holded");
  store.put("grants", { id: "g1", botId: "nora", tool: "browser_sign_in", scope: "login:" + login.id, active: true });
  const vault = new SiteVault(store, { secrets: memorySecrets() });
  const entry = await vault.add({ url: "https://app.holded.com", username: "a@b.es", password: "vault-secret" });
  // The closed allow-list: browser_sign_in is in none of the capabilities.
  assert.ok(!Object.values(REQUEST_BY_CAPABILITY).flat().includes("browser_sign_in"));
  assert.equal(requestToolAllowed("browser_sign_in", { web: true, carpetas: true, apps: true, ordenador: true }), false);
  assert.equal(passwordsAllowed({ id: "m" }), true);
  assert.equal(passwordsAllowed({ id: "m", peerErrand: "room:x" }), false);
  assert.equal(passwordsAllowed({ id: "m", incognito: true }), false);
  const runtime = { store, vault, managers, settings: () => ({}) };
  const tools = computerExtraTools(runtime, { computer: { available: true, call: async () => ({}) } });
  const nora = store.get("bots", "nora");
  assert.ok(tools(nora, { id: "m" }).some((d) => d.name === "browser_sign_in"), "offered in the owner's own turn");
  for (const mission of [{ id: "m", peerErrand: "room:x" }, { id: "m", incognito: true }])
    assert.ok(!tools(nora, mission).some((d) => d.name === "browser_sign_in"), "never offered: " + JSON.stringify(mission));
  const calls = [];
  const computer = { available: true, call: async (op, args) => { calls.push(op); return { url: "https://app.holded.com/login", sessions: [{ missionId: "m", botId: "nora", url: "https://app.holded.com/login" }] }; } };
  for (const extra of [{ noPasswords: true }, { session: "req-step1" }])
    for (const id of [entry.id, login.id]) {
      const ctx = { missionId: "m", botId: "nora", bot: nora, computer, vault, managers, store, settings: {}, ...extra };
      await assert.rejects(planComputerCall("browser_sign_in", { entry: id }, ctx), /no se usan las contraseñas/);
      await assert.rejects(executeComputerTool("browser_sign_in", { entry: id }, { ...ctx, approved: true }), /no se usan las contraseñas/);
    }
  assert.ok(!calls.includes("signIn"));
});

/** A tiny stand-in for Express: handlers by "METHOD path", called with {params, body}. */
function fakeApp() {
  const routes = new Map();
  const app = {};
  for (const m of ["get", "post", "put", "patch", "delete"]) app[m] = (p, fn) => routes.set(m.toUpperCase() + " " + p, fn);
  app.call = async (method, p, { params = {}, body } = {}) => {
    let out = null, code = 200;
    const res = { status(c) { code = c; return res; }, json(v) { out = v; return res; } };
    await routes.get(method + " " + p)({ params, body }, res);
    return { code, body: out };
  };
  return app;
}

test("per-bot permissions: default none, set per account or per bot, and removing a login takes them away", async (t) => {
  const { store, managers } = await setup(t);
  const sessions = new BrowserSessions(store);
  const app = fakeApp();
  registerManagerRoutes(app, { store, managers, sessions, z });
  const listed = await app.call("GET", "/api/password-managers");
  assert.deepEqual(listed.body.logins, [], "nothing is imported until the person picks");
  assert.equal(listed.body.managers.find((m) => m.id === "1password").state, "connected");
  const added = await app.call("POST", "/api/password-managers/:manager/logins", { params: { manager: "1password" }, body: { itemId: "op1holded" } });
  assert.equal(added.code, 201);
  const scope = "login:" + added.body.id;
  assert.deepEqual(signInGrants(store), {}, "no bot may use it until ticked");
  await app.call("PUT", "/api/sign-in-grants", { body: { scope, botIds: ["nora", "nobody"] } });
  assert.deepEqual(signInGrants(store)[scope], ["nora"]);
  await app.call("PUT", "/api/bots/:id/sign-ins", { params: { id: "leo" }, body: { scopes: [scope] } });
  assert.deepEqual(signInGrants(store)[scope].sort(), ["leo", "nora"]);
  await app.call("PUT", "/api/bots/:id/sign-ins", { params: { id: "nora" }, body: { scopes: [] } });
  assert.deepEqual(signInGrants(store)[scope], ["leo"]);
  await app.call("DELETE", "/api/logins/:id", { params: { id: added.body.id } });
  assert.deepEqual(signInGrants(store), {});
  await assert.rejects(app.call("PUT", "/api/sign-in-grants", { body: { scope, botIds: ["nora"] } }), /ya no está/);
});
