// The `Workspace` Durable Object: one company. It runs the desktop's server (server/cloud/host.mjs
// over server/app.mjs) on its own SQLite through the store's DO driver, encrypted with a key
// derived for this workspace, and serves the same /api/* the desktop serves through Cloudflare's
// Node HTTP server support. The live channel is a hibernating WebSocket (/api/live) instead of
// SSE: each socket gets the frames /api/events would have sent, filtered for its person.
// The Worker is the only way in (it signs people in and says who they are); RPC methods keep
// the directory's word in the workspace (its people, removals).
import { DurableObject } from "cloudflare:workers";
import http from "node:http";
import { createHmac } from "node:crypto";
import { handleAsNodeRequest } from "cloudflare:node";
import "./assets.js"; // prompts/ as text (cloud/scripts/gen-assets.mjs)
import { Store } from "../../server/store.mjs";
import { DoDriver } from "../../server/store-driver.mjs";
import { hostWorkspace } from "../../server/cloud/host.mjs";
import { R2Files, SqlFiles } from "../../server/file-store.mjs";

const ID = /^[0-9a-f-]{36}$/;
// Each object's Express server listens on its own port of the isolate (objects can share one).
let nextPort = 41000;

/** The 32-byte database key of one workspace: HMAC-SHA256 of its id under the master secret. */
export function workspaceKey(master, workspaceId) {
  if (!/^[0-9a-f]{64}$/i.test(master || "")) throw Error("WORKSPACE_KEYS is not configured.");
  return createHmac("sha256", Buffer.from(master, "hex")).update("colmena-workspace-key-v1\u0000" + workspaceId).digest();
}

export class Workspace extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.host = null;
    this.booting = null;
    this.port = null;
    this.workspaceId = null;
    this.feeds = new Map(); // WebSocket → close()
    // A client's keep-alive is answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
  }

  /** The workspace's server, made once per wake-up. The id is checked against the one stored. */
  async boot(workspaceId) {
    if (!ID.test(workspaceId || "")) throw Error("Workspace id expected.");
    if (this.host) {
      if (workspaceId !== this.workspaceId) throw Error("Workspace mismatch.");
      return this.host;
    }
    this.booting ??= (async () => {
      const store = new Store("/colmena/" + workspaceId, { driver: new DoDriver(this.ctx.storage), keyProvider: () => workspaceKey(this.env.WORKSPACE_KEYS, workspaceId) });
      const mark = store.get("cloud", "workspace");
      if (!mark) store.put("cloud", { id: "workspace", workspaceId, createdAt: new Date().toISOString() }, { silent: true });
      else if (mark.workspaceId !== workspaceId) throw Error("Workspace mismatch.");
      const masters = this.env.VAULT_MASTER_KEY ? [{ kid: "m1", secret: this.env.VAULT_MASTER_KEY }] : [];
      // Mission files: R2 (EU) when the bucket is bound, else this object's own SQLite.
      const files = this.env.FILES ? new R2Files(this.env.FILES, "workspaces/" + workspaceId) : new SqlFiles(this.ctx.storage.sql);
      const host = hostWorkspace({ store, workspace: { id: workspaceId, name: mark?.title || "" }, masters, files });
      const server = http.createServer(host.app);
      const port = nextPort++;
      await new Promise((resolve) => server.listen(port, resolve));
      this.port = port;
      this.workspaceId = workspaceId;
      this.host = host;
      if ((await this.ctx.storage.get("workspaceId")) !== workspaceId) await this.ctx.storage.put("workspaceId", workspaceId);
      // Sockets that were open while the object hibernated get their feed again.
      for (const ws of this.ctx.getWebSockets()) this.attach(ws);
      return host;
    })();
    try {
      return await this.booting;
    } catch (error) {
      this.booting = null;
      throw error;
    }
  }

  attach(ws) {
    if (this.feeds.has(ws)) return;
    const { person } = ws.deserializeAttachment() || {};
    if (!person?.id) { try { ws.close(4001, "unknown"); } catch {} return; }
    const close = this.host.openFeed(person, (event) => {
      try { ws.send(JSON.stringify(event)); } catch {}
    });
    this.feeds.set(ws, close);
  }

  async fetch(request) {
    const workspaceId = request.headers.get("X-Colmena-Workspace");
    let person = null;
    try { person = JSON.parse(request.headers.get("X-Colmena-Person") || "null"); } catch {}
    try {
      await this.boot(workspaceId);
    } catch (error) {
      console.error("workspace boot: " + (error?.stack || error));
      return Response.json({ error: "El espacio no se pudo abrir. Prueba en unos segundos." }, { status: 503 });
    }
    const url = new URL(request.url);
    if (url.pathname === "/api/live") {
      if (request.headers.get("Upgrade") !== "websocket") return Response.json({ error: "WebSocket expected." }, { status: 426 });
      if (!person?.id || !this.host.members().some((m) => m.id === person.id)) return Response.json({ error: "No perteneces a este espacio." }, { status: 403 });
      const pair = new WebSocketPair();
      // Tagged with the person: a removal closes exactly their sockets.
      this.ctx.acceptWebSocket(pair[1], [person.id]);
      pair[1].serializeAttachment({ person, workspaceId });
      this.attach(pair[1]);
      try { pair[1].send(JSON.stringify({ type: "ready" })); } catch {}
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    // The body is read whole first: a route that answers without reading it (a refusal) must not
    // leave a half-read stream behind, which workerd treats as an uncaught error.
    const body = ["GET", "HEAD"].includes(request.method) ? null : await request.arrayBuffer();
    return handleAsNodeRequest(this.port, new Request(request.url, { method: request.method, headers: request.headers, body }));
  }

  // ---------------------------------------------------------------- RPC (the Worker only)
  /** The directory's list of people of this workspace (after any change), and its name. */
  async syncMembers(workspaceId, list, name = null) {
    const host = await this.boot(workspaceId);
    return host.syncMembers(list, { name });
  }
  /** Someone left or was taken out: their open screens close now. */
  async revokePerson(workspaceId, userId) {
    await this.boot(workspaceId);
    let closed = 0;
    for (const ws of this.ctx.getWebSockets(userId)) {
      this.feeds.get(ws)?.();
      this.feeds.delete(ws);
      try { ws.close(4003, "removed"); closed++; } catch {}
    }
    return { closed };
  }

  // ---------------------------------------------------------------- sockets
  async webSocketMessage(ws) {
    // Nothing is said over the socket yet (writes go through /api/*); waking up re-attaches it.
    const { workspaceId } = ws.deserializeAttachment() || {};
    if (workspaceId) await this.boot(workspaceId);
  }
  async webSocketClose(ws, code) {
    this.feeds.get(ws)?.();
    this.feeds.delete(ws);
    try { ws.close(code === 1005 ? 1000 : code, "bye"); } catch {}
  }
  async webSocketError(ws) {
    this.feeds.get(ws)?.();
    this.feeds.delete(ws);
  }

  /** Timers that must outlive a request (phase 3: routines) come back here as alarms. */
  async alarm() {
    const workspaceId = this.workspaceId || (await this.ctx.storage.get("workspaceId"));
    if (!workspaceId) return;
    const host = await this.boot(workspaceId);
    host.background(() => host.runtime.sweepQuestions?.());
  }
}
