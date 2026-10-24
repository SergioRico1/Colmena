// Colmena's mailbox («buzón») on Cloudflare Workers + Durable Objects: the same contract as
// relay/server.mjs (it stores and forwards sealed envelopes it cannot read), but the live
// channel is a hibernating WebSocket, so a Colmena waiting for messages costs nothing while
// nothing arrives. One Durable Object per mailbox (address) and one per invitation card.
//   GET  /v1/health                      {ok, service, version, stream: "ws"}
//   POST /v1/send {to, env, ephemeral?}  signed by the sender; checks the envelope's signature
//   GET  /v1/ws?auth=<Colmena …>         your mailbox: what waits, then what arrives
//   POST /v1/ack {ids}                   received: delete (also over the socket: {"ack":[…]})
//   PUT|GET|DELETE /v1/invites/:lookup   an encrypted invitation card (25 h at most)
//   PUT /v1/blobs/:id/:n · GET /v1/blobs/:id/:n · DELETE /v1/blobs/:id
//                                        sealed parts of a shared file (7 days); see relay/server.mjs
// Signatures are the ones of server/peers/protocol.mjs, checked here with WebCrypto Ed25519.
import { DurableObject } from "cloudflare:workers";

// perSenderDay: envelopes one sender may leave in one mailbox per day (kept in that mailbox);
// livePerMinute: typing/presence notes per sender and mailbox; sendsPerMinute: per sender, best
// effort in each Worker instance (a global count would cost one more request per message).
const LIMITS = { keepDays: 7, perRecipient: 5000, perSenderDay: 3000, livePerMinute: 120, sendsPerMinute: 600, invitesPerMinute: 30, envelope: 72 * 1024, inviteBytes: 4096, inviteHours: 25, skew: 300, maxAge: 30 * 86400, batch: 300,
  // Files: sealed 1 MiB parts (the key never comes here), 25 MiB a file, 7 days, 200 MiB a day per uploader.
  blobPart: 1024 * 1024 + 64, blobParts: 26, blobKeepDays: 7, blobBytesDay: 200 * 1024 * 1024, blobReadsPerMinute: 600 };
const windows = new Map();
const limited = (key, max) => {
  const t = Date.now(), list = (windows.get(key) || []).filter((x) => t - x < 60000);
  list.push(t);
  windows.set(key, list);
  if (windows.size > 5000) for (const [k, v] of windows) if (!v.some((x) => t - x < 60000)) windows.delete(k);
  return list.length > max;
};
const ADDRESS = /^[A-Za-z0-9_-]{43}$/;
const B64 = /^[A-Za-z0-9+/=_-]+$/;
const enc = new TextEncoder();
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
const fail = (status, error) => json({ error }, status);

// ---- the protocol, as in server/peers/protocol.mjs ----------------------------------------
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}
const fromB64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(s).length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256 = async (data) => b64u(await crypto.subtle.digest("SHA-256", typeof data === "string" ? enc.encode(data) : data));
async function verifyBytes(address, data, sig) {
  try {
    if (!ADDRESS.test(address)) return false;
    const key = await crypto.subtle.importKey("raw", fromB64u(address), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, fromB64u(sig), enc.encode(data));
  } catch {
    return false;
  }
}
/** «Colmena <address>.<ts>.<nonce>.<sig>» over method, path, time, nonce and body hash. */
async function checkAuth(header, method, path, body = "") {
  const m = /^Colmena ([A-Za-z0-9_-]{43})\.(\d{1,12})\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{86})$/.exec(String(header || ""));
  if (!m) return null;
  const [, address, tsText, nonce, sig] = m;
  const ts = Number(tsText);
  if (Math.abs(Date.now() / 1000 - ts) > LIMITS.skew) return null;
  const line = [method.toUpperCase(), path, ts, nonce, await sha256(body)].join("\n");
  return (await verifyBytes(address, line, sig)) ? address : null;
}
async function checkEnvelope(env) {
  if (!env || typeof env !== "object") return "Sobre no válido.";
  const { v, id, from, to, ts, epk, n, ct, sig } = env;
  if (v !== 1) return "Versión del protocolo no compatible.";
  if (typeof id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(id) || !ADDRESS.test(from) || !ADDRESS.test(to) || !Number.isSafeInteger(ts) || !ADDRESS.test(epk)) return "Sobre no válido.";
  if (![n, ct, sig].every((x) => typeof x === "string" && B64.test(x))) return "Sobre no válido.";
  if (JSON.stringify(env).length > LIMITS.envelope) return "Demasiado grande.";
  const now = Date.now() / 1000;
  if (ts > now + LIMITS.skew || ts < now - LIMITS.maxAge) return "Mensaje caducado o con la hora mal.";
  const { sig: _s, ...unsigned } = env;
  return (await verifyBytes(from, canonical(unsigned), sig)) ? null : "Firma no válida.";
}

