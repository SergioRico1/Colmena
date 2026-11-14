// The store's driver seam (server/store-driver.mjs) and the in-Node fake of Durable Object SQL
// (server/do-sql-fake.mjs): the same Store on node:sqlite and on DO SQL (docs/CLOUD.md).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FakeDurableStorage, splitStatements } from "../server/do-sql-fake.mjs";
import { Store, StoreKeyError } from "../server/store.mjs";
import { DoDriver, NodeDriver } from "../server/store-driver.mjs";

const temp = (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "colmena-driver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const KEY = Buffer.alloc(32, 7);

test("the fake keeps the rules of DO SQL: no SQL transactions, no platform PRAGMAs, ArrayBuffer blobs", () => {
  const storage = new FakeDurableStorage();
  const sql = storage.sql;
  for (const text of ["BEGIN", "begin immediate", "COMMIT", "ROLLBACK", "SAVEPOINT a", "RELEASE a", "  -- c\nBEGIN"])
    assert.throws(() => sql.exec(text), /transactionSync/);
  for (const text of ["PRAGMA journal_mode=WAL", "PRAGMA synchronous", "VACUUM", "ATTACH 'x' AS y"]) assert.throws(() => sql.exec(text), /not authorized/);
  assert.deepEqual(sql.exec("PRAGMA table_list").columnNames.includes("name"), true);
  sql.exec("CREATE TABLE t (a INTEGER PRIMARY KEY, b TEXT, c BLOB); INSERT INTO t(b) VALUES('x;y')");
  assert.throws(() => sql.exec("INSERT INTO t(c) VALUES(?)", new Uint8Array([1])), /ArrayBuffer/);
  const written = sql.exec("INSERT INTO t(b, c) VALUES(?, ?)", "z", new Uint8Array([1, 2]).buffer);
  assert.equal(written.rowsWritten, 1);
  const rows = sql.exec("SELECT a, b, c FROM t ORDER BY a").toArray();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].b, "x;y");
  assert.ok(rows[1].c instanceof ArrayBuffer);
  assert.deepEqual(sql.exec("SELECT b FROM t WHERE a=1").raw().toArray(), [["x;y"]]);
  assert.throws(() => sql.exec("SELECT b FROM t").one(), /multiple/);
  assert.throws(() => sql.exec("SELECT b FROM t WHERE a=9").one(), /no results/);
  assert.deepEqual([...sql.exec("SELECT a FROM t ORDER BY a")].map((r) => r.a), [1, 2]);
  assert.deepEqual(splitStatements("SELECT ';'; /* ; */ SELECT \"a;\" -- ;\n; "), ["SELECT ';'", "/* ; */ SELECT \"a;\" -- ;"]);
  // transactionSync: all or nothing, nested calls are savepoints.
  assert.throws(() => storage.transactionSync(() => { sql.exec("INSERT INTO t(b) VALUES('gone')"); throw Error("boom"); }), /boom/);
  storage.transactionSync(() => {
    sql.exec("INSERT INTO t(b) VALUES('kept')");
    assert.throws(() => storage.transactionSync(() => { sql.exec("INSERT INTO t(b) VALUES('inner')"); throw Error("inner"); }));
  });
  assert.deepEqual(sql.exec("SELECT b FROM t WHERE b IN ('gone','kept','inner')").toArray().map((r) => r.b), ["kept"]);
  storage.close();
});

for (const encrypted of [false, true]) {
  test(`the same Store on the DO adapter${encrypted ? ", encrypted by a key provider" : ""}`, (t) => {
    const dir = temp(t);
    const storage = new FakeDurableStorage(path.join(dir, "do.sqlite"));
    const open = () => new Store(null, { driver: new DoDriver(storage), keyProvider: encrypted ? () => KEY : null });
    const store = open();
    assert.equal(store.encrypted, encrypted);
    assert.equal(store.directory, null);
    assert.ok(store.list("bots").length >= 6, "seeded");
    const heard = [];
    store.listeners.add((c) => heard.push(c));
    store.put("messages", { id: "m1", missionId: "c1", shareId: "s", at: "2026-01-01T00:00:00.000Z", text: "hola" });
    store.put("messages", { id: "m2", missionId: "c1", shareId: "s", at: "2026-01-02T00:00:00.000Z", text: "adiós" });
    assert.equal(store.get("messages", "m1").text, "hola");
    assert.deepEqual(store.where("messages", "missionId", "c1").map((m) => m.id), ["m1", "m2"]);
    assert.deepEqual(store.ordered("messages", "shareId", "s", { limit: 1 }).map((m) => m.id), ["m2"]);
    assert.deepEqual(store.columns("messages", ["id", "missionId"]), [{ id: "m1", missionId: "c1" }, { id: "m2", missionId: "c1" }]);
    // A failed transaction leaves nothing and tells nobody.
    const before = heard.length;
    assert.throws(() => store.tx(() => { store.put("messages", { id: "m3" }); store.tx(() => store.remove("messages", "m1")); throw Error("no"); }), /no/);
    assert.equal(store.get("messages", "m3"), null);
    assert.ok(store.get("messages", "m1"));
    assert.equal(heard.length, before);
    store.patch("messages", "m1", { text: "hola de nuevo" });
    assert.equal(store.get("messages", "m1").text, "hola de nuevo");
    const e = store.event("c1", "step", { n: 1 });
    assert.ok(e.seq > 0);
    assert.equal(store.event("c1", "step", { n: 2 }).seq, e.seq + 1);
    assert.deepEqual(store.events("c1").map((x) => x.n), [1, 2]);
    assert.equal(store.remove("messages", "m2"), true);
    assert.equal(store.remove("messages", "m2"), false);
    assert.equal(store.purgeEvents(30, Date.now() + 40 * 86400000), 2);
    store.maintain();
    // Reopened on the same storage (a Durable Object waking up): same data.
    const again = open();
    assert.equal(again.get("messages", "m1").text, "hola de nuevo");
    if (encrypted) {
      assert.throws(() => new Store(null, { driver: new DoDriver(storage), keyProvider: () => Buffer.alloc(32, 1) }), StoreKeyError);
      const raw = storage.sql.exec("SELECT data FROM records WHERE kind='messages'").toArray();
      assert.ok(raw.every((r) => r.data instanceof ArrayBuffer && !Buffer.from(r.data).toString("latin1").includes("hola")));
    }
    storage.close();
  });
}

test("a host that requires encryption never opens a plain database", (t) => {
  const dir = temp(t);
  const storage = new FakeDurableStorage(path.join(dir, "do.sqlite"));
  new Store(null, { driver: new DoDriver(storage) });
  assert.throws(() => new Store(null, { driver: new DoDriver(storage), keyProvider: () => KEY }), StoreKeyError);
  storage.close();
});

test("the default driver is node:sqlite with WAL", { skip: process.env.COLMENA_STORE_DRIVER === "do-fake" && "the suite runs on the DO fake" }, (t) => {
  const store = new Store(temp(t));
  assert.ok(store.db instanceof NodeDriver);
  assert.equal(store.db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
  store.close();
});
