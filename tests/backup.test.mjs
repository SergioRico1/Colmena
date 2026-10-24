// Encrypted backups (server/backup.mjs, backup-service.mjs): the database by SQLite's online
// backup (rowids and order kept, integrity checked), SOUL/USER and workspaces, the Personas
// identity sealed apart; AES-256-GCM chunks under a scrypt-derived key; restore staged and
// applied at the next start.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, stat, open } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { applyPendingRestore, createBackup, extractBackup, inspectDatabase, newMasterKey, readHeader } from "../server/backup.mjs";
import { Backups } from "../server/backup-service.mjs";

const FAST = { N: 2 ** 14, r: 8, p: 1 }; // scrypt cost for tests; real backups use 2^17
const PASSWORD = "caballo-grapa-bateria"; // a fixture password, nothing real

// Cleanups run last-in first-out: stores close before their folders go.
const cleanups = new WeakMap();
function later(t, fn) {
  if (!cleanups.has(t)) {
    cleanups.set(t, []);
    t.after(async () => { for (const f of cleanups.get(t).reverse()) await f(); });
  }
  cleanups.get(t).push(fn);
}
async function dataDir(t, name = "colmena-backup-") {
  const dir = await mkdtemp(path.join(os.tmpdir(), name));
  later(t, () => rm(dir, { recursive: true, force: true }).catch(() => {}));
  return dir;
}
const closeLater = (t, store) => later(t, () => { try { store.close(); } catch {} });
/** A Colmena with records whose rowids have gaps, workspaces, SOUL/USER and an identity. */
async function filled(t) {
  const dir = await dataDir(t);
  const store = new Store(dir);
  closeLater(t, store);
  for (let i = 0; i < 300; i++) store.put("messages", { id: "m" + i, missionId: "chat-" + (i % 7), role: i % 2 ? "assistant" : "user", text: "mensaje " + i, at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() });
  for (let i = 0; i < 300; i += 3) store.remove("messages", "m" + i); // gaps in the rowids
  store.put("messages", { id: "m-late", missionId: "chat-1", role: "user", text: "último", at: new Date().toISOString() });
  store.patch("messages", "m1", { text: "editado" }); // an update keeps its rowid
  await mkdir(path.join(dir, "workspaces", "chat-1", "proyecto", "node_modules", "x"), { recursive: true });
  await writeFile(path.join(dir, "workspaces", "chat-1", "informe.md"), "# Informe\nTodo bien.");
  await writeFile(path.join(dir, "workspaces", "chat-1", "datos.bin"), Buffer.alloc(3 * 1024 * 1024 + 17, 7)); // crosses chunks
  await writeFile(path.join(dir, "workspaces", "chat-1", "proyecto", "node_modules", "x", "big.js"), "skip me");
  await mkdir(path.join(dir, "bots", "nora"), { recursive: true });
  await writeFile(path.join(dir, "bots", "nora", "SOUL.md"), "Soy Nora.");
  await writeFile(path.join(dir, "USER.md"), "Le gusta el café.");
  await mkdir(path.join(dir, "peers"), { recursive: true });
  await writeFile(path.join(dir, "peers", "identity.json"), JSON.stringify({ sign: { pub: "PUB-A", priv: "fixture-only" } }));
  return { dir, store };
}

test("a backup round trip keeps every file, the rows and their insertion order", async (t) => {
  const { dir, store } = await filled(t);
  const keys = await newMasterKey(PASSWORD, FAST);
  const target = path.join(await dataDir(t, "colmena-out-"), "copia.colmena-backup");
  const made = await createBackup({ store, target, ...keys, identity: { sign: { pub: "PUB-A" } } });
  assert.ok(made.bytes > 3 * 1024 * 1024);
  const raw = await readFile(target);
  assert.equal(raw.includes(Buffer.from("Le gusta el café")), false, "nothing readable in the file");
  assert.equal(raw.includes(Buffer.from("mensaje 1")), false);
  const { header } = await readHeader(target);
  assert.equal(header.kdf.name, "scrypt");
  assert.equal(header.identity, true);
  assert.equal(JSON.stringify(header).includes("mensaje"), false, "the header says nothing about the content");

  const staging = path.join(await dataDir(t, "colmena-stage-"), "s");
  const out = await extractBackup(target, PASSWORD, staging);
  assert.equal(out.identity, null, "the identity stays sealed unless asked for");
  assert.equal(out.hasIdentity, true);
  assert.equal(await readFile(path.join(staging, "USER.md"), "utf8"), "Le gusta el café.");
  assert.equal(await readFile(path.join(staging, "bots", "nora", "SOUL.md"), "utf8"), "Soy Nora.");
  assert.equal((await stat(path.join(staging, "workspaces", "chat-1", "datos.bin"))).size, 3 * 1024 * 1024 + 17);
  assert.equal(existsSync(path.join(staging, "workspaces", "chat-1", "proyecto", "node_modules")), false, "dependency folders are left out");
  assert.equal(existsSync(path.join(staging, "peers")), false, "the identity never goes in as a plain file");
  const source = inspectDatabase(path.join(dir, "colmena.sqlite"));
  assert.equal(out.db.integrity, "ok");
  assert.equal(out.db.rows, source.rows);
  assert.equal(out.db.order, source.order, "same rowids, same order");
  const withId = await extractBackup(target, PASSWORD, path.join(path.dirname(staging), "s2"), { withIdentity: true });
  assert.deepEqual(withId.identity, { sign: { pub: "PUB-A" } });
});

