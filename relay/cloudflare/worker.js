// Colmena's mailbox («buzón») on Cloudflare Workers + Durable Objects: the same contract as
// relay/server.mjs (it stores and forwards sealed envelopes it cannot read), but the live
// channel is a hibernating WebSocket, so a Colmena waiting for messages costs nothing while
// nothing arrives. One Durable Object per mailbox (address) and one per invitation card.
//   GET  /v1/health                      {ok, service, version, stream: "ws"}
//   POST /v1/send {to, env, ephemeral?}  signed by the sender; checks the envelope's signature
//   GET  /v1/ws?auth=<Colmena …>         your mailbox: what waits, then what arrives
//   POST /v1/ack {ids}                   received: delete (also over the socket: {"ack":[…]})
//   PUT|GET|DELETE /v1/invites/:lookup   an encrypted invitation card (25 h at most)
// Signatures are the ones of server/peers/protocol.mjs, checked here with WebCrypto Ed25519.
import { DurableObject } from "cloudflare:workers";

const LIMITS = { keepDays: 7, perRecipient: 5000, envelope: 72 * 1024, inviteBytes: 4096, inviteHours: 25, skew: 300, maxAge: 30 * 86400, batch: 300 };
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
const sha256 = async (text) => b64u(await crypto.subtle.digest("SHA-256", enc.encode(text)));
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
      if (path === "/v1/health" && request.method === "GET") return json({ ok: true, service: "colmena-buzon", version: 1, stream: "ws" });
      if (path === "/v1/send" && request.method === "POST") {
        const body = await request.text();
        if (body.length > LIMITS.envelope * 2) return fail(413, "Demasiado grande.");
        const from = await checkAuth(request.headers.get("Authorization"), "POST", path, body);
        if (!from) return fail(401, "Firma no válida.");
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
        if (request.method === "GET") return card.fetch("https://card/get");
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
      if (row.ephemeral) return json({ ok: true, delivered: this.push({ id: row.id, from: row.from, env: row.env }), stored: false });
      const count = this.sql.exec("SELECT COUNT(*) AS n FROM mail").one().n;
      if (count >= LIMITS.perRecipient) return fail(507, "El buzón de esa persona está lleno.");
      const added = this.sql.exec("INSERT OR IGNORE INTO mail (id, sender, env, at) VALUES (?, ?, ?, ?)", row.id, row.from, JSON.stringify(row.env), Date.now()).rowsWritten > 0;
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
    if (this.sql.exec("SELECT COUNT(*) AS n FROM mail").one().n) await this.ctx.storage.setAlarm(Date.now() + 86400000);
  }
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
