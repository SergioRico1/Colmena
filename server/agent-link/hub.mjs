// The cloud end of the local agent link (docs/CLOUD.md › Phase 5): each person's computers
// («Tus dispositivos»), their sockets and the calls a bot's turn sends them. It lives in the
// workspace (the Durable Object in production, Node in the tests) and knows sockets only through
// a small adapter, so hibernation is invisible to it:
//
//   sockets(tag) → [{ attachment(), setAttachment(a), send(text), close(code, reason), lastPing() }]
//
// tag "agent:<deviceId>" lists the sockets of one device. Everything that must survive the object
// sleeping is in the socket's attachment (device, person, nonce, authenticated) or in the store
// (`agentDevices`); only calls in flight live in memory, and a turn waiting on one keeps the
// object awake.
import {
  AgentError, DEVICE_ID, HELLO_WINDOW_MS, OFFLINE_CODE, cleanLends, fingerprint, helloPayload, lendsAllow, offlineMessage,
  toB64url, validPublicKey, verifySignature,
} from "./protocol.mjs";

export const DEVICES = "agentDevices";
export const AGENT_LIMITS = Object.freeze({ devicesPerPerson: 10, pendingMs: 24 * 3600 * 1000, onlineMs: 90 * 1000, callMs: 30_000, name: 60 });
const STATUSES = new Set(["pending", "approved", "revoked"]);
const nowIso = () => new Date().toISOString();
const randomId = (bytes = 12) => [...globalThis.crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
const cleanName = (name) => String(name || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, AGENT_LIMITS.name);
const fail = (message, status = 400, code = null) => Object.assign(Error(message), { status, ...(code ? { code } : {}) });

/**
 * `store`: the workspace's store; `workspace` {id, name}; `memberOf(id)` → member or null;
 * `sockets(tag)` (above); `bots()` → [{id, name}] the person may lend to; `clock`, `log`.
 */
export class AgentHub {
  constructor({ store, workspace, memberOf, sockets = () => [], bots = () => [], importer = null, clock = () => Date.now(), log = () => {} }) {
    this.importer = importer; // (person, batch) → summary: «Llevar mis datos a la nube» (migrate.mjs)
    this.store = store;
    this.workspace = workspace;
    this.memberOf = memberOf;
    this.sockets = sockets;
    this.bots = bots;
    this.clock = clock;
    this.log = log;
    this.pending = new Map(); // call id → {resolve, reject, timer, deviceId}
  }

  // ---------------------------------------------------------------- devices
  view(d, { online = this.isOnline(d.id) } = {}) {
    return {
      id: d.id, name: d.name, platform: d.platform || null, status: d.status, fingerprint: d.fingerprint, createdAt: d.createdAt,
      approvedAt: d.approvedAt || null, revokedAt: d.revokedAt || null, lastSeenAt: d.lastSeenAt || null, online: d.status === "approved" && online,
      lends: d.lends || { folders: [] },
    };
  }
  /** Your devices (never someone else's), newest first, without revoked ones older than 30 days. */
  list(person) {
    const t = this.clock();
    return this.store.list(DEVICES)
      .filter((d) => d.personId === person.id && !(d.status === "revoked" && t - Date.parse(d.revokedAt || 0) > 30 * 86400000) && !(d.status === "pending" && t - Date.parse(d.createdAt) > AGENT_LIMITS.pendingMs))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map((d) => this.view(d));
  }
  mustPerson(person) {
    const m = person?.id ? this.memberOf(person.id) : null;
    if (!m) throw fail("Ya no perteneces a este espacio.", 403);
    if (m.role === "guest") throw fail("Como invitado no puedes prestar un ordenador a los bots.", 403);
    return m;
  }
  /**
   * A computer asks to be one of yours: pending until you approve it (from «Tus dispositivos»).
   * The same key again is the same device (idempotent); a key someone else registered is refused.
   */
  async register(person, { name, publicKey, platform = null } = {}) {
    this.mustPerson(person);
    if (!validPublicKey(publicKey)) throw fail("La clave de este ordenador no es válida.");
    const label = cleanName(name) || "Mi ordenador";
    const same = this.store.list(DEVICES).find((d) => d.publicKey === publicKey && d.status !== "revoked");
    if (same && same.personId !== person.id) throw fail("Este ordenador ya está registrado por otra persona del espacio.", 409);
    if (same) return this.view(same);
    const mine = this.store.list(DEVICES).filter((d) => d.personId === person.id && d.status !== "revoked");
    if (mine.length >= AGENT_LIMITS.devicesPerPerson) throw fail("Ya tienes " + AGENT_LIMITS.devicesPerPerson + " ordenadores. Quita uno en «Tus dispositivos» antes de añadir otro.", 409);
    const device = this.store.put(DEVICES, {
      id: randomId(), personId: person.id, workspaceId: this.workspace.id, name: label, platform: ["win32", "darwin", "linux"].includes(platform) ? platform : null,
      publicKey, fingerprint: await fingerprint(publicKey), status: "pending", createdAt: nowIso(), lends: { folders: [] },
    });
    return this.view(device);
  }
  own(person, id) {
    const d = DEVICE_ID.test(String(id || "")) ? this.store.get(DEVICES, id) : null;
    if (!d || d.personId !== person?.id) throw fail("No existe ese dispositivo.", 404);
    return d;
  }
  /** You approve one of your pending devices (once). */
  approve(person, id) {
    this.mustPerson(person);
    const d = this.own(person, id);
    if (d.status === "approved") return this.view(d);
    if (d.status !== "pending") throw fail("Ese dispositivo se quitó. Vuelve a añadirlo desde el ordenador.", 409);
    if (this.clock() - Date.parse(d.createdAt) > AGENT_LIMITS.pendingMs) throw fail("Esa petición ha caducado. Vuelve a abrir Colmena en ese ordenador.", 410);
    return this.view(this.store.patch(DEVICES, id, { status: "approved", approvedAt: nowIso() }));
  }
  rename(person, id, name) {
    const d = this.own(person, id);
    const label = cleanName(name);
    if (!label) throw fail("Escribe un nombre.");
    return this.view(this.store.patch(DEVICES, d.id, { name: label }));
  }
  /** Revoked: its sockets close now, calls in flight fail and its key never connects again. */
  revoke(person, id) {
    const d = this.own(person, id);
    const out = this.store.patch(DEVICES, d.id, { status: "revoked", revokedAt: nowIso() });
    this.disconnect(d.id, 4403, "revoked");
    return this.view(out, { online: false });
  }
  /** Someone left the company or was deactivated: their computers stop answering. */
  revokePerson(personId) {
    let n = 0;
    for (const d of this.store.list(DEVICES)) if (d.personId === personId) n += this.disconnect(d.id, 4403, "removed");
    return n;
  }
  disconnect(deviceId, code, reason) {
    let n = 0;
    for (const s of this.sockets("agent:" + deviceId)) { try { s.close(code, reason); n++; } catch {} }
    for (const [id, p] of this.pending) if (p.deviceId === deviceId) { this.pending.delete(id); clearTimeout(p.timer); p.reject(new AgentError(offlineMessage(this.store.get(DEVICES, deviceId)?.name), OFFLINE_CODE)); }
    return n;
  }

  // ---------------------------------------------------------------- sockets
  liveSockets(deviceId) {
    const t = this.clock();
    return this.sockets("agent:" + deviceId).filter((s) => {
      const a = s.attachment() || {};
      if (!a.authed || a.deviceId !== deviceId) return false;
      const seen = Math.max(Number(a.authedAt) || 0, Number(s.lastPing?.()) || 0, Number(a.seenAt) || 0);
      return t - seen < AGENT_LIMITS.onlineMs;
    });
  }
  isOnline(deviceId) { return this.liveSockets(deviceId).length > 0; }
  /** A new agent socket: it gets a challenge (a nonce for this socket only). */
  open(socket, deviceId) {
    const nonce = toB64url(globalThis.crypto.getRandomValues(new Uint8Array(24)));
    socket.setAttachment({ ...(socket.attachment() || {}), agent: true, deviceId, nonce, sid: randomId(8), issuedAt: this.clock(), authed: false });
    socket.send(JSON.stringify({ type: "challenge", nonce, at: this.clock(), workspace: this.workspace.id }));
  }
  refuse(socket, code, message, close = 4401) {
    try { socket.send(JSON.stringify({ type: "refused", code, message })); } catch {}
    try { socket.close(close, code); } catch {}
    return { refused: code };
  }
  /** What an agent socket says. Returns what happened (for the tests and the log). */
  async message(socket, text) {
    if (typeof text !== "string" || text.length > 1_100_000) return this.refuse(socket, "size", "Mensaje demasiado grande.", 1009);
    let m = null;
    try { m = JSON.parse(text); } catch { return { ignored: true }; }
    const a = socket.attachment() || {};
    if (!a.agent || !DEVICE_ID.test(a.deviceId || "")) return this.refuse(socket, "socket", "Conexión no válida.");
    if (m?.type === "hello") return this.hello(socket, a, m);
    if (!a.authed) return this.refuse(socket, "auth", "Primero hay que identificarse.");
    const device = this.store.get(DEVICES, a.deviceId);
    if (!device || device.status !== "approved" || !this.memberOf(device.personId)) return this.refuse(socket, "revoked", "Este ordenador ya no está aprobado.", 4403);
    if (m?.type === "result") return this.result(a.deviceId, m);
    if (m?.type === "import") {
      const id = String(m.id || "").slice(0, 80);
      const member = this.memberOf(device.personId);
      try {
        if (!this.importer) throw fail("Este espacio no acepta datos de un ordenador.", 404);
        if (!member || member.role === "guest") throw fail("Como invitado no puedes traer datos al espacio.", 403);
        const summary = await this.importer(member, m.batch || {});
        socket.send(JSON.stringify({ type: "import-result", id, ok: true, summary }));
        return { imported: summary };
      } catch (error) {
        socket.send(JSON.stringify({ type: "import-result", id, ok: false, error: { message: String(error?.message || error).slice(0, 300) } }));
        return { importFailed: error?.message };
      }
    }
    if (m?.type === "lends") {
      const lends = cleanLends(m.lends);
      this.store.put(DEVICES, { ...device, lends, lastSeenAt: nowIso() });
      socket.setAttachment({ ...a, seenAt: this.clock() });
      return { lends };
    }
    return { ignored: true };
  }
  async hello(socket, a, m) {
    const nonce = a.nonce;
    // The nonce is used up whatever happens: a second hello on this socket never works.
    socket.setAttachment({ ...a, nonce: null });
    const device = this.store.get(DEVICES, a.deviceId);
    if (!nonce || a.authed) return this.refuse(socket, "replay", "Esta identificación ya se usó.");
    if (this.clock() - Number(a.issuedAt || 0) > HELLO_WINDOW_MS || Math.abs(this.clock() - Number(m.at)) > HELLO_WINDOW_MS) return this.refuse(socket, "late", "La identificación ha caducado. Vuelve a conectar.");
    if (!device || device.workspaceId !== this.workspace.id) return this.refuse(socket, "unknown", "Este espacio no conoce este ordenador.", 4404);
    if (device.status === "revoked") return this.refuse(socket, "revoked", "Este ordenador se quitó de «Tus dispositivos».", 4403);
    const payload = await helloPayload({ workspaceId: this.workspace.id, deviceId: device.id, nonce, at: m.at, lends: m.lends || {} });
    if (!(await verifySignature(device.publicKey, payload, String(m.sig || "")))) return this.refuse(socket, "signature", "La firma de este ordenador no es válida.");
    if (device.status === "pending") return this.refuse(socket, "pending", "Falta aprobar este ordenador en «Tus dispositivos».", 4409);
    const member = this.memberOf(device.personId);
    if (!member || member.role === "guest") return this.refuse(socket, "member", "La persona de este ordenador ya no puede usarlo con este espacio.", 4403);
    const lends = cleanLends(m.lends);
    this.store.put(DEVICES, { ...device, lends, lastSeenAt: nowIso() });
    socket.setAttachment({ ...a, agent: true, deviceId: device.id, personId: device.personId, nonce: null, authed: true, authedAt: this.clock() });
    socket.send(JSON.stringify({
      type: "welcome", device: { id: device.id, name: device.name }, person: { id: member.id, name: member.name, email: member.email },
      workspace: { id: this.workspace.id, name: this.workspace.name || "" }, bots: this.bots(member),
    }));
    return { welcome: device.id };
  }
  result(deviceId, m) {
    const p = this.pending.get(String(m.id || ""));
    // Only the device the call went to may answer it.
    if (!p || p.deviceId !== deviceId) return { ignored: true };
    this.pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.result ?? null);
    else p.reject(new AgentError(String(m.error?.message || "El ordenador no pudo hacerlo.").slice(0, 600), String(m.error?.code || "AGENT").slice(0, 40)));
    return { result: m.id };
  }
  /** A socket closed: its device's calls in flight fail now instead of waiting for their timeout. */
  closed(socket) {
    const a = socket.attachment?.() || {};
    if (!a.deviceId) return;
    if (this.liveSockets(a.deviceId).some((s) => (s.attachment() || {}).sid !== a.sid)) return;
    for (const [id, p] of this.pending) if (p.deviceId === a.deviceId) { this.pending.delete(id); clearTimeout(p.timer); p.reject(new AgentError(offlineMessage(this.store.get(DEVICES, a.deviceId)?.name), OFFLINE_CODE)); }
  }

  // ---------------------------------------------------------------- routing
  /** Approved devices of a person, with what each lends. */
  devicesOf(personId) {
    return this.store.list(DEVICES).filter((d) => d.personId === personId && d.status === "approved");
  }
  /** Folders a bot may read on this person's computers (online or not): ids «pc.<device>.<folder>». */
  folders(personId, botId) {
    const out = [];
    for (const d of this.devicesOf(personId)) {
      for (const f of d.lends?.folders || []) if (f.bots.includes(botId)) out.push({ id: "pc." + d.id + "." + f.id, label: f.label, access: f.access, computer: d.name, online: this.isOnline(d.id) });
    }
    return out;
  }
  /** What one person's computers lend to a bot, merged (for the tools a turn is offered). */
  lendsFor(personId, botId) {
    const out = { navegador: false, ordenador: false, contrasenas: [], apps: [], codigo: null, folders: this.folders(personId, botId) };
    for (const d of this.devicesOf(personId)) {
      const l = d.lends || {};
      if (lendsAllow(l, { cap: "navegador", botId })) out.navegador = true;
      if (lendsAllow(l, { cap: "ordenador", botId })) { out.ordenador = true; out.apps.push(...(l.ordenador.apps || [])); }
      if (lendsAllow(l, { cap: "contrasenas", botId })) out.contrasenas.push(...(l.contrasenas.logins || []).filter((x) => !x.bots?.length || x.bots.includes(botId)));
      if (lendsAllow(l, { cap: "codigo", botId })) out.codigo = { engines: l.codigo.engines || [], folders: l.codigo.folders || [] };
    }
    return out;
  }
  /**
   * Sends one call to the person's computer that lends `cap` to `bot` (the folder's own device for
   * folders) and waits for its answer. Throws AgentError: NOT_LENT (no computer of theirs lends
   * it), AGENT_OFFLINE (it is off), TIMEOUT, or the agent's own refusal.
   */
  async call({ personId, cap, op, args = {}, bot, mission = null, deviceId = null, folderId = null, loginId = null, timeout = AGENT_LIMITS.callMs }) {
    if (!personId || !bot?.id) throw new AgentError("Solo cuando una persona lo pide.", "NOT_LENT");
    const candidates = this.devicesOf(personId).filter((d) => (!deviceId || d.id === deviceId) && lendsAllow(d.lends, { cap, botId: bot.id, folderId, loginId }));
    if (!candidates.length) throw new AgentError("Ningún ordenador de esta persona presta eso a " + (bot.name || "este bot") + ". Puede activarlo en Colmena, en ese ordenador (Este ordenador › Qué presta).", "NOT_LENT");
    const device = candidates.find((d) => this.isOnline(d.id));
    if (!device) throw new AgentError(offlineMessage(candidates[0].name), OFFLINE_CODE);
    const socket = this.liveSockets(device.id)[0];
    const id = "k" + randomId(10);
    const exp = this.clock() + timeout + 5000;
    const frame = { type: "call", id, cap, op, args, bot: { id: bot.id, name: bot.name || bot.id }, mission: mission ? { id: mission.id, title: String(mission.title || "").slice(0, 120) } : null, person: { id: personId }, exp };
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AgentError("El ordenador «" + device.name + "» no respondió a tiempo. Puede que se haya dormido o perdido la conexión.", "TIMEOUT"));
      }, timeout);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, deviceId: device.id });
      try { socket.send(JSON.stringify(frame)); } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new AgentError(offlineMessage(device.name), OFFLINE_CODE));
        this.log("agent send: " + (error?.message || error));
      }
    });
  }
}

/** A folder id the hub owns: «pc.<device>.<folder>» → {deviceId, folderId}, or null. */
export function agentFolderId(id) {
  const m = /^pc\.([a-f0-9]{24})\.([A-Za-z0-9_-]{1,40})$/.exec(String(id || ""));
  return m ? { deviceId: m[1], folderId: m[2] } : null;
}
export { STATUSES as DEVICE_STATUSES };
