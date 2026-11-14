// Colmena hosted, Phase 0 (docs/CLOUD.md): the Worker routes /w/:workspace/* to that
// workspace's Durable Object, and the object runs the desktop's own store (server/store.mjs) on
// its SQLite through the DO adapter (server/store-driver.mjs › DoDriver). Store changes go out
// over hibernating WebSockets (the cloud's replacement for the desktop's SSE).
//   GET  /w/:ws/info                      {workspace, driver, encrypted, kinds}
//   GET  /w/:ws/records/:kind             every record of a kind
//   GET  /w/:ws/records/:kind/:id         one record (404 when missing)
//   PUT  /w/:ws/records/:kind/:id         store a record (JSON body; its id is the path's)
//   POST /w/:ws/bench?n=1000              n puts and n gets inside the object (timings in ms)
//   GET  /w/:ws/ws                        WebSocket: {"op":"put",kind,data,req} in;
//                                         {"type":"change",…} and {"type":"ack",req} out
// Every request carries the shared test token (secret CLOUD_TOKEN): `Authorization: Bearer …`,
// or for a WebSocket the subprotocols ["colmena.v1", "token.<token>"]. Without a configured
// token, or without WORKSPACE_KEYS (the master of the per-workspace database keys), it refuses.
import { DurableObject } from "cloudflare:workers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Store } from "../../server/store.mjs";
import { DoDriver } from "../../server/store-driver.mjs";

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const KIND = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const ID = /^[A-Za-z0-9_.:-]{1,200}$/;
const PROTOCOL = "colmena.v1";
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const fail = (status, error) => json({ error }, status);

function sameSecret(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string" || !expected) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function tokenOf(request) {
  const bearer = /^Bearer (\S+)$/.exec(request.headers.get("Authorization") || "")?.[1];
  if (bearer) return bearer;
  const protocols = (request.headers.get("Sec-WebSocket-Protocol") || "").split(",").map((s) => s.trim());
  return protocols.find((p) => p.startsWith("token."))?.slice(6) || null;
}
/** The 32-byte database key of one workspace: HMAC-SHA256 of its name under the master secret. */
function workspaceKey(master, workspace) {
  if (!/^[0-9a-f]{64}$/i.test(master || "")) throw Error("WORKSPACE_KEYS is not configured.");
  return createHmac("sha256", Buffer.from(master, "hex")).update("colmena-workspace-key-v1\u0000" + workspace).digest();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, service: "colmena-nube", phase: 0 });
    const m = /^\/w\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!m) return fail(404, "Not found.");
    if (!env.CLOUD_TOKEN || !env.WORKSPACE_KEYS) return fail(503, "Not configured.");
    if (!sameSecret(tokenOf(request), env.CLOUD_TOKEN)) return fail(401, "Unauthorized.");
    const workspace = decodeURIComponent(m[1]);
    if (!NAME.test(workspace)) return fail(400, "Invalid workspace name.");
    const namespace = env.JURISDICTION ? env.WORKSPACE.jurisdiction(env.JURISDICTION) : env.WORKSPACE;
    const stub = namespace.get(namespace.idFromName(workspace));
    const headers = new Headers(request.headers);
    headers.set("X-Colmena-Workspace", workspace);
    headers.set("X-Colmena-Path", m[2] || "/");
    return stub.fetch(new Request(request, { headers }));
  },
};

