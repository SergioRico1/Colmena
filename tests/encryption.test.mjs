// Local encryption of the database (option A: db-crypto.mjs, db-key.mjs, encryption.mjs):
// records and events AES-256-GCM, only kind/id and a few index fields readable, every rowid
// kept, a migration that checks everything before committing, a missing key that never stops
// Colmena from starting, and backups that carry the key.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Store, StoreKeyError } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { encryptDatabase, encryptionOf, fingerprint } from "../server/db-crypto.mjs";
import { databaseKeys } from "../server/db-key.mjs";
import { Encryption, applyPendingEncryption, openStore } from "../server/encryption.mjs";
import { Backups } from "../server/backup-service.mjs";
import { applyPendingRestore } from "../server/backup.mjs";
import { searchHistory } from "../server/tools.mjs";
import { answer, call } from "./fixtures/runtime-fixture.mjs";

const SECRET = "Mi IBAN secreto es ES91 2100 0418 4502 0005 1332";
const PASSWORD = "caballo-grapa-bateria"; // fixture only

const cleanups = new WeakMap();
function later(t, fn) {
  if (!cleanups.has(t)) { cleanups.set(t, []); t.after(async () => { for (const f of cleanups.get(t).reverse()) await f(); }); }
  cleanups.get(t).push(fn);
}
async function dir(t, name = "colmena-enc-") {
  const d = await mkdtemp(path.join(os.tmpdir(), name));
  later(t, () => rm(d, { recursive: true, force: true }).catch(() => {}));
  return d;
}
const keep = (t, store) => { later(t, () => { try { store.close(); } catch {} }); return store; };
/** A plain Colmena with messages (gaps in rowids), steps, events and receipts. */
async function plain(t) {
  const d = await dir(t);
  const store = new Store(d);
  for (let i = 0; i < 4; i++) store.put("missions", { id: "c" + i, title: "Chat " + i, status: "completed", botIds: ["nora"], createdAt: new Date().toISOString() });
  for (let i = 0; i < 120; i++) store.put("messages", { id: "m" + i, missionId: "c" + (i % 4), role: i % 2 ? "assistant" : "user", text: i === 7 ? SECRET : "hola número " + i, at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() });
  for (let i = 0; i < 120; i += 5) store.remove("messages", "m" + i);
  store.put("steps", { id: "s1", missionId: "c1", botId: "nora", kind: "followup", status: "completed", history: [{ role: "user", content: SECRET }] });
  store.put("receipts", { id: "s1:c", tool: "web_fetch", status: "done", result: { text: "x".repeat(40000) }, at: "2026-01-01T00:00:00.000Z" });
  store.event("c1", "note", { text: SECRET });
  store.event("c2", "old", { text: "viejo" });
  store.close();
  return d;
}
const fileHas = async (d, text) => {
  const needle = Buffer.from(text);
  for (const name of ["colmena.sqlite", "colmena.sqlite-wal"]) if (existsSync(path.join(d, name)) && (await readFile(path.join(d, name))).includes(needle)) return true;
  return false;
};

