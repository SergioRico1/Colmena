// «Cifrar este ordenador» (Ajustes › Privacidad y datos): the database is encrypted in place
// (db-crypto.mjs) with a key the system keeps (db-key.mjs). It never happens with Colmena using
// the database: prepare() makes an encrypted backup first (backup-service.mjs), creates the key
// and leaves encrypt-pending.json; the next start runs the migration before the store opens
// (applyPendingEncryption), with its checks, and reports in encrypt-done.json or
// encrypt-failed.json (then the database is exactly as it was).
// openStore() opens the database with its key. When the key is missing (Windows reinstalled, a
// copied folder), Colmena still starts: the encrypted database moves to locked-<time>/ and the
// only way back to that data is restoring a backup (backups carry the key, sealed with your
// backup password).
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Store, StoreKeyError, now } from "./store.mjs";
import { ENCRYPTION, META_FIELDS, encryptDatabase, encryptionOf } from "./db-crypto.mjs";
import { newDatabaseKey } from "./db-key.mjs";

export const ENCRYPT_MARKER = "encrypt-pending.json";
const readJson = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };
const dbFile = (directory) => path.join(directory, "colmena.sqlite");

/** Runs a prepared encryption (before the store opens). Returns {done|failed} or null. */
export async function applyPendingEncryption(directory, keys) {
  const marker = path.join(directory, ENCRYPT_MARKER);
  if (!existsSync(marker)) return null;
  rmSync(path.join(directory, "encrypt-failed.json"), { force: true });
  try {
    if (encryptionOf(dbFile(directory))) throw Error("La base de datos ya estaba cifrada.");
    const key = await keys.load("db-key");
    if (!key) throw Error("No encuentro la clave que se preparó para cifrar.");
    const result = encryptDatabase(dbFile(directory), key);
    writeFileSync(path.join(directory, "encrypt-done.json"), JSON.stringify({ at: now(), ms: result.ms, kinds: result.after.kinds, events: result.after.events, backup: readJson(marker)?.backup || null }));
    return { done: true, ...result };
  } catch (error) {
    writeFileSync(path.join(directory, "encrypt-failed.json"), JSON.stringify({ at: now(), error: String(error?.message || error) }));
    return { failed: true, error: String(error?.message || error) };
  } finally {
    rmSync(marker, { force: true });
  }
}

/**
 * The store of `directory`, with its key when the database is encrypted. Without a usable key the
 * encrypted database is set aside (locked-<time>/) and a new, empty one opens: {store, locked}.
 */
export async function openStore(directory, keys) {
  if (!encryptionOf(dbFile(directory))) return { store: new Store(directory), locked: null };
  const key = await keys.load("db-key").catch(() => null);
  try {
    return { store: new Store(directory, { key }), locked: null };
  } catch (error) {
    if (!(error instanceof StoreKeyError)) throw error;
    const aside = path.join(directory, "locked-" + new Date().toISOString().replace(/[:.]/g, "-"));
    mkdirSync(aside, { recursive: true });
    for (const name of ["colmena.sqlite", "colmena.sqlite-wal", "colmena.sqlite-shm"])
      if (existsSync(path.join(directory, name))) renameSync(path.join(directory, name), path.join(aside, name));
    const locked = { at: now(), folder: path.basename(aside), reason: error.message };
    writeFileSync(path.join(directory, "locked.json"), JSON.stringify(locked));
    return { store: new Store(directory), locked };
  }
}

export class Encryption {
  constructor({ store, keys, backups = null, clock = () => Date.now() }) {
    Object.assign(this, { store, keys, backups, clock });
    this.directory = store.directory;
  }
  status() {
    const encryptedAt = this.store.encrypted ? this.store.db.prepare("SELECT value FROM colmena_meta WHERE key='encryptedAt'").get()?.value || null : null;
    return {
      encrypted: !!this.store.encrypted, encryption: this.store.encrypted ? ENCRYPTION : null, encryptedAt, keyStore: this.keys?.kind || null,
      pending: readJson(path.join(this.directory, ENCRYPT_MARKER)), done: readJson(path.join(this.directory, "encrypt-done.json")),
      failed: readJson(path.join(this.directory, "encrypt-failed.json")), locked: readJson(path.join(this.directory, "locked.json")),
      readable: META_FIELDS, backupReady: !!this.backups?.config().keySetAt,
      plainCopies: this.plainCopies(), canRelaunch: typeof process.send === "function",
    };
  }
  /** Old copies of the database left in clear in the data folder (from restores). */
  plainCopies() {
    try {
      return readdirSync(this.directory).filter((n) => n.startsWith("before-restore-") && existsSync(path.join(this.directory, n, "colmena.sqlite")) && !encryptionOf(path.join(this.directory, n, "colmena.sqlite")));
    } catch { return []; }
  }
  /**
   * Gets the encryption ready for the next start: an encrypted backup now (it needs the backup
   * password), the key in the system vault, the marker. Returns {backup, keyStore}.
   */
  async prepare() {
    if (this.store.encrypted) throw Object.assign(Error("La base de datos ya está cifrada."), { status: 409 });
    if (!this.keys) throw Object.assign(Error("Este ordenador no puede guardar la clave de cifrado."), { status: 501 });
    if (!this.backups?.config().keySetAt) throw Object.assign(Error("Antes de cifrar, pon la contraseña de las copias: se hace una copia justo antes."), { status: 409 });
    const backup = await this.backups.run();
    const existing = await this.keys.load("db-key").catch(() => null);
    if (!existing) await this.keys.save("db-key", newDatabaseKey());
    if (!(await this.keys.load("db-key"))) throw Error("No se pudo guardar la clave en este ordenador.");
    const marker = { at: now(), backup: backup.file, rows: backup.rows };
    writeFileSync(path.join(this.directory, ENCRYPT_MARKER), JSON.stringify(marker));
    return { ...marker, keyStore: this.keys.kind };
  }
  cancel() {
    rmSync(path.join(this.directory, ENCRYPT_MARKER), { force: true });
    return { ok: true };
  }
  dismiss(what) {
    if (["encrypt-done", "encrypt-failed", "locked"].includes(what)) rmSync(path.join(this.directory, what + ".json"), { force: true });
    return this.status();
  }
}
export function registerEncryptionRoutes(app, { encryption, backups }) {
  app.get("/api/encryption", (_req, res) => res.json(encryption.status()));
  app.post("/api/encryption/prepare", async (_req, res) => res.json({ ...(await encryption.prepare()), status: encryption.status() }));
  app.delete("/api/encryption/prepare", (_req, res) => res.json(encryption.cancel()));
  app.post("/api/encryption/dismiss/:what", (req, res) => res.json(encryption.dismiss(req.params.what)));
  app.post("/api/encryption/relaunch", (_req, res) => res.json(backups.relaunch()));
}
