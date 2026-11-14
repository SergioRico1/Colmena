// Where the binary objects of team messaging live (docs/CLOUD.md › Phase 2): uploaded files, the
// parts of a Slack export being imported. One small async interface, three backends:
//   put(key, body, {size, type}) → {size}     body: Uint8Array | ArrayBuffer | ReadableStream
//   get(key) → {body: ReadableStream, size, type} | null
//   read(key, offset, length) → Uint8Array    (a range: the ZIP reader's random access)
//   head(key) → {size, type} | null           remove(key)
// R2Blobs (deployed, cloud/src/workspace.js passes the bucket), SqlBlobs (the object's own SQLite in
// 1 MB rows, so `wrangler dev` without R2 holds files of any size) and MemoryBlobs (tests).

const CHUNK = 1024 * 1024;

export async function toBytes(body) {
  if (body == null) return new Uint8Array(0);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (typeof body.getReader === "function") {
    const parts = [];
    let size = 0;
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      size += value.byteLength;
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.byteLength; }
    return out;
  }
  throw Error("Contenido no válido.");
}
const streamOf = (bytes) => new ReadableStream({ start(c) { if (bytes.byteLength) c.enqueue(bytes); c.close(); } });

/** Blobs in memory (tests). `max`: the largest object accepted. */
export class MemoryBlobs {
  constructor({ max = 512 * 1024 * 1024 } = {}) { this.map = new Map(); this.max = max; }
  async put(key, body, { type = "application/octet-stream" } = {}) {
    const bytes = await toBytes(body);
    if (bytes.byteLength > this.max) throw Object.assign(Error("Archivo demasiado grande."), { status: 413 });
    this.map.set(key, { bytes: bytes.slice(), type });
    return { size: bytes.byteLength };
  }
  async get(key) { const o = this.map.get(key); return o ? { body: streamOf(o.bytes), size: o.bytes.byteLength, type: o.type } : null; }
  async read(key, offset, length) { const o = this.map.get(key); if (!o) throw Error("No existe: " + key); return o.bytes.subarray(offset, offset + length); }
  async head(key) { const o = this.map.get(key); return o ? { size: o.bytes.byteLength, type: o.type } : null; }
  async remove(key) { this.map.delete(key); }
}

/** Blobs in the object's SQLite (DO SQL or the test fake), in 1 MB rows. */
export class SqlBlobs {
  constructor(sql, { max = 64 * 1024 * 1024 } = {}) {
    this.sql = sql;
    this.max = max;
    sql.exec("CREATE TABLE IF NOT EXISTS colmena_blobs (key TEXT NOT NULL, part INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(key, part)) WITHOUT ROWID;" +
      "CREATE TABLE IF NOT EXISTS colmena_blob_heads (key TEXT PRIMARY KEY, size INTEGER NOT NULL, type TEXT NOT NULL)");
  }
  async put(key, body, { type = "application/octet-stream" } = {}) {
    const bytes = await toBytes(body);
    if (bytes.byteLength > this.max) throw Object.assign(Error("Archivo demasiado grande para guardarlo aquí."), { status: 413 });
    await this.remove(key);
    const parts = Math.max(1, Math.ceil(bytes.byteLength / CHUNK));
    for (let part = 0; part < parts; part++)
      this.sql.exec("INSERT INTO colmena_blobs(key, part, data) VALUES(?,?,?)", key, part, bytes.slice(part * CHUNK, (part + 1) * CHUNK).buffer);
    this.sql.exec("INSERT INTO colmena_blob_heads(key, size, type) VALUES(?,?,?)", key, bytes.byteLength, type);
    return { size: bytes.byteLength };
  }
  async head(key) { return this.sql.exec("SELECT size, type FROM colmena_blob_heads WHERE key=?", key).toArray()[0] || null; }
  async get(key) {
    const head = await this.head(key);
    if (!head) return null;
    return { body: streamOf(await this.read(key, 0, head.size)), size: head.size, type: head.type };
  }
  async read(key, offset, length) {
    const head = await this.head(key);
    if (!head) throw Error("No existe: " + key);
    const end = Math.min(head.size, offset + length);
    const out = new Uint8Array(Math.max(0, end - offset));
    for (let part = Math.floor(offset / CHUNK); part * CHUNK < end; part++) {
      const row = this.sql.exec("SELECT data FROM colmena_blobs WHERE key=? AND part=?", key, part).toArray()[0];
      if (!row) break;
      const bytes = new Uint8Array(row.data);
      const from = Math.max(offset, part * CHUNK), to = Math.min(end, part * CHUNK + bytes.byteLength);
      out.set(bytes.subarray(from - part * CHUNK, to - part * CHUNK), from - offset);
    }
    return out;
  }
  async remove(key) {
    this.sql.exec("DELETE FROM colmena_blobs WHERE key=?", key);
    this.sql.exec("DELETE FROM colmena_blob_heads WHERE key=?", key);
  }
}

/** Blobs in an R2 bucket under `base` (one prefix per workspace). */
export class R2Blobs {
  constructor(bucket, base, { max = 100 * 1024 * 1024 } = {}) {
    this.bucket = bucket;
    this.base = String(base).replace(/\/+$/, "") + "/";
    this.max = max;
  }
  async put(key, body, { size = null, type = "application/octet-stream" } = {}) {
    if (size != null && size > this.max) throw Object.assign(Error("Archivo demasiado grande."), { status: 413 });
    // A stream needs its length up front (FixedLengthStream); bytes go as they are.
    let value = body;
    if (body && typeof body.getReader === "function") {
      if (size == null) value = await toBytes(body);
      else if (typeof FixedLengthStream === "function") { const f = new FixedLengthStream(size); body.pipeTo(f.writable).catch(() => {}); value = f.readable; }
    }
    const object = await this.bucket.put(this.base + key, value, { httpMetadata: { contentType: type } });
    return { size: object?.size ?? size ?? 0 };
  }
  async get(key) {
    const o = await this.bucket.get(this.base + key);
    return o ? { body: o.body, size: o.size, type: o.httpMetadata?.contentType || "application/octet-stream" } : null;
  }
  async read(key, offset, length) {
    const o = await this.bucket.get(this.base + key, { range: { offset, length } });
    if (!o) throw Error("No existe: " + key);
    return new Uint8Array(await o.arrayBuffer());
  }
  async head(key) { const o = await this.bucket.head(this.base + key); return o ? { size: o.size, type: o.httpMetadata?.contentType || "application/octet-stream" } : null; }
  async remove(key) { await this.bucket.delete(this.base + key); }
}
