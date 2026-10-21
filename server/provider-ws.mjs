// One warm WebSocket per bot and mission to the Responses API (OpenAI WebSocket mode, as
// OpenClaw does): no new connection for every round, and when a request only adds items to
// the previous one, just those items travel with `previous_response_id` (the state is kept
// by the connection, so `store: false` still holds). Anything unexpected falls back to the
// usual SSE request: a failed handshake turns WebSockets off for the session, a dropped
// connection before the first event retries over SSE, and a busy socket is never shared.

export const WS_URL = "wss://api.openai.com/v1/responses";
export const HTTP_URL = "https://api.openai.com/v1/responses";
export const WS_IDLE_MS = 5 * 60 * 1000;
export const WS_MAX_AGE_MS = 55 * 60 * 1000;
const OPEN_TIMEOUT_MS = 8000;
const MAX_SOCKETS = 8;
// Header variants tried at the first handshake: plain, then the beta flag Codex sends.
const VARIANTS = [{}, { "OpenAI-Beta": "responses_websockets=2026-02-06" }];

/** Not usable for this request: the caller sends it over SSE instead. */
export class SocketUnavailable extends Error {}

const contextOf = (body) => {
  const { input: _i, previous_response_id: _p, stream: _s, ...rest } = body;
  return JSON.stringify(rest);
};

/**
 * The request to send on a socket that already answered `cont`: only the new input items
 * with previous_response_id, or the whole body when anything earlier changed.
 */
export function continuationBody(body, cont) {
  const { stream: _s, ...full } = body;
  if (!cont?.responseId || contextOf(body) !== cont.context) return { request: full, continued: false };
  const input = Array.isArray(body.input) ? body.input : [];
  const base = [...cont.input, ...cont.output];
  if (input.length <= base.length) return { request: full, continued: false };
  for (let i = 0; i < base.length; i++) if (JSON.stringify(input[i]) !== JSON.stringify(base[i])) return { request: full, continued: false };
  return { request: { ...full, previous_response_id: cont.responseId, input: input.slice(base.length) }, continued: true };
}

