// The local agent link (docs/CLOUD.md › Phase 5): device registration and approval, the agent
// protocol (signed hello on a per-socket challenge, replays, the local allowlist, offline),
// the routing rules (only the person's own turns, only what they lent), a cloud bot reading a
// lent folder through the agent in a real hosted workspace, and the data migration's idempotence.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync, randomBytes, sign as edSign } from "node:crypto";
import { Store } from "../server/store.mjs";
import { DoDriver } from "../server/store-driver.mjs";
import { FakeDurableStorage } from "../server/do-sql-fake.mjs";
import { hostWorkspace } from "../server/cloud/host.mjs";
import { SqlFiles } from "../server/file-store.mjs";
import { asPerson } from "../server/identity.mjs";
import { AgentHub, agentFolderId } from "../server/agent-link/hub.mjs";
import { LocalAgent, lendsOf, refusalFor, normalizePolicy, fitResult } from "../server/agent-link/agent.mjs";
import { ReplayGuard, canonical, cleanLends, fingerprint, helloPayload, toB64url, verifySignature, OFFLINE_CODE } from "../server/agent-link/protocol.mjs";
import { lender } from "../server/agent-link/cloud-tools.mjs";
import { exportBatches, importBatch, MIGRATION_KINDS, LEDGER } from "../server/agent-link/migrate.mjs";

const ANA = { id: "11111111-1111-4111-8111-111111111111", name: "Ana", email: "ana@example.com", role: "owner" };
const BETO = { id: "22222222-2222-4222-8222-222222222222", name: "Beto", email: "beto@example.com", role: "member" };
const GIL = { id: "33333333-3333-4333-8333-333333333333", name: "Gil", email: "gil@example.com", role: "guest" };
const PEOPLE = [ANA, BETO, GIL];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, { timeout = 8000, step = 20 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw Error("timed out");
    await wait(step);
  }
}
function deviceKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "jwk" }).x; // base64url of the 32 raw bytes
  return { publicKey: raw, privateKey: privateKey.export({ format: "pem", type: "pkcs8" }) };
}

/**
 * Sockets between a LocalAgent and a hub, in memory: the agent opens `new FakeWS(url)` as it
 * would a real WebSocket; the hub sees the server end through the same adapter the Durable
 * Object gives it (attachment, send, close, lastPing).
 */
function socketLab(getHub) {
  const sockets = new Map(); // tag → Set(adapter)
  const all = new Set();
  class FakeWS {
    constructor(url) {
      this.readyState = 0;
      this.url = url;
      const u = new URL(url.replace(/^ws/, "http"));
      const deviceId = u.searchParams.get("device");
      let attachment = { agent: true, workspaceId: u.searchParams.get("workspace"), deviceId };
      const client = this;
      const server = {
        attachment: () => attachment,
        setAttachment: (a) => { attachment = a; },
        send: (text) => { if (client.readyState === 1) queueMicrotask(() => client.onmessage?.({ data: text })); },
        close: (code, reason) => client.shut(code, reason),
        lastPing: () => client.pingAt || 0,
      };
      this.server = server;
      setTimeout(() => {
        const hub = getHub();
        const d = hub.store.get("agentDevices", deviceId);
        if (!d || d.status === "revoked") return this.shut(4404, "unknown");
        this.readyState = 1;
        const tag = "agent:" + deviceId;
        if (!sockets.has(tag)) sockets.set(tag, new Set());
        sockets.get(tag).add(server);
        all.add(this);
        hub.open(server, deviceId);
      }, 1);
    }
    send(text) {
      if (this.readyState !== 1) throw Error("closed");
      if (text === '{"type":"ping"}') { this.pingAt = Date.now(); return; }
      this.lastSent = text;
      getHub().message(this.server, text).catch(() => {});
    }
    shut(code = 1000, reason = "") {
      if (this.readyState === 3) return;
      this.readyState = 3;
      for (const set of sockets.values()) set.delete(this.server);
      all.delete(this);
      getHub().closed(this.server);
      queueMicrotask(() => this.onclose?.({ code, reason }));
    }
    close(code, reason) { this.shut(code, reason); }
  }
  return { FakeWS, sockets: (tag) => [...(sockets.get(tag) || [])], dropAll: () => { for (const c of [...all]) c.shut(1006, "network"); } };
}

