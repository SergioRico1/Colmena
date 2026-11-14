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
import { R2Blobs, SqlBlobs } from "../../server/cloud/blobs.mjs";
import { uploadFile, fileHeaders } from "../../server/cloud/chat-routes.mjs";
import { sendMail } from "./mail.js";
import { machineClient } from "../../server/machine/seam.mjs";
import { renderingDriver } from "./browser.js";

const CODE = /^\/api\/code(\/|$)/;
const PREVIEW = /^\/__preview\/([A-Za-z0-9_-]{32})(\/.*)?$/;

const UPLOAD = /^\/api\/chat\/files$/;
const IMPORT_PART = /^\/api\/chat\/import\/([0-9a-f-]{36})\/parts\/(\d{1,4})$/;
const DOWNLOAD = /^\/api\/chat\/files\/([0-9a-f-]{36})$/;
const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

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
      // Team messaging's files and import parts: R2 (EU) when bound, else this object's SQLite.
      const blobs = this.env.FILES ? new R2Blobs(this.env.FILES, "workspaces/" + workspaceId) : new SqlBlobs(this.ctx.storage.sql);
      const vapid = this.env.VAPID_PUBLIC_KEY && this.env.VAPID_PRIVATE_KEY ? { publicKey: this.env.VAPID_PUBLIC_KEY, privateKey: this.env.VAPID_PRIVATE_KEY, subject: this.env.VAPID_SUBJECT || "mailto:avisos@colmena.invalid" } : null;
      // Phase 4: the company's machine (a container behind the Machine DO) and Browser Rendering.
      const env = this.env;
      const machine = env.MACHINE ? machineClient({
        fetch: (url, init) => this.machineStub(workspaceId).fetch(new Request(url, init)),
        headers: () => ({ "X-Machine-Workspace": workspaceId, "X-Machine-Quota": String(store.get("settings", "main")?.machineMinutes || "") }),
      }) : null;
      const browserDriver = env.BROWSER ? renderingDriver(env.BROWSER, { onLaunch: (ms) => { this.browserLaunches = [...(this.browserLaunches || []), ms].slice(-20); } }) : null;
      const host = hostWorkspace({ machine, browserDriver, machineInfo: env.MACHINE ? () => this.machineStatus(workspaceId) : null, store, workspace: { id: workspaceId, name: mark?.title || "" }, masters, files, blobs, vapid,
        // Phase 3: webhook addresses and MCP callbacks on the public site; the fake model only
        // when the Worker has the test secret (each workspace still needs its own flag).
        publicUrl: this.env.PUBLIC_URL || "", testing: !!this.env.FAKE_MODEL_TOKEN,
        defer: (promise) => { const p = Promise.resolve(promise).catch((e) => console.error("workspace deferred: " + (e?.stack || e))); try { this.ctx.waitUntil(p); } catch {} return p; },
        presence: () => this.presence(),
        // Phase 5: the open sockets of each person's computers (server/agent-link/hub.mjs).
        agentSockets: (tag) => this.ctx.getWebSockets(tag).map((ws) => this.agentSocket(ws)) });
      const server = http.createServer(host.app);
      const port = nextPort++;
      await new Promise((resolve) => server.listen(port, resolve));
      this.port = port;
      this.workspaceId = workspaceId;
      this.host = host;
      if ((await this.ctx.storage.get("workspaceId")) !== workspaceId) await this.ctx.storage.put("workspaceId", workspaceId);
      // Sockets that were open while the object hibernated get their feed again.
      for (const ws of this.ctx.getWebSockets()) this.attach(ws);
      // Work an eviction cut (a deploy, a crash, memory) goes on by itself, as the person it is for.
      this.bootedAt = Date.now();
      try {
        const resumed = host.resume();
        if (resumed?.length) console.log("workspace resumed " + resumed.length + " mission(s) after a wake-up");
      } catch (error) { console.error("workspace resume: " + (error?.stack || error)); }
      // The alarm comes back for whatever bots wait on (routines, heartbeats of running work).
      this.ctx.waitUntil(this.scheduleFor(host).catch(() => {}));
      return host;
    })();
    try {
      return await this.booting;
    } catch (error) {
      this.booting = null;
      throw error;
    }
  }

  /** The company's Machine DO (one container): in the EU jurisdiction when the Worker says so. */
  machineStub(workspaceId) {
    const j = this.env.MACHINE_JURISDICTION;
    const n = j ? this.env.MACHINE.jurisdiction(j) : this.env.MACHINE;
    return n.get(n.idFromName("machine:" + workspaceId));
  }

  /** A socket of the local agent as the hub sees it (attachment, send, close, last keep-alive). */
  agentSocket(ws) {
    return {
      attachment: () => { try { return ws.deserializeAttachment(); } catch { return null; } },
      setAttachment: (a) => ws.serializeAttachment(a),
      send: (text) => ws.send(text),
      close: (code, reason) => ws.close(code, reason),
      lastPing: () => { try { return this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() || 0; } catch { return 0; } },
    };
  }

  attach(ws) {
    if (this.feeds.has(ws)) return;
    const { person, agent } = ws.deserializeAttachment() || {};
    if (agent) return;
    if (!person?.id) { try { ws.close(4001, "unknown"); } catch {} return; }
    const close = this.host.openFeed(person, (event) => {
      try { ws.send(JSON.stringify(event)); } catch {}
    }, { watching: () => { try { return ws.deserializeAttachment()?.watch || null; } catch { return null; } } });
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
    // Phase 5: a computer's local agent (outbound from the desktop). It proves who it is with its
    // device key on this socket (a challenge per socket); nothing here trusts a cookie.
    if (url.pathname === "/agent/connect") return this.agentConnect(request, workspaceId);
    // A task's dev server (the Worker's /vista/<workspace>/<token>/…): the token is the capability.
    const preview = PREVIEW.exec(url.pathname);
    if (preview) {
      const headers = Object.fromEntries([...request.headers].map(([k, v]) => [k.toLowerCase(), v]));
      return this.host.preview(preview[1], preview[2] || "/", { method: request.method, headers, search: url.search, body: ["GET", "HEAD"].includes(request.method) ? null : await request.arrayBuffer() });
    }
    // «Código»: straight to the company's machine, streams included (live events, terminals).
    if (CODE.test(url.pathname)) {
      const headers = Object.fromEntries([...request.headers].map(([k, v]) => [k.toLowerCase(), v]));
      const body = ["GET", "HEAD"].includes(request.method) ? null : await request.arrayBuffer();
      try {
        return await this.host.machineProxy({ method: request.method, path: url.pathname, search: url.search, headers, body, person });
      } catch (error) {
        console.error("workspace code: " + (error?.stack || error));
        return json({ error: "La máquina de tu empresa no responde. Prueba en un minuto." }, 502);
      }
    }
    // Team messaging's uploads and downloads stream straight to and from R2 (no body in memory).
    const streamed = await this.streamed(request, url, person);
    if (streamed) return streamed;
    if (url.pathname === "/api/live") {
      if (request.headers.get("Upgrade") !== "websocket") return Response.json({ error: "WebSocket expected." }, { status: 426 });
      if (!person?.id || !this.host.members().some((m) => m.id === person.id)) return Response.json({ error: "No perteneces a este espacio." }, { status: 403 });
      const pair = new WebSocketPair();
      // Tagged with the person: a removal closes exactly their sockets.
      this.ctx.acceptWebSocket(pair[1], [person.id]);
      pair[1].serializeAttachment({ person, workspaceId });
      this.attach(pair[1]);
      try { pair[1].send(JSON.stringify({ type: "ready" })); } catch {}
      this.presenceChanged(person.id);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    // The body is read whole first: a route that answers without reading it (a refusal) must not
    // leave a half-read stream behind, which workerd treats as an uncaught error.
    const body = ["GET", "HEAD"].includes(request.method) ? null : await request.arrayBuffer();
    const response = await handleAsNodeRequest(this.port, new Request(request.url, { method: request.method, headers: request.headers, body }));
    // A mention (the mail digest), an import, a bot's work or a routine may need the alarm sooner.
    if (body !== null) await this.schedule();
    return response;
  }

  async agentConnect(request, workspaceId) {
    if (request.headers.get("Upgrade") !== "websocket") return Response.json({ error: "WebSocket expected." }, { status: 426 });
    const deviceId = request.headers.get("X-Colmena-Agent-Device") || "";
    const device = /^[a-f0-9]{24}$/.test(deviceId) ? this.host.store.get("agentDevices", deviceId) : null;
    if (!device || device.workspaceId !== workspaceId) return Response.json({ error: "Este espacio no conoce este ordenador." }, { status: 404 });
    if (device.status === "revoked") {
      // Said over the socket, so the computer stops trying (a plain 404 looks like a network error).
      const gone = new WebSocketPair();
      gone[1].accept();
      gone[1].send(JSON.stringify({ type: "refused", code: "revoked", message: "Este ordenador se quitó de «Tus dispositivos»." }));
      gone[1].close(4403, "revoked");
      return new Response(null, { status: 101, webSocket: gone[0] });
    }
    // One socket per device: a new one replaces the old (a computer that woke up again).
    for (const old of this.ctx.getWebSockets("agent:" + deviceId)) { try { old.close(4000, "replaced"); } catch {} }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1], ["agent", "agent:" + deviceId]);
    pair[1].serializeAttachment({ agent: true, workspaceId, deviceId });
    this.host.agents.open(this.agentSocket(pair[1]), deviceId);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  /** Who is here: each person with an open screen, "active" unless every screen of theirs says away. */
  presence() {
    const out = new Map();
    for (const ws of this.ctx.getWebSockets()) {
      let a = null;
      try { a = ws.deserializeAttachment(); } catch {}
      if (!a?.person?.id || a.agent) continue;
      if (out.get(a.person.id) !== "active") out.set(a.person.id, a.state === "away" ? "away" : "active");
    }
    return out;
  }
  presenceChanged(personId) {
    if (!this.host) return;
    this.host.chatEmit({ type: "chat.presence", person: personId, presence: this.presence().get(personId) || "offline" }, { people: "all" });
  }
  /** The alarm at the earliest of what the workspace wants (import steps, the digest, upkeep, bots). */
  async schedule(at = null) {
    if (!this.host) return;
    return this.scheduleFor(this.host, at);
  }
  async scheduleFor(host, at = null) {
    const want = at ?? host.nextAlarm(Date.now());
    const current = await this.ctx.storage.getAlarm();
    if (!current || want < current) await this.ctx.storage.setAlarm(want);
  }
  /** Uploads (files, import parts) and file downloads, streamed; null for every other request. */
  async streamed(request, url, person) {
    const upload = request.method === "PUT" && UPLOAD.test(url.pathname);
    const part = request.method === "PUT" ? IMPORT_PART.exec(url.pathname) : null;
    const download = request.method === "GET" ? DOWNLOAD.exec(url.pathname) : null;
    if (!upload && !part && !download) return null;
    const host = this.host;
    const who = person?.id ? host.chat.member(person.id) : null;
    if (!who) return json({ error: "Ya no perteneces a este espacio." }, 403);
    const me = { ...who, name: person.name || who.name, email: person.email || who.email };
    const size = Number(request.headers.get("Content-Length"));
    try {
      if (upload) {
        const q = url.searchParams;
        const file = await uploadFile({ chat: host.chat, blobs: host.blobs }, me, { channel: q.get("channel"), name: q.get("name"), type: request.headers.get("Content-Type"), size, width: q.get("w"), height: q.get("h"), body: request.body });
        return json(file, 201);
      }
      if (part) {
        const out = await host.importer.putPart(me, part[1], Number(part[2]), request.body, Number.isFinite(size) ? size : null);
        return json(out);
      }
      const file = host.chat.fileFor(me, download[1]);
      const found = await host.blobs.get(file.key);
      if (!found) return json({ error: "No existe ese archivo." }, 404);
      return new Response(found.body, { headers: { ...fileHeaders(file, { download: url.searchParams.get("download") === "1" }), "Content-Length": String(found.size) } });
    } catch (error) {
      const status = error?.status || 500;
      if (status >= 500) console.error("workspace stream: " + (error?.stack || error));
      return json({ error: status >= 500 ? "Algo ha fallado. Prueba otra vez." : error.message }, status);
    }
  }

  // ---------------------------------------------------------------- RPC (the Worker only)
  /** The directory's list of people of this workspace (after any change), and its name. */
  async syncMembers(workspaceId, list, name = null) {
    const host = await this.boot(workspaceId);
    return host.syncMembers(list, { name });
  }
  /** An admin action the Worker handled (the directory's): into this company's audit log. */
  async audit(workspaceId, entry) {
    const host = await this.boot(workspaceId);
    host.audit(entry);
    return { ok: true };
  }
  /** The test flags of this workspace ({fakeModel}); refused unless the Worker allows tests. */
  async setTestFlags(workspaceId, flags) {
    const host = await this.boot(workspaceId);
    const out = host.setTestFlags(flags);
    await this.schedule();
    return out;
  }
  /** A request to one of this workspace's webhook addresses (the Worker has already limited its size). */
  async hook(workspaceId, hookId, headers, bytes) {
    const host = await this.boot(workspaceId);
    await host.hook(hookId, { headers, body: Buffer.from(bytes || new ArrayBuffer(0)) });
    await this.schedule();
    return { ok: true };
  }
  /** What the object holds in memory right now: for the e2e (eviction and concurrency checks). */
  async probe(workspaceId) {
    const host = await this.boot(workspaceId);
    return { bootedAt: this.bootedAt || null, working: host.working(), alarm: await this.ctx.storage.getAlarm() };
  }
  /**
   * Test only (the Worker checks the test secret): the object is reset as an eviction would
   * (DurableObjectState#abort). The next request or alarm makes a fresh one from storage.
   */
  async evict(workspaceId) {
    await this.boot(workspaceId);
    await this.schedule(Date.now() + 2000);
    this.ctx.abort("test eviction");
  }

  /** Phase 4, the e2e and Empresa › Máquina: the machine's state, its cold starts and minutes. */
  async machineStatus(workspaceId) {
    await this.boot(workspaceId);
    if (!this.env.MACHINE) return { configured: false };
    const r = await this.machineStub(workspaceId).fetch(new Request("http://machine/__status", { headers: { "X-Machine-Workspace": workspaceId } }));
    return { configured: true, ...(await r.json()), minutesPerMonth: this.host.store.get("settings", "main")?.machineMinutes || Number(this.env.MACHINE_MINUTES_PER_MONTH || 600), browserLaunches: this.browserLaunches || [], browserPages: this.host.browser?.open() || 0 };
  }
  /** Test only: the cloud browser opens a page and reads it (Browser Rendering's launch and CDP, measured). */
  async browserProbe(workspaceId, url) {
    const host = await this.boot(workspaceId);
    if (!host.browser) return { configured: false };
    const t0 = Date.now();
    const args = { missionId: "probe", botId: "probe", url, session: "probe-" + t0 };
    try {
      const page = await host.browser.call("open", args);
      return { ok: true, ms: Date.now() - t0, title: page.title, elements: page.elements, launches: this.browserLaunches || [] };
    } catch (error) {
      return { ok: false, ms: Date.now() - t0, error: String(error?.message || error).slice(0, 500), launches: this.browserLaunches || [] };
    } finally {
      await host.browser.call("close", args).catch(() => {});
    }
  }
  /** Test only: the machine sleeps now (its work packed to R2 first), as the idle alarm would. */
  async machineSleep(workspaceId) {
    await this.boot(workspaceId);
    const r = await this.machineStub(workspaceId).fetch(new Request("http://machine/__sleep", { headers: { "X-Machine-Workspace": workspaceId } }));
    return r.json();
  }
  /** Test only: this company's machine minutes per month (null: the deployment's default). */
  async setMachineQuota(workspaceId, minutes) {
    const host = await this.boot(workspaceId);
    const settings = host.store.get("settings", "main") || { id: "main" };
    host.store.put("settings", { ...settings, id: "main", machineMinutes: minutes == null ? null : Math.max(0.01, Number(minutes)) });
    return { machineMinutes: host.store.get("settings", "main").machineMinutes };
  }

  /** Someone left or was taken out: their open screens close now. */
  async revokePerson(workspaceId, userId) {
    await this.boot(workspaceId);
    let closed = this.host.agents.revokePerson(userId);
    for (const ws of this.ctx.getWebSockets(userId)) {
      this.feeds.get(ws)?.();
      this.feeds.delete(ws);
      try { ws.close(4003, "removed"); closed++; } catch {}
    }
    return { closed };
  }

  // ---------------------------------------------------------------- sockets
  /**
   * What a screen says over its socket (keep-alives never get here: the auto-response answers
   * them without waking the object): typing in a channel (relayed to the channel's other people,
   * nothing stored), «away»/«active» (kept in the socket's attachment) and which channel it has open.
   */
  async webSocketMessage(ws, message) {
    const a = ws.deserializeAttachment() || {};
    if (a.workspaceId) await this.boot(a.workspaceId);
    if (a.agent) {
      // The local agent: its hello, results of calls, what it lends, data it brings.
      try { await this.host.agents.message(this.agentSocket(ws), typeof message === "string" ? message : ""); } catch (error) { console.error("agent: " + (error?.stack || error)); }
      await this.schedule();
      return;
    }
    if (typeof message !== "string" || message.length > 500 || !a.person?.id) return;
    let m = null;
    try { m = JSON.parse(message); } catch { return; }
    const chat = this.host.chat;
    if (m?.type === "typing" && typeof m.channel === "string") {
      const row = chat.row(m.channel);
      if (!row || !chat.canRead(a.person, row)) return;
      const members = new Set(chat.memberIds(row.id));
      const frame = JSON.stringify({ type: "chat.typing", channel: row.id, thread: typeof m.thread === "string" ? m.thread.slice(0, 64) : null, person: a.person.id });
      for (const other of this.ctx.getWebSockets()) {
        if (other === ws) continue;
        let o = null;
        try { o = other.deserializeAttachment(); } catch {}
        if (o?.person?.id && o.person.id !== a.person.id && (members.has(o.person.id) || o.watch === row.id)) { try { other.send(frame); } catch {} }
      }
    } else if (m?.type === "presence" && ["active", "away"].includes(m.state)) {
      const before = this.presence().get(a.person.id);
      ws.serializeAttachment({ ...a, state: m.state });
      if (this.presence().get(a.person.id) !== before) this.presenceChanged(a.person.id);
    } else if (m?.type === "watch") {
      ws.serializeAttachment({ ...a, watch: typeof m.channel === "string" ? m.channel.slice(0, 64) : null });
    }
  }
  async webSocketClose(ws, code) {
    let agent = null;
    try { agent = ws.deserializeAttachment()?.agent ? ws : null; } catch {}
    if (agent) {
      try { ws.close(code === 1005 ? 1000 : code, "bye"); } catch {}
      if (this.host) this.host.agents.closed(this.agentSocket(ws));
      return;
    }
    this.feeds.get(ws)?.();
    this.feeds.delete(ws);
    try { ws.close(code === 1005 ? 1000 : code, "bye"); } catch {}
    let person = null;
    try { person = ws.deserializeAttachment()?.person?.id; } catch {}
    if (person && this.host) this.presenceChanged(person);
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
    const env = this.env;
    const directory = () => { const n = env.JURISDICTION ? env.DIRECTORY.jurisdiction(env.JURISDICTION) : env.DIRECTORY; return n.get(n.idFromName("directory")); };
    const next = await host.tick({
      // People of a Slack import who are not here yet: pending invitations (never mailed).
      invite: async (startedBy, people) => {
        const r = await directory().call("importInvitations", workspaceId, startedBy.id, people);
        if (!r.ok) throw Error(r.error || "invitations");
        return r.value;
      },
      // The digest of unread mentions, through the mail provider (or the dev outbox).
      mail: (digest) => sendMail(env, { to: digest.email, kind: "digest", url: (env.PUBLIC_URL || "") + "/canales", items: digest.items, name: digest.name, workspace: host.store.get("cloud", "workspace")?.title || null }, { keep: async (m) => { await directory().call("keepDevMail", m); } }),
    });
    await this.ctx.storage.setAlarm(next);
    // While bots work the alarm keeps the object awake; each wake-up is short (a tick).
  }
}
