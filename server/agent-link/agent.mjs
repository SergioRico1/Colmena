// The desktop end of the local agent link (docs/CLOUD.md › Phase 5). In cloud mode Colmena's
// desktop app runs this (server/agent-link/main.mjs, a child of Electron): one outbound WebSocket
// to the person's workspace, signed with this computer's own Ed25519 key, that answers the calls
// of their cloud bots with the local implementations (folders, the bot browser with this
// computer's sessions, apps and commands, saved logins from 1Password/Bitwarden, Claude Code).
//
// The agent is the last word on what this computer lends: every call is checked against the
// person's local allowlist (`policy`), whatever the cloud asks. Secrets (the device key, the
// password managers' answers, provider logins) never leave the computer; results never carry a
// path outside a lent folder.
import { createPrivateKey, sign as edSign } from "node:crypto";
import {
  AgentError, CAPABILITIES, MAX_RESULT_CHARS, ReplayGuard, capabilityOf, cleanLends, helloPayload, toB64url,
} from "./protocol.mjs";

export const RECONNECT_MS = Object.freeze({ min: 2000, max: 60_000, pending: 10_000 });
export const PING_MS = 25_000;
const PING = '{"type":"ping"}';

/** The local allowlist, normalised: nothing is lent unless the person turned it on here. */
export function normalizePolicy(raw = {}) {
  const p = raw && typeof raw === "object" ? raw : {};
  const bots = (x) => [...new Set((Array.isArray(x) ? x : []).filter((b) => typeof b === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(b)))];
  const cap = (x) => ({ enabled: x?.enabled === true, bots: bots(x?.bots) });
  return {
    binding: p.binding && typeof p.binding === "object" ? { workspaceId: String(p.binding.workspaceId || ""), deviceId: String(p.binding.deviceId || "") } : null,
    folders: (Array.isArray(p.folders) ? p.folders : []).filter((f) => f && typeof f.path === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(String(f.id || "")))
      .map((f) => ({ id: f.id, path: f.path, label: String(f.label || "").slice(0, 80) || "Carpeta", access: f.access === "escribe" ? "escribe" : "lee", bots: bots(f.bots) })),
    navegador: cap(p.navegador),
    ordenador: { ...cap(p.ordenador), apps: Array.isArray(p.ordenador?.apps) ? p.ordenador.apps.filter((a) => a && typeof a.id === "string").map((a) => ({ id: a.id, label: String(a.label || a.id).slice(0, 60), ...(typeof a.path === "string" ? { path: a.path } : {}) })) : [] },
    contrasenas: { ...cap(p.contrasenas), logins: Array.isArray(p.contrasenas?.logins) ? p.contrasenas.logins.filter((l) => l && l.id) : [] },
    dictado: { enabled: p.dictado?.enabled === true },
    codigo: { ...cap(p.codigo), folders: (Array.isArray(p.codigo?.folders) ? p.codigo.folders : []).filter((f) => f && typeof f.path === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(String(f.id || ""))) },
  };
}

/** What this computer tells the cloud it lends: labels and bot ids, never a path. */
export function lendsOf(policy) {
  const p = normalizePolicy(policy);
  const on = (c) => (c.enabled && c.bots.length ? { bots: c.bots } : null);
  return cleanLends({
    folders: p.folders.filter((f) => f.bots.length).map(({ id, label, access, bots }) => ({ id, label, access, bots })),
    navegador: on(p.navegador),
    ordenador: on(p.ordenador) ? { ...on(p.ordenador), apps: p.ordenador.apps.map((a) => ({ id: a.id, label: a.label || a.id })) } : null,
    contrasenas: on(p.contrasenas) ? { ...on(p.contrasenas), logins: p.contrasenas.logins.map((l) => ({ id: l.id, label: l.label, domain: l.domain, username: l.username, bots: l.bots || [] })) } : null,
    codigo: on(p.codigo) && p.codigo.folders.length ? { ...on(p.codigo), engines: ["claude"], folders: p.codigo.folders.map((f) => ({ id: f.id, label: f.label || f.id })) } : null,
    dictado: p.dictado.enabled,
  });
}

/**
 * Whether the local allowlist lets this call run. Returns null, or the refusal the cloud gets.
 * The cloud's own view of what is lent is never trusted for this.
 */