async function hubLab(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-agent-"));
  t.after(() => rm(dir, { recursive: true, force: true }).catch(() => {}));
  const store = new Store(path.join(dir, "data"));
  t.after(() => store.close());
  for (const p of PEOPLE) store.put("members", { ...p });
  const memberOf = (id) => store.get("members", id) || null;
  let hub = null;
  const lab = socketLab(() => hub);
  hub = new AgentHub({ store, workspace: { id: "w-" + randomBytes(4).toString("hex"), name: "Pruebas" }, memberOf, sockets: lab.sockets, bots: () => [{ id: "nora", name: "Nora" }, { id: "tomas", name: "Tomás" }] });
  return { dir, store, hub, lab, memberOf };
}

function startAgent({ hub, lab, device, keys, policy, execute = async () => ({ ok: true }) }) {
  const states = [];
  const agent = new LocalAgent({
    url: "https://colmena.example", identity: () => ({ workspaceId: hub.workspace.id, deviceId: device.id, privateKey: keys.privateKey }),
    policy: () => policy.current, execute, WebSocketImpl: lab.FakeWS, onStatus: (s) => states.push(s.status),
  });
  agent.start();
  return { agent, states };
}

// ---------------------------------------------------------------- protocol pieces
test("protocol: canonical JSON, fingerprints, signatures and the replay guard", async () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 0 }] }), '{"a":[2,{"c":0,"d":1}],"b":1}');
  const keys = deviceKeys();
  const fp = await fingerprint(keys.publicKey);
  assert.match(fp, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  const payload = await helloPayload({ workspaceId: "w", deviceId: "d", nonce: "n", at: 1, lends: { folders: [] } });
  const sig = toB64url(edSign(null, Buffer.from(payload), keys.privateKey));
  assert.equal(await verifySignature(keys.publicKey, payload, sig), true);
  assert.equal(await verifySignature(keys.publicKey, payload.replace("\nn\n", "\nm\n"), sig), false, "another nonce");
  assert.equal(await verifySignature(deviceKeys().publicKey, payload, sig), false, "another key");
  let t = 1000;
  const guard = new ReplayGuard({ clock: () => t });
  assert.equal(guard.check({ id: "call-0001", exp: 5000 }), null);
  assert.match(guard.check({ id: "call-0001", exp: 5000 }), /ya se recibió/);
  assert.match(guard.check({ id: "call-0002", exp: 999 }), /caducado/);
  assert.match(guard.check({ id: "call-0003", exp: t + 60 * 60 * 1000 }), /demasiado/);
  assert.match(guard.check({ id: "x" }), /identificador/);
  t = 6000;
  assert.equal(guard.check({ id: "call-0004", exp: 7000 }), null, "expired ids are forgotten, new ones pass");
});

test("lends travel without paths; the local allowlist decides every call", () => {
  const policy = normalizePolicy({
    folders: [{ id: "f1", path: "C:\\Users\\ana\\Informes", label: "Informes", access: "lee", bots: ["nora"] }, { id: "f2", path: "C:\\privado", label: "Privado", bots: [] }],
    navegador: { enabled: true, bots: ["nora"] }, ordenador: { enabled: false, bots: ["nora"] },
    contrasenas: { enabled: true, bots: ["nora"], logins: [{ id: "op:1", label: "Banco", domain: "banco.example", username: "a***", bots: ["nora"] }] },
  });
  const lends = lendsOf(policy);
  assert.equal(JSON.stringify(lends).includes("Users"), false, "no path leaves the computer");
  assert.deepEqual(lends.folders.map((f) => f.id), ["f1"], "a folder lent to nobody is not announced");
  assert.ok(lends.navegador && !lends.ordenador && lends.contrasenas.logins.length === 1);
  const call = (cap, op, args, bot = "nora") => ({ cap, op, args, bot: { id: bot, name: bot } });
  assert.equal(refusalFor(policy, call("carpetas", "read", { folderId: "f1", path: "a.txt" })), null);
  assert.match(refusalFor(policy, call("carpetas", "read", { folderId: "f2", path: "a.txt" })), /no ha prestado esa carpeta/);
  assert.match(refusalFor(policy, call("carpetas", "read", { folderId: "nope" })), /no está prestada/);
  assert.match(refusalFor(policy, call("carpetas", "read", { folderId: "f1" }, "tomas")), /no ha prestado esa carpeta a tomas/);
  assert.match(refusalFor(policy, call("carpetas", "write", { folderId: "f1" })), /no permitida/);
  assert.equal(refusalFor(policy, call("navegador", "plan", { name: "browser_open", args: { url: "https://example.com" } })), null);
  assert.match(refusalFor(policy, call("navegador", "plan", { name: "run_command", args: {} })), /no corresponde/);
  assert.match(refusalFor(policy, call("ordenador", "plan", { name: "run_command", args: {} })), /no ha activado/);
  assert.match(refusalFor(policy, call("contrasenas", "execute", { name: "browser_sign_in", args: { entry: "op:2" } })), /no está prestado/);
  assert.equal(refusalFor(policy, call("contrasenas", "execute", { name: "browser_sign_in", args: { entry: "op:1" } })), null);
  assert.match(refusalFor(policy, call("dictado", "run", {})), /no hace eso/);
  // The cloud's own view is cleaned too: unknown fields and paths are dropped.
  assert.deepEqual(cleanLends({ folders: [{ id: "f1", label: "X", path: "C:\\x", bots: ["nora", "<x>"] }], secret: "sk-1" }), { folders: [{ id: "f1", label: "X", access: "lee", bots: ["nora"] }] });
  assert.equal(fitResult({ image: "x".repeat(1_000_000), url: "u" }).imageOmitted, true);
  assert.throws(() => fitResult({ content: "x".repeat(1_000_000) }), /demasiado grande/);
});

