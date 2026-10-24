// Local encryption of Colmena's database (Ajustes › Privacidad y datos › «Cifrado de este
// ordenador»), option A of docs/ARCHITECTURE.md: every record's `data` (and every event) is
// AES-256-GCM with a 32-byte key kept by the system (Windows DPAPI, macOS Keychain:
// db-key.mjs). What stays readable is only what SQLite needs to find records: `kind`, `id`
// and `meta`, a small JSON with the index fields below (mission, status, bot, dates…). Each
// ciphertext is bound to its kind and id, so rows cannot be swapped between records.
//
// encryptDatabase() turns a plain database into an encrypted one in a single transaction with
// secure_delete on, keeping every rowid (the store's order), and checks — before committing —
// the rows per kind, the order fingerprint and that every row decrypts to exactly what it was.
// Any difference rolls everything back and the database stays as it was. Never VACUUM.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export const ENCRYPTION = "aes-256-gcm-v1";
const VERSION_BYTE = 1;
// Fields kept readable in `meta` so where()/columns() and the mission index work without decrypting.
export const META_FIELDS = Object.freeze(["missionId", "status", "botId", "kind", "stepId", "taskId", "shareId", "thread", "targetId", "automationId", "task", "createdAt", "at"]);
const META = new Set(META_FIELDS);
const CANARY = "colmena-database-key-check";

/** The readable index fields of a record (only scalar values). */
export function metaOf(record) {
  const out = {};
  for (const f of META_FIELDS) {
    const v = record?.[f];
    if (v !== undefined && v !== null && typeof v !== "object") out[f] = v;
  }
  return JSON.stringify(out);
}
export const isMetaField = (field) => META.has(field);

/** {encrypt(text, aad) → Buffer, decrypt(blob, aad) → text} with `key` (32 bytes). */
export function recordCipher(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw Error("La clave de la base de datos no es válida.");
  return {
    encrypt(text, aad) {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      c.setAAD(Buffer.from(aad, "utf8"));
      const body = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
      return Buffer.concat([Buffer.from([VERSION_BYTE]), iv, c.getAuthTag(), body]);
    },
    decrypt(blob, aad) {
      const b = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
      if (b[0] !== VERSION_BYTE) throw Error("Registro cifrado con un formato desconocido.");
      const d = createDecipheriv("aes-256-gcm", key, b.subarray(1, 13));
      d.setAAD(Buffer.from(aad, "utf8"));
      d.setAuthTag(b.subarray(13, 29));
      return Buffer.concat([d.update(b.subarray(29)), d.final()]).toString("utf8");
    },
  };
}
export const recordAad = (kind, id) => "record\u0000" + kind + "\u0000" + id;
export const eventAad = (mission) => "event\u0000" + (mission ?? "");

/** The encryption a database file says it has ("aes-256-gcm-v1"), or null for a plain (or missing) one. */
export function encryptionOf(file) {
  if (!existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const has = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='colmena_meta'").get();
    return has ? db.prepare("SELECT value FROM colmena_meta WHERE key='encryption'").get()?.value || null : null;
  } finally { db.close(); }
}
/** Whether `key` opens a database (its canary decrypts). */
export function checkKey(db, cipher) {
  const row = db.prepare("SELECT value FROM colmena_meta WHERE key='canary'").get();
  if (!row) return false;
  try { return cipher.decrypt(Buffer.from(row.value, "base64"), "canary") === CANARY; } catch { return false; }
}

/** Rows per kind, insertion-order fingerprint and integrity of an open database. */
export function fingerprint(db) {
  const kinds = {};
  for (const r of db.prepare("SELECT kind, count(*) AS n FROM records GROUP BY kind").all()) kinds[r.kind] = r.n;
  const hash = createHash("sha256");
  for (const r of db.prepare("SELECT rowid, kind, id FROM records ORDER BY rowid").iterate()) hash.update(r.rowid + "\t" + r.kind + "\t" + r.id + "\n");
  const events = db.prepare("SELECT count(*) AS n, max(seq) AS last FROM events").get();
  const integrity = db.prepare("PRAGMA integrity_check").all().map((r) => Object.values(r)[0]).join("; ");
  return { kinds, order: hash.digest("hex"), events: events.n, lastEvent: events.last ?? 0, integrity };
}

