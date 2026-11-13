// Named browser sessions («Sesiones del navegador», docs/COMPUTER.md): each one its own
// persistent Electron partition, so the cookies of «Trabajo» never mix with «Personal».
// - «Principal» (id "principal") is the partition every bot used before
//   (persist:colmena-navegador): nothing to migrate, nothing lost.
// - Others live in SQLite (kind "browserSessions": {id, name, createdAt}); their partition is
//   persist:colmena-s-<id> (desktop/browser.cjs partitionFor).
// - A bot browses in its session (bot.browserSession, default Principal); a mission or a room
//   may override it (mission.browserSession). A session that no longer exists falls back to
//   Principal.
// - Sessions stay on this computer: nothing about them (cookies, passwords) goes over the relay.
// - A turn that answers another person keeps its separate, empty, in-memory session
//   (server/computer/wire.mjs browserSessionOf): it never uses a named session.
import { randomBytes } from "node:crypto";
import { now } from "../store.mjs";

export const PRINCIPAL = "principal";
export const SESSION_ID = /^[a-z0-9]{1,40}$/;
const MAX_SESSIONS = 20;

const cleanName = (name) => String(name || "").replace(/\s+/g, " ").trim().slice(0, 40);

/** The session a bot's browser opens in for this mission: an id, PRINCIPAL when none. */
export function sessionFor(store, mission, bot) {
  for (const wanted of [mission?.browserSession, bot?.browserSession]) {
    if (wanted === PRINCIPAL) return PRINCIPAL;
    if (wanted && SESSION_ID.test(wanted) && store.get("browserSessions", wanted)) return wanted;
  }
  return PRINCIPAL;
}

export class BrowserSessions {
  constructor(store, { computer = null } = {}) {
    this.store = store;
    this.computer = computer;
  }
  list() {
    const own = this.store.list("browserSessions").sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const bots = this.store.list("bots");
    const users = (sid) => bots.filter((b) => b.enabled !== false && (b.browserSession && this.store.get("browserSessions", b.browserSession) ? b.browserSession : PRINCIPAL) === sid).map((b) => ({ id: b.id, name: b.name }));
    return [
      { id: PRINCIPAL, name: "Principal", principal: true, createdAt: null, bots: users(PRINCIPAL) },
      ...own.map((s) => ({ id: s.id, name: s.name, principal: false, createdAt: s.createdAt, bots: users(s.id) })),
    ];
  }
  get(id) {
    if (id === PRINCIPAL) return this.list()[0];
    const s = SESSION_ID.test(String(id || "")) ? this.store.get("browserSessions", id) : null;
    if (!s) throw Object.assign(Error("Esa sesión del navegador ya no existe."), { status: 404 });
    return this.list().find((x) => x.id === id);
  }
  create(name) {
    const n = cleanName(name);
    if (!n) throw Object.assign(Error("Ponle un nombre a la sesión."), { status: 400 });
    const own = this.store.list("browserSessions");
    if (own.length >= MAX_SESSIONS) throw Object.assign(Error("Ya tienes " + MAX_SESSIONS + " sesiones: borra alguna antes."), { status: 409 });
    if ([{ name: "Principal" }, ...own].some((s) => s.name.toLocaleLowerCase("es") === n.toLocaleLowerCase("es")))
      throw Object.assign(Error("Ya hay una sesión que se llama así."), { status: 409 });
    const id = randomBytes(6).toString("hex");
    this.store.put("browserSessions", { id, name: n, createdAt: now() });
    return this.get(id);
  }
  rename(id, name) {
    if (id === PRINCIPAL) throw Object.assign(Error("La sesión Principal no cambia de nombre."), { status: 400 });
    this.get(id);
    const n = cleanName(name);
    if (!n) throw Object.assign(Error("Ponle un nombre a la sesión."), { status: 400 });
    this.store.patch("browserSessions", id, { name: n });
    return this.get(id);
  }
  /** Deletes a session: its cookies are wiped and its bots, missions and rooms go back to Principal. */
  async remove(id) {
    if (id === PRINCIPAL) throw Object.assign(Error("La sesión Principal no se puede borrar."), { status: 400 });
    this.get(id);
    for (const b of this.store.list("bots")) if (b.browserSession === id) this.store.patch("bots", b.id, { browserSession: null });
    for (const m of this.store.list("missions")) if (m.browserSession === id) this.store.patch("missions", m.id, { browserSession: null });
    this.store.remove("browserSessions", id);
    await this.clear(id, { quiet: true });
    return { ok: true };
  }
  /** «Cerrar todas las sesiones»: wipes cookies and storage of that partition (its tabs close). */
  async clear(id, { quiet = false } = {}) {
    if (!this.computer?.available) {
      if (quiet) return { cleared: false };
      throw Object.assign(Error("Solo funciona en la app de escritorio."), { status: 409 });
    }
    try {
      return await this.computer.call("sessionClear", { profile: id });
    } catch (error) {
      if (quiet) return { cleared: false };
      throw error;
    }
  }
  /** The sites with cookies in a session: domains only, never a cookie's value. */
  async sites(id) {
    if (id !== PRINCIPAL) this.get(id);
    if (!this.computer?.available) return { available: false, domains: [] };
    const r = await this.computer.call("sessionSites", { profile: id });
    return { available: true, domains: (r?.domains || []).filter((d) => typeof d === "string").slice(0, 200) };
  }
  /** «Iniciar sesión a mano»: a window of that session for the person, with an address bar. */
  async openManual(id, url = "") {
    const s = this.get(id);
    if (!this.computer?.available) throw Object.assign(Error("Solo funciona en la app de escritorio."), { status: 409 });
    return this.computer.call("sessionOpen", { profile: id, name: s.name, url: String(url || "").slice(0, 2000) });
  }
  /** A bot's session (null = Principal). */
  assignBot(botId, sessionId) {
    if (!this.store.get("bots", botId)) throw Object.assign(Error("Ese bot no existe."), { status: 404 });
    const next = !sessionId || sessionId === PRINCIPAL ? null : (this.get(sessionId), sessionId);
    this.store.patch("bots", botId, { browserSession: next });
    return { botId, browserSession: next || PRINCIPAL };
  }
  /** A mission's or a room's override (null = each bot uses its own). */
  assignMission(missionId, sessionId) {
    if (!this.store.get("missions", missionId)) throw Object.assign(Error("Esa conversación no existe."), { status: 404 });
    const next = !sessionId ? null : sessionId === PRINCIPAL ? PRINCIPAL : (this.get(sessionId), sessionId);
    this.store.patch("missions", missionId, { browserSession: next });
    return { missionId, browserSession: next };
  }
}
