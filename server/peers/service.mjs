// People («Personas»): talking to other people who use Colmena on their own computers.
// - Identity: an Ed25519 + X25519 key pair made once (DPAPI on Windows, a private file
//   elsewhere). The public signing key is your address.
// - Contacts: added only through a one-time invitation code; both sides then see the same
//   four safety words (protocol.mjs). Someone added to a group by its owner is «known»: they
//   can write in that group, not to you directly.
// - Conversations («shares»): a direct one per contact and groups of up to 32 people. There is
//   no server that owns them: every message is sealed separately for each member and goes
//   through the mailbox; the group's owner signs who is in it (the roster).
// - Live bits (typing, presence) are never stored, by the mailbox or here.
// What leaves this computer: what you write in a conversation, your name, seen marks and
// reactions. Nothing else (no mail, files, memory, calendar).
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { now } from "../store.mjs";
import { statusNow } from "../notifications.mjs";
import {
  b64u, formatInviteCode, inviteLookup, inviteProof, isAddress, newIdentity, newInviteCode, open, openInvite, parseInviteCode, ProtocolError, safetyWords, sameProof, seal, sealInvite, sha256, validIdentity, canonical, signBytes, verifyBytes,
} from "./protocol.mjs";
import { RelayClient } from "./relay-client.mjs";

// The mailbox every Colmena uses unless Ajustes › Personas or COLMENA_RELAY_URL say another:
// Colmena's own on Cloudflare (relay/cloudflare/, deployed 2026-10-24).
export const DEFAULT_RELAY = "https://colmena.klast-lab-fa693a.workers.dev";
/** Where someone you invite gets Colmena (the newest release, Windows and Mac). */
export const DOWNLOAD_URL = "https://github.com/SergioRico1/Colmena/releases/latest";
export const PEER_LIMITS = Object.freeze({
  text: 8000, title: 60, name: 80, members: 32, perMinute: 120, inviteHours: 24, invitesOpen: 20, page: 60, seenDays: 31,
});
const BINDING = { profile: "peer-identity", hostId: "colmena-peers-v1", clientId: "peer-identity", subject: "identity" };
const PERSON_COLORS = ["#EFE2D3", "#DCE5EE", "#E2E9D7", "#E3E2F3", "#F3E1E1", "#E1EFEC", "#EEE6D2", "#E6E1EC"];
// Presence is refreshed every 10 minutes (only to who is connected), so «connected» lasts 25.
const ONLINE_MS = 25 * 60000;
const TYPING_MS = 8000;
const BOT_THINKING_MS = 90000;
const PRESENCE_EVERY = 10 * 60000;
const RETRY = [5000, 15000, 60000, 300000];
const ASK_DEFAULTS = Object.freeze({ libre: "pregunta", bots: "mencion", archivos: "nunca", encargos: "pregunta" });

