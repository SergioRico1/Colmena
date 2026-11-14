// The store's SQL driver (store.mjs runs on it): the small slice of node:sqlite's DatabaseSync
// the store and its few raw-SQL callers use, so the same Store runs on
//   - node:sqlite (the desktop; the default, unchanged behaviour), or
//   - a Durable Object's SQLite (`ctx.storage.sql` + `ctx.storage.transactionSync`), which is
//     synchronous too, so no call site has to become async (docs/CLOUD.md).
//
// A driver is {kind, prepare(sql) → statement, exec(sql), transaction(fn), isTransaction,
// setup({fresh}), maintain(), close(), native?}; a statement is {all, get, run, iterate} with
// node:sqlite's shapes (run → {changes, lastInsertRowid}). `native` is the DatabaseSync itself
// (node only: online backups need it).
//
// node:sqlite is loaded with process.getBuiltinModule, never imported: this module (and so the
// store) also loads in workerd, where node:sqlite does not exist.
import path from "node:path";
import { FakeDurableStorage } from "./do-sql-fake.mjs";

const builtin = (name) => {
  const mod = globalThis.process?.getBuiltinModule?.(name);
  if (!mod) throw Error(`${name} is not available in this runtime.`);
  return mod;
};

/** node:sqlite on the file `file` (the desktop). */
export class NodeDriver {
  constructor(file) {
    const { DatabaseSync } = builtin("node:sqlite");
    this.kind = "node";
    this.native = new DatabaseSync(file);
  }
  prepare(text) { return this.native.prepare(text); }
  exec(text) { this.native.exec(text); }
  get isTransaction() { return this.native.isTransaction; }
  /** Runs `fn` in BEGIN IMMEDIATE … COMMIT (ROLLBACK when it throws, or when COMMIT fails). */
  transaction(fn) {
    this.native.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.native.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.native.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }
  /**
   * T3 Code's set: WAL with synchronous=NORMAL (FULL waits for the disk on every commit and
   * stalls the event loop; in WAL a crash can lose the last commit, never corrupt the file),
   * the WAL file kept under 32 MB, and space handed back in steps (incremental auto_vacuum,
   * which only a new database takes: see Store.maintain).
   */
  setup({ fresh }) {
    if (fresh) this.native.exec("PRAGMA auto_vacuum=INCREMENTAL;");
    this.native.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA journal_size_limit=33554432;");
  }
  /** Freed pages handed back a few at a time, the WAL folded into the file without blocking. */
  maintain() { this.native.exec("PRAGMA incremental_vacuum(1024); PRAGMA wal_checkpoint(PASSIVE);"); }
  close() { this.native.close(); }
}

// ---- Durable Object SQLite ------------------------------------------------------------------
// `storage` is a DurableObjectStorage (ctx.storage) or anything shaped like it (do-sql-fake.mjs):
// storage.sql.exec(query, ...bindings) → cursor {toArray, one, raw, rowsRead, rowsWritten, …};
// storage.transactionSync(fn). SQL BEGIN/COMMIT/SAVEPOINT are refused there, and so are most
// PRAGMAs: setup and maintain do nothing (the platform runs the database).

/** A binding as DO SQL takes it: blobs are ArrayBuffers. */
const bindValue = (v) => (ArrayBuffer.isView(v) ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v);
const bindAll = (args) => (args.some((v) => ArrayBuffer.isView(v)) ? args.map(bindValue) : args);

class DoStatement {
  constructor(driver, text) {
    this.driver = driver;
    this.text = text;
  }
  cursor(args) { return this.driver.sql.exec(this.text, ...bindAll(args)); }
  all(...args) { return this.cursor(args).toArray(); }
  get(...args) {
    const next = this.cursor(args).next();
    return next.done ? undefined : next.value;
  }
  iterate(...args) { return this.cursor(args); }
  run(...args) {
    this.cursor(args).toArray(); // run to the end (a cursor is lazy)
    const r = this.driver.sql.exec("SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid").one();
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }
}

export class DoDriver {
  /** `owned`: close() also closes `storage` (the in-Node fake; a real DO's storage is never closed). */
  constructor(storage, { owned = false } = {}) {
    if (!storage?.sql || typeof storage.transactionSync !== "function") throw Error("DoDriver needs a Durable Object storage (ctx.storage).");
    this.kind = "do";
    this.storage = storage;
    this.owned = owned;
    this.sql = storage.sql;
    this.depth = 0;
  }
  // DO SQL plans and caches statements by itself: a statement is just its text.
  prepare(text) { return new DoStatement(this, text); }
  exec(text) { this.sql.exec(text).toArray(); }
  get isTransaction() { return this.depth > 0; }
  transaction(fn) {
    this.depth++;
    try { return this.storage.transactionSync(fn); } finally { this.depth--; }
  }
  setup() {}
  maintain() {}
  close() { if (this.owned) this.storage.close?.(); }
}

/**
 * The driver a Store opens when it is given none: node:sqlite on `directory`/colmena.sqlite, or
 * with COLMENA_STORE_DRIVER=do-fake the DO adapter over the in-Node fake of DO SQL (tests).
 */
export function defaultDriver(directory) {
  builtin("node:fs").mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "colmena.sqlite");
  const mode = globalThis.process?.env?.COLMENA_STORE_DRIVER || "node";
  if (mode === "node") return new NodeDriver(file);
  if (mode === "do-fake") return new DoDriver(new FakeDurableStorage(file), { owned: true });
  throw Error(`Unknown COLMENA_STORE_DRIVER «${mode}» (node | do-fake).`);
}
