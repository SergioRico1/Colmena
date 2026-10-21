// Puente servidor ⇄ Electron para el uso del ordenador.
// Requests:  {type:'computer', id, op, args}  →  {type:'computer-result', id, ok, result | error:{message, code}}
// Pushes:    {type:'computer-frame', missionId, botId, tabId, url, title, takeover, jpegBase64}
//            {type:'computer-event', event:'takeover'|'returned'|'closed', missionId, botId}
// Without Electron (npm run dev, tests) `available` is false and every call fails clearly.

export class ComputerError extends Error {
  constructor(message, code = "ERROR") {
    super(message || "El navegador no pudo completar la acción.");
    this.code = code;
  }
}

export const UNAVAILABLE_MESSAGE =
  "El navegador y las apps de este ordenador solo funcionan en la aplicación de escritorio de Colmena.";

const OP_TIMEOUTS = { open: 45000, preview: 70000, render: 120000, download: 320000, act: 30000, fill: 60000, snapshot: 30000, screenshot: 20000 };
const FRAME_INTERVAL_MS = 1000;
const MAX_FRAME_B64 = 4 * 1024 * 1024;

/**
 * @param {object} o
 * @param {boolean} o.available
 * @param {(message:object)=>void} o.send
 * @param {number} [o.timeoutMs]
 */
export function createBridge({ available = false, send = () => {}, timeoutMs = 60000, now = () => Date.now() } = {}) {
  const pending = new Map();
  const frameListeners = new Set();
  const eventListeners = new Set();
  const lastFrames = new Map(); // missionId → frame (memory only, never SQLite)
  const lastEmit = new Map();
  let seq = 0;

  function emitFrame(frame) {
    for (const fn of [...frameListeners]) {
      try { fn(frame); } catch {}
    }
  }

  function acceptFrame(message) {
    const b64 = message.jpegBase64;
    if (typeof message.missionId !== "string" || typeof b64 !== "string" || !b64 || b64.length > MAX_FRAME_B64) return;
    if (!/^[A-Za-z0-9+/]+=*$/.test(b64.slice(0, 200))) return;
    const frame = {
      type: "browser_frame",
      mission: message.missionId,
      botId: typeof message.botId === "string" ? message.botId : null,
      tabId: typeof message.tabId === "string" ? message.tabId : null,
      url: String(message.url || "").slice(0, 2000),
      title: String(message.title || "").slice(0, 300),
      takeover: !!message.takeover,
      image: "data:image/jpeg;base64," + b64,
      at: now(),
    };
    lastFrames.set(frame.mission, frame);
    const previous = lastEmit.get(frame.mission) || 0;
    if (frame.at - previous < FRAME_INTERVAL_MS) return;
    lastEmit.set(frame.mission, frame.at);
    emitFrame(frame);
  }

  function handleMessage(message) {
    if (!message || typeof message !== "object") return;
    if (message.type === "computer-result") {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new ComputerError(message.error?.message, message.error?.code));
    } else if (message.type === "computer-frame") acceptFrame(message);
    else if (message.type === "computer-event") {
      for (const fn of [...eventListeners]) {
        try { fn({ event: message.event, missionId: message.missionId, botId: message.botId }); } catch {}
      }
    }
  }

  function call(op, args = {}, { timeout, signal } = {}) {
    if (!available) return Promise.reject(new ComputerError(UNAVAILABLE_MESSAGE, "UNAVAILABLE"));
    const id = "c" + ++seq;
    return new Promise((resolve, reject) => {
      const limit = timeout ?? OP_TIMEOUTS[op] ?? timeoutMs;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new ComputerError("El navegador tardó demasiado en responder.", "TIMEOUT"));
      }, limit);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      signal?.addEventListener?.("abort", () => {
        if (!pending.has(id)) return;
        pending.delete(id);
        clearTimeout(timer);
        reject(signal.reason || new ComputerError("Acción cancelada.", "ABORTED"));
      }, { once: true });
      try {
        send({ type: "computer", id, op, args });
      } catch (error) {
        pending.delete(id);
        clearTimeout(timer);
        reject(new ComputerError("No se pudo hablar con la aplicación de escritorio: " + error.message, "UNAVAILABLE"));
      }
    });
  }

  return {
    get available() {
      return available;
    },
    call,
    handleMessage,
    /** Subscribes to throttled frames ({type:'browser_frame', mission, …}). Returns an unsubscribe function. */
    onFrame(fn) {
      frameListeners.add(fn);
      return () => frameListeners.delete(fn);
    },
    onEvent(fn) {
      eventListeners.add(fn);
      return () => eventListeners.delete(fn);
    },
    lastFrame(missionId) {
      return lastFrames.get(missionId) || null;
    },
    /** Stores a capture taken by a tool (e.g. browser_screenshot) as the mission's latest frame. */
    rememberFrame(missionId, { botId = null, url = "", title = "", jpegBase64 }) {
      if (!jpegBase64) return;
      acceptFrame({ missionId, botId, url, title, jpegBase64 });
    },
    forget(missionId) {
      lastFrames.delete(missionId);
      lastEmit.delete(missionId);
    },
    pendingCount: () => pending.size,
  };
}

const enabled = typeof process.send === "function" && process.env.COLMENA_COMPUTER === "1";

/** Singleton used by the server. Available only when launched by desktop/main.cjs. */
export const computer = createBridge({ available: enabled, send: (message) => process.send(message) });
if (enabled) process.on("message", computer.handleMessage);