export function refusalFor(policy, call) {
  const p = normalizePolicy(policy);
  const botId = call?.bot?.id;
  const cap = call?.cap;
  if (!CAPABILITIES.includes(cap) || cap === "dictado") return "Este ordenador no hace eso.";
  if (!botId) return "Falta qué bot lo pide.";
  if (cap === "carpetas") {
    const folder = p.folders.find((f) => f.id === call.args?.folderId);
    if (!folder) return "Esa carpeta no está prestada en este ordenador.";
    if (!folder.bots.includes(botId)) return "La persona no ha prestado esa carpeta a " + (call.bot.name || "este bot") + " en este ordenador.";
    if (!["list", "read"].includes(call.op)) return "Operación no permitida.";
    return null;
  }
  const c = p[cap];
  if (!c?.enabled) return "La persona no ha activado eso en este ordenador.";
  if (!c.bots.includes(botId)) return "La persona no ha prestado eso a " + (call.bot.name || "este bot") + " en este ordenador.";
  if (cap === "codigo") {
    if (call.op !== "run") return "Operación no permitida.";
    if (!p.codigo.folders.some((f) => f.id === call.args?.folderId)) return "Esa carpeta de proyecto no está prestada en este ordenador.";
    return null;
  }
  if (!["plan", "execute"].includes(call.op)) return "Operación no permitida.";
  const tool = String(call.args?.name || "");
  if (capabilityOf(tool) !== cap && !(cap === "contrasenas" && tool === "browser_sign_in")) return "Esa herramienta no corresponde a lo prestado.";
  // A command or a document in a folder: only a folder lent to this bot (or the mission's own).
  const folderId = call.args?.args?.folderId;
  if (["run_command", "open_file"].includes(tool) && folderId && folderId !== "misión" && folderId !== "mision") {
    const f = p.folders.find((x) => x.id === folderId);
    if (!f || !f.bots.includes(botId)) return "Esa carpeta no está prestada a " + (call.bot.name || "este bot") + " en este ordenador.";
  }
  if (tool === "browser_sign_in") {
    const login = p.contrasenas.logins.find((l) => l.id === call.args?.args?.entry);
    if (!login || (login.bots?.length && !login.bots.includes(botId))) return "Ese inicio de sesión no está prestado a " + (call.bot.name || "este bot") + ".";
  }
  return null;
}

/** A result that fits in one frame (images and long pages are the big ones). */
export function fitResult(result) {
  const text = JSON.stringify(result ?? null);
  if (text.length <= MAX_RESULT_CHARS) return result;
  if (result && typeof result === "object" && typeof result.image === "string") {
    const { image: _i, ...rest } = result;
    return { ...rest, imageOmitted: true, note: "La imagen era demasiado grande para enviarla a la nube." };
  }
  throw new AgentError("El resultado es demasiado grande para enviarlo a la nube (más de 900 KB). Pide una parte más pequeña.", "TOO_BIG");
}

/**
 * The agent. `url`: the workspace's site (https://app.colmena.team); `identity()` → {workspaceId,
 * deviceId, privateKey (PKCS#8 PEM or KeyObject)} or null while not registered; `policy()` → the
 * local allowlist; `execute(call)` → the local implementation's result (main.mjs); `onStatus`.
 */
export class LocalAgent {
  constructor({ url, identity, policy, execute, WebSocketImpl = globalThis.WebSocket, clock = () => Date.now(), log = () => {}, onStatus = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
    Object.assign(this, { url: String(url || "").replace(/\/$/, ""), identity, policy, execute, WebSocketImpl, clock, log, onStatus, setTimer, clearTimer });
    this.guard = new ReplayGuard({ clock });
    this.ws = null;
    this.state = { status: "idle", person: null, workspace: null, bots: [], device: null, error: null };
    this.retry = RECONNECT_MS.min;
    this.timer = null;
    this.ping = null;
    this.stopped = true;
    this.imports = new Map();
  }
  setStatus(patch) {
    this.state = { ...this.state, ...patch };
    try { this.onStatus(this.state); } catch {}
  }
  start() {
    this.stopped = false;
    this.connect();
  }
  stop() {
    this.stopped = true;
    this.clearTimer(this.timer);
    clearInterval(this.ping);
    try { this.ws?.close(1000, "bye"); } catch {}
    this.ws = null;
    this.setStatus({ status: "idle" });
  }
  /** Reconnect now (a new binding, the device was just approved, the network came back). */
  restart() {
    this.clearTimer(this.timer);
    try { this.ws?.close(1000, "restart"); } catch {}
    this.ws = null;
    this.retry = RECONNECT_MS.min;
    if (!this.stopped) this.connect();
  }
  later(ms) {
    if (this.stopped) return;
    this.clearTimer(this.timer);
    this.timer = this.setTimer(() => this.connect(), ms);
    this.timer?.unref?.();
  }
  connect() {
    if (this.stopped) return;
    const id = this.identity();
    if (!id?.workspaceId || !id?.deviceId || !id?.privateKey) return this.setStatus({ status: "unregistered" });
    const wsUrl = this.url.replace(/^http/, "ws") + "/agent/connect?workspace=" + encodeURIComponent(id.workspaceId) + "&device=" + encodeURIComponent(id.deviceId);
    this.setStatus({ status: "connecting", error: null });
    let ws;
    try { ws = new this.WebSocketImpl(wsUrl); } catch (error) {
      this.setStatus({ status: "offline", error: String(error?.message || error) });
      return this.later(this.backoff());
    }
    this.ws = ws;
    let refused = null;
    ws.onmessage = (event) => { this.onMessage(ws, id, typeof event.data === "string" ? event.data : String(event.data)).then((r) => { if (r?.refused) refused = r; }).catch((e) => this.log("agent: " + (e?.message || e))); };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      clearInterval(this.ping);
      if (this.stopped) return;
      const code = event?.code;
      if (refused?.refused === "pending" || code === 4409) { this.setStatus({ status: "pending" }); return this.later(RECONNECT_MS.pending); }
      if (code === 4403 || code === 4404 || refused?.refused === "revoked" || refused?.refused === "unknown") { this.setStatus({ status: "revoked", error: refused?.message || null }); return; }
      if (code === 4000) return; // replaced by a newer socket of this computer
      this.setStatus({ status: "offline" });
      this.later(this.backoff());
    };
    ws.onerror = () => {};
  }
  backoff() {
    const ms = this.retry;
    this.retry = Math.min(RECONNECT_MS.max, Math.round(this.retry * 1.8));
    return ms;
  }
  send(frame) {
    if (this.ws?.readyState !== 1) return false;
    try { this.ws.send(typeof frame === "string" ? frame : JSON.stringify(frame)); return true; } catch { return false; }
  }
  lends() { return lendsOf(this.policy()); }
  /** What this computer lends changed (the person edited the allowlist here). */
  sendLends() { return this.send({ type: "lends", at: this.clock(), lends: this.lends() }); }