test("migrating encrypts every record and event, keeps every rowid, and leaves nothing readable", async (t) => {
  const d = await plain(t);
  const before = new Store(d);
  const list = before.list("messages").map((m) => m.id);
  before.close();
  assert.equal(await fileHas(d, SECRET), true, "readable before");
  const key = randomBytes(32);
  const result = encryptDatabase(path.join(d, "colmena.sqlite"), key);
  assert.deepEqual(result.after.kinds, result.before.kinds);
  assert.equal(result.after.order, result.before.order, "same rowids, same order");
  assert.equal(result.after.integrity, "ok");
  assert.equal(encryptionOf(path.join(d, "colmena.sqlite")), "aes-256-gcm-v1");
  assert.equal(await fileHas(d, SECRET), false, "nothing readable in the database file nor its WAL");
  assert.equal(await fileHas(d, "hola número"), false);

  const store = keep(t, new Store(d, { key }));
  assert.equal(store.encrypted, true);
  assert.deepEqual(store.list("messages").map((m) => m.id), list, "the history in its order");
  assert.equal(store.get("messages", "m7").text, SECRET);
  assert.equal(store.where("messages", "missionId", "c3").length, list.filter((id) => Number(id.slice(1)) % 4 === 3).length);
  assert.equal(store.where("messages", "role", "user").length, list.filter((id) => Number(id.slice(1)) % 2 === 0).length, "a field outside the index still works");
  assert.deepEqual(store.columns("steps", ["missionId", "status", "botId", "kind"]), [{ missionId: "c1", status: "completed", botId: "nora", kind: "followup" }]);
  assert.equal(store.listWithout("steps", ["history"])[0].history, undefined);
  assert.equal(store.events("c1")[0].text, SECRET);
  // The missionId index is used, on the readable meta.
  const plan = store.db.prepare("EXPLAIN QUERY PLAN SELECT id, data FROM records WHERE kind=? AND json_extract(meta,'$.missionId')=?").all("messages", "c1").map((r) => r.detail).join(" ");
  assert.match(plan, /records_mission/);
  // New writes are encrypted too, and events keep going after the old last one.
  store.put("messages", { id: "nuevo", missionId: "c1", role: "user", text: "otro secreto 4242", at: new Date().toISOString() });
  const event = store.event("c1", "after", { text: "x" });
  assert.ok(event.seq > result.before.lastEvent);
  assert.equal(store.purgeEvents(30, Date.UTC(2026, 9, 1)), 0);
  assert.ok(store.purgeEvents(-1) >= 1, "purging by date still works");
  assert.equal(store.pruneReceipts(1, Date.UTC(2026, 9, 1), { max: 1000 }), 1, "old big tool bodies still slim");
  assert.equal(store.get("receipts", "s1:c").result.recortado, true);
  store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  assert.equal(await fileHas(d, "otro secreto 4242"), false);
  assert.ok(searchHistory(store, "IBAN secreto").length >= 1, "searching the history works without a readable index");
  assert.throws(() => encryptDatabase(path.join(d, "colmena.sqlite"), key), /ya está cifrada/);
});

test("without its key, or with another one, the database does not open; rows cannot be swapped", async (t) => {
  const d = await plain(t);
  const key = randomBytes(32);
  encryptDatabase(path.join(d, "colmena.sqlite"), key);
  assert.throws(() => new Store(d), (e) => e instanceof StoreKeyError && /no encuentro su clave/.test(e.message));
  assert.throws(() => new Store(d, { key: randomBytes(32) }), (e) => e instanceof StoreKeyError && /no abre/.test(e.message));
  // Someone swaps two encrypted rows: they no longer decrypt.
  const raw = new DatabaseSync(path.join(d, "colmena.sqlite"));
  const a = raw.prepare("SELECT data FROM records WHERE kind='messages' AND id='m1'").get().data;
  raw.prepare("UPDATE records SET data=? WHERE kind='messages' AND id='m2'").run(a);
  raw.close();
  const store = keep(t, new Store(d, { key }));
  assert.throws(() => store.get("messages", "m2"));
  assert.equal(store.get("messages", "m3").text, "hola número 3");
});

test("a missing key never stops Colmena: the encrypted database is set aside and a new one opens", async (t) => {
  const d = await plain(t);
  encryptDatabase(path.join(d, "colmena.sqlite"), randomBytes(32));
  const keys = databaseKeys(d, { vault: null, platform: "linux" }); // empty slots
  const { store, locked } = await openStore(d, keys);
  keep(t, store);
  assert.ok(locked);
  assert.equal(store.encrypted, false);
  assert.equal(store.get("messages", "m1"), null, "a fresh database");
  assert.ok(existsSync(path.join(d, locked.folder, "colmena.sqlite")), "the encrypted one is kept");
  assert.ok(existsSync(path.join(d, "locked.json")));
});

test("«Cifrar este ordenador»: a backup first, the key in the system vault, applied at the next start", async (t) => {
  const d = await plain(t);
  const keys = databaseKeys(d, { vault: null, platform: "linux" });
  let store = new Store(d);
  const backups = new Backups({ store, vault: () => null, keys });
  backups.save({ folder: path.join(await dir(t, "colmena-drive-"), "Copias") });
  const encryption = new Encryption({ store, keys, backups });
  await assert.rejects(encryption.prepare(), /contraseña de las copias/, "never without a backup password");
  await backups.setPassword(PASSWORD);
  const prepared = await encryption.prepare();
  assert.ok(existsSync(prepared.backup), "a backup made just before");
  assert.equal(prepared.keyStore, "file");
  assert.ok(await keys.load("db-key"));
  assert.equal(encryption.status().pending.backup, prepared.backup);
  store.close();

  const applied = await applyPendingEncryption(d, keys);
  assert.equal(applied.done, true);
  assert.equal(await applyPendingEncryption(d, keys), null, "once");
  const opened = await openStore(d, keys);
  store = keep(t, opened.store);
  assert.equal(opened.locked, null);
  assert.equal(store.encrypted, true);
  assert.equal(store.get("messages", "m7").text, SECRET);
  const status = new Encryption({ store, keys, backups: new Backups({ store, vault: () => null, keys }) }).status();
  assert.equal(status.encrypted, true);
  assert.ok(status.encryptedAt);
  assert.ok(status.done);
  assert.ok(status.readable.includes("missionId"), "the app says what stays readable");
});