// ---------------------------------------------------------------- devices
test("devices: registered pending, approved once by their person, idempotent, never someone else's", async (t) => {
  const { hub, store } = await hubLab(t);
  const keys = deviceKeys();
  const d = await hub.register(ANA, { name: "Portátil de Ana", publicKey: keys.publicKey, platform: "win32" });
  assert.equal(d.status, "pending");
  assert.match(d.fingerprint, /^[0-9A-F-]{14}$/);
  assert.equal((await hub.register(ANA, { name: "Otra vez", publicKey: keys.publicKey })).id, d.id, "the same key is the same device");
  await assert.rejects(hub.register(BETO, { name: "Mío", publicKey: keys.publicKey }), /otra persona/);
  await assert.rejects(hub.register(GIL, { name: "Invitado", publicKey: deviceKeys().publicKey }), /invitado/);
  await assert.rejects(hub.register(ANA, { name: "Mal", publicKey: "abc" }), /no es válida/);
  assert.throws(() => hub.approve(BETO, d.id), /No existe/, "Beto cannot approve Ana's device");
  assert.deepEqual(hub.list(BETO), [], "nor see it");
  assert.equal(hub.approve(ANA, d.id).status, "approved");
  assert.equal(hub.approve(ANA, d.id).status, "approved", "approving twice is fine");
  assert.equal(hub.rename(ANA, d.id, "Sobremesa").name, "Sobremesa");
  assert.equal(hub.revoke(ANA, d.id).status, "revoked");
  assert.throws(() => hub.approve(ANA, d.id), /se quitó/);
  // A pending request older than a day cannot be approved any more.
  const old = await hub.register(ANA, { name: "Viejo", publicKey: deviceKeys().publicKey });
  store.patch("agentDevices", old.id, { createdAt: new Date(Date.now() - 2 * 86400000).toISOString() });
  assert.throws(() => hub.approve(ANA, old.id), /caducado/);
});

// ---------------------------------------------------------------- the handshake and calls
test("agent: signed hello on a fresh challenge; pending, revoked and forged keys are refused", async (t) => {
  const { hub, lab } = await hubLab(t);
  const keys = deviceKeys();
  const device = await hub.register(ANA, { name: "Portátil", publicKey: keys.publicKey });
  const policy = { current: { folders: [] } };
  const first = startAgent({ hub, lab, device, keys, policy });
  await until(() => first.agent.state.status === "pending");
  first.agent.stop();
  hub.approve(ANA, device.id);
  const { agent } = startAgent({ hub, lab, device, keys, policy });
  await until(() => agent.state.status === "online");
  assert.equal(agent.state.person.id, ANA.id);
  assert.ok(agent.state.bots.some((b) => b.id === "nora"));
  assert.equal(hub.isOnline(device.id), true);
  assert.equal(hub.list(ANA)[0].online, true);
  // A second hello on the same socket (a replay of the first) closes it.
  const socket = lab.sockets("agent:" + device.id)[0];
  const replay = await hub.message(socket, JSON.stringify({ type: "hello", at: Date.now(), lends: {}, sig: "AAAA" }));
  assert.equal(replay.refused, "replay");
  await until(() => !hub.isOnline(device.id));
  agent.stop();
  // Someone with another key pretending to be this device.
  const thief = startAgent({ hub, lab, device, keys: deviceKeys(), policy });
  await until(() => thief.agent.state.error);
  assert.match(thief.agent.state.error, /firma/);
  assert.equal(hub.isOnline(device.id), false);
  thief.agent.stop();
  // A hello signed for an old challenge is refused (late), whatever the key.
  const late = { attachment: () => ({ agent: true, deviceId: device.id, nonce: "n", issuedAt: Date.now() - 10 * 60 * 1000 }), setAttachment() {}, send() {}, close() {} };
  assert.equal((await hub.message(late, JSON.stringify({ type: "hello", at: Date.now(), lends: {}, sig: "AAAA" }))).refused, "late");
  // Revoked: the socket closes and the agent stops trying.
  const again = startAgent({ hub, lab, device, keys, policy });
  await until(() => again.agent.state.status === "online");
  hub.revoke(ANA, device.id);
  await until(() => again.agent.state.status === "revoked" || again.agent.state.status === "offline");
  assert.equal(hub.isOnline(device.id), false);
  again.agent.stop();
});