// ---- the front door ---------------------------------------------------------------------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/v1/health" && request.method === "GET") return json({ ok: true, service: "colmena-buzon", version: 1, stream: "ws", blobs: { part: LIMITS.blobPart - 64, parts: LIMITS.blobParts, keepDays: LIMITS.blobKeepDays } });
      // A sealed file: parts kept by one Durable Object per file; the uploader's mailbox counts its bytes per day.
      const blob = /^\/v1\/blobs\/([A-Za-z0-9_-]{22,43})(?:\/(\d{1,2}))?$/.exec(path);
      if (blob) {
        const store = env.BLOB.get(env.BLOB.idFromName(blob[1]));
        if (request.method === "GET" && blob[2] !== undefined) {
          if (limited("blob:" + (request.headers.get("CF-Connecting-IP") || "?"), LIMITS.blobReadsPerMinute)) return fail(429, "Demasiadas descargas seguidas.");
          return store.fetch("https://blob/get?n=" + blob[2], { headers: { "X-Blob-Token": request.headers.get("X-Blob-Token") || "" } });
        }
        if (request.method === "PUT" && blob[2] !== undefined) {
          const bytes = new Uint8Array(await request.arrayBuffer());
          if (!bytes.length || bytes.length > LIMITS.blobPart) return fail(413, "Parte no válida.");
          const owner = await checkAuth(request.headers.get("Authorization"), "PUT", path, bytes);
          if (!owner) return fail(401, "Firma no válida.");
          const quota = await env.MAILBOX.get(env.MAILBOX.idFromName(owner)).fetch("https://box/blob-quota", { method: "POST", body: JSON.stringify({ bytes: bytes.length }) });
          if (!quota.ok) return quota;
          return store.fetch("https://blob/put", { method: "POST", body: bytes, headers: { "X-Owner": owner, "X-N": blob[2], "X-Blob-Parts": request.headers.get("X-Blob-Parts") || "", "X-Blob-Read": request.headers.get("X-Blob-Read") || "" } });
        }
        if (request.method === "DELETE" && blob[2] === undefined) {
          const owner = await checkAuth(request.headers.get("Authorization"), "DELETE", path, "");
          if (!owner) return fail(401, "Firma no válida.");
          return store.fetch("https://blob/delete", { method: "POST", headers: { "X-Owner": owner } });
        }
      }
      if (path === "/v1/send" && request.method === "POST") {
        const body = await request.text();
        if (body.length > LIMITS.envelope * 2) return fail(413, "Demasiado grande.");
        const from = await checkAuth(request.headers.get("Authorization"), "POST", path, body);
        if (!from) return fail(401, "Firma no válida.");
        if (limited("send:" + from, LIMITS.sendsPerMinute)) return fail(429, "Demasiados mensajes seguidos.");
        let data;
        try { data = JSON.parse(body); } catch { return fail(400, "Petición no válida."); }
        if (!ADDRESS.test(data?.to)) return fail(400, "Destinatario no válido.");
        const bad = await checkEnvelope(data.env);
        if (bad) return fail(400, bad);
        if (data.env.from !== from || data.env.to !== data.to) return fail(403, "El sobre no es de quien lo envía.");
        const box = env.MAILBOX.get(env.MAILBOX.idFromName(data.to));
        return box.fetch("https://box/deliver", { method: "POST", body: JSON.stringify({ id: data.env.id, from, env: data.env, ephemeral: data.ephemeral === true }) });
      }
      if (path === "/v1/ws" && request.method === "GET") {
        if (request.headers.get("Upgrade") !== "websocket") return fail(426, "Hace falta un WebSocket.");
        const address = await checkAuth(url.searchParams.get("auth"), "GET", path);
        if (!address) return fail(401, "Firma no válida.");
        return env.MAILBOX.get(env.MAILBOX.idFromName(address)).fetch("https://box/ws", request);
      }
      if (path === "/v1/ack" && request.method === "POST") {
        const body = await request.text();
        const address = await checkAuth(request.headers.get("Authorization"), "POST", path, body);
        if (!address) return fail(401, "Firma no válida.");
        return env.MAILBOX.get(env.MAILBOX.idFromName(address)).fetch("https://box/ack", { method: "POST", body });
      }
      const invite = /^\/v1\/invites\/([A-Za-z0-9_-]{32})$/.exec(path);
      if (invite) {
        const card = env.INVITE.get(env.INVITE.idFromName(invite[1]));
        if (request.method === "GET") {
          if (limited("invite:" + (request.headers.get("CF-Connecting-IP") || "?"), LIMITS.invitesPerMinute)) return fail(429, "Demasiados intentos. Espera un minuto.");
          return card.fetch("https://card/get");
        }
        const body = request.method === "PUT" ? await request.text() : "";
        const owner = await checkAuth(request.headers.get("Authorization"), request.method, path, body);
        if (!owner) return fail(401, "Firma no válida.");
        if (request.method === "PUT") return card.fetch("https://card/put", { method: "POST", body: JSON.stringify({ owner, ...JSON.parse(body || "{}") }) });
        if (request.method === "DELETE") return card.fetch("https://card/delete", { method: "POST", body: JSON.stringify({ owner }) });
      }
      return fail(404, "No existe.");
    } catch {
      return fail(400, "Petición no válida.");
    }
  },
};