test("a failed migration leaves the database exactly as it was", async (t) => {
  const d = await plain(t);
  const file = path.join(d, "colmena.sqlite");
  const raw = new DatabaseSync(file);
  const before = fingerprint(raw);
  raw.close();
  // A row goes missing half-way: the count check fails and everything rolls back.
  assert.throws(() => encryptDatabase(file, randomBytes(32), { beforeChecks: (db) => db.exec("DELETE FROM records WHERE kind='messages' AND id='m1'") }), /recuento/);
  assert.equal(encryptionOf(file), null);
  const again = new DatabaseSync(file);
  const after = fingerprint(again);
  const m1 = again.prepare("SELECT data FROM records WHERE kind='messages' AND id='m1'").get();
  again.close();
  assert.deepEqual(after, before, "nothing was changed");
  assert.match(m1.data, /hola número 1/);
  // Through the startup path (here: the prepared key is gone), it reports the failure and Colmena opens the plain database.
  const keys = databaseKeys(d, { vault: null, platform: "linux" });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(path.join(d, "encrypt-pending.json"), "{}");
  const result = await applyPendingEncryption(d, keys);
  assert.equal(result.failed, true);
  assert.ok(existsSync(path.join(d, "encrypt-failed.json")));
  const { store } = await openStore(d, keys);
  keep(t, store);
  assert.equal(store.encrypted, false);
});

test("a backup of an encrypted Colmena carries its key: restored on a new computer, it opens", async (t) => {
  const d = await plain(t);
  const keysA = databaseKeys(d, { vault: null, platform: "linux" });
  const key = randomBytes(32);
  await keysA.save("db-key", key);
  encryptDatabase(path.join(d, "colmena.sqlite"), key);
  const store = keep(t, new Store(d, { key }));
  const backups = new Backups({ store, vault: () => null, keys: keysA });
  backups.save({ folder: path.join(await dir(t, "colmena-drive-"), "Copias") });
  await backups.setPassword(PASSWORD);
  const made = await backups.run();

  const fresh = await dir(t, "colmena-new-");
  const keysB = databaseKeys(fresh, { vault: null, platform: "linux" });
  const other = new Store(fresh);
  const staged = await new Backups({ store: other, vault: () => null, keys: keysB }).stage({ file: made.file, password: PASSWORD });
  assert.equal(staged.dbKey, true);
  other.close();
  await applyPendingRestore(fresh, { keys: keysB });
  assert.ok((await keysB.load("db-key")).equals(key), "the key came with the backup");
  assert.equal(await keysB.load("db-key-restore"), null);
  const { store: restored, locked } = await openStore(fresh, keysB);
  keep(t, restored);
  assert.equal(locked, null);
  assert.equal(restored.encrypted, true);
  assert.equal(restored.get("messages", "m7").text, SECRET);
  assert.deepEqual(restored.list("messages").map((m) => m.id), store.list("messages").map((m) => m.id));
});

test("a bot works as before on an encrypted database", async (t) => {
  const d = await plain(t);
  const key = randomBytes(32);
  encryptDatabase(path.join(d, "colmena.sqlite"), key);
  const store = keep(t, new Store(d, { key }));
  store.patch("settings", "main", { model: "fixture", learning: false });
  let round = 0;
  const runtime = new Runtime(store, { respond: async () => (++round === 1 ? call("create_deliverable", { title: "Informe", kind: "document", format: "md", content: "# Secreto 9191" }, "d1") : answer("Hecho.")) }, null, { seed: false });
  later(t, () => runtime.shutdown());
  const m = runtime.create({ prompt: "Haz el informe", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).status, "completed");
  assert.equal(store.where("artifacts", "missionId", m.id).find((a) => a.title === "Informe").content, "# Secreto 9191");
  assert.equal(store.where("receipts", "status", "done").length >= 1, true);
  store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  assert.equal(await fileHas(d, "Secreto 9191"), false);
  void readdirSync;
});