export class Workspace extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = null;
    this.workspace = null;
  }
  /** The workspace's store, opened once per wake-up (the name comes with every request and socket). */
  open(workspace) {
    if (this.store) {
      if (workspace !== this.workspace) throw Error("Workspace mismatch.");
      return this.store;
    }
    const store = new Store(null, { driver: new DoDriver(this.ctx.storage), keyProvider: () => workspaceKey(this.env.WORKSPACE_KEYS, workspace) });
    // The same object always serves the same name (idFromName); written once, checked after.
    const mark = store.get("cloud", "workspace");
    if (!mark) store.put("cloud", { id: "workspace", name: workspace, createdAt: new Date().toISOString() }, { silent: true });
    else if (mark.name !== workspace) throw Error("Workspace mismatch.");
    store.listeners.add((change) => this.broadcast(change));
    this.store = store;
    this.workspace = workspace;
    return store;
  }
  broadcast(change) {
    const text = JSON.stringify({ type: "change", change });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(text); } catch {}
    }
  }
  async fetch(request) {
    const workspace = request.headers.get("X-Colmena-Workspace");
    const route = request.headers.get("X-Colmena-Path") || "/";
    let store;
    try {
      store = this.open(workspace);
    } catch (error) {
      return fail(500, error.message);
    }
    const url = new URL(request.url);
    if (route === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return fail(426, "WebSocket expected.");
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ workspace });
      return new Response(null, { status: 101, webSocket: pair[0], headers: { "Sec-WebSocket-Protocol": PROTOCOL } });
    }
    if (route === "/info" && request.method === "GET") {
      const kinds = Object.fromEntries(this.ctx.storage.sql.exec("SELECT kind, count(*) AS n FROM records GROUP BY kind").toArray().map((r) => [r.kind, r.n]));
      return json({ workspace, driver: store.db.kind, encrypted: store.encrypted, kinds, sockets: this.ctx.getWebSockets().length, bytes: this.ctx.storage.sql.databaseSize });
    }
    if (route === "/bench" && request.method === "POST") {
      const n = Math.min(Math.max(Number(url.searchParams.get("n")) || 1000, 1), 10000);
      const t0 = performance.now();
      for (let i = 0; i < n; i++) store.put("bench", { id: "b" + i, n: i, text: "x".repeat(200) }, { silent: true });
      const t1 = performance.now();
      for (let i = 0; i < n; i++) if (!store.get("bench", "b" + i)) return fail(500, "Lost a record.");
      const t2 = performance.now();
      const listed = store.list("bench").length;
      const t3 = performance.now();
      // Deployed, workerd's clock only advances on I/O (Spectre mitigation), so these may read 0:
      // the smoke also times the whole request from outside, minus one empty round trip.
      return json({ n, putMs: t1 - t0, getMs: t2 - t1, listMs: t3 - t2, listed });
    }
    if (route === "/selftest" && request.method === "POST") return json(this.selftest());
    const r = /^\/records\/([^/]+)(?:\/([^/]+))?$/.exec(route);
    if (r) {
      const kind = decodeURIComponent(r[1]), id = r[2] ? decodeURIComponent(r[2]) : null;
      if (!KIND.test(kind) || kind === "cloud" || (id !== null && !ID.test(id))) return fail(400, "Invalid kind or id.");
      if (request.method === "GET" && id === null) return json(store.list(kind));
      if (request.method === "GET") {
        const record = store.get(kind, id);
        return record ? json(record) : fail(404, "No such record.");
      }
      if (request.method === "PUT" && id !== null) {
        let body;
        try { body = await request.json(); } catch { return fail(400, "JSON body expected."); }
        if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "A JSON object expected.");
        return json(store.put(kind, { ...body, id }));
      }
    }
    return fail(404, "Not found.");
  }
  /** What the real DO SQL does with what the fake (server/do-sql-fake.mjs) assumes. */
  selftest() {
    const sql = this.ctx.storage.sql;
    const attempt = (fn) => { try { return { ok: true, value: fn() }; } catch (error) { return { ok: false, error: String(error.message).slice(0, 160) }; } };
    const out = {};
    out.begin = attempt(() => sql.exec("BEGIN").toArray());
    out.pragmaJournal = attempt(() => sql.exec("PRAGMA journal_mode").toArray());
    out.pragmaTableList = attempt(() => sql.exec("PRAGMA table_list").toArray().length);
    out.tables = attempt(() => sql.exec("SELECT name FROM sqlite_master WHERE type='table'").toArray().map((r) => r.name));
    out.multiStatement = attempt(() => sql.exec("CREATE TABLE IF NOT EXISTS selftest (a TEXT, b BLOB); DELETE FROM selftest; SELECT 7 AS x").one().x);
    out.fts5 = attempt(() => {
      sql.exec("CREATE VIRTUAL TABLE IF NOT EXISTS selftest_fts USING fts5(text, tokenize='unicode61 remove_diacritics 2')");
      sql.exec("INSERT INTO selftest_fts(text) VALUES(?)", "Informe de facturación");
      const hits = sql.exec("SELECT text FROM selftest_fts WHERE selftest_fts MATCH ? ORDER BY bm25(selftest_fts)", '"facturacion"*').toArray().length;
      sql.exec("DROP TABLE selftest_fts");
      return hits;
    });
    out.blobRoundTrip = attempt(() => {
      sql.exec("INSERT INTO selftest(b) VALUES(?)", new Uint8Array([1, 2, 3]).buffer);
      const b = sql.exec("SELECT b FROM selftest").one().b;
      return { type: Object.prototype.toString.call(b), bytes: [...new Uint8Array(b)] };
    });
    out.typedArrayBinding = attempt(() => sql.exec("INSERT INTO selftest(b) VALUES(?)", new Uint8Array([4])).rowsWritten);
    out.changesAfterWrite = attempt(() => { sql.exec("UPDATE selftest SET a='x'").toArray(); return sql.exec("SELECT changes() AS c, last_insert_rowid() AS r").one(); });
    out.rowsWrittenOfOneUpdate = attempt(() => sql.exec("UPDATE selftest SET a='y' WHERE rowid=1").rowsWritten);
    out.value2MBplus = attempt(() => sql.exec("INSERT INTO selftest(a) VALUES(?)", "x".repeat(2 * 1024 * 1024 + 10)).rowsWritten);
    out.value1MB = attempt(() => sql.exec("INSERT INTO selftest(a) VALUES(?)", "x".repeat(1024 * 1024)).rowsWritten);
    out.bindings101 = attempt(() => sql.exec("SELECT " + Array(101).fill("?").join(","), ...Array(101).fill(1)).toArray().length);
    out.nestedTransactionSync = attempt(() => this.ctx.storage.transactionSync(() => this.ctx.storage.transactionSync(() => 1)));
    out.rowPrototype = attempt(() => Object.getPrototypeOf(sql.exec("SELECT 1 AS x").one()) === Object.prototype);
    sql.exec("DROP TABLE IF EXISTS selftest");
    return out;
  }
  async webSocketMessage(ws, message) {
    let msg;
    try { msg = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)); } catch { return; }
    const { workspace } = ws.deserializeAttachment() || {};
    try {
      const store = this.open(workspace);
      if (msg.op === "put" && KIND.test(msg.kind || "") && msg.kind !== "cloud" && ID.test(msg.data?.id || "")) {
        store.put(msg.kind, msg.data);
        ws.send(JSON.stringify({ type: "ack", req: msg.req ?? null }));
      } else if (msg.op === "ping") ws.send(JSON.stringify({ type: "pong", req: msg.req ?? null }));
      else ws.send(JSON.stringify({ type: "error", req: msg.req ?? null, error: "Unknown or invalid message." }));
    } catch (error) {
      ws.send(JSON.stringify({ type: "error", req: msg.req ?? null, error: error.message }));
    }
  }
  async webSocketClose(ws, code) {
    try { ws.close(code, "bye"); } catch {}
  }
}