export class ResponseSockets {
  constructor({ WebSocketImpl = globalThis.WebSocket, clock = Date.now } = {}) {
    this.WebSocket = WebSocketImpl;
    this.clock = clock;
    this.entries = new Map(); // key → { socket, busy, openedAt, idle, cont, variant }
    this.disabled = typeof WebSocketImpl !== "function";
    this.variant = null; // header variant that worked
  }
  supports(url, key) {
    return !this.disabled && this.clock() >= (this.pausedUntil || 0) && !!key && url === HTTP_URL;
  }
  close(key) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    clearTimeout(entry.idle);
    try { entry.socket.close(1000, "done"); } catch {}
  }
  closeAll() {
    for (const key of [...this.entries.keys()]) this.close(key);
  }
  async open(headers, signal) {
    const variants = this.variant ? [this.variant] : VARIANTS;
    let lastError = null;
    for (const variant of variants) {
      try {
        const socket = await new Promise((resolve, reject) => {
          let socket;
          try {
            socket = new this.WebSocket(WS_URL, { headers: { ...headers, ...variant } });
          } catch (error) {
            return reject(error);
          }
          const timer = setTimeout(() => { cleanup(); try { socket.close(); } catch {} reject(Error("timeout")); }, OPEN_TIMEOUT_MS);
          const onOpen = () => { cleanup(); resolve(socket); };
          const onFail = (event) => { cleanup(); reject(Error(event?.message || event?.reason || "handshake")); };
          const onAbort = () => { cleanup(); try { socket.close(); } catch {} reject(signal.reason || Error("aborted")); };
          const cleanup = () => {
            clearTimeout(timer);
            socket.removeEventListener?.("open", onOpen);
            socket.removeEventListener?.("error", onFail);
            socket.removeEventListener?.("close", onFail);
            signal?.removeEventListener?.("abort", onAbort);
          };
          socket.addEventListener("open", onOpen);
          socket.addEventListener("error", onFail);
          socket.addEventListener("close", onFail);
          signal?.addEventListener?.("abort", onAbort, { once: true });
        });
        this.variant = variant;
        this.failures = 0;
        return socket;
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error;
      }
    }
    // The endpoint did not take the WebSocket (or the token was refreshing): SSE for ten
    // minutes, and for the whole session after three failed handshakes.
    this.failures = (this.failures || 0) + 1;
    if (this.failures >= 3) this.disabled = true;
    else this.pausedUntil = this.clock() + 10 * 60 * 1000;
    throw new SocketUnavailable("WebSocket no disponible: " + (lastError?.message || ""));
  }
  async acquire(key, headers, signal) {
    let entry = this.entries.get(key);
    if (entry && (entry.socket.readyState !== 1 || this.clock() - entry.openedAt > WS_MAX_AGE_MS)) {
      this.close(key);
      entry = null;
    }
    if (entry?.busy) throw new SocketUnavailable("ocupado");
    if (!entry) {
      while (this.entries.size >= MAX_SOCKETS) {
        const idle = [...this.entries].find(([, e]) => !e.busy);
        if (!idle) throw new SocketUnavailable("demasiadas conexiones");
        this.close(idle[0]);
      }
      const socket = await this.open(headers, signal);
      entry = { socket, busy: false, openedAt: this.clock(), idle: null, cont: null };
      this.entries.set(key, entry);
      socket.addEventListener("close", () => { if (this.entries.get(key) === entry) this.entries.delete(key); });
      socket.addEventListener("error", () => {});
    }
    clearTimeout(entry.idle);
    entry.busy = true;
    return entry;
  }
  /**
   * Opens the socket for `key` ahead of time (you started typing): the first round then
   * skips the handshake. Never waits for a busy one, never throws.
   */
  async warm(key, headers) {
    if (this.disabled || this.clock() < (this.pausedUntil || 0) || !key) return false;
    const entry = this.entries.get(key);
    if (entry && entry.socket.readyState === 1 && this.clock() - entry.openedAt <= WS_MAX_AGE_MS) return true;
    try {
      const fresh = await this.acquire(key, headers, AbortSignal.timeout(OPEN_TIMEOUT_MS));
      this.release(key, fresh, true);
      return true;
    } catch {
      return false;
    }
  }
  release(key, entry, keep) {
    entry.busy = false;
    if (!keep) return this.close(key);
    clearTimeout(entry.idle);
    entry.idle = setTimeout(() => this.close(key), WS_IDLE_MS);
    entry.idle.unref?.();
  }
  /**
   * Sends `body`; `collector()` gives a fresh {handle(event), finish()} for each attempt
   * (finish returns the result, or throws like the SSE path). Throws SocketUnavailable when
   * nothing was received yet, so the caller sends it over SSE instead.
   */
  async run({ key, headers, body, signal, collector }) {
    const entry = await this.acquire(key, headers, signal);
    let keep = true;
    try {
      let { request, continued } = continuationBody(body, entry.cont);
      for (let attempt = 0; ; attempt++) {
        const c = collector();
        try {
          await this.exchange(entry.socket, request, signal, c.handle);
          const result = c.finish();
          entry.cont = { context: contextOf(body), input: Array.isArray(body.input) ? body.input : [], output: result.output || [], responseId: result.responseId || null };
          return { ...result, transport: continued ? "ws-continued" : "ws" };
        } catch (error) {
          entry.cont = null;
          // The connection forgot the previous response: send everything once more.
          if (continued && attempt === 0 && error?.code === "previous_response_not_found") {
            ({ request, continued } = continuationBody(body, null));
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      keep = false;
      throw error;
    } finally {
      this.release(key, entry, keep && !signal?.aborted);
    }
  }
  /** One response on the socket. Rejects with SocketUnavailable if it closed before any event. */
  exchange(socket, request, signal, handle) {
    return new Promise((resolve, reject) => {
      let seen = false, done = false;
      const end = (fn, value) => {
        if (done) return;
        done = true;
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("close", onClose);
        socket.removeEventListener("error", onClose);
        signal?.removeEventListener?.("abort", onAbort);
        fn(value);
      };
      const onMessage = (message) => {
        let event;
        try {
          event = JSON.parse(typeof message.data === "string" ? message.data : Buffer.from(message.data).toString("utf8"));
        } catch {
          return end(reject, Object.assign(Error("Respuesta de OpenAI ilegible."), { transient: true }));
        }
        const code = event?.type === "error" ? String(event.error?.code || event.code || "") : "";
        if (/previous_response_not_found/.test(code)) return end(reject, Object.assign(Error("previous response not found"), { code: "previous_response_not_found" }));
        // Refused before anything was said (a limit of the WebSocket mode, or a request the
        // SSE path knows how to adapt, such as an unsupported option): SSE takes over.
        if (!seen && event?.type === "error") return end(reject, new SocketUnavailable(code || "rechazada"));
        seen = true;
        try {
          handle(event);
        } catch (error) {
          return end(reject, error);
        }
        if (["response.completed", "response.failed", "response.incomplete", "response.done"].includes(event?.type)) end(resolve);
      };
      const onClose = () => end(reject, seen
        ? Object.assign(Error("OpenAI cortó la respuesta a medias."), { transient: true })
        : new SocketUnavailable("cerrado"));
      const onAbort = () => {
        try { socket.close(1000, "aborted"); } catch {}
        end(reject, signal.reason || Error("aborted"));
      };
      socket.addEventListener("message", onMessage);
      socket.addEventListener("close", onClose);
      socket.addEventListener("error", onClose);
      signal?.addEventListener?.("abort", onAbort, { once: true });
      try {
        socket.send(JSON.stringify({ type: "response.create", ...request }));
      } catch {
        end(reject, new SocketUnavailable("no se pudo enviar"));
      }
    });
  }
}
