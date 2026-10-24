// Colmena's mailbox («buzón»): stores and forwards sealed envelopes between Colmenas that
// cannot reach each other directly (two desktops behind home routers). It has no accounts:
// every request is signed with the sender's key (server/peers/protocol.mjs), it checks that
// an envelope's sender is who signed the request, and it never sees what is inside.
//   POST /v1/send {to, env, ephemeral?}   deliver (or keep up to 7 days); ephemeral = live only
//   GET  /v1/stream                        SSE: what waits for you, then what arrives
//   POST /v1/ack {ids}                     received: delete
//   PUT|DELETE /v1/invites/:lookup         an encrypted invitation card (24 h)
//   GET  /v1/invites/:lookup               read a card (whoever has the code)
//   PUT  /v1/blobs/:id/:n                  part n of an encrypted file (signed; part 0 says how
//                                          many parts and the hash of the read token)
//   GET  /v1/blobs/:id/:n                  a part, for whoever has the read token (X-Blob-Token)
//   DELETE /v1/blobs/:id                   the uploader takes it away before it expires
// Run: node relay/server.mjs [--port 4390] [--host 127.0.0.1] [--data ./.relay-data]
import http from "node:http";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { checkAuth, checkEnvelope, isAddress, MAX_ENVELOPE, ProtocolError } from "../server/peers/protocol.mjs";

export const RELAY_LIMITS = Object.freeze({
  keepDays: 7, perRecipient: 5000, perSenderDay: 3000, livePerMinute: 120, sendsPerMinute: 600, invitesPerMinute: 30, inviteBytes: 4096, inviteHours: 25, streamsPerAddress: 4,
  // Files (sealed by each Colmena with a key only the recipients get): 1 MiB parts, 25 MiB per
  // file, 7 days, 200 MiB a day per uploader, 4 GiB in all on this server.
  blobPart: 1024 * 1024 + 64, blobParts: 26, blobKeepDays: 7, blobBytesDay: 200 * 1024 * 1024, blobTotal: 4 * 1024 * 1024 * 1024, blobReadsPerMinute: 600,
});

