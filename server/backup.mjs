// Encrypted backups of Colmena (Ajustes › Privacidad y datos): the database, the bots' SOUL and
// USER, the workspaces (deliverables and mission files) and, apart, your «Personas» identity.
//
// File (.colmena-backup):
//   "COLMENA-BACKUP\n" · u32 header length · header JSON (format, version, createdAt, kdf
//   {scrypt N r p salt}, fileSalt, chunk, identity: bool) · data chunks · identity block.
// Keys: master = scrypt(password, salt); per file, HKDF-SHA256(master, fileSalt) gives one key
// for the data and another one for the identity (so the identity is sealed apart and only
// opened when you ask for it). Every chunk is AES-256-GCM with nonce = section byte + counter
// and the header's hash plus a «last chunk» flag as associated data: a cut, reordered or edited
// file does not decrypt.
// The database is copied with SQLite's online backup API (node:sqlite `backup()`): pages, so
// the rowids — the store's insertion order — stay as they are. Never VACUUM / VACUUM INTO.
// Restoring stages everything next to the data, checks every hash and PRAGMA integrity_check,
// and is applied at the next start (applyPendingRestore, before the store opens); what was
// there goes to before-restore-<time>/.
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, scrypt as scryptCb } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync, readdirSync, statSync } from "node:fs";
import { open, readdir, rm, stat, mkdir, rename, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const MAGIC = Buffer.from("COLMENA-BACKUP\n");
export const BACKUP_FORMAT = Object.freeze({ version: 1, chunk: 1024 * 1024, scrypt: { N: 2 ** 17, r: 8, p: 1 } });
export const EXTENSION = ".colmena-backup";
// What a backup holds (relative to the data directory). Credentials bound to this computer
// (auth/, connections/, provider/: Windows DPAPI) are not copied: on another computer you sign in again.
export const INCLUDED = Object.freeze({ files: ["USER.md"], folders: ["workspaces", "bots", "logos"] });
const SKIP = new Set(["node_modules", ".venv", "venv", "__pycache__", ".next", ".cache"]);
const IDENTITY_BINDING = { profile: "peer-identity", hostId: "colmena-peers-v1", clientId: "peer-identity", subject: "identity" };
const RESTORE_BINDING = { profile: "peer-identity-restore", hostId: "colmena-peers-v1", clientId: "peer-identity", subject: "identity" };
export const KEY_BINDING = { profile: "backup-key", hostId: "colmena-backup-v1", clientId: "backup", subject: "key" };

export class BackupError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}

// ---- Keys --------------------------------------------------------------------------------
const scrypt = (password, salt, { N, r, p }) => new Promise((resolve, reject) =>
  scryptCb(String(password).normalize("NFC"), salt, 32, { N, r, p, maxmem: 256 * 1024 * 1024 }, (e, key) => (e ? reject(e) : resolve(key))));

/** {key, kdf} for a new password: the master key and the parameters a backup header carries. */
export async function newMasterKey(password, params = BACKUP_FORMAT.scrypt) {
  if (String(password || "").length < 8) throw new BackupError("La contraseña necesita al menos 8 caracteres.");
  const salt = randomBytes(16);
  return { key: await scrypt(password, salt, params), kdf: { name: "scrypt", ...params, salt: salt.toString("base64") } };
}
/** The master key again from the password and a header's kdf. */
export function masterKeyFrom(password, kdf) {
  if (kdf?.name !== "scrypt") throw new BackupError("Esta copia usa un cifrado que esta versión no conoce.");
  const { N, r, p } = kdf;
  if (![N, r, p].every(Number.isInteger) || N > 2 ** 20 || r > 16 || p > 4) throw new BackupError("Parámetros de cifrado no válidos.");
  return scrypt(password, Buffer.from(kdf.salt, "base64"), { N, r, p });
}
const subKey = (master, fileSalt, label) => Buffer.from(hkdfSync("sha256", master, fileSalt, "colmena-backup-v1 " + label, 32));

