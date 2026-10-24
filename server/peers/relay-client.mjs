// Talks to the mailbox (relay/server.mjs): one SSE stream that delivers what waits and what
// arrives, signed POSTs to send and to confirm. Reconnects by itself with a growing pause.
import { authHeader } from "./protocol.mjs";

const BACKOFF = [1000, 2000, 5000, 10000, 30000];

export class RelayClient {
  constructor({ url, identity, onMail, onStatus = () => {}, fetchImpl = fetch, log = (m) => console.warn("[peers] " + m) }) {
    this.url = String(url).replace(/\/+$/, "");
    this.identity = identity;
    this.onMail = onMail;
    this.onStatus = onStatus;
    this.fetch = fetchImpl;
    this.log = log;
    this.status = "off";
    this.stopped = true;
    this.failures = 0;
    this.controller = null;
    this.acks = [];
    this.ackTimer = null;
  }
  setStatus(status, error = null) {
    if (this.status === status && !error) return;
    this.status = status;
    this.onStatus(status, error);
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    void this.loop();
  }
  stop() {
    this.stopped = true;
    this.controller?.abort();
    clearTimeout(this.wakeTimer);
    clearTimeout(this.ackTimer);
    this.setStatus("off");
  }
  async request(method, path, body) {
    const text = body === undefined ? "" : JSON.stringify(body);
    const res = await this.fetch(this.url + path, {
      method,
      headers: { Authorization: authHeader(this.identity, method, path, text), ...(text ? { "Content-Type": "text/plain" } : {}) },
      ...(text ? { body: text } : {}),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(Error(data.error || "El buzón respondió " + res.status + "."), { status: res.status });
    return data;
  }
  send(to, env, { ephemeral = false } = {}) {
    return this.request("POST", "/v1/send", { to, env, ...(ephemeral ? { ephemeral: true } : {}) });
  }
  putInvite(lookup, blob, expiresAt) { return this.request("PUT", "/v1/invites/" + lookup, { blob, expiresAt }); }
  deleteInvite(lookup) { return this.request("DELETE", "/v1/invites/" + lookup).catch(() => null); }
  async getInvite(lookup) {
    const res = await this.fetch(this.url + "/v1/invites/" + lookup, { signal: AbortSignal.timeout(15000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(Error(data.error || "No se encontró la invitación."), { status: res.status });
    return data;
  }
  /** Part n of a sealed file; part 0 also says how many parts and the read token's hash. */
  async putBlob(id, n, bytes, { parts = null, read = null } = {}) {
    const path = "/v1/blobs/" + id + "/" + n;
    const res = await this.fetch(this.url + path, {
      method: "PUT",
      headers: { Authorization: authHeader(this.identity, "PUT", path, bytes), "Content-Type": "application/octet-stream", ...(n === 0 ? { "X-Blob-Parts": String(parts), "X-Blob-Read": read } : {}) },
      body: bytes,
      signal: AbortSignal.timeout(120000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(Error(data.error || "El buzón respondió " + res.status + "."), { status: res.status });
    return data;
  }
  async getBlob(id, n, token) {
    const res = await this.fetch(this.url + "/v1/blobs/" + id + "/" + n, { headers: { "X-Blob-Token": token }, signal: AbortSignal.timeout(120000) });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw Object.assign(Error(data.error || "El buzón respondió " + res.status + "."), { status: res.status });
    }
    return Buffer.from(await res.arrayBuffer());
  }
  deleteBlob(id) { return this.request("DELETE", "/v1/blobs/" + id).catch(() => null); }
  async health() {
    const res = await this.fetch(this.url + "/v1/health", { signal: AbortSignal.timeout(8000) });
    return res.ok ? res.json() : null;
  }
  ack(id) {
    this.acks.push(id);
    this.ackTimer ??= setTimeout(() => {
      this.ackTimer = null;
      const ids = this.acks.splice(0, 500);
      if (ids.length) this.request("POST", "/v1/ack", { ids }).catch((e) => { this.acks.unshift(...ids); this.log("No se pudo confirmar la recepción: " + e.message); });
    }, 200);
  }
  async loop() {
    while (!this.stopped) {
      this.setStatus("connecting");
      try {
        // The mailbox says how it delivers: SSE (relay/server.mjs) or a WebSocket that
        // sleeps while nothing arrives (relay/cloudflare/worker.js).
        const kind = this.kind || (this.kind = (await this.health().catch(() => null))?.stream === "ws" ? "ws" : "sse");
        await (kind === "ws" ? this.socket() : this.stream());
        this.failures = 0;
      } catch (error) {
        if (this.stopped) break;
        this.failures++;
        this.setStatus("offline", error.message);
      }
      if (this.stopped) break;
      const wait = BACKOFF[Math.min(this.failures, BACKOFF.length - 1)];
      await new Promise((resolve) => { this.wakeTimer = setTimeout(resolve, wait); });
    }
  }
  /** Reconnects now (the network came back, the address changed). */
  kick() {
    this.failures = 0;
    clearTimeout(this.wakeTimer);
    this.controller?.abort();
  }
  /** The WebSocket mailbox: «ready», then {type:"mail"} rows; «ping» every 25 s → «pong». */
  socket() {
    return new Promise((resolve, reject) => {
      const path = "/v1/ws";
      const url = this.url.replace(/^http/, "ws") + path + "?auth=" + encodeURIComponent(authHeader(this.identity, "GET", path));
      const ws = new WebSocket(url);
      let watchdog = null, ping = null, opened = false;
      const alive = () => { clearTimeout(watchdog); watchdog = setTimeout(() => ws.close(4000, "sin respuesta"), 70000); };
      const done = (error) => {
        clearTimeout(watchdog);
        clearInterval(ping);
        this.controller = null;
        if (this.stopped) resolve();
        else reject(error || Error(opened ? "Se cortó la conexión con el buzón." : "El buzón no acepta la conexión."));
      };
      // kick() and stop() close the socket through the same handle as the SSE stream.
      this.controller = { abort: () => { try { ws.close(1000, "adiós"); } catch {} } };
      ws.onopen = () => { opened = true; alive(); ping = setInterval(() => { try { ws.send("ping"); } catch {} }, 25000); };
      // One at a time and in order, as on the SSE stream (a hello before its first message).
      let queue = Promise.resolve();
      ws.onmessage = (e) => {
        alive();
        const text = typeof e.data === "string" ? e.data : Buffer.from(e.data).toString("utf8");
        if (text === "pong") return;
        let event;
        try { event = JSON.parse(text); } catch { return; }
        if (event.type === "ready") { this.failures = 0; this.setStatus("online"); }
        if (event.type === "mail") queue = queue.then(async () => {
          try {
            if (await this.onMail(event)) this.ack(event.id);
          } catch (error) {
            this.log("Un mensaje no se pudo procesar: " + error.message);
          }
        });
      };
      ws.onerror = () => {};
      ws.onclose = () => done();
    });
  }
  async stream() {
    this.controller = new AbortController();
    const path = "/v1/stream";
    const res = await this.fetch(this.url + path, { headers: { Authorization: authHeader(this.identity, "GET", path), Accept: "text/event-stream" }, signal: this.controller.signal });
    if (!res.ok || !res.body) throw Error("El buzón no acepta la conexión (" + res.status + ").");
    const decoder = new TextDecoder();
    let buffer = "";
    // The mailbox pings every 25 s; silence for 70 s means the line is dead.
    let watchdog;
    const alive = () => { clearTimeout(watchdog); watchdog = setTimeout(() => this.controller?.abort(), 70000); };
    alive();
    try {
      for await (const chunk of res.body) {
        alive();
        buffer += decoder.decode(chunk, { stream: true });
        let cut;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const event = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (event === "ready") { this.failures = 0; this.setStatus("online"); }
          if (event === "mail" && data) {
            let row;
            try { row = JSON.parse(data); } catch { continue; }
            try {
              if (await this.onMail(row)) this.ack(row.id);
            } catch (error) {
              this.log("Un mensaje no se pudo procesar: " + error.message);
            }
          }
        }
      }
    } finally {
      clearTimeout(watchdog);
    }
    if (!this.stopped) throw Error("Se cortó la conexión con el buzón.");
  }
}