  async onMessage(ws, id, text) {
    let m = null;
    try { m = JSON.parse(text); } catch { return null; }
    if (m?.type === "pong") return null;
    if (m?.type === "challenge") {
      const lends = this.lends();
      const at = this.clock();
      const payload = await helloPayload({ workspaceId: id.workspaceId, deviceId: id.deviceId, nonce: String(m.nonce || ""), at, lends });
      const key = typeof id.privateKey === "string" ? createPrivateKey(id.privateKey) : id.privateKey;
      const sig = toB64url(edSign(null, Buffer.from(payload), key));
      ws.send(JSON.stringify({ type: "hello", at, lends, sig }));
      return null;
    }
    if (m?.type === "welcome") {
      this.retry = RECONNECT_MS.min;
      clearInterval(this.ping);
      this.ping = setInterval(() => this.send(PING), PING_MS);
      this.ping.unref?.();
      this.setStatus({ status: "online", person: m.person || null, workspace: m.workspace || null, bots: Array.isArray(m.bots) ? m.bots : [], device: m.device || null, error: null });
      return null;
    }
    if (m?.type === "refused") {
      this.setStatus({ status: m.code === "pending" ? "pending" : m.code === "revoked" || m.code === "unknown" ? "revoked" : "offline", error: String(m.message || "") });
      return { refused: m.code, message: m.message };
    }
    if (m?.type === "call") return this.onCall(m);
    if (m?.type === "import-result") {
      const p = this.imports.get(m.id);
      if (p) { this.imports.delete(m.id); m.ok ? p.resolve(m.summary) : p.reject(Error(m.error?.message || "No se pudo.")); }
      return null;
    }
    return null;
  }
  /** One call from the cloud: replay check, the local allowlist, then the local implementation. */
  async onCall(call) {
    const answer = (ok, payload) => this.send({ type: "result", id: call.id, ok, ...(ok ? { result: payload } : { error: payload }) });
    const replay = this.guard.check(call);
    if (replay) { answer(false, { message: replay, code: "REPLAY" }); return { replay }; }
    const refused = refusalFor(this.policy(), call);
    if (refused) { answer(false, { message: refused, code: "NOT_LENT" }); return { refused: "policy", message: refused }; }
    try {
      const result = fitResult(await this.execute(call, normalizePolicy(this.policy())));
      answer(true, result);
      return { ok: true };
    } catch (error) {
      answer(false, { message: String(error?.message || error).slice(0, 600), code: String(error?.code || "ERROR").slice(0, 40) });
      return { error: error?.message };
    }
  }
  /** «Llevar mis datos a la nube»: batches one after the other, each acknowledged. */
  async upload(batches, { installId, onProgress = () => {} } = {}) {
    const totals = { created: 0, updated: 0, unchanged: 0, skipped: 0 };
    let i = 0;
    for (const batch of batches) {
      if (this.state.status !== "online") throw Error("Este ordenador no está conectado a la nube ahora.");
      const id = "imp-" + this.clock() + "-" + i++;
      const summary = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.imports.delete(id); reject(Error("La nube no respondió a tiempo.")); }, 120_000);
        this.imports.set(id, { resolve: (s) => { clearTimeout(timer); resolve(s); }, reject: (e) => { clearTimeout(timer); reject(e); } });
        if (!this.send({ type: "import", id, batch: { installId, ...batch } })) { clearTimeout(timer); this.imports.delete(id); reject(Error("Se perdió la conexión.")); }
      });
      for (const k of Object.keys(totals)) totals[k] += Number(summary?.[k]) || 0;
      onProgress({ done: i, total: batches.length, kind: batch.kind, totals });
    }
    return totals;
  }
}