export const initialsOf = (name) => {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || "?") + (words.length > 1 ? words.at(-1)[0] : words[0]?.[1] || "")).toUpperCase();
};
export const colorOf = (address) => PERSON_COLORS[sha256(String(address))[0] % PERSON_COLORS.length];
export const dmId = (a, b) => "dm-" + b64u(sha256("colmena-dm|" + [a, b].sort().join("|"))).slice(0, 24);
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const lastLineOf = (text) => clip(String(text).replace(/[*_#>`|]+/g, ""), 140);
const SHAPES = new Set(["hex", "circle", "square", "diamond", "leaf", "arch"]);
/** A bot as it travels (and as it is accepted from someone else): only these fields, checked. */
export function cleanBot(b) {
  if (!b || typeof b.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(b.id)) return null;
  const name = clip(b.name, 40);
  if (!name) return null;
  return { id: b.id, name, role: clip(b.role, 60), color: /^#[0-9A-Fa-f]{6}$/.test(b.color || "") ? b.color : "#8C8F99", shape: SHAPES.has(b.shape) ? b.shape : "circle" };
}
/** {mode, until} from someone's profile, checked (null: available). */
const statusOf = (profile) => {
  const st = profile?.status;
  if (!st || !["dnd", "away"].includes(st.mode)) return null;
  const until = st.until && Number.isFinite(Date.parse(st.until)) ? new Date(Date.parse(st.until)).toISOString() : null;
  return { mode: st.mode, until };
};
const botsOf = (profile) => (Array.isArray(profile?.bots) ? profile.bots.slice(0, 24).map(cleanBot).filter(Boolean) : []);
// Search: accents and case out.
const foldText = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** A line of `text` around the first word found: «…tenemos la reunión del lunes en…». */
const snippetOf = (text, word) => {
  const flat = String(text).replace(/\s+/g, " ").trim();
  const at = Math.max(0, foldText(flat).indexOf(word));
  const start = Math.max(0, at - 50);
  return (start ? "…" : "") + flat.slice(start, at + 110) + (at + 110 < flat.length ? "…" : "");
};
// What is left of a message deleted for everyone.
const tombstone = () => ({ text: "", deletedAt: now(), mentions: [], people: [], reactions: {}, card: null });
/** Replies of each thread root: count, last reply and who replied (newest first). */
const threadsOf = (list) => {
  const out = new Map();
  for (const m of list) {
    if (!m.thread || m.deletedAt) continue;
    const t = out.get(m.thread) || { count: 0, lastAt: "", who: [] };
    t.count += 1;
    if (String(m.at) > t.lastAt) t.lastAt = m.at;
    t.who = [m.from, ...t.who.filter((w) => w !== m.from)];
    out.set(m.thread, t);
  }
  return out;
};
const cleanMentions = (list) => (Array.isArray(list) ? list : []).slice(0, 8)
  .filter((m) => m && isAddress(m.owner) && typeof m.bot === "string" && /^[a-z0-9-]{1,40}$/.test(m.bot))
  .map((m) => ({ owner: m.owner, bot: m.bot }));

export class PeerError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export class Peers extends EventEmitter {
  constructor({ store, directory = store.directory, vault = undefined, relayUrl = null, nameOf = () => "", notifier = null, fetchImpl = fetch, clock = () => Date.now(), log = (m) => console.warn("[peers] " + m) }) {
    super();
    this.store = store;
    this.directory = path.join(directory, "peers");
    this.vault = vault;
    this.defaultRelay = relayUrl;
    this.nameOf = nameOf;
    this.notifier = notifier;
    this.fetch = fetchImpl;
    this.clock = clock;
    this.log = log;
    this.identity = null;
    this.client = null;
    this.relayStatus = { status: "off", error: null };
    this.presence = new Map(); // address → { state, at }
    this.typing = new Map(); // shareId → Map(address → at)
    this.rate = new Map(); // address → [times]
    this.previews = new Map(); // code → card (an invitation being looked at)
    this.lastPresenceTo = new Map();
    this.timers = [];
    this.setMaxListeners(50);
  }

  // ---------------------------------------------------------------- lifecycle
  async start() {
    this.stopped = false;
    this.identity = await this.loadIdentity();
    this.pruneSeen();
    this.connect();
    this.timers.push(setInterval(() => this.flushOutbox(), 5000), setInterval(() => this.heartbeat(), PRESENCE_EVERY), setInterval(() => this.pruneSeen(), 3600000));
    for (const t of this.timers) t.unref?.();
    return this;
  }
  stop() {
    this.stopped = true; // what is still arriving is left at the mailbox for next time
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    clearTimeout(this.askTimer);
    if (this.client?.status === "online") this.broadcastPresence("away");
    this.client?.stop();
    this.client = null;
  }
  async loadIdentity() {
    if (this.vault === undefined) {
      const { windowsVault } = await import("../nexo/credential-vault.mjs");
      this.vault = windowsVault(this.directory);
    }
    if (this.vault) {
      const saved = await this.vault.load(BINDING).catch(() => null);
      if (saved && validIdentity(saved)) return saved;
      const fresh = newIdentity();
      await this.vault.save(BINDING, fresh);
      return fresh;
    }
    // Without DPAPI (macOS, tests): a file only this user can read.
    mkdirSync(this.directory, { recursive: true });
    const file = path.join(this.directory, "identity.json");
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, "utf8"));
      if (validIdentity(saved)) return saved;
    }
    const fresh = newIdentity();
    writeFileSync(file, JSON.stringify(fresh), { mode: 0o600 });
    try { chmodSync(file, 0o600); } catch {}
    return fresh;
  }
  get address() { return this.identity?.sign.pub || null; }
  config() { return this.store.get("peerConfig", "main") || { id: "main" }; }
  relayUrl() { return this.config().relayUrl || this.defaultRelay || null; }
  setRelay(url) {
    const clean = url ? String(url).trim().replace(/\/+$/, "") : null;
    if (clean && !/^https?:\/\/[^\s/]+$/.test(clean)) throw new PeerError("La dirección del buzón no es válida.");
    if (clean && clean.startsWith("http://") && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(clean)) throw new PeerError("El buzón tiene que ir por https (o estar en este ordenador).");
    this.store.put("peerConfig", { ...this.config(), relayUrl: clean, updatedAt: now() });
    this.connect();
    return this.stateView();
  }
  connect() {
    this.client?.stop();
    this.client = null;
    const url = this.relayUrl();
    if (!url || !this.identity) {
      this.relayStatus = { status: "off", error: null };
      this.changed();
      return;
    }
    this.client = new RelayClient({
      url, identity: this.identity, fetchImpl: this.fetch, log: this.log,
      onMail: (row) => this.receive(row),
      onStatus: (status, error) => {
        this.relayStatus = { status, error: status === "online" ? null : error || this.relayStatus.error };
        this.emit("live", { type: "relay", status });
        this.changed();
        if (status === "online") {
          this.broadcastPresence("online");
          void this.flushOutbox();
          clearTimeout(this.askTimer);
          this.askTimer = setTimeout(() => this.askMissing(), 3000);
          this.askTimer.unref?.();
        }
      },
    });
    this.client.start();
  }
  changed() { for (const fn of this.store.listeners) try { fn({ type: "changed-local", kinds: ["peers"] }); } catch {} }
  myName() { return clip(this.nameOf() || "", PEER_LIMITS.name) || "Sin nombre"; }
  /** Your bots as others see them: name, role, colour and shape (nothing of what they know). */
  myBots() {
    return this.store.list("bots").filter((b) => b.enabled !== false).slice(0, 24).map((b) => cleanBot(b)).filter(Boolean);
  }
  myProfile() { return { name: this.myName(), box: this.identity.box.pub, bots: this.myBots(), status: this.myStatus() }; }
  /** Your status for other people: available, «dnd» (No molestar) or «away» (Fuera), until a time. */
  myStatus() { return statusNow(this.store.get("settings", "main"), this.clock()); }
  /** Sets your status; your contacts get it with your profile (once per change). */
  setStatus(mode, until = null) {
    if (!["available", "dnd", "away"].includes(mode)) throw new PeerError("Estado no válido.");
    const end = until ? Date.parse(until) : null;
    if (until && (!Number.isFinite(end) || end <= this.clock())) throw new PeerError("Elige un momento que aún no haya pasado.");
    if (end && end - this.clock() > 366 * 864e5) throw new PeerError("Como mucho un año.");
    this.store.patch("settings", "main", { status: mode === "available" ? null : { mode, until: end ? new Date(end).toISOString() : null, at: now() } });
    this.announceProfile();
    return this.stateView();
  }
  /** Someone's status as they last told us (an expired one is gone). */
  awayOf(c) {
    const st = c?.away;
    if (!st || !["dnd", "away"].includes(st.mode)) return null;
    if (st.until && Date.parse(st.until) <= this.clock()) return null;
    return { mode: st.mode, until: st.until || null };
  }

  // ---------------------------------------------------------------- views
  contact(id) { return this.store.get("peerContacts", id); }
  contacts() { return this.store.list("peerContacts"); }
  online(address) {
    const p = this.presence.get(address);
    return !!p && p.state === "online" && this.clock() - p.at < ONLINE_MS;
  }
  person(address) {
    if (address === this.address) return { id: address, me: true, name: this.myName(), initials: "TÚ", color: "#12131A" };
    const c = this.contact(address);
    const name = c?.name || "Alguien";
    return { id: address, name, initials: initialsOf(name), color: colorOf(address), online: this.online(address), status: c?.status || "unknown", away: this.awayOf(c) };
  }
  contactView(c) {
    return {
      id: c.id, name: c.name, initials: initialsOf(c.name), color: colorOf(c.id), status: c.status, via: c.via || null,
      online: this.online(c.id), lastSeenAt: c.lastSeenAt || null, addedAt: c.addedAt || null,
      words: this.address ? safetyWords(this.address, c.id) : [], verifiedAt: c.verifiedAt || null, asks: { ...ASK_DEFAULTS, ...(c.asks || {}) },
      dm: c.status === "active" ? dmId(this.address, c.id) : null, bots: c.bots || [], away: this.awayOf(c),
    };
  }
  shareView(s) {
    const members = s.members.map((m) => ({ ...this.person(m.id), role: m.role || "member" }));
    const others = members.filter((m) => !m.me);
    const title = s.kind === "dm" ? others[0]?.name || "Conversación" : s.title;
    return {
      id: s.id, kind: s.kind, title, owner: s.owner, mine: s.owner === this.address, members, lastAt: s.lastAt || s.createdAt,
      lastLine: s.lastLine || "", lastFrom: s.lastFrom ? this.person(s.lastFrom).name : null, unread: s.unread || 0,
      // The face of the row: the last other person who wrote (or the first one), then «+N».
      face: (others.find((m) => m.id === s.lastFromOther) || others[0]) || null, more: Math.max(0, others.length - 1),
      left: !!s.leftAt, removed: !!s.removedAt, typing: this.typingIn(s.id), thinking: this.typingIn(s.id, true), createdAt: s.createdAt,
    };
  }
  stateView() {
    const invites = this.store.list("peerInvites").filter((i) => i.status === "open" && Date.parse(i.expiresAt) > this.clock());
    return {
      me: this.address ? { address: this.address, name: this.myName(), status: this.myStatus() } : null,
      relay: { url: this.relayUrl(), status: this.relayStatus.status, error: this.relayStatus.error },
      contacts: this.contacts().filter((c) => ["active", "pending", "known"].includes(c.status)).map((c) => this.contactView(c)).sort((a, b) => a.name.localeCompare(b.name, "es")),
      invites: invites.map((i) => ({ id: i.id, name: i.name, createdAt: i.createdAt, expiresAt: i.expiresAt })),
      shares: this.store.list("peerShares").filter((s) => !s.hidden).map((s) => this.shareView(s)).sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt))),
    };
  }
  /** Who is writing (people) or thinking (bots, «Vera (de Sergio)») in a conversation now. */
  typingIn(shareId, bots = false) {
    const map = this.typing.get(shareId);
    if (!map) return [];
    const t = this.clock();
    return [...map.values()].filter((x) => !!x.bot === bots && t - x.at < (x.bot ? BOT_THINKING_MS : TYPING_MS)).map((x) => x.label);
  }
  live(shareId) { return { type: "typing", shareId, names: this.typingIn(shareId), thinking: this.typingIn(shareId, true) }; }
  /** One of your bots starts (or stops) answering in a conversation: everyone sees it thinking. */
  botThinking(shareId, bot, on = true) {
    const s = this.store.get("peerShares", shareId);
    if (!s) return;
    if (!this.typing.has(shareId)) this.typing.set(shareId, new Map());
    const key = this.address + "#" + bot.id;
    if (on) this.typing.get(shareId).set(key, { at: this.clock(), label: bot.name, bot: true });
    else this.typing.get(shareId).delete(key);
    this.emit("live", this.live(shareId));
    if (on) for (const id of this.others(s)) this.ephemeral(id, { type: "typing", share: shareId, bot: bot.name });
  }

  // ---------------------------------------------------------------- sending
  requireRelay() {
    if (!this.client) throw new PeerError("Falta conectar Colmena al buzón (Ajustes › Personas).", 409);
  }
  /** Seals `body` for `to` and queues it; the outbox retries until the mailbox takes it. */
  enqueue(to, body, { messageId = null } = {}) {
    const c = this.contact(to);
    if (!c?.box) return null;
    const env = seal(this.identity, { to, toBox: c.box, body });
    return this.store.put("peerOutbox", { id: env.id, to, env, messageId, attempts: 0, nextAt: 0, createdAt: now() });
  }
  async flushOutbox() {
    if (!this.client || this.client.status !== "online" || this.flushing) return;
    this.flushing = true;
    try {
      const due = this.store.list("peerOutbox").filter((o) => (o.nextAt || 0) <= this.clock());
      for (const o of due) {
        try {
          await this.client.send(o.to, o.env);
          this.store.remove("peerOutbox", o.id);
          if (o.messageId) this.delivered(o.messageId, o.to);
        } catch (error) {
          const fatal = error.status && error.status >= 400 && error.status < 500 && error.status !== 429 && error.status !== 401;
          if (fatal || (o.attempts || 0) > 40) {
            this.store.remove("peerOutbox", o.id);
            if (o.messageId) this.failed(o.messageId, error.message);
          } else {
            this.store.patch("peerOutbox", o.id, { attempts: (o.attempts || 0) + 1, nextAt: this.clock() + RETRY[Math.min(o.attempts || 0, RETRY.length - 1)], error: error.message });
          }
          if (!error.status) break; // the mailbox is unreachable: try the rest later
        }
      }
    } finally {
      this.flushing = false;
    }
  }
  delivered(messageId, to) {
    const m = this.store.get("peerMessages", messageId);
    if (!m) return;
    const pending = (m.pendingTo || []).filter((x) => x !== to);
    this.store.patch("peerMessages", messageId, { pendingTo: pending, ...(pending.length ? {} : { status: "sent" }) });
    if (!pending.length) this.emit("live", { type: "message", shareId: m.shareId, message: this.messageView(this.store.get("peerMessages", messageId)) });
  }
  failed(messageId, error) {
    if (this.store.get("peerMessages", messageId)) this.store.patch("peerMessages", messageId, { status: "failed", error: clip(error, 200) });
  }
  /**
   * A live-only note (typing, presence). The mailbox charges every request, so it only goes
   * to someone we see connected unless `always` (saying hello when we connect).
   */
  ephemeral(to, body, { always = false } = {}) {
    const c = this.contact(to);
    if (!this.client || this.client.status !== "online" || !c?.box || (!always && !this.online(to))) return;
    this.client.send(to, seal(this.identity, { to, toBox: c.box, body }), { ephemeral: true }).catch(() => {});
  }
  /** «online» when we connect goes to every contact (that is how each one learns); after that, and «away», only to who is connected. */
  broadcastPresence(state, { everyone = state === "online" } = {}) {
    for (const c of this.contacts().filter((x) => x.status === "active")) {
      if (!everyone && !this.online(c.id)) continue;
      this.lastPresenceTo.set(c.id, this.clock());
      this.ephemeral(c.id, { type: "presence", state }, { always: true });
    }
  }
  heartbeat() { if (this.client?.status === "online") this.broadcastPresence("online", { everyone: false }); }
  /**
   * A moment after connecting, ask again those who have not answered: a reply can cross our
   * reconnection and get lost. `ask` makes them answer even if they told us a moment ago.
   */
  askMissing() {
    if (this.stopped || this.client?.status !== "online") return;
    for (const c of this.contacts().filter((x) => x.status === "active" && !this.online(x.id))) this.ephemeral(c.id, { type: "presence", state: "online", ask: true }, { always: true });
  }
  /** A new contact learns at once that we are here (the next heartbeat may be two minutes away). */
  sayOnline(to) {
    this.lastPresenceTo.set(to, this.clock());
    this.ephemeral(to, { type: "presence", state: "online" }, { always: true });
  }

  // ---------------------------------------------------------------- invitations
  async createInvite(name, { room = null, role = "member" } = {}) {
    this.requireRelay();
    const label = clip(name, PEER_LIMITS.name);
    if (!label) throw new PeerError("Escribe cómo se llama.");
    // An invitation can also put them straight into a group of yours, with a role.
    const group = room ? this.ownGroup(room) : null;
    const open = this.store.list("peerInvites").filter((i) => i.status === "open" && Date.parse(i.expiresAt) > this.clock());
    if (open.length >= PEER_LIMITS.invitesOpen) throw new PeerError("Tienes demasiadas invitaciones sin aceptar. Cancela alguna.");
    const code = newInviteCode();
    const lookup = inviteLookup(code);
    const expiresAt = this.clock() + PEER_LIMITS.inviteHours * 3600000;
    const card = { v: 1, addr: this.address, box: this.identity.box.pub, name: this.myName(), ...(group ? { room: group.title } : {}) };
    await this.client.putInvite(lookup, sealInvite(code, card), expiresAt);
    const record = this.store.put("peerInvites", { id: randomUUID(), code, lookup, name: label, status: "open", createdAt: now(), expiresAt: new Date(expiresAt).toISOString(), ...(group ? { room: group.id, roomTitle: group.title, role: role === "guest" ? "guest" : "member" } : {}) });
    return { id: record.id, code: formatInviteCode(code), name: label, expiresAt: record.expiresAt, room: group ? group.title : null, text: inviteText(label, this.myName(), formatInviteCode(code), group?.title), download: DOWNLOAD_URL };
  }
  async cancelInvite(id) {
    const inv = this.store.get("peerInvites", id);
    if (!inv) throw new PeerError("No existe esa invitación.", 404);
    this.store.patch("peerInvites", id, { status: "cancelled", code: null });
    await this.client?.deleteInvite(inv.lookup);
    return { ok: true };
  }
  async previewInvite(text) {
    this.requireRelay();
    const code = parseInviteCode(text);
    if (!code) throw new PeerError("Ese código no parece una invitación de Colmena. Debe ser como COLMENA-XXXX-XXXX-XXXX-XXXX.");
    let found;
    try {
      found = await this.client.getInvite(inviteLookup(code));
    } catch (error) {
      throw new PeerError(error.status === 404 ? "Esa invitación no existe, ya se usó o ha caducado. Pide otra." : "No se pudo consultar el buzón: " + error.message, error.status === 404 ? 404 : 502);
    }
    const card = openInvite(code, found.blob);
    if (!card || !isAddress(card.addr) || !isAddress(card.box)) throw new PeerError("La invitación está dañada. Pide otra.");
    if (card.addr === this.address) throw new PeerError("Esa invitación la has creado tú: mándasela a la otra persona.");
    this.previews.set(code, card);
    const already = this.contact(card.addr);
    return { name: clip(card.name, PEER_LIMITS.name), words: safetyWords(this.address, card.addr), expiresAt: new Date(found.expiresAt).toISOString(), already: already?.status === "active", room: card.room ? clip(card.room, PEER_LIMITS.title) : null };
  }
  async acceptInvite(text) {
    const code = parseInviteCode(text);
    if (!code) throw new PeerError("Ese código no parece una invitación de Colmena.");
    if (!this.previews.has(code)) await this.previewInvite(code);
    const card = this.previews.get(code);
    this.previews.delete(code);
    const existing = this.contact(card.addr);
    this.store.put("peerContacts", {
      ...(existing || {}), id: card.addr, box: card.box, name: clip(card.name, PEER_LIMITS.name) || "Alguien",
      status: existing?.status === "active" ? "active" : "pending", via: "invitation", addedAt: existing?.addedAt || now(), asks: existing?.asks || { ...ASK_DEFAULTS },
    });
    this.enqueue(card.addr, { type: "hello", invite: inviteLookup(code), proof: inviteProof(code, this.address, card.addr), profile: this.myProfile() });
    this.ensureDm(card.addr);
    void this.flushOutbox();
    return { contact: this.contactView(this.contact(card.addr)), dm: dmId(this.address, card.addr) };
  }

  // ---------------------------------------------------------------- contacts
  updateContact(id, { asks, verified } = {}) {
    const c = this.contact(id);
    if (!c || c.status === "removed") throw new PeerError("No existe esa persona.", 404);
    const next = {};
    if (asks) next.asks = { ...ASK_DEFAULTS, ...(c.asks || {}), ...asks };
    if (verified !== undefined) next.verifiedAt = verified ? now() : null;
    this.store.patch("peerContacts", id, next);
    return this.contactView(this.contact(id));
  }
  removeContact(id) {
    const c = this.contact(id);
    if (!c) throw new PeerError("No existe esa persona.", 404);
    if (c.status === "active") this.enqueue(id, { type: "bye" });
    this.store.patch("peerContacts", id, { status: "removed", removedAt: now() });
    const dm = this.store.get("peerShares", dmId(this.address, id));
    if (dm) this.store.patch("peerShares", dm.id, { removedAt: now() });
    void this.flushOutbox();
    return { ok: true };
  }

  // ---------------------------------------------------------------- conversations
  ensureDm(other) {
    const shareId = dmId(this.address, other);
    const existing = this.store.get("peerShares", shareId);
    if (existing) {
      if (existing.removedAt || existing.hidden) this.store.patch("peerShares", shareId, { removedAt: null, hidden: false });
      return this.store.get("peerShares", shareId);
    }
    return this.store.put("peerShares", {
      id: shareId, kind: "dm", title: "", owner: null, version: 0, createdAt: now(), lastAt: now(), unread: 0,
      members: [{ id: this.address, role: "member" }, { id: other, role: "member" }],
    });
  }
  share(id) {
    const s = this.store.get("peerShares", id);
    if (!s) throw new PeerError("No existe esa conversación.", 404);
    return s;
  }
  others(s) { return s.members.map((m) => m.id).filter((id) => id !== this.address); }
  /**
   * Who is in a group as its owner signs it: title, version and members with their role
   * (owner, member, guest). Signed with the owner's key besides the envelope, so the list
   * holds wherever it travels.
   */
  roster(s) {
    const r = { id: s.id, kind: "group", title: s.title, owner: s.owner, version: s.version, members: s.members.map((m) => ({ id: m.id, role: m.role, box: m.id === this.address ? this.identity.box.pub : this.contact(m.id)?.box, name: m.id === this.address ? this.myName() : this.contact(m.id)?.name })) };
    return s.owner === this.address ? { ...r, sig: signBytes(this.identity.sign, canonical(r)) } : r;
  }
  /** Sends the group's new list to everyone in it (and to whoever just left it). */
  sendRoster(s, extra = []) {
    for (const id of [...new Set([...this.others(s), ...extra])]) if (id !== this.address) this.enqueue(id, { type: "share", share: this.roster(s) });
    void this.flushOutbox();
  }
  ownGroup(shareId) {
    const s = this.share(shareId);
    if (s.kind !== "group" || s.owner !== this.address) throw new PeerError("Solo quien creó la conversación puede cambiar esto.", 403);
    if (s.leftAt || s.removedAt) throw new PeerError("Esta conversación ya está cerrada.", 409);
    return s;
  }
  /** Changes the name of a group of yours. */
  renameGroup(shareId, title) {
    const s = this.ownGroup(shareId);
    const name = clip(title, PEER_LIMITS.title);
    if (!name) throw new PeerError("Ponle un nombre a la conversación.");
    const next = this.store.patch("peerShares", shareId, { title: name, version: s.version + 1 });
    this.sendRoster(next);
    return this.shareView(next);
  }
  /** «Miembro» or «Invitado» (a guest writes and reads; their messages never wake bots). */
  setRole(shareId, memberId, role) {
    const s = this.ownGroup(shareId);
    if (!["member", "guest"].includes(role)) throw new PeerError("Papel no válido.");
    if (memberId === this.address || !s.members.some((m) => m.id === memberId)) throw new PeerError("Esa persona no está en la conversación.", 404);
    const next = this.store.patch("peerShares", shareId, { members: s.members.map((m) => (m.id === memberId ? { ...m, role } : m)), version: s.version + 1 });
    this.sendRoster(next);
    return this.shareView(next);
  }
  /** Takes someone out of a group of yours: the new list goes to everyone, them included. */
  removeMember(shareId, memberId) {
    const s = this.ownGroup(shareId);
    if (memberId === this.address || !s.members.some((m) => m.id === memberId)) throw new PeerError("Esa persona no está en la conversación.", 404);
    const next = this.store.patch("peerShares", shareId, { members: s.members.filter((m) => m.id !== memberId), version: s.version + 1 });
    this.sendRoster(next, [memberId]);
    return this.shareView(next);
  }
  roleOf(s, address) { return s?.members?.find((m) => m.id === address)?.role || null; }
  createGroup(title, memberIds) {
    this.requireRelay();
    const name = clip(title, PEER_LIMITS.title);
    if (!name) throw new PeerError("Ponle un nombre a la conversación.");
    const ids = [...new Set(memberIds)].filter((x) => x !== this.address);
    if (ids.length < 1) throw new PeerError("Elige al menos a una persona.");
    if (ids.length + 1 > PEER_LIMITS.members) throw new PeerError("Como mucho " + PEER_LIMITS.members + " personas por conversación.");
    for (const id of ids) if (this.contact(id)?.status !== "active") throw new PeerError("Solo puedes añadir a personas con las que ya hablas.");
    const s = this.store.put("peerShares", {
      id: randomUUID(), kind: "group", title: name, owner: this.address, version: 1, createdAt: now(), lastAt: now(), unread: 0,
      members: [{ id: this.address, role: "owner" }, ...ids.map((id) => ({ id, role: "member" }))],
    });
    for (const id of ids) this.enqueue(id, { type: "share", share: this.roster(s) });
    void this.flushOutbox();
    return this.shareView(s);
  }
  addMembers(shareId, memberIds, role = "member") {
    const s = this.share(shareId);
    if (s.kind !== "group" || s.owner !== this.address) throw new PeerError("Solo quien creó la conversación puede añadir personas.", 403);
    const as = role === "guest" ? "guest" : "member";
    const have = new Set(s.members.map((m) => m.id));
    const add = [...new Set(memberIds)].filter((id) => !have.has(id));
    for (const id of add) if (this.contact(id)?.status !== "active") throw new PeerError("Solo puedes añadir a personas con las que ya hablas.");
    if (have.size + add.length > PEER_LIMITS.members) throw new PeerError("Como mucho " + PEER_LIMITS.members + " personas por conversación.");
    const next = this.store.patch("peerShares", shareId, { members: [...s.members, ...add.map((id) => ({ id, role: as, addedAt: now() }))], version: s.version + 1 });
    this.sendRoster(next);
    return this.shareView(next);
  }
  leave(shareId) {
    const s = this.share(shareId);
    if (s.kind !== "group") throw new PeerError("Para dejar de hablar con alguien, quítalo en Ajustes › Personas.");
    if (s.owner === this.address) {
      // The owner closes it for everyone: nobody left to sign who is in it.
      for (const id of this.others(s)) this.enqueue(id, { type: "share", share: { ...this.roster(s), version: s.version + 1, members: [], closed: true } });
    } else {
      for (const id of this.others(s)) this.enqueue(id, { type: "leave", share: s.id });
    }
    this.store.patch("peerShares", shareId, { leftAt: now() });
    void this.flushOutbox();
    return { ok: true };
  }
  /**
   * A page of the conversation (thread replies stay in their thread), or with `thread` the
   * root of that thread and all its replies.
   */
  messages(shareId, { before = null, thread = null, limit = PEER_LIMITS.page } = {}) {
    const s = this.share(shareId);
    const every = this.store.where("peerMessages", "shareId", shareId).sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.id).localeCompare(String(b.id)));
    const threads = threadsOf(every);
    if (thread) {
      const root = every.find((m) => m.id === thread && !m.thread);
      if (!root) throw new PeerError("No existe ese hilo.", 404);
      return { share: this.shareView(s), root: this.messageView(root, s, threads), messages: every.filter((m) => m.thread === root.id).slice(-500).map((m) => this.messageView(m, s, threads)) };
    }
    const all = every.filter((m) => !m.thread);
    const end = before ? all.findIndex((m) => m.id === before) : all.length;
    const page = all.slice(Math.max(0, (end < 0 ? all.length : end) - limit), end < 0 ? all.length : end);
    return { share: this.shareView(s), messages: page.map((m) => this.messageView(m, s, threads)), more: page.length < all.length && all.indexOf(page[0]) > 0 };
  }
  messageView(m, s = this.share(m.shareId), threads = null) {
    const author = this.person(m.from);
    const mine = m.from === this.address;
    const seenBy = mine ? Object.entries(s.seenBy || {}).filter(([id, v]) => id !== this.address && String(v.at) >= String(m.at)).map(([id]) => this.person(id).name) : [];
    const reactions = Object.entries(m.reactions || {}).filter(([, who]) => who.length).map(([emoji, who]) => ({ emoji, count: who.length, mine: who.includes(this.address), who: who.map((id) => this.person(id).name) }));
    // A thread root says how many replies it has and who wrote them.
    const thread = m.thread ? null : (threads || threadsOf(this.store.where("peerMessages", "thread", m.id))).get(m.id);
    return {
      id: m.id, shareId: m.shareId, from: mine ? "me" : m.from, author: { name: author.name, initials: author.initials, color: author.color }, text: m.text, at: m.at,
      status: m.status || "received", error: m.error || null, replyTo: m.replyTo || null, thread: m.thread || null, seenBy, reactions,
      ...(m.editedAt ? { edited: m.editedAt } : {}), ...(m.deletedAt ? { deleted: true } : {}),
      ...(thread ? { replies: { count: thread.count, lastAt: thread.lastAt, people: thread.who.slice(0, 3).map((id) => { const p = this.person(id); return { id, me: !!p.me, initials: p.initials, color: p.color }; }) } } : {}),
      // People named with «@» (their first names are in the text).
      ...(m.people?.length ? { people: m.people.map((id) => { const p = this.person(id); return { id, me: !!p.me, name: p.name, initials: p.initials, color: p.color }; }) } : {}),
      // Written by a bot of `author` (on its owner's computer): «Vera · bot de Sergio».
      ...(m.bot ? { bot: m.bot } : {}), ...(m.mentions?.length ? { mentions: m.mentions } : {}), ...(m.card ? { card: m.card.kind === "file" ? { kind: "file" } : m.card } : {}), ...(m.local ? { local: true } : {}),
      // A shared file: what this Colmena has of it (files.mjs), never its key.
      ...(m.card?.kind === "errand" ? { errand: this.errands?.view(m.card.id) || null } : {}),
      ...(m.card?.kind === "file" ? { file: this.files?.viewOf(m.card.file?.id) || { id: String(m.card.file?.id || ""), name: String(m.card.file?.name || "archivo"), kind: "other", status: "pending" } } : {}),
      // A meeting card shows the meeting as it is now (meetings.mjs), not as it was sent.
      ...(m.card?.kind === "meeting" ? { meeting: this.meetings?.view(String(m.card.id)) || null } : {}),
    };
  }
  /**
   * Sends `text` to everyone in the conversation. `mentions` [{owner, bot}] name bots (yours
   * or someone else's) the message is for; `bot` signs it as one of your bots; `card` is a
   * structured part (the meeting card of phase 3).
   */
  post(shareId, text, { replyTo = null, thread = null, mentions = [], people = [], bot = null, card = null } = {}) {
    this.requireRelay();
    const s = this.share(shareId);
    if (s.leftAt || s.removedAt) throw new PeerError("Ya no estás en esta conversación.", 409);
    const body = String(text || "").trim();
    if (!body) throw new PeerError("Escribe algo.");
    if (body.length > PEER_LIMITS.text) throw new PeerError("El mensaje es demasiado largo.");
    // A reply goes to the thread of its root (threads are one level deep).
    if (thread) {
      let root = this.store.get("peerMessages", thread);
      if (root?.thread) root = this.store.get("peerMessages", root.thread);
      if (!root || root.shareId !== shareId) throw new PeerError("No existe ese mensaje.", 404);
      thread = root.id;
    }
    const signed = bot ? cleanBot(bot) : null;
    const named = cleanMentions(mentions);
    const members = new Set(s.members.map((m) => m.id));
    const persons = [...new Set(people)].filter((a) => isAddress(a) && a !== this.address && members.has(a)).slice(0, 16);
    const extra = { ...(replyTo ? { replyTo } : {}), ...(thread ? { thread } : {}), ...(signed ? { bot: signed } : {}), ...(named.length ? { mentions: named } : {}), ...(persons.length ? { people: persons } : {}), ...(card ? { card } : {}) };
    const to = this.others(s).filter((id) => ["active", "known", "pending"].includes(this.contact(id)?.status));
    const m = this.store.put("peerMessages", { id: randomUUID(), shareId, from: this.address, text: body, at: now(), status: to.length ? "sending" : "sent", pendingTo: to, ...extra });
    for (const id of to) this.enqueue(id, { type: "msg", share: shareId, id: m.id, at: m.at, text: body, ...extra, ...(s.kind === "group" ? { v: s.version } : {}) }, { messageId: m.id });
    this.store.patch("peerShares", shareId, { lastAt: m.at, lastLine: lastLineOf((signed ? signed.name + ": " : "") + body), lastFrom: this.address, unread: 0 });
    void this.flushOutbox();
    const view = this.messageView(this.store.get("peerMessages", m.id));
    this.emit("live", { type: "message", shareId, message: view });
    if (thread) this.emitMessage(shareId, thread);
    this.emit("posted", { share: this.store.get("peerShares", shareId), message: m, mine: true });
    return view;
  }
  /** The message as it is now, to whoever has the conversation open. */
  emitMessage(shareId, messageId) {
    const m = this.store.get("peerMessages", messageId);
    if (m) this.emit("live", { type: "message", shareId, message: this.messageView(m) });
  }
  /** Changes the text of one of your messages, for everyone (only its author can). */
  edit(messageId, text) {
    this.requireRelay();
    const m = this.store.get("peerMessages", messageId);
    if (!m || m.from !== this.address || m.deletedAt) throw new PeerError("Ese mensaje no se puede editar.", 409);
    if (m.bot || m.card || m.local) throw new PeerError("Lo que escriben tus bots no se edita; puedes borrarlo.", 409);
    const body = String(text || "").trim();
    if (!body) throw new PeerError("Escribe algo.");
    if (body.length > PEER_LIMITS.text) throw new PeerError("El mensaje es demasiado largo.");
    const s = this.share(m.shareId);
    if (body !== m.text) {
      const at = now();
      this.store.patch("peerMessages", m.id, { text: body, editedAt: at });
      this.sendChange(s, { type: "edit", share: s.id, msg: m.id, text: body, at });
      this.afterChange(s, m, body);
    }
    return this.messageView(this.store.get("peerMessages", m.id), s);
  }
  /** Deletes one of your messages (or your bot's) for everyone: a «Mensaje borrado» stays. */
  unsend(messageId) {
    const m = this.store.get("peerMessages", messageId);
    if (!m || m.from !== this.address || m.deletedAt) throw new PeerError("Ese mensaje no se puede borrar.", 409);
    if (m.card?.kind === "meeting") throw new PeerError("Una reunión no se borra: cancélala desde su tarjeta.", 409);
    const s = this.share(m.shareId);
    this.store.patch("peerMessages", m.id, tombstone());
    if (!m.local) this.sendChange(s, { type: "unsend", share: s.id, msg: m.id });
    this.afterChange(s, m, null);
    return this.messageView(this.store.get("peerMessages", m.id), s);
  }
  sendChange(s, body) {
    for (const id of this.others(s)) if (this.contact(id)?.box) this.enqueue(id, body);
    void this.flushOutbox();
  }
  /**
   * After message `m` changed (`text`, or null if deleted): the conversation's last line and
   * an unread notice that still show the old words say the new ones.
   */
  afterChange(s, m, text) {
    // A shared file deleted for everyone goes from the mailbox and from each Colmena.
    if (text === null && m.card?.kind === "file") void this.files?.forget(m.card.file?.id);
    // Deleted: the row shows what was said before it.
    const before = text === null ? this.store.where("peerMessages", "shareId", s.id).filter((x) => !x.deletedAt && x.id !== m.id).sort((a, b) => String(a.at).localeCompare(String(b.at))).at(-1) : null;
    const line = text === null ? (before ? lastLineOf((before.bot ? before.bot.name + ": " : "") + before.text) : "") : lastLineOf((m.bot ? m.bot.name + ": " : "") + text);
    const old = lastLineOf((m.bot ? m.bot.name + ": " : "") + m.text);
    const share = this.store.get("peerShares", s.id);
    if (share?.lastLine === old && share.lastAt === m.at) this.store.patch("peerShares", s.id, { lastLine: line });
    for (const n of this.store.list("notifications").filter((n) => n.peerShare === s.id && !n.read && n.text === lastLineOf(m.text))) {
      if (text === null) this.store.remove("notifications", n.id);
      else this.store.patch("notifications", n.id, { text: lastLineOf(text) });
    }
    this.emitMessage(s.id, m.id);
    if (m.thread) this.emitMessage(s.id, m.thread);
  }
  /**
   * Messages with every word of `query` (accents and case do not matter), newest first; in
   * one conversation with `shareId`.
   */
  search(query, { shareId = null, limit = 40 } = {}) {
    const words = foldText(query).split(/\s+/).filter(Boolean);
    if (!words.length || words.join("").length < 2) return { hits: [] };
    const views = new Map();
    const shareOf = (id) => {
      if (!views.has(id)) { const s = this.store.get("peerShares", id); views.set(id, s && !s.removedAt ? this.shareView(s) : null); }
      return views.get(id);
    };
    const rows = shareId ? this.store.where("peerMessages", "shareId", shareId) : this.store.list("peerMessages");
    const hits = rows.filter((m) => !m.deletedAt && m.text && !m.local && words.every((w) => foldText(m.text).includes(w)) && shareOf(m.shareId))
      .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit);
    return {
      hits: hits.map((m) => {
        const s = shareOf(m.shareId);
        return { id: m.id, shareId: m.shareId, title: s.title, kind: s.kind, at: m.at, thread: m.thread || null, author: m.from === this.address ? "Tú" : this.person(m.from).name, bot: m.bot?.name || null, snippet: snippetOf(m.text, words[0]) };
      }),
    };
  }
  retry(messageId) {
    const m = this.store.get("peerMessages", messageId);
    if (!m || m.from !== this.address || m.status !== "failed") throw new PeerError("Ese mensaje no se puede reenviar.", 409);
    const s = this.share(m.shareId);
    const to = this.others(s).filter((id) => this.contact(id)?.box);
    this.store.patch("peerMessages", m.id, { status: "sending", pendingTo: to, error: null });
    // The same message again, with everything it carried (thread, bot, mentions, card).
    const extra = Object.fromEntries(["replyTo", "thread", "bot", "mentions", "people", "card"].filter((k) => m[k] && (!Array.isArray(m[k]) || m[k].length)).map((k) => [k, m[k]]));
    for (const id of to) this.enqueue(id, { type: "msg", share: s.id, id: m.id, at: m.at, text: m.text, ...extra, ...(s.kind === "group" ? { v: s.version } : {}) }, { messageId: m.id });
    void this.flushOutbox();
    return this.messageView(this.store.get("peerMessages", m.id));
  }
  seen(shareId) {
    const s = this.share(shareId);
    const last = this.store.where("peerMessages", "shareId", shareId).filter((m) => m.from !== this.address).sort((a, b) => String(a.at).localeCompare(String(b.at))).at(-1);
    if (s.unread) this.store.patch("peerShares", shareId, { unread: 0 });
    for (const n of this.store.list("notifications").filter((n) => n.peerShare === shareId && !n.read)) this.store.patch("notifications", n.id, { read: true });
    if (!last || s.seenSent === last.id) return { ok: true };
    this.store.patch("peerShares", shareId, { seenSent: last.id });
    for (const id of this.others(s)) if (this.contact(id)?.box) this.enqueue(id, { type: "seen", share: shareId, at: last.at });
    void this.flushOutbox();
    return { ok: true };
  }
  typingNow(shareId) {
    const s = this.share(shareId);
    const t = this.clock();
    this.typingSent ??= new Map(); // memory only: not worth a write
    if (t - (this.typingSent.get(shareId) || 0) < 5000) return { ok: true };
    this.typingSent.set(shareId, t);
    for (const id of this.others(s)) this.ephemeral(id, { type: "typing", share: shareId });
    return { ok: true };
  }
  react(messageId, emoji) {
    const m = this.store.get("peerMessages", messageId);
    if (!m) throw new PeerError("No existe ese mensaje.", 404);
    const e = String(emoji || "").trim();
    if (!e || e.length > 16) throw new PeerError("Reacción no válida.");
    const s = this.share(m.shareId);
    const who = new Set(m.reactions?.[e] || []);
    const on = !who.has(this.address);
    on ? who.add(this.address) : who.delete(this.address);
    this.store.patch("peerMessages", m.id, { reactions: { ...(m.reactions || {}), [e]: [...who] } });
    for (const id of this.others(s)) if (this.contact(id)?.box) this.enqueue(id, { type: "react", share: s.id, msg: m.id, emoji: e, on });
    void this.flushOutbox();
    const view = this.messageView(this.store.get("peerMessages", m.id), s);
    this.emit("live", { type: "message", shareId: s.id, message: view });
    return view;
  }

  // ---------------------------------------------------------------- receiving
  /** One envelope from the mailbox. true = handled (or useless): it can be deleted there. */
  async receive(row) {
    if (this.stopped) return false;
    const env = row?.env;
    if (!env || typeof env.id !== "string") return true;
    if (this.store.get("peerSeen", env.id)) return true;
    let body;
    try {
      body = open(this.identity, env);
    } catch (error) {
      this.log("Sobre rechazado (" + (error.code || error.message) + ")");
      return error instanceof ProtocolError;
    }
    const from = env.from;
    if (this.limited(from)) return true;
    const c = this.contact(from);
    try {
      if (body.type === "hello") this.onHello(from, body);
      else if (!c || ["removed", "blocked"].includes(c.status)) return true; // nobody we talk to
      else this.dispatch(c, body);
    } catch (error) {
      this.log("Mensaje de " + (c?.name || "alguien") + " ignorado: " + error.message);
    }
    if (!["typing", "presence", "code.view", "code.viewers"].includes(body.type)) this.store.put("peerSeen", { id: env.id, at: now() });
    if (c) this.touch(from);
    return true;
  }
  limited(from) {
    const t = this.clock();
    const list = (this.rate.get(from) || []).filter((x) => t - x < 60000);
    list.push(t);
    this.rate.set(from, list);
    return list.length > PEER_LIMITS.perMinute;
  }
  touch(from) {
    const c = this.contact(from);
    if (c && this.clock() - Date.parse(c.lastSeenAt || 0) > 60000) this.store.patch("peerContacts", from, { lastSeenAt: now() });
  }
  onHello(from, body) {
    const inv = this.store.list("peerInvites").find((i) => i.lookup === body.invite && i.status === "open");
    if (!inv || Date.parse(inv.expiresAt) < this.clock() || !inv.code) throw Error("invitación no válida o caducada");
    if (!sameProof(body.proof, inviteProof(inv.code, from, this.address))) throw Error("prueba de invitación incorrecta");
    if (!isAddress(body.profile?.box)) throw Error("perfil incompleto");
    const name = clip(body.profile.name, PEER_LIMITS.name) || inv.name;
    const existing = this.contact(from);
    this.store.put("peerContacts", { ...(existing || {}), id: from, box: body.profile.box, name, invitedAs: inv.name, status: "active", via: "invitation", addedAt: existing?.addedAt || now(), lastSeenAt: now(), asks: existing?.asks || { ...ASK_DEFAULTS }, bots: botsOf(body.profile), away: statusOf(body.profile) });
    this.store.patch("peerInvites", inv.id, { status: "used", usedAt: now(), usedBy: from, code: null });
    void this.client?.deleteInvite(inv.lookup);
    this.enqueue(from, { type: "welcome", profile: this.myProfile() });
    this.ensureDm(from);
    void this.flushOutbox().then(() => this.sayOnline(from));
    // Invited to a room: in it now, with the role chosen.
    const room = inv.room && this.store.get("peerShares", inv.room);
    if (room && room.owner === this.address && !room.leftAt && !room.members.some((m) => m.id === from)) {
      try { this.addMembers(room.id, [from], inv.role); } catch (error) { this.log("No se pudo añadir a la sala: " + error.message); }
    }
    this.notify({ title: name + " ya está en tus personas", text: room ? "Aceptó tu invitación y ya está en «" + room.title + "»." : "Aceptó tu invitación. Ya podéis escribiros.", shareId: room ? room.id : dmId(this.address, from) });
  }
  dispatch(c, body) {
    const from = c.id;
    switch (body.type) {
      case "welcome":
        if (c.status === "pending") this.store.patch("peerContacts", from, { status: "active", bots: botsOf(body.profile), away: statusOf(body.profile), ...(body.profile?.name ? { name: clip(body.profile.name, PEER_LIMITS.name) } : {}) });
        this.ensureDm(from);
        this.sayOnline(from);
        return;
      case "profile":
        this.store.patch("peerContacts", from, { ...(body.name ? { name: clip(body.name, PEER_LIMITS.name) } : {}), ...(Array.isArray(body.bots) ? { bots: botsOf(body) } : {}), ...("status" in body ? { away: statusOf(body) } : {}) });
        return;
      case "bye": {
        this.store.patch("peerContacts", from, { status: "removed", removedAt: now() });
        const dm = this.store.get("peerShares", dmId(this.address, from));
        if (dm) this.store.patch("peerShares", dm.id, { removedAt: now() });
        return;
      }
      case "presence": {
        const was = this.online(from);
        this.presence.set(from, { state: body.state === "online" ? "online" : "away", at: this.clock() });
        this.emit("live", { type: "presence", id: from, online: this.online(from) });
        if (was !== this.online(from)) this.changed(); // the green dots in the lists
        // Someone just came online: tell them we are here too (once a minute at most, unless
        // they were not connected: our own «online» of a moment ago never reached them).
        const since = this.clock() - (this.lastPresenceTo.get(from) || 0);
        if (body.state === "online" && c.status === "active" && (!was || since > 60000 || (body.ask === true && since > 2000))) {
          this.lastPresenceTo.set(from, this.clock());
          this.ephemeral(from, { type: "presence", state: "online" });
        }
        return;
      }
      case "typing": {
        const s = this.memberShare(body.share, from);
        if (!s) return;
        if (!this.typing.has(s.id)) this.typing.set(s.id, new Map());
        const bot = body.bot ? clip(body.bot, 40) : null;
        this.typing.get(s.id).set(bot ? from + "#" + bot : from, { at: this.clock(), label: bot ? bot + " (de " + c.name.split(" ")[0] + ")" : c.name, bot: !!bot });
        this.presence.set(from, { state: "online", at: this.clock() }); // typing right now: connected
        this.emit("live", this.live(s.id));
        return;
      }
      case "share":
        return this.onRoster(c, body.share);
      case "leave": {
        const s = this.memberShare(body.share, from);
        if (!s) return;
        const members = s.members.filter((m) => m.id !== from);
        this.store.patch("peerShares", s.id, { members, ...(s.owner === this.address ? { version: s.version + 1 } : {}) });
        if (s.owner === this.address) {
          const next = this.store.get("peerShares", s.id);
          for (const id of this.others(next)) this.enqueue(id, { type: "share", share: this.roster(next) });
          void this.flushOutbox();
        }
        return;
      }
      case "msg":
        return this.onMessage(c, body);
      case "seen": {
        const s = this.memberShare(body.share, from);
        if (!s || typeof body.at !== "string") return;
        this.store.patch("peerShares", s.id, { seenBy: { ...(s.seenBy || {}), [from]: { at: body.at } } });
        this.emit("live", { type: "seen", shareId: s.id });
        return;
      }
      case "react": {
        const s = this.memberShare(body.share, from);
        const m = s && this.store.get("peerMessages", String(body.msg || ""));
        const e = String(body.emoji || "").trim();
        if (!m || m.shareId !== s.id || !e || e.length > 16) return;
        const who = new Set(m.reactions?.[e] || []);
        body.on === false ? who.delete(from) : who.add(from);
        this.store.patch("peerMessages", m.id, { reactions: { ...(m.reactions || {}), [e]: [...who] } });
        this.emit("live", { type: "message", shareId: s.id, message: this.messageView(this.store.get("peerMessages", m.id)) });
        return;
      }
      case "edit":
      case "unsend": {
        const s = this.memberShare(body.share, from);
        const m = s && this.store.get("peerMessages", String(body.msg || ""));
        // Only whoever wrote it: the envelope is signed by `from`, and it must be the author.
        if (!m || m.shareId !== s.id || m.from !== from || m.deletedAt) return;
        if (body.type === "edit") {
          const text = String(body.text || "").slice(0, PEER_LIMITS.text);
          if (!text.trim() || m.bot || m.card) return;
          const at = typeof body.at === "string" && Number.isFinite(Date.parse(body.at)) ? body.at : now();
          this.store.patch("peerMessages", m.id, { text, editedAt: at });
          this.afterChange(s, m, text);
        } else {
          this.store.patch("peerMessages", m.id, tombstone());
          this.afterChange(s, m, null);
        }
        return;
      }
      default:
        // A meeting being agreed (meetings.mjs checks who may say what); anything else is a
        // newer Colmena's message type: ignored.
        if (/^meet\.[a-z]+$/.test(body.type)) this.emit("meet", { from: c, body });
        // A Código task shared with you, or one you share (codeshare.mjs checks who may say what).
        else if (/^code\.[a-z]+(\.[a-z]+)?$/.test(body.type)) this.emit("code", { from: c, body });
        // An errand for one of your bots, or the answer to one of theirs (errands.mjs checks who).
        else if (/^errand\.[a-z]+$/.test(body.type)) this.emit("errand", { from: c, body });
        return;
    }
  }
  /** The conversation `shareId` if `from` is in it (a direct one is made on first contact). */
  memberShare(shareId, from) {
    if (typeof shareId !== "string") return null;
    if (shareId === dmId(this.address, from) && this.contact(from)?.status === "active") return this.ensureDm(from);
    const s = this.store.get("peerShares", shareId);
    if (!s || s.kind !== "group" || s.leftAt || s.removedAt) return null;
    return s.members.some((m) => m.id === from) ? s : null;
  }
  onRoster(c, roster) {
    if (!roster || typeof roster.id !== "string" || roster.kind !== "group" || roster.owner !== c.id || !Number.isSafeInteger(roster.version)) return;
    // Signed by its owner (older Colmenas send it unsigned inside their signed envelope).
    if (roster.sig !== undefined) {
      const { sig, ...unsigned } = roster;
      if (typeof sig !== "string" || !verifyBytes(c.id, canonical(unsigned), sig)) return;
    }
    const current = this.store.get("peerShares", roster.id);
    if (current && (current.owner !== c.id || current.version >= roster.version)) return;
    const members = Array.isArray(roster.members) ? roster.members.slice(0, PEER_LIMITS.members) : [];
    const inIt = members.some((m) => m.id === this.address);
    if (!inIt) {
      if (current && !current.removedAt) {
        this.store.patch("peerShares", current.id, { removedAt: now(), version: roster.version });
        if (!roster.closed && !current.leftAt) this.notify({ title: c.name + " te ha quitado de «" + current.title + "»", text: "Lo que os escribisteis se queda en tu Colmena.", shareId: current.id });
      }
      return;
    }
    // People we do not talk to directly: known through this group's owner.
    for (const m of members) {
      if (m.id === this.address || !isAddress(m.id) || !isAddress(m.box)) continue;
      const known = this.contact(m.id);
      if (!known || known.status === "removed") this.store.put("peerContacts", { ...(known || {}), id: m.id, box: m.box, name: clip(m.name, PEER_LIMITS.name) || "Alguien", status: known?.status === "removed" ? "removed" : "known", via: "group:" + roster.id, addedAt: known?.addedAt || now() });
      else if (known.status === "known" && known.box !== m.box) this.store.patch("peerContacts", m.id, { box: m.box });
    }
    const record = {
      ...(current || { createdAt: now(), lastAt: now(), unread: 0 }), id: roster.id, kind: "group", title: clip(roster.title, PEER_LIMITS.title) || "Conversación", owner: c.id, version: roster.version,
      members: members.filter((m) => isAddress(m.id)).map((m) => ({ id: m.id, role: m.id === c.id ? "owner" : m.role === "guest" ? "guest" : "member" })),
    };
    this.store.put("peerShares", record);
    if (!current) this.notify({ title: c.name + " te ha añadido a «" + record.title + "»", text: "Una conversación con " + (record.members.length - 1) + " personas.", shareId: record.id });
  }
  onMessage(c, body) {
    const s = this.memberShare(body.share, c.id);
    if (!s) return;
    const text = String(body.text || "").slice(0, PEER_LIMITS.text);
    if (!text.trim() || typeof body.id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(body.id)) return;
    const existing = this.store.get("peerMessages", body.id);
    if (existing) return;
    const at = typeof body.at === "string" && !Number.isNaN(Date.parse(body.at)) && Date.parse(body.at) < this.clock() + 300000 ? body.at : now();
    const bot = body.bot ? cleanBot(body.bot) : null;
    const mentions = cleanMentions(body.mentions);
    const people = (Array.isArray(body.people) ? body.people : []).filter((a) => isAddress(a) && s.members.some((m) => m.id === a)).slice(0, 16);
    const card = body.card && typeof body.card === "object" ? body.card : null; // checked by whoever reads it (meetings.mjs)
    // A thread reply: its root must be here (a reply to a reply goes to the root); a root we
    // never got leaves it as a plain message.
    let root = typeof body.thread === "string" ? this.store.get("peerMessages", body.thread.slice(0, 64)) : null;
    if (root?.thread) root = this.store.get("peerMessages", root.thread);
    if (root && root.shareId !== s.id) root = null;
    const named = people.includes(this.address);
    // In a group, a thread only calls those in it: its author, whoever replied, whoever is named.
    const calls = !root || s.kind === "dm" || named || root.from === this.address || this.store.where("peerMessages", "thread", root.id).some((r) => r.from === this.address);
    const m = this.store.put("peerMessages", {
      id: body.id, shareId: s.id, from: c.id, text, at, receivedAt: now(), status: "received",
      ...(typeof body.replyTo === "string" ? { replyTo: body.replyTo.slice(0, 64) } : {}), ...(root ? { thread: root.id } : {}), ...(bot ? { bot } : {}), ...(mentions.length ? { mentions } : {}), ...(people.length ? { people } : {}), ...(card ? { card } : {}),
    });
    this.store.patch("peerShares", s.id, { lastAt: at > (s.lastAt || "") ? at : s.lastAt, lastLine: lastLineOf((bot ? bot.name + ": " : "") + text), lastFrom: c.id, lastFromOther: c.id, unread: (s.unread || 0) + (calls ? 1 : 0) });
    this.typing.get(s.id)?.delete(bot ? c.id + "#" + bot.name : c.id);
    this.emit("live", { type: "message", shareId: s.id, message: this.messageView(m) });
    if (root) this.emitMessage(s.id, root.id);
    this.emit("live", this.live(s.id));
    const share = this.store.get("peerShares", s.id);
    this.emit("posted", { share, message: m, mine: false });
    if (!calls) return;
    const who = bot ? bot.name + " (bot de " + c.name.split(" ")[0] + ")" : c.name;
    const where = share.kind === "dm" ? "" : " en «" + share.title + "»";
    const title = named ? who + " te ha mencionado" + where : root ? who + " ha respondido en un hilo" + where : share.kind === "dm" ? who : who + where;
    this.notify({ title, text: lastLineOf(text), shareId: s.id, mention: named, thread: root?.id || null });
  }
  notify({ title, text, shareId, mention = false, thread = null }) {
    if (!this.notifier) return;
    // One notice per conversation: the newest replaces the one you did not read.
    for (const n of this.store.list("notifications").filter((n) => n.peerShare === shareId && !n.read)) this.store.remove("notifications", n.id);
    try {
      // A mention has its own sound and gets through «Avísame de: lo importante».
      this.notifier.notify({ kind: mention ? "mention" : "message", title, text, url: "/con/" + shareId + (thread ? "?hilo=" + thread : ""), extra: { peerShare: shareId } });
    } catch (error) {
      this.log("No se pudo avisar: " + error.message);
    }
  }
  pruneSeen() {
    const limit = this.clock() - PEER_LIMITS.seenDays * 864e5;
    for (const r of this.store.columns("peerSeen", ["id", "at"])) if (Date.parse(r.at) < limit) this.store.remove("peerSeen", r.id);
  }
  /** Tells your contacts your new name. */
  announceProfile() {
    const name = this.myName();
    const bots = this.myBots();
    const status = this.myStatus();
    const signature = JSON.stringify([name, bots, status]);
    if (this.config().announced === signature) return;
    this.store.put("peerConfig", { ...this.config(), announced: signature });
    for (const c of this.contacts().filter((x) => x.status === "active")) this.enqueue(c.id, { type: "profile", name, bots, status });
    void this.flushOutbox();
  }
}

/** The text you copy and send yourself (WhatsApp, mail…). */
export function inviteText(to, from, code, room = null) {
  const first = String(to).split(/\s+/)[0] || "";
  return [
    room ? `Hola${first ? " " + first : ""}, soy ${from}. Te invito a la conversación «${room}» en Colmena.` : `Hola${first ? " " + first : ""}, soy ${from}. Te invito a hablar conmigo desde Colmena.`,
    `1. Si aún no la tienes, descárgala gratis: ${DOWNLOAD_URL}`,
    "2. En Colmena, abre Chats › Nueva › «Tengo una invitación» y pega este código:",
    code,
    "Sirve una vez y caduca en 24 horas. Al pegarlo te saldrán cuatro palabras: las comprobamos juntos para saber que nadie se ha colado.",
  ].join("\n");
}
