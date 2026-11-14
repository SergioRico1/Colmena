// The local agent link (docs/CLOUD.md › Phase 5): what the desktop and the cloud say to each other
// over the agent's WebSocket, shared by both ends. No Node-only import at module scope: the cloud
// side runs in workerd (the Workspace Durable Object), the desktop side in Node.
//
//   desktop ──wss──► Worker /agent/connect?workspace=W&device=D ──► Workspace DO
//   DO     → agent  {type:"challenge", nonce, at}
//   agent  → DO     {type:"hello", at, lends, sig}          sig = Ed25519(helloPayload(...))
//   DO     → agent  {type:"welcome", person, workspace, bots} | {type:"refused", code, message}
//   DO     → agent  {type:"call", id, cap, op, args, bot, mission, person, exp}
//   agent  → DO     {type:"result", id, ok, result | error:{message, code}}
//   agent  → DO     {type:"lends", at, lends, sig}            what this computer lends changed
//   either          '{"type":"ping"}' / '{"type":"pong"}'    keep-alive (answered by the platform)
//
// The device key never leaves the computer: the cloud keeps only its public half (raw Ed25519,
// base64url). The challenge is a fresh nonce per socket, used once and only for 2 minutes, so a
// captured hello cannot be replayed; a call carries a unique id and an expiry, and the agent
// refuses an id it has seen or a call past its expiry.

export const PROTOCOL = "colmena-agent.v1";
export const HELLO_WINDOW_MS = 2 * 60 * 1000;
export const CALL_MAX_MS = 15 * 60 * 1000;
/** A result larger than this does not travel (the platform's WebSocket frames stop at 1 MiB). */
export const MAX_RESULT_CHARS = 900_000;
/** What a computer can lend, by the names the person sees. */
export const CAPABILITIES = Object.freeze(["carpetas", "navegador", "ordenador", "contrasenas", "dictado", "codigo"]);
export const CAPABILITY_LABELS = Object.freeze({
  carpetas: "Carpetas", navegador: "Navegador con tus sesiones", ordenador: "Apps y programas", contrasenas: "Gestor de contraseñas",
  dictado: "Dictado del sistema", codigo: "Claude Code de este ordenador",
});
export const OFFLINE_CODE = "AGENT_OFFLINE";

const B64URL = /^[A-Za-z0-9_-]+$/;
export const DEVICE_ID = /^[a-f0-9]{24}$/;
const subtle = () => globalThis.crypto?.subtle;