test("agent calls: only what is lent here, each call once, and an offline computer said plainly", async (t) => {
  const { hub, lab, dir } = await hubLab(t);
  const keys = deviceKeys();
  const device = await hub.register(ANA, { name: "Portátil de Ana", publicKey: keys.publicKey });
  hub.approve(ANA, device.id);
  const folder = path.join(dir, "Informes");
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, "ventas.txt"), "Ventas de octubre: 42 cajas.");
  const policy = { current: normalizePolicy({ folders: [{ id: "inf", path: folder, label: "Informes", bots: ["nora"] }, { id: "otra", path: dir, label: "Otra", bots: [] }] }) };
  const ran = [];
  const { tools } = { tools: await import("../server/tools.mjs") };
  const execute = async (call, p) => {
    ran.push(call.id);
    const f = p.folders.find((x) => x.id === call.args.folderId);
    return call.op === "list" ? tools.listFolder(f, "") : tools.readFolderFile(f, call.args.path, 1);
  };
  const { agent } = startAgent({ hub, lab, device, keys, policy, execute });
  await until(() => agent.state.status === "online");
  const nora = { id: "nora", name: "Nora" };
  assert.deepEqual(hub.folders(ANA.id, "nora").map((f) => f.id), ["pc." + device.id + ".inf"]);
  assert.deepEqual(agentFolderId("pc." + device.id + ".inf"), { deviceId: device.id, folderId: "inf" });
  const read = await hub.call({ personId: ANA.id, cap: "carpetas", op: "read", args: { folderId: "inf", path: "ventas.txt" }, bot: nora, folderId: "inf" });
  assert.match(read.content, /42 cajas/);
  assert.equal(JSON.stringify(read).includes(dir), false, "no local path in the answer");
  // A folder this computer did not lend to Nora: the cloud never even routes it…
  await assert.rejects(hub.call({ personId: ANA.id, cap: "carpetas", op: "read", args: { folderId: "otra", path: "x" }, bot: nora, folderId: "otra" }), (e) => e.code === "NOT_LENT");
  // …and if a cloud asked anyway (its view forged), the agent refuses it by its own allowlist.
  const lent = hub.store.get("agentDevices", device.id);
  hub.store.put("agentDevices", { ...lent, lends: { folders: [...lent.lends.folders, { id: "otra", label: "Otra", access: "lee", bots: ["nora"] }] } });
  await assert.rejects(hub.call({ personId: ANA.id, cap: "carpetas", op: "read", args: { folderId: "otra", path: "ventas.txt" }, bot: nora, folderId: "otra" }), /no ha prestado esa carpeta/);
  assert.equal(ran.length, 1, "the refused call never ran");
  // Other people never reach Ana's computer.
  await assert.rejects(hub.call({ personId: BETO.id, cap: "carpetas", op: "read", args: { folderId: "inf", path: "ventas.txt" }, bot: nora, folderId: "inf" }), (e) => e.code === "NOT_LENT");
  // The same call id twice: the second is refused by the agent (replay).
  const socket = lab.sockets("agent:" + device.id)[0];
  const replayed = { type: "call", id: "k-replay-0001", cap: "carpetas", op: "list", args: { folderId: "inf" }, bot: nora, exp: Date.now() + 10000 };
  assert.equal((await agent.onCall(replayed)).ok, true);
  assert.equal((await agent.onCall(replayed)).replay, "Esta petición ya se recibió una vez.");
  assert.match((await agent.onCall({ ...replayed, id: "k-late-00001", exp: Date.now() - 1 })).replay, /caducado/);
  assert.ok(socket);
  // The computer goes off: the next call says so in plain words, at once.
  lab.dropAll();
  agent.stop();
  await until(() => !hub.isOnline(device.id));
  await assert.rejects(hub.call({ personId: ANA.id, cap: "carpetas", op: "read", args: { folderId: "inf", path: "ventas.txt" }, bot: nora, folderId: "inf" }), (e) => e.code === OFFLINE_CODE && /apagado o sin conexión/.test(e.message) && /Portátil de Ana/.test(e.message));
});