test("a wrong password, an edited byte or a cut file never restore anything", async (t) => {
  const { store } = await filled(t);
  const out = await dataDir(t, "colmena-out-");
  const target = path.join(out, "copia.colmena-backup");
  await createBackup({ store, target, ...(await newMasterKey(PASSWORD, FAST)) });
  const stage = (name) => path.join(out, name);
  await assert.rejects(extractBackup(target, "otra-contraseña", stage("a")), (e) => e.status === 401 && /contraseña no es correcta/.test(e.message));
  // One byte changed in the middle of the encrypted data.
  const tampered = path.join(out, "tocada.colmena-backup");
  const bytes = await readFile(target);
  bytes[Math.floor(bytes.length / 2)] ^= 1;
  await writeFile(tampered, bytes);
  await assert.rejects(extractBackup(tampered, PASSWORD, stage("b")), /dañada|incompleta/);
  // Cut before its last chunk.
  const cut = path.join(out, "cortada.colmena-backup");
  await writeFile(cut, (await readFile(target)).subarray(0, bytes.length - 2 * 1024 * 1024));
  await assert.rejects(extractBackup(cut, PASSWORD, stage("c")), /dañada|incompleta/);
  await assert.rejects(readHeader(path.join(out, "no-existe.colmena-backup")), (e) => e.status === 404);
  await writeFile(path.join(out, "otra.colmena-backup"), "hola");
  await assert.rejects(readHeader(path.join(out, "otra.colmena-backup")), /no es una copia de Colmena|incompleta/);
});

test("restoring on a new computer: staged, applied at start, history and order back, the old data kept apart", async (t) => {
  const { dir, store } = await filled(t);
  const source = inspectDatabase(path.join(dir, "colmena.sqlite"));
  const sourceRows = store.list("messages").map((m) => m.id);
  const keys = await newMasterKey(PASSWORD, FAST);
  const target = path.join(await dataDir(t, "colmena-out-"), "copia.colmena-backup");
  const identity = JSON.parse(await readFile(path.join(dir, "peers", "identity.json"), "utf8"));
  await createBackup({ store, target, ...keys, identity });

  // The new computer already has a fresh Colmena with something of its own.
  const fresh = await dataDir(t, "colmena-new-");
  const other = new Store(fresh);
  other.put("messages", { id: "nuevo", missionId: "x", role: "user", text: "de este PC", at: new Date().toISOString() });
  const backups = new Backups({ store: other, vault: () => null });
  const staged = await backups.stage({ file: target, password: PASSWORD, identity: true });
  assert.equal(staged.identity, true);
  assert.equal(staged.rows, source.rows);
  assert.ok(backups.pending(), "waiting for the next start");
  other.close();

  const applied = await applyPendingRestore(fresh);
  assert.equal(applied.applied, true);
  assert.equal(applied.identity, true);
  assert.equal(inspectDatabase(path.join(fresh, "colmena.sqlite")).order, source.order);
  const reopened = new Store(fresh);
  closeLater(t, reopened);
  assert.deepEqual(reopened.list("messages").map((m) => m.id), sourceRows, "the history in its order");
  assert.equal(reopened.get("messages", "nuevo"), null);
  assert.equal(await readFile(path.join(fresh, "workspaces", "chat-1", "informe.md"), "utf8"), "# Informe\nTodo bien.");
  assert.deepEqual(JSON.parse(await readFile(path.join(fresh, "peers", "identity.json"), "utf8")), identity, "your Personas address is back");
  const aside = readdirSync(fresh).find((n) => n.startsWith("before-restore-"));
  assert.ok(aside && existsSync(path.join(fresh, aside, "colmena.sqlite")), "what was there is kept apart");
  assert.equal(existsSync(path.join(fresh, "restore-pending.json")), false);
  assert.equal(await applyPendingRestore(fresh), null, "applied once");
});