// ---- Chunked AES-256-GCM -----------------------------------------------------------------
const nonce = (section, index) => {
  const n = Buffer.alloc(12);
  n[0] = section;
  n.writeBigUInt64BE(BigInt(index), 4);
  return n;
};
const aad = (headerHash, index, last) => Buffer.concat([headerHash, Buffer.from([last ? 1 : 0]), Buffer.from(String(index))]);
function seal(key, section, index, last, headerHash, plain) {
  const c = createCipheriv("aes-256-gcm", key, nonce(section, index));
  c.setAAD(aad(headerHash, index, last));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([body, c.getAuthTag()]);
}
function unseal(key, section, index, last, headerHash, sealed) {
  const d = createDecipheriv("aes-256-gcm", key, nonce(section, index));
  d.setAAD(aad(headerHash, index, last));
  d.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]);
}

/** Writes sealed chunks to a file handle: [u8 last][u32 length][sealed] each. */
class ChunkWriter {
  constructor(handle, key, headerHash, chunk) { Object.assign(this, { handle, key, headerHash, chunk, index: 0, buffered: [], size: 0 }); }
  async push(buffer) {
    this.buffered.push(buffer);
    this.size += buffer.length;
    while (this.size >= this.chunk) {
      const all = Buffer.concat(this.buffered);
      await this.write(all.subarray(0, this.chunk), false);
      const rest = all.subarray(this.chunk);
      this.buffered = rest.length ? [rest] : [];
      this.size = rest.length;
    }
  }
  async write(plain, last) {
    const sealed = seal(this.key, 1, this.index, last, this.headerHash, plain);
    const head = Buffer.alloc(5);
    head[0] = last ? 1 : 0;
    head.writeUInt32BE(sealed.length, 1);
    await this.handle.write(Buffer.concat([head, sealed]));
    this.index += 1;
  }
  async end() { await this.write(Buffer.concat(this.buffered), true); this.buffered = []; this.size = 0; }
}

// ---- What goes in --------------------------------------------------------------------------
/** Files of the included folders, relative paths with «/» (dependency folders skipped). */
export async function collectFiles(directory) {
  const out = [];
  for (const name of INCLUDED.files) {
    const s = await stat(path.join(directory, name)).catch(() => null);
    if (s?.isFile()) out.push({ rel: name, size: s.size });
  }
  const walk = async (rel) => {
    let entries = [];
    try { entries = await readdir(path.join(directory, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isSymbolicLink() || SKIP.has(e.name)) continue;
      const child = rel + "/" + e.name;
      if (e.isDirectory()) await walk(child);
      else if (e.isFile()) out.push({ rel: child, size: (await stat(path.join(directory, child)).catch(() => null))?.size ?? 0 });
    }
  };
  for (const folder of INCLUDED.folders) await walk(folder);
  return out;
}

/** Row count, insertion order fingerprint and integrity of a database file. */
export function inspectDatabase(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").all().map((r) => Object.values(r)[0]).join("; ");
    const hash = createHash("sha256");
    let rows = 0;
    for (const r of db.prepare("SELECT rowid, kind, id FROM records ORDER BY rowid").iterate()) { hash.update(r.rowid + "\t" + r.kind + "\t" + r.id + "\n"); rows += 1; }
    return { integrity, rows, order: hash.digest("hex") };
  } finally { db.close(); }
}

const entryHead = (type, rel, size) => {
  const name = Buffer.from(rel, "utf8");
  const head = Buffer.alloc(1 + 2 + name.length + 8);
  head[0] = type;
  head.writeUInt16BE(name.length, 1);
  name.copy(head, 3);
  head.writeBigUInt64BE(BigInt(size), 3 + name.length);
  return head;
};

/**
 * Writes an encrypted backup of `directory` (the store's own) to `target`. `key` + `kdf` come from
 * newMasterKey (or the saved key); `identity` is the Personas identity object or null.
 * Returns {file, bytes, files, rows, createdAt}.
 */