test("a call in flight fails at once when the computer disconnects; a silent one times out", async (t) => {
  const { hub, lab } = await hubLab(t);
  const keys = deviceKeys();
  const device = await hub.register(ANA, { name: "Portátil", publicKey: keys.publicKey });
  hub.approve(ANA, device.id);
  const policy = { current: normalizePolicy({ folders: [{ id: "inf", path: os.tmpdir(), label: "Tmp", bots: ["nora"] }] }) };
  let hold = null;
  const { agent } = startAgent({ hub, lab, device, keys, policy, execute: () => new Promise((r) => { hold = r; }) });
  await until(() => agent.state.status === "online");
  const pending = hub.call({ personId: ANA.id, cap: "carpetas", op: "list", args: { folderId: "inf" }, bot: { id: "nora", name: "Nora" }, folderId: "inf", timeout: 5000 });
  await until(() => hold);
  lab.dropAll();
  await assert.rejects(pending, (e) => e.code === OFFLINE_CODE);
  agent.stop();
  const silent = startAgent({ hub, lab, device, keys, policy, execute: () => new Promise(() => {}) });
  await until(() => silent.agent.state.status === "online");
  await assert.rejects(hub.call({ personId: ANA.id, cap: "carpetas", op: "list", args: { folderId: "inf" }, bot: { id: "nora", name: "Nora" }, folderId: "inf", timeout: 150 }), (e) => e.code === "TIMEOUT");
  silent.agent.stop();
});

test("routing rules: only the person's own turns, never a guest, another member's request or an errand", () => {
  const memberOf = (id) => PEOPLE.find((p) => p.id === id) || null;
  asPerson(ANA, () => {
    assert.equal(lender({ askedBy: ANA.id }, memberOf)?.id, ANA.id);
    assert.equal(lender({ askedBy: BETO.id }, memberOf), null, "Beto asked: Ana's computer is not his");
    assert.equal(lender({ askedBy: ANA.id, peerErrand: { from: "x" } }, memberOf), null, "a turn for someone else");
  });
  asPerson(GIL, () => assert.equal(lender({ askedBy: GIL.id }, memberOf), null, "guests never"));
  assert.equal(lender({}, memberOf), null, "background work as nobody");
});

