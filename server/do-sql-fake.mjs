// An in-Node stand-in for a SQLite-backed Durable Object's storage (DurableObjectStorage):
// `sql` (SqlStorage) and `transactionSync`, on a node:sqlite file, with the DO rules the store
// has to live with (store-driver.mjs › DoDriver, docs/CLOUD.md):
//   - sql.exec(query, ...bindings) runs now and returns a cursor: toArray(), one(), raw(),
//     next(), iteration, columnNames, rowsRead, rowsWritten;
//   - several statements may go in one exec (without bindings); the cursor is the last one's;
//   - BEGIN / COMMIT / ROLLBACK / SAVEPOINT / RELEASE are refused: transactions only through
//     transactionSync(fn) (nested calls become savepoints);
//   - only harmless PRAGMAs are allowed (journal, sync, vacuum and checkpoint ones are the
//     platform's); ATTACH, DETACH and VACUUM are refused;
//   - blobs bind as ArrayBuffer and come back as ArrayBuffer (typed arrays are refused here, so
//     an adapter that forgets to convert fails in tests and not in production);
//   - the platform's limits: 2 MB per bound string or blob, 100 bindings, 100 KB of SQL.
// rowsRead / rowsWritten are approximations (rows returned / rows changed): node:sqlite does not
// expose SQLite's own counters. Used by COLMENA_STORE_DRIVER=do-fake and by tests.
const builtin = (name) => {
  const mod = globalThis.process?.getBuiltinModule?.(name);
  if (!mod) throw Error(`${name} is not available in this runtime.`);
  return mod;
};

const TX_MESSAGE = "To execute a transaction, please use the state.storage.transaction() or state.storage.transactionSync() APIs instead of the SQL BEGIN TRANSACTION or SAVEPOINT statements. The JavaScript API is safer because it will automatically roll back on exceptions, and because it interacts correctly with Durable Objects' automatic atomic write coalescing.";
const MAX_VALUE = 2 * 1024 * 1024;
const PRAGMAS = new Set(["table_list", "table_info", "table_xinfo", "index_list", "index_info", "index_xinfo", "foreign_key_list", "foreign_keys", "defer_foreign_keys", "legacy_alter_table", "quick_check", "optimize", "case_sensitive_like", "reverse_unordered_selects", "ignore_check_constraints", "data_version", "page_count", "page_size", "freelist_count"]);

/** Splits SQL text into statements (quotes and comments respected; no trigger bodies). */
export function splitStatements(text) {
  const out = [];
  let start = 0, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "'" || c === '"' || c === "`") {
      const end = text.indexOf(c, i + 1);
      i = end < 0 ? text.length : end + 1;
      // A doubled quote is an escaped one: the scan simply continues past it.
    } else if (c === "[") {
      const end = text.indexOf("]", i + 1);
      i = end < 0 ? text.length : end + 1;
    } else if (c === "-" && text[i + 1] === "-") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end + 1;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (c === ";") {
      out.push(text.slice(start, i));
      start = ++i;
    } else i++;
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter((s) => s && !/^(--[^\n]*\n?|\/\*[\s\S]*?\*\/|\s)*$/.test(s));
}

function guard(statement) {
  const head = statement.replace(/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
  const word = (/^[A-Za-z]+/.exec(head)?.[0] || "").toUpperCase();
  if (["BEGIN", "COMMIT", "END", "ROLLBACK", "SAVEPOINT", "RELEASE"].includes(word)) throw Error(TX_MESSAGE);
  if (["ATTACH", "DETACH", "VACUUM"].includes(word)) throw Error("not authorized: SQLITE_AUTH");
  if (word === "PRAGMA") {
    const name = (/^PRAGMA\s+(?:\w+\.)?(\w+)/i.exec(head)?.[1] || "").toLowerCase();
    if (!PRAGMAS.has(name)) throw Error("not authorized: SQLITE_AUTH");
  }
}

const toDo = (v) => (v instanceof Uint8Array ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v);
function toNode(v) {
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) throw TypeError("Unsupported binding type: pass blobs to Durable Object SQL as ArrayBuffer.");
  if (v === undefined) throw TypeError("Unsupported binding type: undefined.");
  return v;
}