export async function createBackup({ store, target, key, kdf, identity = null, appVersion = null, dbKey = null }) {
  const directory = store.directory;
  const createdAt = new Date().toISOString();
  const temp = path.join(directory, "backup-" + process.pid + "-" + Date.now() + ".sqlite");
  await mkdir(path.dirname(target), { recursive: true });
  const partial = target + ".part";
  let handle;
  try {
    // 1. The database, online: SQLite copies its pages (rowids and order untouched).
    await sqliteBackup(store.db, temp);
    const db = inspectDatabase(temp);
    if (db.integrity !== "ok") throw new BackupError("La copia de la base de datos no pasó la comprobación de integridad: " + db.integrity);
    const files = await collectFiles(directory);
    const fileSalt = randomBytes(16);
    const header = Buffer.from(JSON.stringify({
      format: "colmena-backup", version: BACKUP_FORMAT.version, createdAt, appVersion, kdf, fileSalt: fileSalt.toString("base64"), chunk: BACKUP_FORMAT.chunk, identity: !!identity,
    }), "utf8");
    const headerHash = createHash("sha256").update(header).digest();
    handle = await open(partial, "w");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(header.length);
    await handle.write(Buffer.concat([MAGIC, len, header]));
    const writer = new ChunkWriter(handle, subKey(key, fileSalt, "data"), headerHash, BACKUP_FORMAT.chunk);
    // An encrypted database travels with its key, inside the sealed data: without it the copy
    // could not be opened on another computer (or here, after reinstalling Windows).
    if (store.encrypted && !dbKey) throw new BackupError("No encuentro la clave de la base de datos cifrada para guardarla en la copia.");
    const manifest = { createdAt, appVersion, db, files: [], ...(store.encrypted ? { dbKey: dbKey.toString("base64") } : {}) };
    // 2. Each file: its header, then its bytes (hashed on the way).
    const addFile = async (rel, abs, size) => {
      await writer.push(entryHead(1, rel, size));
      const hash = createHash("sha256");
      let seen = 0;
      for await (const chunk of createReadStream(abs, { highWaterMark: 256 * 1024 })) {
        const part = seen + chunk.length > size ? chunk.subarray(0, size - seen) : chunk;
        hash.update(part);
        seen += part.length;
        await writer.push(part);
        if (seen >= size) break;
      }
      if (seen < size) throw new BackupError("Un archivo cambió mientras se copiaba: " + rel + ". Vuelve a intentarlo.");
      manifest.files.push({ path: rel, size, sha256: hash.digest("hex") });
    };
    await addFile("colmena.sqlite", temp, statSync(temp).size);
    for (const f of files) await addFile(f.rel, path.join(directory, f.rel), f.size);
    // 3. The manifest closes the data: what must come out, and how the database looked.
    const body = Buffer.from(JSON.stringify(manifest), "utf8");
    await writer.push(entryHead(2, "manifest.json", body.length));
    await writer.push(body);
    await writer.end();
    // 4. The identity, sealed with its own key (one block; zero length when there is none).
    const sealed = identity ? seal(subKey(key, fileSalt, "identity"), 2, 0, true, headerHash, Buffer.from(JSON.stringify(identity), "utf8")) : Buffer.alloc(0);
    const idLen = Buffer.alloc(4);
    idLen.writeUInt32BE(sealed.length);
    await handle.write(Buffer.concat([idLen, sealed]));
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(partial, target);
    return { file: target, bytes: statSync(target).size, files: manifest.files.length, rows: db.rows, createdAt };
  } finally {
    if (handle) await handle.close().catch(() => {});
    await unlink(partial).catch(() => {});
    await rm(temp, { force: true }).catch(() => {});
    await rm(temp + "-journal", { force: true }).catch(() => {});
  }
}

// ---- Reading a backup --------------------------------------------------------------------
async function readExactly(handle, position, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new BackupError("La copia está incompleta o dañada.");
  return buffer;
}