// ---------------------------------------------------------------- the real hosted workspace
async function company(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-agent-ws-"));
  const storage = new FakeDurableStorage(path.join(dir, "do.sqlite"));
  const store = new Store(path.join(dir, "virtual-root"), { driver: new DoDriver(storage), keyProvider: () => Buffer.alloc(32, 7) });
  let host = null;
  const lab = socketLab(() => host.agents);
  host = hostWorkspace({ store, workspace: { id: "44444444-4444-4444-8444-444444444444", name: "Pruebas" }, masters: [{ kid: "m1", secret: randomBytes(32).toString("hex") }], files: new SqlFiles(storage.sql), log: () => {}, testing: true, previews: false, agentSockets: lab.sockets });
  host.syncMembers(PEOPLE, { name: "Pruebas" });
  host.setTestFlags({ fakeModel: true });
  const server = http.createServer(host.app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const as = (person) => async (method, route, body) => {
    const r = await fetch(base + "/api" + route, { method, headers: { "Content-Type": "application/json", "X-Colmena-Person": JSON.stringify(person) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    let data = null;
    try { data = await r.json(); } catch {}
    return { status: r.status, data };
  };
  t.after(async () => {
    host.bots.close();
    await host.runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    try { storage.close?.(); } catch {}
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });
  return { dir, store, host, lab, as };
}

test("hosted: «Tus dispositivos» over the API, and a cloud bot reads a lent folder through the agent", async (t) => {
  const { dir, store, host, lab, as } = await company(t);
  const keys = deviceKeys();
  const ana = as(ANA), beto = as(BETO);
  const made = await ana("POST", "/agent/devices", { name: "Portátil de Ana", publicKey: keys.publicKey, platform: "win32" });
  assert.equal(made.status, 201);
  const device = made.data.device;
  assert.equal((await beto("POST", "/agent/devices/" + device.id + "/approve")).status, 404, "not Beto's to approve");
  assert.equal((await as(GIL)("POST", "/agent/devices", { name: "x", publicKey: deviceKeys().publicKey })).status, 403);
  assert.equal((await ana("POST", "/agent/devices/" + device.id + "/approve")).data.device.status, "approved");
  const folder = path.join(dir, "Informes");
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, "ventas.txt"), "Ventas de octubre: 42 cajas.");
  const policy = { current: normalizePolicy({ folders: [{ id: "inf", path: folder, label: "Informes", bots: ["nora"] }, { id: "priv", path: dir, label: "Privada", bots: ["vera"] }] }) };
  const tools = await import("../server/tools.mjs");
  const execute = async (call, p) => { const f = p.folders.find((x) => x.id === call.args.folderId); return call.op === "list" ? tools.listFolder(f, call.args.path || "") : tools.readFolderFile(f, call.args.path, 1); };
  const { agent } = startAgent({ hub: host.agents, lab, device, keys, policy, execute });
  await until(() => agent.state.status === "online");
  const listed = (await ana("GET", "/agent/devices")).data.devices;
  assert.equal(listed[0].online, true);
  assert.deepEqual(listed[0].lends.folders.map((f) => f.label), ["Informes", "Privada"]);
  assert.deepEqual((await beto("GET", "/agent/devices")).data.devices, []);

  const general = (await ana("GET", "/chat/channels")).data.channels.find((c) => c.name === "general");
  const settled = () => until(() => host.runtime.jobs.size === 0 && host.runtime.active.size === 0, { timeout: 15000 });
  const ask = async (who, text) => {
    const sent = (await who("POST", "/chat/channels/" + general.id + "/messages", { text })).data.message;
    await settled();
    const thread = (await who("GET", "/chat/messages/" + sent.id + "/thread")).data;
    return (thread.replies || thread.messages || []).filter((m) => m.author.startsWith("bot:")).map((m) => m.text).join("\n");
  };
  const fid = "pc." + device.id + ".inf";
  const said = await ask(ana, `<@bot:nora> lee el informe [[tool:read_folder_file {"folderId":"${fid}","path":"ventas.txt","page":1}]]`);
  assert.match(said, /42 cajas/, "Nora read the file on Ana's computer");
  // The folder lent to another bot only: refused by the agent, said to the bot.
  const priv = await ask(ana, `<@bot:nora> lee lo privado [[tool:read_folder_file {"folderId":"pc.${device.id}.priv","path":"Informes/ventas.txt","page":1}]]`);
  assert.match(priv, /presta eso|no ha prestado/);
  assert.doesNotMatch(priv, /42 cajas/);
  // Beto asks Nora for Ana's folder: never routed to Ana's computer.
  const other = await ask(beto, `<@bot:nora> lee el informe de Ana [[tool:read_folder_file {"folderId":"${fid}","path":"ventas.txt","page":1}]]`);
  assert.doesNotMatch(other, /42 cajas/);
  // Ana's computer goes off: the bot says so.
  lab.dropAll();
  agent.stop();
  await until(() => !host.agents.isOnline(device.id));
  const off = await ask(ana, `<@bot:nora> otra vez [[tool:read_folder_file {"folderId":"${fid}","path":"ventas.txt","page":1}]]`);
  assert.match(off, /apagado o sin conexión/);
  // Revoked from the screen: gone from what bots can see.
  assert.equal((await ana("DELETE", "/agent/devices/" + device.id)).data.device.status, "revoked");
  assert.deepEqual(host.agents.folders(ANA.id, "nora"), []);
  assert.ok(store.get("agentDevices", device.id).publicKey, "the public key stays (never reused)");
});

// ---------------------------------------------------------------- migration
test("migration: secrets stay home, the upload is idempotent, conversations stay private, routines arrive paused", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-migrate-"));
  t.after(() => rm(dir, { recursive: true, force: true }).catch(() => {}));
  const local = new Store(path.join(dir, "local"));
  const cloud = new Store(path.join(dir, "cloud"));
  t.after(() => { local.close(); cloud.close(); });
  cloud.put("bots", { id: "nora", name: "Nora", instructions: "La de la nube" });
  local.put("bots", { id: "nora", name: "Nora", instructions: "La mía" });
  local.put("bots", { id: "lola", name: "Lola", instructions: "Contable", apiKey: "sk-" + "x".repeat(30), browserSession: "s1" });
  local.put("memories", { id: "m1", text: "Ana prefiere informes cortos", botId: "nora", scope: "bot" });
  local.put("memories", { id: "m2", text: "Mi contraseña es hunter2-secreta", botId: "nora" });
  local.put("missions", { id: "c1", title: "Ventas", status: "completed", botIds: ["lola"] });
  local.put("missions", { id: "c2", title: "Secreto", incognito: true });
  local.put("messages", { id: "msg1", missionId: "c1", role: "user", text: "Resume las ventas" });
  local.put("messages", { id: "msg2", missionId: "c2", role: "user", text: "esto no viaja" });
  local.put("automations", { id: "r1", name: "Resumen diario", enabled: true, botId: "lola", trigger: { type: "dia" } });
  local.put("vault", { id: "v1", domain: "banco.example", password: "x" });
  local.put("providers", { id: "openai", apiKey: "sk-" + "y".repeat(30) });
  const { batches, counts } = exportBatches(local);
  assert.equal(JSON.stringify(batches).includes("sk-"), false, "no key leaves");
  assert.equal(JSON.stringify(batches).includes("hunter2"), false, "a memory with a secret stays");
  assert.equal(JSON.stringify(batches).includes("esto no viaja"), false, "incognito stays");
  assert.ok(batches.every((b) => MIGRATION_KINDS.includes(b.kind)), "only migratable kinds");
  assert.equal(counts.missions, 1);
  const installId = "inst-" + randomBytes(6).toString("hex");
  const run = async () => { const out = { created: 0, updated: 0, unchanged: 0, skipped: 0 }; for (const b of batches) { const s = await importBatch(cloud, ANA, { installId, ...b }); for (const k in out) out[k] += s[k]; } return out; };
  const first = await run();
  assert.ok(first.created >= 5, JSON.stringify(first));
  assert.equal(cloud.get("bots", "nora").instructions, "La de la nube", "a seeded bot keeps the cloud's version");
  assert.equal(cloud.get("memories", "m1").botId, "nora", "its memory came along");
  assert.deepEqual(cloud.get("missions", "c1").audience, [ANA.id], "only Ana sees her old conversations");
  assert.equal(cloud.get("automations", "r1").enabled, false, "routines arrive paused");
  assert.equal(cloud.get("automations", "r1").ownerId, ANA.id);
  assert.equal(cloud.get("bots", "lola").apiKey, undefined);
  assert.equal(cloud.list("vault").length + cloud.list("providers").length, 0);
  const second = await run();
  assert.equal(second.created + second.updated, 0, "the same upload again changes nothing");
  assert.equal(second.unchanged, first.created + first.skipped, JSON.stringify(second));
  // A changed record updates only what this import made.
  local.patch("bots", "lola", { instructions: "Contable y fiscal" });
  const third = await importBatch(cloud, ANA, { installId, kind: "bots", records: local.list("bots").map((b) => b) });
  assert.equal(third.updated, 1);
  assert.equal(cloud.get("bots", "lola").instructions, "Contable y fiscal");
  // Beto uploading the same install never takes over Ana's records.
  const beto = await importBatch(cloud, BETO, { installId, kind: "missions", records: [{ id: "c1", title: "Mía" }] });
  assert.equal(beto.skipped, 1);
  assert.equal(cloud.get("missions", "c1").title, "Ventas");
  assert.ok(cloud.list(LEDGER).length >= first.created);
  await assert.rejects(importBatch(cloud, ANA, { installId, kind: "vault", records: [] }), /no se puede llevar/);
});

// ---------------------------------------------------------------- the desktop sign-in (directory)
test("desktop sign-in: a session only with the poll token and the code the browser hands back", async (t) => {
  const { DirectoryCore } = await import("../cloud/src/directory-core.js");
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-desk-"));
  const storage = new FakeDurableStorage(path.join(dir, "dir.sqlite"));
  t.after(async () => { try { storage.close?.(); } catch {} await rm(dir, { recursive: true, force: true }).catch(() => {}); });
  let now = Date.now();
  const core = new DirectoryCore(storage, { clock: () => now });
  const link = core.requestLink({ email: "ana@example.com" });
  const ana = core.verifyLink({ token: link.token });
  const ws = core.createWorkspace(ana.user.id, "Miel");
  const start = core.startDesktop({ name: "Portátil de Ana", ip: "1.2.3.4" });
  assert.match(start.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.deepEqual(core.finishDesktop({ id: start.id, poll: start.poll }), { pending: true, code: start.code });
  assert.equal(core.previewDesktop(start.id).name, "Portátil de Ana");
  const { handback } = core.approveDesktop(start.id, ana.user.id, ws.id);
  assert.match(handback, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.throws(() => core.approveDesktop(start.id, ana.user.id, ws.id), /ya se usó/, "approved once");
  assert.equal(core.finishDesktop({ id: start.id, poll: start.poll }).approved, true, "no code, no session");
  assert.throws(() => core.finishDesktop({ id: start.id, poll: randomBytes(32).toString("base64url"), handback }), /no válida/, "someone else's poll token");
  assert.throws(() => core.finishDesktop({ id: start.id, poll: start.poll, handback: "AAAA-AAAA" }), /no es el que te dio/);
  const done = core.finishDesktop({ id: start.id, poll: start.poll, handback: handback.toLowerCase().replace("-", "") });
  assert.equal(done.user.id, ana.user.id);
  assert.equal(done.session.workspaceId, ws.id, "opens the company the browser had open");
  assert.notEqual(done.session.token, ana.session.token, "a session of its own");
  assert.equal(core.session(done.session.token).user.email, "ana@example.com");
  assert.throws(() => core.finishDesktop({ id: start.id, poll: start.poll, handback }), /ya se usó/);
  // Five wrong codes close the request; an old one expires.
  const s2 = core.startDesktop({ name: "Otro" });
  core.approveDesktop(s2.id, ana.user.id);
  for (let i = 0; i < 4; i++) assert.throws(() => core.finishDesktop({ id: s2.id, poll: s2.poll, handback: "BBBB-BBBB" }), /no es el que/);
  assert.throws(() => core.finishDesktop({ id: s2.id, poll: s2.poll, handback: "BBBB-BBBB" }), /Demasiados/);
  assert.throws(() => core.finishDesktop({ id: s2.id, poll: s2.poll, handback: "CCCC-CCCC" }), /ya se usó/);
  const s3 = core.startDesktop({ name: "Tarde" });
  now += 11 * 60 * 1000;
  assert.throws(() => core.approveDesktop(s3.id, ana.user.id), /caducado/);
});

// ---------------------------------------------------------------- computer tools through the agent
test("computer tools: offered only to the lending person's bots, planned there, approved in the cloud, run there", async (t) => {
  const { hub, lab, store } = await hubLab(t);
  const { agentExtraTools } = await import("../server/agent-link/cloud-tools.mjs");
  const keys = deviceKeys();
  const device = await hub.register(ANA, { name: "Portátil", publicKey: keys.publicKey });
  hub.approve(ANA, device.id);
  const policy = { current: normalizePolicy({ navegador: { enabled: true, bots: ["nora"] } }) };
  const seen = [];
  const execute = async (call) => {
    seen.push(call.op + ":" + call.args.name + (call.args.approved ? ":approved" : ""));
    if (call.op === "plan") return { name: call.args.name, args: call.args.args, policy: "approval", verb: "navegando", detail: "example.com", approval: { title: "Abrir example.com", summary: "Nora quiere abrir example.com", grantScope: "dominio:example.com", canAlways: true, redLine: false, computer: { domain: "example.com" } } };
    return { url: "https://example.com/", title: "Ejemplo", elements: "e1 enlace" };
  };
  const { agent } = startAgent({ hub, lab, device, keys, policy, execute });
  await until(() => agent.state.status === "online");
  const runtime = { store, autonomy: () => "avisa", setActivity() {}, announce() {}, approvalContext: () => ({}), flagged: () => false };
  const memberOf = (id) => PEOPLE.find((p) => p.id === id) || null;
  const tools = agentExtraTools(runtime, hub, { memberOf });
  const mission = { id: "m1", title: "Prueba", askedBy: ANA.id };
  const names = (bot, person, m = mission) => asPerson(person, () => tools(bot, m).map((x) => x.name));
  assert.ok(names({ id: "nora", name: "Nora" }, ANA).includes("browser_open"));
  assert.equal(names({ id: "nora", name: "Nora" }, ANA).includes("run_command"), false, "apps and commands are not lent");
  assert.deepEqual(names({ id: "tomas", name: "Tomás" }, ANA), [], "not lent to Tomás");
  assert.deepEqual(names({ id: "nora", name: "Nora" }, BETO, { ...mission, askedBy: BETO.id }), [], "Beto's turn: nothing of Ana's computer");
  const open = asPerson(ANA, () => tools({ id: "nora", name: "Nora" }, mission).find((x) => x.name === "browser_open"));
  const ctx = { mission, step: { id: "s1" }, bot: { id: "nora", name: "Nora" }, call: { call_id: "c1" } };
  assert.deepEqual(await asPerson(ANA, () => open.run({ url: "https://example.com" }, ctx)), { waiting: true });
  const a = store.get("approvals", "s1:c1");
  assert.equal(a.status, "pending");
  assert.equal(a.agent, true);
  assert.deepEqual(seen, ["plan:browser_open"], "planned on the computer, not run before the OK");
  store.patch("approvals", "s1:c1", { status: "approved" });
  const result = await asPerson(ANA, () => open.run({ url: "https://example.com" }, ctx));
  assert.equal(result.title, "Ejemplo");
  assert.deepEqual(seen, ["plan:browser_open", "execute:browser_open:approved"]);
  assert.equal(store.get("approvals", "s1:c1").status, "executed");
});