/**
 * Encrypts the database at `file` with `key`, in place (the app must not have it open).
 * Returns {before, after, ms}; throws (with nothing changed) when any check fails.
 */
export function encryptDatabase(file, key, { checkpoint = true, beforeChecks = null } = {}) {
  const cipher = recordCipher(key);
  const db = new DatabaseSync(file);
  const started = Date.now();
  try {
    db.exec("PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;");
    if (db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='colmena_meta'").get() &&
        db.prepare("SELECT value FROM colmena_meta WHERE key='encryption'").get()) throw Error("La base de datos ya está cifrada.");
    const before = fingerprint(db);
    if (before.integrity !== "ok") throw Error("La base de datos no pasa la comprobación de integridad: " + before.integrity);
    db.exec("BEGIN IMMEDIATE");
    try {
      const digest = createHash("sha256"); // of every plain row, to compare after decrypting
      db.exec("CREATE TABLE records_enc (kind TEXT NOT NULL, id TEXT NOT NULL, data BLOB NOT NULL, meta TEXT, PRIMARY KEY(kind,id))");
      const put = db.prepare("INSERT INTO records_enc(rowid, kind, id, data, meta) VALUES(?,?,?,?,?)");
      for (const r of db.prepare("SELECT rowid, kind, id, data FROM records ORDER BY rowid").iterate()) {
        digest.update(r.data);
        put.run(r.rowid, r.kind, r.id, cipher.encrypt(r.data, recordAad(r.kind, r.id)), metaOf(JSON.parse(r.data)));
      }
      db.exec("CREATE TABLE events_enc (seq INTEGER PRIMARY KEY AUTOINCREMENT, mission TEXT, data BLOB NOT NULL, at TEXT)");
      const putEvent = db.prepare("INSERT INTO events_enc(seq, mission, data, at) VALUES(?,?,?,?)");
      for (const e of db.prepare("SELECT seq, mission, data FROM events ORDER BY seq").iterate()) {
        let at = null;
        try { at = JSON.parse(e.data).at ?? null; } catch {}
        putEvent.run(e.seq, e.mission, cipher.encrypt(e.data, eventAad(e.mission)), at);
      }
      // The full-text index of the history keeps messages readable: it goes (search reads decrypted messages).
      db.exec("DROP TABLE IF EXISTS colmena_history_fts; DROP TABLE IF EXISTS colmena_history_sync;");
      db.exec("DROP TABLE records; ALTER TABLE records_enc RENAME TO records;");
      db.exec("DROP TABLE events; ALTER TABLE events_enc RENAME TO events;");
      db.exec("CREATE INDEX records_mission ON records(kind, json_extract(meta,'$.missionId')); CREATE INDEX events_mission ON events(mission, seq);");
      db.exec("CREATE TABLE IF NOT EXISTS colmena_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      const meta = db.prepare("INSERT INTO colmena_meta(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
      meta.run("encryption", ENCRYPTION);
      meta.run("canary", cipher.encrypt(CANARY, "canary").toString("base64"));
      meta.run("encryptedAt", new Date().toISOString());
      beforeChecks?.(db); // tests: something going wrong mid-way
      // Checks before committing: same rows per kind, same order, every row decrypts to what it was.
      const after = fingerprint(db);
      if (JSON.stringify(after.kinds) !== JSON.stringify(before.kinds)) throw Error("El recuento de registros por tipo no coincide.");
      if (after.order !== before.order) throw Error("El orden de los registros no coincide.");
      if (after.events !== before.events || after.lastEvent !== before.lastEvent) throw Error("Los eventos no coinciden.");
      const check = createHash("sha256");
      for (const r of db.prepare("SELECT kind, id, data FROM records ORDER BY rowid").iterate()) check.update(cipher.decrypt(r.data, recordAad(r.kind, r.id)));
      if (check.digest("hex") !== digest.digest("hex")) throw Error("Algún registro no se descifra igual.");
      if (after.integrity !== "ok") throw Error("La base cifrada no pasa la comprobación de integridad: " + after.integrity);
      db.exec("COMMIT");
      // The plain pages were zeroed (secure_delete); fold the WAL into the file and empty it.
      if (checkpoint) db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA incremental_vacuum;");
      return { before, after, ms: Date.now() - started };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  } finally {
    db.close();
  }
}