/** The header of a backup file (no password needed): {header, offset}. */
export async function readHeader(file) {
  const handle = await open(file, "r").catch(() => { throw new BackupError("No encuentro ese archivo de copia.", 404); });
  try {
    const magic = await readExactly(handle, 0, MAGIC.length);
    if (!magic.equals(MAGIC)) throw new BackupError("Ese archivo no es una copia de Colmena.");
    const length = (await readExactly(handle, MAGIC.length, 4)).readUInt32BE(0);
    if (length > 64 * 1024) throw new BackupError("La copia está dañada.");
    const raw = await readExactly(handle, MAGIC.length + 4, length);
    const header = JSON.parse(raw.toString("utf8"));
    if (header.format !== "colmena-backup" || header.version > BACKUP_FORMAT.version) throw new BackupError("Esta copia es de una versión más nueva de Colmena.");
    return { header, raw, offset: MAGIC.length + 4 + length };
  } finally { await handle.close(); }
}

/**
 * Decrypts a backup into `staging` (a new folder), checking every hash, the manifest and the
 * database. `withIdentity` also opens the identity block. Returns {manifest, identity, db}.
 */
export async function extractBackup(file, password, staging, { withIdentity = false } = {}) {
  const { header, raw, offset } = await readHeader(file);
  const master = await masterKeyFrom(password, header.kdf);
  const fileSalt = Buffer.from(header.fileSalt, "base64");
  const headerHash = createHash("sha256").update(raw).digest();
  const dataKey = subKey(master, fileSalt, "data");
  await mkdir(staging, { recursive: true });
  const handle = await open(file, "r");
  try {
    let position = offset, index = 0, last = false;
    let pending = Buffer.alloc(0);
    let current = null; // {rel, size, written, hash, out}
    let manifest = null, manifestBytes = null;
    const written = new Map();
    const take = async (data) => {
      pending = pending.length ? Buffer.concat([pending, data]) : data;
      for (;;) {
        if (current) {
          const need = current.size - current.written;
          const part = pending.subarray(0, Math.min(need, pending.length));
          pending = pending.subarray(part.length);
          current.hash.update(part);
          current.written += part.length;
          if (current.out) await current.out.write(part); else current.buffer.push(part);
          if (current.written < current.size) return;
          if (current.out) await current.out.close();
          if (current.type === 2) manifestBytes = Buffer.concat(current.buffer);
          else written.set(current.rel, { size: current.size, sha256: current.hash.digest("hex") });
          current = null;
          continue;
        }
        if (pending.length < 3) return;
        const nameLength = pending.readUInt16BE(1);
        if (pending.length < 3 + nameLength + 8) return;
        const type = pending[0];
        const rel = pending.subarray(3, 3 + nameLength).toString("utf8");
        const size = Number(pending.readBigUInt64BE(3 + nameLength));
        pending = pending.subarray(3 + nameLength + 8);
        if (type === 1) {
          // Only plain relative paths inside the staging folder.
          if (!rel || rel.includes("\\") || rel.split("/").some((p) => !p || p === "." || p === "..") || path.isAbsolute(rel)) throw new BackupError("La copia contiene una ruta no válida.");
          const target = path.join(staging, ...rel.split("/"));
          await mkdir(path.dirname(target), { recursive: true });
          current = { type, rel, size, written: 0, hash: createHash("sha256"), out: await open(target, "w") };
        } else if (type === 2) {
          if (size > 64 * 1024 * 1024) throw new BackupError("La copia está dañada.");
          current = { type, rel, size, written: 0, hash: createHash("sha256"), out: null, buffer: [] };
        } else throw new BackupError("La copia está dañada.");
        if (size === 0) {
          if (current.out) await current.out.close();
          if (type === 1) written.set(rel, { size: 0, sha256: current.hash.digest("hex") });
          else manifestBytes = Buffer.alloc(0);
          current = null;
        }
      }
    };
    while (!last) {
      const head = await readExactly(handle, position, 5);
      last = head[0] === 1;
      const length = head.readUInt32BE(1);
      if (length > header.chunk + 64) throw new BackupError("La copia está dañada.");
      const sealed = await readExactly(handle, position + 5, length);
      position += 5 + length;
      let plain;
      try { plain = unseal(dataKey, 1, index, last, headerHash, sealed); }
      catch { throw new BackupError(index === 0 ? "La contraseña no es correcta (o la copia está dañada)." : "La copia está dañada o incompleta.", index === 0 ? 401 : 422); }
      index += 1;
      await take(plain);
    }
    if (current || pending.length || !manifestBytes) throw new BackupError("La copia está incompleta.");
    manifest = JSON.parse(manifestBytes.toString("utf8"));
    for (const f of manifest.files) {
      const got = written.get(f.path);
      if (!got || got.size !== f.size || got.sha256 !== f.sha256) throw new BackupError("Un archivo de la copia no coincide: " + f.path);
    }
    if (written.size !== manifest.files.length) throw new BackupError("La copia contiene archivos que no estaban en su índice.");
    const db = inspectDatabase(path.join(staging, "colmena.sqlite"));
    if (db.integrity !== "ok") throw new BackupError("La base de datos de la copia no pasa la comprobación de integridad: " + db.integrity);
    if (db.rows !== manifest.db.rows || db.order !== manifest.db.order) throw new BackupError("La base de datos de la copia no conserva el orden original.");
    // The identity block, only when asked.
    const idLength = (await readExactly(handle, position, 4)).readUInt32BE(0);
    let identity = null;
    if (withIdentity && idLength) {
      const sealed = await readExactly(handle, position + 4, idLength);
      identity = JSON.parse(unseal(subKey(master, fileSalt, "identity"), 2, 0, true, headerHash, sealed).toString("utf8"));
    }
    return { manifest, identity, db, hasIdentity: idLength > 0 };
  } finally { await handle.close(); }
}