test("automatic backups keep the newest N with a saved key, never the password", async (t) => {
  const { dir, store } = await filled(t);
  const folder = path.join(await dataDir(t, "colmena-drive-"), "Copias de Colmena");
  let clock = Date.UTC(2026, 9, 1, 9);
  const backups = new Backups({ store, vault: () => null, clock: () => clock });
  backups.save({ folder, schedule: "daily", keep: 2 });
  assert.equal(backups.due(), false, "no key yet: nothing runs on its own");
  await backups.setPassword(PASSWORD);
  const keyFile = await readFile(path.join(dir, "backup", "key.json"), "utf8");
  assert.equal(keyFile.includes(PASSWORD), false, "the password is not stored");
  assert.equal(backups.due(), true);
  for (let day = 0; day < 3; day++) {
    clock += 24 * 3600000;
    assert.ok(await backups.tick(), "day " + day);
    assert.equal(backups.due(), false);
  }
  const view = await backups.view();
  assert.equal(view.backups.length, 2, "only the newest two automatic ones");
  assert.ok(view.backups.every((b) => b.name.startsWith("colmena-auto-")));
  assert.equal(JSON.stringify(view).includes(PASSWORD), false);
  assert.equal(view.hasPassword, true);
  // Restorable with the password itself.
  const out = await extractBackup(view.backups[0].path, PASSWORD, path.join(folder, "..", "check"));
  assert.equal(out.db.integrity, "ok");
  await backups.forgetPassword();
  assert.equal(existsSync(path.join(dir, "backup", "key.json")), false);
  assert.equal((await backups.view()).schedule, "off");
});

test("the routes: password, a backup now, its file, staging a restore and cancelling it", async (t) => {
  const { dir, store } = await filled(t);
  const folder = path.join(await dataDir(t, "colmena-docs-"), "Copias de Colmena");
  const runtime = new Runtime(store, { respond: async () => ({ text: "x", output: [] }) }, null, { seed: false });
  const backups = new Backups({ store, vault: () => null });
  let origin;
  const server = http.createServer(createApp({ store, runtime, session: { status: () => null }, getOrigin: () => origin, backups }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  later(t, async () => { await runtime.shutdown(); server.closeAllConnections(); await new Promise((r) => server.close(r)); });
  const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
  const send = (method, route, body) => fetch(origin + "/api" + route, { method, headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: JSON.stringify(body || {}) });
  assert.equal((await send("PUT", "/backup/settings", { schedule: "daily" })).status, 409, "automatic needs a password first");
  assert.equal((await send("PUT", "/backup/settings", { folder: "relativa" })).status, 422);
  assert.equal((await send("PUT", "/backup/settings", { folder })).status, 200);
  assert.equal((await send("POST", "/backup/password", { password: "corta" })).status, 400);
  assert.equal((await send("POST", "/backup/password", { password: PASSWORD })).status, 200);
  const run = await (await send("POST", "/backup/run")).json();
  assert.ok(run.file.startsWith(folder));
  const view = await (await fetch(origin + "/api/backup")).json();
  assert.equal(view.backups.length, 1);
  assert.equal(view.hasPassword, true);
  const file = await fetch(origin + "/api/backup/file/" + encodeURIComponent(view.backups[0].name));
  assert.equal(file.status, 200);
  assert.ok((await file.arrayBuffer()).byteLength > 1000);
  assert.equal((await fetch(origin + "/api/backup/file/..%2F..%2Fcolmena.sqlite")).status, 404);
  assert.equal((await send("POST", "/backup/restore", { path: run.file, password: "mal-contraseña" })).status, 401);
  const staged = await (await send("POST", "/backup/restore", { path: run.file, password: PASSWORD })).json();
  assert.equal(staged.identity, false);
  assert.ok(existsSync(path.join(dir, "restore-pending.json")));
  assert.ok((await (await fetch(origin + "/api/backup")).json()).pending);
  await send("DELETE", "/backup/restore");
  assert.equal(existsSync(path.join(dir, "restore-pending.json")), false);
  assert.equal(readdirSync(dir).some((n) => n.startsWith("restore-staging-")), false, "the staged copy is gone");
  void open;
});