// ---- one mailbox ------------------------------------------------------------------------
export class Mailbox extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS mail (id TEXT PRIMARY KEY, sender TEXT NOT NULL, env TEXT NOT NULL, at INTEGER NOT NULL)");
    // How much each sender left here each day: nobody can fill your mailbox or the quota.
    this.sql.exec("CREATE TABLE IF NOT EXISTS quota (sender TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (sender, day))");
    this.live = new Map();
    // Keep-alives answered without waking the object (no cost while waiting).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }
  waiting(limit = LIMITS.batch) {
    return this.sql.exec("SELECT id, sender, env FROM mail ORDER BY at, rowid LIMIT ?", limit).toArray().map((r) => ({ id: r.id, from: r.sender, env: JSON.parse(r.env) }));
  }
  push(row) {
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) try { ws.send(JSON.stringify({ type: "mail", ...row })); } catch {}
    return sockets.length > 0;
  }
  ack(ids) {
    let removed = 0;
    for (const id of (Array.isArray(ids) ? ids : []).slice(0, 500)) if (typeof id === "string") removed += this.sql.exec("DELETE FROM mail WHERE id = ?", id).rowsWritten;
    // More waiting than one batch: the next one goes now.
    if (removed && this.ctx.getWebSockets().length) for (const row of this.waiting()) this.push(row);
    return removed;
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/deliver") {
      const row = await request.json();
      if (row.ephemeral) {
        const t = Date.now(), list = (this.live.get(row.from) || []).filter((x) => t - x < 60000);
        if (list.length >= LIMITS.livePerMinute) return fail(429, "Demasiados avisos seguidos.");
        this.live.set(row.from, [...list, t]);
        return json({ ok: true, delivered: this.push({ id: row.id, from: row.from, env: row.env }), stored: false });
      }
      const count = this.sql.exec("SELECT COUNT(*) AS n FROM mail").one().n;
      if (count >= LIMITS.perRecipient) return fail(507, "El buzón de esa persona está lleno.");
      const day = new Date().toISOString().slice(0, 10);
      const used = this.sql.exec("SELECT n FROM quota WHERE sender = ? AND day = ?", row.from, day).toArray()[0]?.n || 0;
      if (used >= LIMITS.perSenderDay) return fail(429, "Demasiados mensajes para esta persona hoy.");
      const added = this.sql.exec("INSERT OR IGNORE INTO mail (id, sender, env, at) VALUES (?, ?, ?, ?)", row.id, row.from, JSON.stringify(row.env), Date.now()).rowsWritten > 0;
      if (added) this.sql.exec("INSERT INTO quota (sender, day, n) VALUES (?, ?, 1) ON CONFLICT (sender, day) DO UPDATE SET n = n + 1", row.from, day);
      if (added && !(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + 86400000);
      return json({ ok: true, delivered: added ? this.push({ id: row.id, from: row.from, env: row.env }) : false, stored: true });
    }
    if (path === "/ws") {
      if (this.ctx.getWebSockets().length >= 4) return fail(429, "Demasiadas conexiones.");
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].send(JSON.stringify({ type: "ready" }));
      for (const row of this.waiting()) pair[1].send(JSON.stringify({ type: "mail", ...row }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (path === "/ack") {
      const data = await request.json().catch(() => ({}));
      return json({ ok: true, removed: this.ack(data.ids) });
    }
    // Bytes of files this address left today (asked before each part is kept).
    if (path === "/blob-quota") {
      const { bytes = 0 } = await request.json().catch(() => ({}));
      const day = new Date().toISOString().slice(0, 10);
      this.sql.exec("CREATE TABLE IF NOT EXISTS blob_quota (day TEXT PRIMARY KEY, bytes INTEGER NOT NULL)");
      const used = this.sql.exec("SELECT bytes FROM blob_quota WHERE day = ?", day).toArray()[0]?.bytes || 0;
      if (used + Number(bytes) > LIMITS.blobBytesDay) return fail(429, "Has compartido demasiado hoy.");
      this.sql.exec("INSERT INTO blob_quota (day, bytes) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET bytes = bytes + excluded.bytes", day, Number(bytes));
      this.sql.exec("DELETE FROM blob_quota WHERE day < ?", new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10));
      return json({ ok: true });
    }
    return fail(404, "No existe.");
  }
  async webSocketMessage(ws, message) {
    try {
      const data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
      if (Array.isArray(data?.ack)) this.ack(data.ack);
    } catch {}
  }
  async webSocketClose(ws, code) {
    try { ws.close(code === 1005 ? 1000 : code, "adiós"); } catch {}
  }
  async alarm() {
    this.sql.exec("DELETE FROM mail WHERE at < ?", Date.now() - LIMITS.keepDays * 86400000);
    this.sql.exec("DELETE FROM quota WHERE day < ?", new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10));
    if (this.sql.exec("SELECT COUNT(*) AS n FROM mail").one().n || this.sql.exec("SELECT COUNT(*) AS n FROM quota").one().n) await this.ctx.storage.setAlarm(Date.now() + 86400000);
  }
}