class FakeCursor {
  constructor(columns, rows, written) {
    this.columnNames = columns;
    this.rows = rows;
    this.at = 0;
    this.rowsRead = rows.length;
    this.rowsWritten = written;
  }
  next() {
    if (this.at >= this.rows.length) return { done: true, value: undefined };
    return { done: false, value: this.rows[this.at++] };
  }
  [Symbol.iterator]() { return this; }
  toArray() {
    const rest = this.rows.slice(this.at);
    this.at = this.rows.length;
    return rest;
  }
  one() {
    const rest = this.toArray();
    if (rest.length === 0) throw Error("Expected exactly one result from SQL query, but got no results.");
    if (rest.length > 1) throw Error("Expected exactly one result from SQL query, but got multiple results.");
    return rest[0];
  }
  raw() {
    const names = this.columnNames, self = this;
    return {
      next() { const n = self.next(); return n.done ? n : { done: false, value: names.map((k) => n.value[k]) }; },
      [Symbol.iterator]() { return this; },
      toArray() { return self.toArray().map((r) => names.map((k) => r[k])); },
    };
  }
}

export class FakeSqlStorage {
  constructor(db) { this.db = db; }
  exec(query, ...bindings) {
    const statements = splitStatements(String(query));
    if (!statements.length) return new FakeCursor([], [], 0);
    if (statements.length > 1 && bindings.length) throw Error("A query with several statements cannot take bindings.");
    statements.forEach(guard);
    // DO SQL limits: 100 bound parameters per query, 2 MB per string or BLOB, 100 KB of SQL.
    if (bindings.length > 100) throw Error("too many SQL variables: SQLITE_ERROR");
    if (String(query).length > 100 * 1024) throw Error("string or blob too big: SQLITE_TOOBIG");
    for (const v of bindings) {
      const size = typeof v === "string" ? Buffer.byteLength(v) : v instanceof ArrayBuffer ? v.byteLength : 0;
      if (size > MAX_VALUE) throw Error(`string or blob too big: SQLITE_TOOBIG (${size} bytes; Durable Objects allow ${MAX_VALUE})`);
    }
    let cursor = null;
    for (const text of statements) {
      const stmt = this.db.prepare(text);
      const columns = stmt.columns().map((c) => c.name);
      const args = bindings.map(toNode);
      if (columns.length) {
        // Plain objects (node:sqlite's have a null prototype), blobs as ArrayBuffer.
        const rows = stmt.all(...args).map((row) => {
          const out = {};
          for (const k in row) out[k] = toDo(row[k]);
          return out;
        });
        const written = /^\s*(INSERT|UPDATE|DELETE|REPLACE|WITH)\b/i.test(text) ? Number(this.db.prepare("SELECT changes() AS n").get().n) : 0;
        cursor = new FakeCursor(columns, rows, written);
      } else {
        const r = stmt.run(...args);
        cursor = new FakeCursor([], [], Number(r.changes));
      }
    }
    return cursor;
  }
  get databaseSize() {
    const r = this.db.prepare("SELECT page_count * page_size AS n FROM pragma_page_count(), pragma_page_size()").get();
    return Number(r.n);
  }
}

/** {sql, transactionSync} like a SQLite-backed Durable Object's ctx.storage, on the file `file`. */
export class FakeDurableStorage {
  constructor(file = ":memory:") {
    const { DatabaseSync } = builtin("node:sqlite");
    this.native = new DatabaseSync(file);
    this.sql = new FakeSqlStorage(this.native);
    this.depth = 0;
    // A real one is never empty: the platform keeps its key-value API in a table of its own.
    this.native.exec("CREATE TABLE IF NOT EXISTS _cf_KV (key TEXT PRIMARY KEY, value BLOB) WITHOUT ROWID");
  }
  transactionSync(fn) {
    const level = this.depth++;
    const name = "fake_do_tx_" + level;
    this.native.exec(level === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${name}`);
    try {
      const result = fn();
      this.native.exec(level === 0 ? "COMMIT" : `RELEASE ${name}`);
      return result;
    } catch (error) {
      try { this.native.exec(level === 0 ? "ROLLBACK" : `ROLLBACK TO ${name}; RELEASE ${name}`); } catch {}
      throw error;
    } finally {
      this.depth--;
    }
  }
  close() { this.native.close(); }
}
