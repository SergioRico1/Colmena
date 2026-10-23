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
        await this.stream();
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