// ---- one sealed file --------------------------------------------------------------------
// Its parts as the uploader sealed them; whoever has the read token (in the envelopes) can
// download them; everything goes when it expires.
export class Blob extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
  }
  // Again on every request: deleteAll() also drops the tables.
  tables() {
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK (id = 1), owner TEXT NOT NULL, parts INTEGER NOT NULL, read TEXT NOT NULL, expires INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS parts (n INTEGER PRIMARY KEY, data BLOB NOT NULL)");
  }
  meta() { return this.sql.exec("SELECT owner, parts, read, expires FROM meta WHERE id = 1").toArray()[0] || null; }
  async fetch(request) {
    const url = new URL(request.url);
    this.tables();
    let meta = this.meta();
    if (url.pathname === "/get") {
      const n = Number(url.searchParams.get("n"));
      if (!meta || meta.expires < Date.now() || meta.read !== (await sha256(request.headers.get("X-Blob-Token") || ""))) return fail(404, "Ese archivo no existe o ya caducó.");
      const row = this.sql.exec("SELECT data FROM parts WHERE n = ?", n).toArray()[0];
      if (!row) return fail(404, "Esa parte aún no está.");
      return new Response(row.data, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }
    const owner = request.headers.get("X-Owner") || "";
    if (url.pathname === "/put") {
      const n = Number(request.headers.get("X-N"));
      if (!meta) {
        const parts = Number(request.headers.get("X-Blob-Parts"));
        const read = request.headers.get("X-Blob-Read") || "";
        if (n !== 0 || !Number.isInteger(parts) || parts < 1 || parts > LIMITS.blobParts || !/^[A-Za-z0-9_-]{43}$/.test(read)) return fail(400, "Falta la parte 0.");
        const expires = Date.now() + LIMITS.blobKeepDays * 86400000;
        this.sql.exec("INSERT INTO meta (id, owner, parts, read, expires) VALUES (1, ?, ?, ?, ?)", owner, parts, read, expires);
        await this.ctx.storage.setAlarm(expires);
        meta = this.meta();
      }
      if (meta.owner !== owner) return fail(403, "Ese archivo no es tuyo.");
      if (!Number.isInteger(n) || n < 0 || n >= meta.parts) return fail(400, "Parte no válida.");
      this.sql.exec("INSERT OR REPLACE INTO parts (n, data) VALUES (?, ?)", n, await request.arrayBuffer());
      return json({ ok: true, expiresAt: meta.expires });
    }
    if (url.pathname === "/delete") {
      if (meta && meta.owner === owner) await this.ctx.storage.deleteAll();
      return json({ ok: true });
    }
    return fail(404, "No existe.");
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}

// ---- one invitation card ----------------------------------------------------------------
export class Invite extends DurableObject {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const card = await this.ctx.storage.get("card");
    if (path === "/get") {
      if (!card || card.expires < Date.now()) return fail(404, "Esa invitación no existe o ya caducó.");
      return json({ blob: card.blob, expiresAt: card.expires });
    }
    const data = await request.json().catch(() => ({}));
    if (path === "/put") {
      if (typeof data.blob !== "string" || data.blob.length > LIMITS.inviteBytes) return fail(400, "Invitación no válida.");
      if (card && card.owner !== data.owner && card.expires > Date.now()) return fail(409, "Ese código ya está en uso.");
      const expires = Math.min(Number(data.expiresAt) || 0, Date.now() + LIMITS.inviteHours * 3600000);
      if (expires <= Date.now()) return fail(400, "La invitación ya caducó.");
      await this.ctx.storage.put("card", { owner: data.owner, blob: data.blob, expires });
      await this.ctx.storage.setAlarm(expires);
      return json({ ok: true, expiresAt: expires });
    }
    if (path === "/delete") {
      if (card && card.owner === data.owner) await this.ctx.storage.deleteAll();
      return json({ ok: true });
    }
    return fail(404, "No existe.");
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}