export function createRelay({ directory, now = () => Date.now(), log = () => {}, limits = {} } = {}) {
  const L = { ...RELAY_LIMITS, ...limits };
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, "relay.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;" +
      "CREATE TABLE IF NOT EXISTS mail (id TEXT PRIMARY KEY, rcpt TEXT NOT NULL, sender TEXT NOT NULL, env TEXT NOT NULL, at INTEGER NOT NULL);" +
      "CREATE INDEX IF NOT EXISTS mail_rcpt ON mail(rcpt, at);" +
      "CREATE TABLE IF NOT EXISTS invites (lookup TEXT PRIMARY KEY, owner TEXT NOT NULL, blob TEXT NOT NULL, expires INTEGER NOT NULL);" +
      // How much each sender left in each mailbox per day: nobody can fill yours.
      "CREATE TABLE IF NOT EXISTS quota (sender TEXT NOT NULL, rcpt TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (sender, rcpt, day));" +
      "CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, parts INTEGER NOT NULL, read TEXT NOT NULL, bytes INTEGER NOT NULL, expires INTEGER NOT NULL);" +
      "CREATE TABLE IF NOT EXISTS blob_parts (id TEXT NOT NULL, n INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (id, n));" +
      "CREATE TABLE IF NOT EXISTS blob_quota (owner TEXT NOT NULL, day TEXT NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY (owner, day));",
  );
  const q = {
    put: db.prepare("INSERT OR IGNORE INTO mail(id, rcpt, sender, env, at) VALUES (?,?,?,?,?)"),
    count: db.prepare("SELECT COUNT(*) AS n FROM mail WHERE rcpt=?"),
    waiting: db.prepare("SELECT id, sender, env FROM mail WHERE rcpt=? ORDER BY at, rowid LIMIT 500"),
    ack: db.prepare("DELETE FROM mail WHERE rcpt=? AND id=?"),
    old: db.prepare("DELETE FROM mail WHERE at < ?"),
    invitePut: db.prepare("INSERT INTO invites(lookup, owner, blob, expires) VALUES (?,?,?,?) ON CONFLICT(lookup) DO UPDATE SET owner=excluded.owner, blob=excluded.blob, expires=excluded.expires WHERE invites.owner=excluded.owner"),
    inviteGet: db.prepare("SELECT blob, expires FROM invites WHERE lookup=?"),
    inviteDel: db.prepare("DELETE FROM invites WHERE lookup=? AND owner=?"),
    invitesOld: db.prepare("DELETE FROM invites WHERE expires < ?"),
    used: db.prepare("SELECT n FROM quota WHERE sender=? AND rcpt=? AND day=?"),
    count1: db.prepare("INSERT INTO quota(sender, rcpt, day, n) VALUES (?,?,?,1) ON CONFLICT(sender, rcpt, day) DO UPDATE SET n = n + 1"),
    quotaOld: db.prepare("DELETE FROM quota WHERE day < ?"),
    blobGet: db.prepare("SELECT owner, parts, read, bytes, expires FROM blobs WHERE id=?"),
    blobNew: db.prepare("INSERT INTO blobs(id, owner, parts, read, bytes, expires) VALUES (?,?,?,?,0,?)"),
    blobGrow: db.prepare("UPDATE blobs SET bytes = bytes + ? WHERE id=?"),
    partPut: db.prepare("INSERT OR REPLACE INTO blob_parts(id, n, data) VALUES (?,?,?)"),
    partGet: db.prepare("SELECT data FROM blob_parts WHERE id=? AND n=?"),
    blobDel: db.prepare("DELETE FROM blobs WHERE id=?"),
    partsDel: db.prepare("DELETE FROM blob_parts WHERE id=?"),
    blobsOld: db.prepare("SELECT id FROM blobs WHERE expires < ?"),
    blobTotal: db.prepare("SELECT COALESCE(SUM(bytes), 0) AS n FROM blobs"),
    blobUsed: db.prepare("SELECT bytes FROM blob_quota WHERE owner=? AND day=?"),
    blobCount: db.prepare("INSERT INTO blob_quota(owner, day, bytes) VALUES (?,?,?) ON CONFLICT(owner, day) DO UPDATE SET bytes = bytes + excluded.bytes"),
    blobQuotaOld: db.prepare("DELETE FROM blob_quota WHERE day < ?"),
  };
  const streams = new Map(); // address → Set<res>
  const nonces = new Map(); // nonce → expiry
  const windows = new Map(); // key → [times]

  const limited = (key, max) => {
    const t = now(), list = (windows.get(key) || []).filter((x) => t - x < 60000);
    list.push(t);
    windows.set(key, list);
    return list.length > max;
  };
  const sweep = () => {
    const t = now();
    q.old.run(t - L.keepDays * 864e5);
    q.quotaOld.run(new Date(t - 2 * 864e5).toISOString().slice(0, 10));
    q.invitesOld.run(t);
    for (const { id } of q.blobsOld.all(t)) { q.partsDel.run(id); q.blobDel.run(id); }
    q.blobQuotaOld.run(new Date(t - 2 * 864e5).toISOString().slice(0, 10));
    for (const [n, exp] of nonces) if (exp < t) nonces.delete(n);
    for (const [k, list] of windows) if (!list.some((x) => t - x < 60000)) windows.delete(k);
  };
  const timer = setInterval(sweep, 60000);
  timer.unref?.();

  const app = express();
  app.disable("x-powered-by");
  // File parts are bytes; everything else is JSON text.
  app.use("/v1/blobs", express.raw({ type: () => true, limit: L.blobPart }));
  app.use(express.text({ type: () => true, limit: MAX_ENVELOPE * 2 }));
  app.use((_req, res, next) => { res.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); next(); });
  const fail = (res, status, error) => res.status(status).json({ error });
  /** The signed request's address, or a 401. */
  const who = (req, res) => {
    const body = typeof req.body === "string" || Buffer.isBuffer(req.body) ? req.body : "";
    const auth = checkAuth(req.headers.authorization, req.method, req.path, body, Math.floor(now() / 1000));
    if (!auth || nonces.has(auth.nonce)) { fail(res, 401, "Firma no válida."); return null; }
    nonces.set(auth.nonce, now() + 11 * 60000);
    return auth.address;
  };
  const json = (req) => { try { return JSON.parse(req.body || "{}"); } catch { return null; } };
  const push = (address, row) => {
    for (const res of streams.get(address) || []) res.write(`event: mail\ndata: ${JSON.stringify(row)}\n\n`);
    return (streams.get(address)?.size || 0) > 0;
  };

  app.get("/v1/health", (_req, res) => res.json({ ok: true, service: "colmena-buzon", version: 1, stream: "sse", blobs: { part: L.blobPart - 64, parts: L.blobParts, keepDays: L.blobKeepDays } }));

  app.post("/v1/send", (req, res) => {
    const from = who(req, res);
    if (!from) return;
    const data = json(req);
    if (!data || !isAddress(data.to)) return fail(res, 400, "Destinatario no válido.");
    if (limited("send:" + from, L.sendsPerMinute)) return fail(res, 429, "Demasiados mensajes seguidos.");
    try {
      checkEnvelope(data.env, { now: Math.floor(now() / 1000) });
    } catch (error) {
      return fail(res, 400, error instanceof ProtocolError ? error.message : "Sobre no válido.");
    }
    if (data.env.from !== from || data.env.to !== data.to) return fail(res, 403, "El sobre no es de quien lo envía.");
    const row = { id: data.env.id, from, env: data.env };
    if (data.ephemeral === true) {
      if (limited("live:" + from + ":" + data.to, L.livePerMinute)) return fail(res, 429, "Demasiados avisos seguidos.");
      return res.json({ ok: true, delivered: push(data.to, row), stored: false });
    }
    if (q.count.get(data.to).n >= L.perRecipient) return fail(res, 507, "El buzón de esa persona está lleno.");
    const day = new Date(now()).toISOString().slice(0, 10);
    if ((q.used.get(from, data.to, day)?.n || 0) >= L.perSenderDay) return fail(res, 429, "Demasiados mensajes para esta persona hoy.");
    const added = q.put.run(row.id, data.to, from, JSON.stringify(row.env), now()).changes > 0;
    if (added) q.count1.run(from, data.to, day);
    const delivered = added ? push(data.to, row) : false;
    res.json({ ok: true, delivered, stored: true });
  });

  app.get("/v1/stream", (req, res) => {
    const address = who(req, res);
    if (!address) return;
    const set = streams.get(address) || new Set();
    if (set.size >= L.streamsPerAddress) return fail(res, 429, "Demasiadas conexiones.");
    res.set({ "Content-Type": "text/event-stream", Connection: "keep-alive" });
    res.flushHeaders();
    res.write("event: ready\ndata: {}\n\n");
    for (const r of q.waiting.all(address)) res.write(`event: mail\ndata: ${JSON.stringify({ id: r.id, from: r.sender, env: JSON.parse(r.env) })}\n\n`);
    set.add(res);
    streams.set(address, set);
    const ping = setInterval(() => res.write(": ping\n\n"), 25000);
    req.on("close", () => {
      clearInterval(ping);
      set.delete(res);
      if (!set.size) streams.delete(address);
    });
  });

  app.post("/v1/ack", (req, res) => {
    const address = who(req, res);
    if (!address) return;
    const ids = json(req)?.ids;
    if (!Array.isArray(ids) || ids.length > 500) return fail(res, 400, "Lista no válida.");
    let removed = 0;
    for (const id of ids) if (typeof id === "string") removed += q.ack.run(address, id).changes;
    res.json({ ok: true, removed });
  });

  const lookupOk = (s) => /^[A-Za-z0-9_-]{32}$/.test(s);
  app.put("/v1/invites/:lookup", (req, res) => {
    const owner = who(req, res);
    if (!owner) return;
    const data = json(req);
    if (!lookupOk(req.params.lookup) || typeof data?.blob !== "string" || data.blob.length > L.inviteBytes) return fail(res, 400, "Invitación no válida.");
    const expires = Math.min(Number(data.expiresAt) || 0, now() + L.inviteHours * 3600000);
    if (expires <= now()) return fail(res, 400, "La invitación ya caducó.");
    const changed = q.invitePut.run(req.params.lookup, owner, data.blob, expires).changes;
    if (!changed) return fail(res, 409, "Ese código ya está en uso.");
    res.json({ ok: true, expiresAt: expires });
  });
  app.get("/v1/invites/:lookup", (req, res) => {
    if (limited("invite:" + (req.socket.remoteAddress || "?"), L.invitesPerMinute)) return fail(res, 429, "Demasiados intentos. Espera un minuto.");
    const row = lookupOk(req.params.lookup) ? q.inviteGet.get(req.params.lookup) : null;
    if (!row || row.expires < now()) return fail(res, 404, "Esa invitación no existe o ya caducó.");
    res.json({ blob: row.blob, expiresAt: row.expires });
  });
  app.delete("/v1/invites/:lookup", (req, res) => {
    const owner = who(req, res);
    if (!owner) return;
    q.inviteDel.run(req.params.lookup, owner);
    res.json({ ok: true });
  });
  // Files: the mailbox keeps sealed parts it cannot read; the key travels in the envelopes.
  const blobOk = (s) => /^[A-Za-z0-9_-]{22,43}$/.test(s);
  const tokenHash = (t) => createHash("sha256").update(String(t || "")).digest("base64url");
  app.put("/v1/blobs/:id/:n", (req, res) => {
    const owner = who(req, res);
    if (!owner) return;
    const n = Number(req.params.n);
    const data = Buffer.isBuffer(req.body) ? req.body : null;
    if (!blobOk(req.params.id) || !Number.isInteger(n) || n < 0 || n >= L.blobParts || !data?.length) return fail(res, 400, "Parte no válida.");
    let blob = q.blobGet.get(req.params.id);
    if (!blob) {
      const parts = Number(req.headers["x-blob-parts"]);
      const read = String(req.headers["x-blob-read"] || "");
      if (n !== 0 || !Number.isInteger(parts) || parts < 1 || parts > L.blobParts || !/^[A-Za-z0-9_-]{43}$/.test(read)) return fail(res, 400, "Falta la parte 0.");
      q.blobNew.run(req.params.id, owner, parts, read, now() + L.blobKeepDays * 864e5);
      blob = q.blobGet.get(req.params.id);
    }
    if (blob.owner !== owner) return fail(res, 403, "Ese archivo no es tuyo.");
    if (n >= blob.parts) return fail(res, 400, "Parte no válida.");
    const day = new Date(now()).toISOString().slice(0, 10);
    if ((q.blobUsed.get(owner, day)?.bytes || 0) + data.length > L.blobBytesDay) return fail(res, 429, "Has compartido demasiado hoy.");
    if (q.blobTotal.get().n + data.length > L.blobTotal) return fail(res, 507, "El buzón está lleno de archivos.");
    q.partPut.run(req.params.id, n, data);
    q.blobGrow.run(data.length, req.params.id);
    q.blobCount.run(owner, day, data.length);
    res.json({ ok: true, expiresAt: blob.expires });
  });
  app.get("/v1/blobs/:id/:n", (req, res) => {
    if (limited("blob:" + (req.socket.remoteAddress || "?"), L.blobReadsPerMinute)) return fail(res, 429, "Demasiadas descargas seguidas.");
    const blob = blobOk(req.params.id) ? q.blobGet.get(req.params.id) : null;
    if (!blob || blob.expires < now() || blob.read !== tokenHash(req.headers["x-blob-token"])) return fail(res, 404, "Ese archivo no existe o ya caducó.");
    const part = q.partGet.get(req.params.id, Number(req.params.n));
    if (!part) return fail(res, 404, "Esa parte aún no está.");
    res.set({ "Content-Type": "application/octet-stream" }).send(Buffer.from(part.data));
  });
  app.delete("/v1/blobs/:id", (req, res) => {
    const owner = who(req, res);
    if (!owner) return;
    const blob = q.blobGet.get(req.params.id);
    if (blob && blob.owner === owner) { q.partsDel.run(req.params.id); q.blobDel.run(req.params.id); }
    res.json({ ok: true });
  });
  app.use((_req, res) => fail(res, 404, "No existe."));
  // eslint-disable-next-line no-unused-vars
  app.use((error, _req, res, _next) => fail(res, error.status === 413 ? 413 : 400, error.status === 413 ? "Demasiado grande." : "Petición no válida."));

  return {
    app,
    online: (address) => (streams.get(address)?.size || 0) > 0,
    sweep,
    close() {
      clearInterval(timer);
      for (const set of streams.values()) for (const res of set) res.end();
      streams.clear();
      db.close();
    },
    id: randomUUID(),
  };
}

/** Starts the mailbox on `host:port`; resolves to { url, close }. */
export async function startRelay({ port = 4390, host = "127.0.0.1", directory, limits } = {}) {
  const relay = createRelay({ directory, limits });
  const server = http.createServer(relay.app);
  server.requestTimeout = 0; // SSE streams stay open
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const url = `http://${host}:${server.address().port}`;
  return {
    url, relay,
    close: () => new Promise((resolve) => { relay.close(); server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const arg = (name, fallback) => { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : fallback; };
  const { url } = await startRelay({
    port: Number(arg("port", process.env.PORT || 4390)),
    host: arg("host", process.env.HOST || "127.0.0.1"),
    directory: path.resolve(arg("data", process.env.RELAY_DATA || ".relay-data")),
  });
  console.log("COLMENA_RELAY_READY " + url);
}