export function toB64url(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64url(text) {
  if (typeof text !== "string" || !B64URL.test(text)) throw Error("base64url expected");
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
/** A raw Ed25519 public key in base64url: 32 bytes. */
export function validPublicKey(text) {
  try { return fromB64url(text).length === 32; } catch { return false; }
}

/** JSON with sorted keys: the same object signs the same on both ends. */
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
}
export async function sha256Hex(text) {
  const digest = await subtle().digest("SHA-256", new TextEncoder().encode(String(text)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** What the device signs to say hello (or that what it lends changed) on this socket. */
export async function helloPayload({ kind = "hello", workspaceId, deviceId, nonce, at, lends }) {
  return ["colmena-agent-v1", kind, workspaceId, deviceId, nonce, String(at), await sha256Hex(canonical(lends || {}))].join("\n");
}
/** The fingerprint a person compares on both screens before approving a device: «3F2A-91C0-7B4E». */
export async function fingerprint(publicKey) {
  const hex = (await sha256Hex(publicKey)).slice(0, 12).toUpperCase();
  return hex.match(/.{4}/g).join("-");
}
export async function verifySignature(publicKey, payload, signature) {
  try {
    const key = await subtle().importKey("raw", fromB64url(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await subtle().verify("Ed25519", key, fromB64url(signature), new TextEncoder().encode(payload));
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ what a computer lends
const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);
const botList = (list) => [...new Set((Array.isArray(list) ? list : []).filter((b) => typeof b === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(b)))].slice(0, 100);
/**
 * The cloud's view of a device's lends: labels, ids and which bots, never a path, a password
 * or a key. Whatever else the agent sends is dropped.
 */
export function cleanLends(raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const cap = (x) => (x && typeof x === "object" && x.enabled !== false ? { bots: botList(x.bots) } : null);
  const folders = (Array.isArray(r.folders) ? r.folders : []).slice(0, 50)
    .filter((f) => f && /^[A-Za-z0-9_-]{1,40}$/.test(String(f.id || "")))
    .map((f) => ({ id: String(f.id), label: clip(f.label, 80) || "Carpeta", access: f.access === "escribe" ? "escribe" : "lee", bots: botList(f.bots) }));
  const out = { folders };
  const navegador = cap(r.navegador), ordenador = cap(r.ordenador), contrasenas = cap(r.contrasenas), codigo = cap(r.codigo);
  if (navegador) out.navegador = navegador;
  if (ordenador) out.ordenador = { ...ordenador, apps: (Array.isArray(r.ordenador?.apps) ? r.ordenador.apps : []).slice(0, 30).map((a) => ({ id: clip(a?.id, 60), label: clip(a?.label, 60) })).filter((a) => a.id) };
  if (contrasenas) out.contrasenas = { ...contrasenas, logins: (Array.isArray(r.contrasenas?.logins) ? r.contrasenas.logins : []).slice(0, 100).map((l) => ({ id: clip(l?.id, 120), label: clip(l?.label, 80), domain: clip(l?.domain, 120), username: clip(l?.username, 80), bots: botList(l?.bots) })).filter((l) => l.id && l.domain) };
  if (codigo) out.codigo = { ...codigo, engines: (Array.isArray(r.codigo?.engines) ? r.codigo.engines : []).filter((e) => ["claude", "codex", "opencode"].includes(e)), folders: (Array.isArray(r.codigo?.folders) ? r.codigo.folders : []).slice(0, 20).map((f) => ({ id: clip(f?.id, 40), label: clip(f?.label, 80) })).filter((f) => f.id) };
  if (r.dictado === true) out.dictado = true;
  return out;
}
/** Which capability a computer tool needs on the person's computer. */
export function capabilityOf(tool) {
  if (tool === "browser_sign_in") return "contrasenas";
  if (/^browser_/.test(tool)) return "navegador";
  if (["open_file", "open_app", "run_command"].includes(tool) || /^desktop_/.test(tool)) return "ordenador";
  if (tool === "list_folder" || tool === "read_folder_file") return "carpetas";
  if (tool === "code_local") return "codigo";
  return null;
}
/** Whether a lends view lets `botId` use `cap` (folders: that folder; passwords: that login). */
export function lendsAllow(lends, { cap, botId, folderId = null, loginId = null }) {
  if (!lends || !botId) return false;
  if (cap === "carpetas") return (lends.folders || []).some((f) => f.id === folderId && f.bots.includes(botId));
  const c = lends[cap];
  if (!c || !Array.isArray(c.bots) || !c.bots.includes(botId)) return false;
  if (cap === "contrasenas" && loginId) return (c.logins || []).some((l) => l.id === loginId && (!l.bots?.length || l.bots.includes(botId)));
  return true;
}

// ------------------------------------------------------------------ calls, seen once
/** The agent's memory of call ids (replay protection): an id is accepted once, before its expiry. */
export class ReplayGuard {
  constructor({ clock = () => Date.now(), max = 5000 } = {}) {
    this.clock = clock;
    this.max = max;
    this.seen = new Map(); // id → expiry
  }
  /** null when the call may run; otherwise why not. */
  check(call) {
    const t = this.clock();
    for (const [id, exp] of this.seen) { if (exp < t) this.seen.delete(id); else break; }
    if (!call || typeof call.id !== "string" || !/^[A-Za-z0-9_.:-]{8,120}$/.test(call.id)) return "Llamada sin identificador.";
    const exp = Number(call.exp);
    if (!Number.isFinite(exp) || exp < t) return "Esta petición ha caducado.";
    if (exp > t + CALL_MAX_MS) return "Esta petición pide demasiado tiempo.";
    if (this.seen.has(call.id)) return "Esta petición ya se recibió una vez.";
    this.seen.set(call.id, exp);
    if (this.seen.size > this.max) this.seen.delete(this.seen.keys().next().value);
    return null;
  }
}

export class AgentError extends Error {
  constructor(message, code = "AGENT") {
    super(message);
    this.code = code;
  }
}
/** What a bot is told when the person's computer is off. */
export const offlineMessage = (deviceName) =>
  "El ordenador de la persona" + (deviceName ? " («" + deviceName + "»)" : "") + " está apagado o sin conexión: ahora no puedo usarlo. Díselo con estas palabras y sigue con lo demás; cuando abra Colmena en ese ordenador, se puede repetir.";