// ---- Applying a restore at start ---------------------------------------------------------
export const RESTORE_MARKER = "restore-pending.json";
const MOVED = ["colmena.sqlite", "colmena.sqlite-wal", "colmena.sqlite-shm", ...INCLUDED.files, ...INCLUDED.folders, "checkpoints"];

/**
 * Called by server/index.mjs before the store opens. Moves what is there to
 * before-restore-<time>/ and the staged backup into place; the identity, when it was chosen,
 * goes from the vault's «restore» slot to the real one. Returns a summary or null.
 */
export async function applyPendingRestore(directory, { vault = null, keys = null } = {}) {
  const markerFile = path.join(directory, RESTORE_MARKER);
  if (!existsSync(markerFile)) return null;
  let marker;
  try { marker = JSON.parse(readFileSync(markerFile, "utf8")); } catch { rmSync(markerFile, { force: true }); return null; }
  const staging = path.join(directory, path.basename(String(marker.staging || "")));
  if (!marker.staging || !existsSync(path.join(staging, "colmena.sqlite"))) { rmSync(markerFile, { force: true }); return { applied: false, error: "La restauración preparada ya no está." }; }
  const aside = path.join(directory, "before-restore-" + new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(aside, { recursive: true });
  for (const name of MOVED) if (existsSync(path.join(directory, name))) renameSync(path.join(directory, name), path.join(aside, name));
  for (const name of readdirSync(staging)) renameSync(path.join(staging, name), path.join(directory, name));
  rmSync(staging, { recursive: true, force: true });
  let identity = false;
  if (marker.identity) {
    try {
      if (vault) {
        const saved = await vault.load(RESTORE_BINDING);
        if (saved) { await vault.save(IDENTITY_BINDING, saved); await vault.remove(RESTORE_BINDING.profile).catch(() => {}); identity = true; }
      } else {
        const file = path.join(directory, "peers", "identity-restore.json");
        if (existsSync(file)) { renameSync(file, path.join(directory, "peers", "identity.json")); identity = true; }
      }
    } catch {}
  }
  // The restored database is encrypted: its key becomes this computer's (the previous one is kept apart).
  if (marker.dbKey && keys) {
    const restored = await keys.load("db-key-restore");
    if (restored) {
      const current = await keys.load("db-key").catch(() => null);
      if (current && !current.equals(restored)) await keys.save("db-key-before", current);
      await keys.save("db-key", restored);
      await keys.remove("db-key-restore");
    }
  }
  rmSync(markerFile, { force: true });
  writeFileSync(path.join(directory, "restore-done.json"), JSON.stringify({ at: new Date().toISOString(), from: marker.createdAt || null, aside: path.basename(aside), identity }));
  return { applied: true, aside, identity };
}

/** Keeps the identity chosen for a restore until the next start (vault, or a private file). */
export async function stageIdentity(directory, identity, vault = null) {
  if (vault) return vault.save(RESTORE_BINDING, identity);
  const dir = path.join(directory, "peers");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "identity-restore.json");
  writeFileSync(file, JSON.stringify(identity), { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch {}
}
export async function loadIdentity(directory, vault = null) {
  if (vault) return vault.load(IDENTITY_BINDING).catch(() => null);
  const file = path.join(directory, "peers", "identity.json");
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

// ---- Where backups go ------------------------------------------------------------------
/** Synced folders of this computer (OneDrive, Google Drive) and Documents, with a «Copias de Colmena» folder inside. */
export function suggestedFolders({ env = process.env, home = os.homedir(), exists = existsSync } = {}) {
  const out = [];
  const add = (kind, label, base) => { if (base && exists(base) && !out.some((x) => x.base === base)) out.push({ kind, label, base, path: path.join(base, "Copias de Colmena") }); };
  for (const key of ["OneDriveConsumer", "OneDrive", "OneDriveCommercial"]) add("onedrive", key === "OneDriveCommercial" ? "OneDrive (trabajo)" : "OneDrive", env[key]);
  if (process.platform === "win32") for (const letter of "DEFGHIJKLMNOPQRSTUVWXYZ") for (const name of ["Mi unidad", "My Drive"]) add("gdrive", "Google Drive", `${letter}:\\${name}`);
  add("gdrive", "Google Drive", path.join(home, "Google Drive"));
  const cloud = path.join(home, "Library", "CloudStorage");
  if (exists(cloud)) for (const d of (() => { try { return readdirSync(cloud); } catch { return []; } })()) {
    if (/^GoogleDrive/i.test(d)) for (const name of ["My Drive", "Mi unidad"]) add("gdrive", "Google Drive", path.join(cloud, d, name));
    if (/^OneDrive/i.test(d)) add("onedrive", "OneDrive", path.join(cloud, d));
  }
  add("documents", "Documentos", path.join(home, "Documents"));
  return out;
}

/** Backups in a folder, newest first: [{name, path, bytes, at}]. */
export async function listBackups(folder) {
  let names = [];
  try { names = await readdir(folder); } catch { return []; }
  const out = [];
  for (const name of names.filter((n) => n.endsWith(EXTENSION))) {
    const s = await stat(path.join(folder, name)).catch(() => null);
    if (s?.isFile()) out.push({ name, path: path.join(folder, name), bytes: s.size, at: s.mtime.toISOString() });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
/** Keeps the newest `keep` automatic backups of a folder; returns the names removed. */
export async function pruneBackups(folder, keep) {
  const auto = (await listBackups(folder)).filter((b) => b.name.startsWith("colmena-auto-"));
  const gone = auto.slice(Math.max(1, keep));
  for (const b of gone) await rm(b.path, { force: true }).catch(() => {});
  return gone.map((b) => b.name);
}
export const backupName = (auto, at = new Date()) => `colmena-${auto ? "auto-" : ""}${at.toISOString().slice(0, 16).replace(/[:T]/g, "-")}${EXTENSION}`;
