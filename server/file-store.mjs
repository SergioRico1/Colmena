// Where the files of a hosted workspace live (docs/CLOUD.md › Phase 1 › Files). The desktop keeps
// a mission's files in its folder on disk and mounts nothing here: every function of files.mjs
// works as before. A hosted workspace has no disk, so its mission root ("/colmena/<id>") is
// mounted on a backend with one small interface:
//   get(key) → {bytes: Buffer, size, at} | null     put(key, bytes) → {size, at}
//   list(prefix) → [{key, size, at}]                remove(key)
// Two backends: the workspace's own SQLite (SqlFiles, small files, the default) and R2
// (R2Files, when the Worker has a bucket bound). Keys are "<missionId>/<relative path>".
import path from "node:path";

const mounts = new Map(); // root (posix, no trailing slash) → backend

const posix = (p) => String(p || "").replace(/\\/g, "/").replace(/\/+$/, "");
/** Files under `root` go to `backend` from now on (the hosted workspace, once per object). */
export function mountFiles(root, backend) { mounts.set(posix(root), backend); }
export function unmountFiles(root) { mounts.delete(posix(root)); }
/** The backend and key prefix of a mission root, or null (the desktop: a real folder). */
export function mountedRoot(root) {
  const r = posix(root);
  for (const [base, backend] of mounts) if (r === base || r.startsWith(base + "/")) return { backend, prefix: r.slice(base.length + 1) };
  return null;
}
export const fileKey = (mount, relative) => (mount.prefix ? mount.prefix + "/" : "") + relative;

/** Files in the workspace's SQLite: at most `max` bytes each (a DO row holds up to 2 MB). */
export class SqlFiles {
  constructor(sql, { max = 1536 * 1024 } = {}) {
    this.sql = sql;
    this.max = max;
    sql.exec("CREATE TABLE IF NOT EXISTS colmena_files (key TEXT PRIMARY KEY, data BLOB NOT NULL, size INTEGER NOT NULL, at TEXT NOT NULL)");
  }
  async get(key) {
    const row = this.sql.exec("SELECT data, size, at FROM colmena_files WHERE key=?", key).toArray()[0];
    return row ? { bytes: Buffer.from(row.data), size: row.size, at: row.at } : null;
  }
  async put(key, bytes) {
    const buf = Buffer.from(bytes);
    if (buf.length > this.max) throw Error("Archivo demasiado grande para guardarlo aquí (máximo " + Math.round(this.max / 1024) + " KB por ahora).");
    const at = new Date().toISOString();
    this.sql.exec("INSERT INTO colmena_files(key, data, size, at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data, size=excluded.size, at=excluded.at",
      key, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), buf.length, at);
    return { size: buf.length, at };
  }
  async list(prefix) {
    return this.sql.exec("SELECT key, size, at FROM colmena_files WHERE key >= ? AND key < ? ORDER BY key", prefix, prefix + "￿").toArray();
  }
  async remove(key) { this.sql.exec("DELETE FROM colmena_files WHERE key=?", key); }
}

/** Files in an R2 bucket under `base` (one prefix per workspace). */
export class R2Files {
  constructor(bucket, base, { max = 10 * 1024 * 1024 } = {}) {
    this.bucket = bucket;
    this.base = posix(base) + "/";
    this.max = max;
  }
  async get(key) {
    const object = await this.bucket.get(this.base + key);
    if (!object) return null;
    const bytes = Buffer.from(await object.arrayBuffer());
    return { bytes, size: bytes.length, at: object.uploaded?.toISOString?.() || new Date().toISOString() };
  }
  async put(key, bytes) {
    const buf = Buffer.from(bytes);
    if (buf.length > this.max) throw Error("Archivo demasiado grande.");
    await this.bucket.put(this.base + key, buf);
    return { size: buf.length, at: new Date().toISOString() };
  }
  async list(prefix) {
    const out = [];
    let cursor;
    do {
      const page = await this.bucket.list({ prefix: this.base + prefix, cursor, limit: 1000 });
      for (const o of page.objects) out.push({ key: o.key.slice(this.base.length), size: o.size, at: o.uploaded?.toISOString?.() || null });
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor && out.length < 5000);
    return out;
  }
  async remove(key) { await this.bucket.delete(this.base + key); }
}

/** A mounted file as files.mjs and workfiles.mjs describe one: like an lstat, plus its bytes. */
export async function mountedFile(mount, relative) {
  const found = await mount.backend.get(fileKey(mount, relative));
  if (!found) return null;
  const mtime = new Date(found.at || Date.now());
  return { bytes: found.bytes, info: { size: found.size, mtime, mtimeMs: mtime.getTime(), nlink: 1, isFile: () => true, isDirectory: () => false }, name: path.posix.basename(relative) };
}
