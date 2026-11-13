// One room object (docs/ROOMS-CONTRACT.md, docs/PLAN-equipo-y-salas.md). A room is the parent of
// what were two things: a mission (your bots working, on this computer) and a share (the
// conversation with people, through the mailbox). Either link may be missing:
//   { id, title, slug, teamId|null, missionId|null, shareId|null, general, createdBy,
//     createdAt, archived, snoozedUntil, seenAt }            store kind `rooms`
// `private` is never stored: a room is private while it has no share. The two message stores
// stay apart; server/room-timeline.mjs reads them as one conversation.
//
// Who keeps it right: a sweep on start (one transaction) and, from then on, the store itself.
// Every mission that is a room and every group of people gets its room the moment it is
// written, whoever writes it (a new sala, a roster that arrives, a team's «general»), and
// resolveRoom makes it on the spot for anything that slipped through. Ids are deterministic
// (a room made from a mission has its id, one made from a group has the group's), so doing it
// twice changes nothing. Missions and shares are never rewritten: an older Colmena opens the
// same database and finds its salas and its groups as they were.
import { randomUUID } from "node:crypto";
import { now } from "./store.mjs";
import { MISSION_KINDS, isRoomMission, missionKind } from "./mission-kind.mjs";
import { roomSlug } from "./runtime/helpers.mjs";
import { snoozeUntil } from "./rooms.mjs";
import { statusNow } from "./notifications.mjs";
import { wrapReport } from "./external-content.mjs";
import { isAddress, verifyCard } from "./peers/protocol.mjs";
import { PEER_LIMITS, botsOf, cleanBot } from "./peers/service.mjs";
import { RoomWork } from "./room-work.mjs";

// `intros`: people one person may make known to you in a day (room.intro: the owner of a room
// they propose you for; room.req: someone they propose for a room of yours). A person proposes a
// few people a day at most; each one is a new key kept here.
export const ROOM_LIMITS = Object.freeze({ title: PEER_LIMITS.title, requests: 20, context: 30, parts: 20, bots: 6, intros: 10 });
/** Assistant rows that count as something new in a room (docs/ROOMS-CONTRACT.md › Unread). */
const UNREAD_KINDS = new Set(["message", "deliverable", "question", "plan"]);
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const hhmm = (iso) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const later = (a, b) => (String(a || "") > String(b || "") ? a : b) || null;

export class RoomError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * A long answer cut into pieces a message can carry: [{text, glue}], `glue` being what stood
 * between a piece and the one before ("\n\n", "\n", " " or nothing). Cut at a paragraph when
 * there is one in the second half of the piece, else at a line, else at a word.
 */
export function splitForPeers(text, max = PEER_LIMITS.text) {
  const parts = [];
  let rest = String(text || "").trim(), glue = "";
  while (rest.length > max && parts.length < ROOM_LIMITS.parts - 1) {
    const head = rest.slice(0, max + 1);
    let cut = -1, sep = "";
    for (const s of ["\n\n", "\n", " "]) {
      const at = head.lastIndexOf(s);
      if (at >= max / 2) { cut = at; sep = s; break; }
    }
    if (cut < 0) { cut = max; sep = ""; }
    parts.push({ text: rest.slice(0, cut).trimEnd(), glue });
    rest = rest.slice(cut + sep.length).trimStart();
    glue = sep;
  }
  if (rest) parts.push({ text: rest.slice(0, max), glue });
  return parts.filter((p) => p.text);
}
/** The pieces of splitForPeers (or of the messages that carried them), joined back. */
export const joinParts = (parts) => parts.map((p, i) => (i ? p.glue ?? "\n\n" : "") + p.text).join("");

export class Rooms {
  /** `getPeers`: «Personas» (server/peers/service.mjs) once it exists; without it every room is private. */
  constructor({ store, runtime = null, getPeers = () => null, log = (m) => console.warn("[salas] " + m) }) {
    this.store = store;
    this.runtime = runtime;
    this.getPeers = getPeers;
    this.log = log;
    this.shared = new Map(); // missionId → roomId, for rooms that have both links (the relay's hot path)
    this.stats = new Map(); // missionId → { seenAt, unread, lastAt } (dropped when its messages change)
    this.turns = new Map(); // peer message id → the mission message that started a turn for it
    this.thinking = new Map(); // stepId → { shareId, face }
    this.greeted = new Map(); // shareId → the roster version whose people were told your bots
    this.synced = new Map(); // shareId:address → when that person was last sent the roster they asked for
    this.attached = new WeakSet();
    // Other people's requests to your bots, and what a room's people see of a bot's work (server/room-work.mjs).
    this.work = new RoomWork(this);
    this.onChange = (change) => { try { this.changed(change); } catch (error) { this.log(error.message); } };
  }
  start() {
    try { this.sweep(); } catch (error) { this.log("No se pudieron preparar las salas: " + error.message); }
    this.store.listeners.add(this.onChange);
    this.work.start();
    return this;
  }
  stop() { this.store.listeners.delete(this.onChange); this.work.stop(); }

  // ---------------------------------------------------------------- who
  /** «Personas», once it has its keys; listening to it from the first time it is seen. */
  get peers() {
    const p = this.getPeers?.() || null;
    if (p && !this.attached.has(p)) this.attach(p);
    return p?.identity ? p : null;
  }
  attach(p) {
    if (!p || this.attached.has(p)) return this;
    this.attached.add(p);
    p.rooms = this;
    const safely = (fn) => (event) => { try { fn(event); } catch (error) { this.log(error.message); } };
    p.on("room", safely(({ from, body }) => this.receive(from, body)));
    p.on("profile-out", safely(() => this.announceBots()));
    // Once, when the mailbox first connects: people of rooms you were already in learn your bots
    // (only those who have not been told these same ones).
    let told = false;
    p.on("live", safely((event) => { if (event?.type === "relay" && event.status === "online" && !told) { told = true; this.announceBots(); } }));
    // «Personas» may start after the sweep: groups it already had get their room now.
    for (const s of this.store.list("peerShares")) if (s.kind === "group") this.ensureForShare(s);
    return this;
  }
  me() {
    const p = this.peers;
    const settings = this.store.get("settings", "main") || {};
    return { address: p?.address || null, name: p?.myName?.() || (settings.userName && settings.userName !== "Tu cuenta" ? settings.userName : "Tú") };
  }

  // ---------------------------------------------------------------- records
  save(room) {
    const saved = this.store.put("rooms", room);
    this.index(saved);
    return saved;
  }
  index(room) {
    for (const [missionId, roomId] of this.shared) if (roomId === room.id && missionId !== room.missionId) this.shared.delete(missionId);
    if (room.missionId && room.shareId) this.shared.set(room.missionId, room.id);
    else if (room.missionId) this.shared.delete(room.missionId);
  }
  ofMission(missionId) {
    if (typeof missionId !== "string" || !missionId) return null;
    const direct = this.store.get("rooms", missionId);
    return direct?.missionId === missionId ? direct : this.store.where("rooms", "missionId", missionId)[0] || null;
  }
  ofShare(shareId) {
    if (typeof shareId !== "string" || !shareId || shareId.startsWith("dm-")) return null;
    const direct = this.store.get("rooms", shareId);
    return direct?.shareId === shareId ? direct : this.store.where("rooms", "shareId", shareId)[0] || null;
  }
  /** The room of a group of people (never of a direct conversation), made now if it was missing. */
  roomOfShare(share) { return share?.kind === "group" ? this.ensureForShare(share) : null; }
  /**
   * The room `x` names: its own id, its mission's or its share's (`/sala/:id` and `/con/:id`
   * keep working). A direct conversation («dm-…») is never a room.
   */
  resolveRoom(x) {
    if (typeof x !== "string" || !x || x.startsWith("dm-")) return null;
    const found = this.store.get("rooms", x) || this.store.where("rooms", "missionId", x)[0] || this.store.where("rooms", "shareId", x)[0];
    if (found) return found;
    // Something written before this Colmena knew rooms, or while it was not looking.
    const m = this.store.get("missions", x);
    if (m && isRoomMission(m)) return this.ensureForMission(m);
    const s = this.store.get("peerShares", x);
    return s?.kind === "group" ? this.ensureForShare(s) : null;
  }
  must(x) {
    const room = this.resolveRoom(x);
    if (!room) throw new RoomError("No existe esa sala.", 404);
    return room;
  }
  mission(room) { return room?.missionId ? this.store.get("missions", room.missionId) : null; }
  share(room) { return room?.shareId ? this.store.get("peerShares", room.shareId) : null; }

  // ---------------------------------------------------------------- migration
  /**
   * Every sala becomes a private room and every group of people a room with its share; every
   * mission learns its kind. One transaction: all of it or none. Running it again finds
   * everything done.
   */
  sweep() {
    const made = this.store.tx(() => {
      let n = 0;
      for (const m of this.store.list("missions")) {
        // The kind is added without touching `updatedAt` (lists are sorted by it) and without waking anybody.
        const mission = MISSION_KINDS.includes(m.kind) ? m : this.store.put("missions", { ...m, kind: missionKind(m) }, { silent: true });
        if (isRoomMission(mission) && !this.ofMission(mission.id)) { this.ensureForMission(mission); n++; }
      }
      for (const s of this.store.list("peerShares")) if (s.kind === "group" && !this.ofShare(s.id)) { this.ensureForShare(s); n++; }
      return n;
    });
    this.shared.clear();
    for (const r of this.store.list("rooms")) this.index(r);
    return made;
  }
  /** A sala's room: `{ id: mission.id, missionId }`, private. Null when the mission is not a room. */
  ensureForMission(m) {
    if (!m) return null;
    const found = this.ofMission(m.id);
    if (found) return found;
    if (!isRoomMission(m)) return null;
    return this.save({
      id: m.id, title: m.room || m.title || "sala", slug: m.room || roomSlug(m.title), teamId: null, missionId: m.id, shareId: null, general: false,
      createdBy: this.getPeers?.()?.address || null, createdAt: m.createdAt || now(), archived: !!m.archived, snoozedUntil: m.snoozedUntil || null, seenAt: null,
    });
  }
  /**
   * A group's room: `{ id: share.id, shareId }`, of the team its roster names (teams.mjs keeps
   * `teamId` only when that team says so). A room that just got its share (its first invitation:
   * the share is made with the room's id) is that same room. Its name follows the share's.
   */
  ensureForShare(s) {
    if (!s || s.kind !== "group") return null;
    // A room of yours without people that has this very id is that room only when the
    // conversation is one YOU made (its first invitation). Somebody else's group that happens to
    // carry the id of a room of yours never takes it over: it gets a room of its own.
    const same = this.store.get("rooms", s.id);
    const mine = !!s.owner && s.owner === this.getPeers?.()?.address;
    const found = this.ofShare(s.id) || (same && !same.shareId && mine ? same : null);
    const tie = { title: s.title || "sala", slug: roomSlug(s.title), teamId: s.teamId || null, general: !!s.general };
    if (!found) return this.save({ id: same ? randomUUID() : s.id, ...tie, missionId: null, shareId: s.id, createdBy: s.owner || null, createdAt: s.createdAt || now(), archived: false, snoozedUntil: null, seenAt: null });
    const next = { ...found, ...tie, shareId: s.id, ...(found.shareId ? {} : { createdBy: s.owner || found.createdBy }) };
    return JSON.stringify(next) === JSON.stringify(found) ? found : this.save(next);
  }

  // ---------------------------------------------------------------- what the store tells
  changed(change) {
    if (change?.type !== "record") return;
    const { kind, op, data, id } = change;
    if (kind === "approvals" || kind === "thread") return this.work.changed(change);
    if (kind === "missions") { if (op !== "remove") this.work.changed(change); return op === "remove" ? this.missionGone(id) : this.missionChanged(data); }
    if (kind === "peerShares") return op === "remove" ? this.shareGone(id) : this.shareChanged(data);
    if (kind === "messages") return data?.missionId ? void this.stats.delete(data.missionId) : void this.stats.clear();
    if (kind === "steps" && op !== "remove" && data) return this.stepChanged(data);
    if (kind === "peerMessages" && op === "insert" && data?.shareId && data.status === "received") return this.wake(this.ofShare(data.shareId));
  }
  missionChanged(m) {
    if (!m || !isRoomMission(m)) return;
    const room = this.ofMission(m.id) || this.ensureForMission(m);
    if (!room) return;
    // A private room is named after its sala; with people, the share's title is the truth.
    const next = { ...room, archived: !!m.archived, snoozedUntil: m.snoozedUntil || null, ...(room.shareId ? {} : { title: m.room || m.title || room.title, slug: m.room || room.slug }) };
    if (JSON.stringify(next) !== JSON.stringify(room)) this.save(next);
  }
  missionGone(missionId) {
    this.stats.delete(missionId);
    const room = this.ofMission(missionId);
    if (!room) return;
    // A room needs one of its links: without people it goes with its sala.
    if (room.shareId) this.save({ ...room, missionId: null });
    else { this.store.remove("rooms", room.id); this.shared.delete(missionId); }
  }
  shareChanged(s) {
    if (s?.kind !== "group") return;
    this.ensureForShare(s);
    this.work.sawMembers(s);
    if (!s.leftAt && !s.removedAt && this.greeted.get(s.id) !== s.version) this.greetRoommates(s);
  }
  shareGone(shareId) {
    const room = this.ofShare(shareId);
    if (!room) return;
    if (room.missionId) this.save({ ...room, shareId: null, general: false, teamId: null });
    else this.store.remove("rooms", room.id);
  }
  /** Something new from someone else: a room put away comes back (as a sala does, rooms.mjs). */
  wake(room) {
    if (!room || (!room.archived && !room.snoozedUntil)) return;
    const m = this.mission(room);
    if (m && (m.archived || m.snoozedUntil)) this.store.patch("missions", m.id, { archived: false, snoozedUntil: null, wokeAt: now(), wokeBy: "activity" });
    this.save({ ...this.store.get("rooms", room.id), archived: false, snoozedUntil: null });
  }

  // ---------------------------------------------------------------- views
  /** What is new from your bots since you last looked, and when the room last moved. */
  statsOf(room) {
    if (!room.missionId) return { unread: 0, lastAt: null };
    const cached = this.stats.get(room.missionId);
    if (cached && cached.seenAt === room.seenAt) return cached;
    const rows = this.store.where("messages", "missionId", room.missionId);
    let unread = 0, lastAt = null;
    for (const m of rows) {
      if (m.role !== "user" && m.role !== "assistant") continue;
      lastAt = later(lastAt, m.at);
      // An answer said in parts counts once. Never seen with the room's own screen: nothing counts yet.
      if (room.seenAt && m.role === "assistant" && UNREAD_KINDS.has(m.kind || "message") && !(m.part > 1) && String(m.at || "") > room.seenAt) unread++;
    }
    const stats = { seenAt: room.seenAt, unread, lastAt };
    this.stats.set(room.missionId, stats);
    return stats;
  }
  view(room) {
    const s = this.share(room), m = this.mission(room), me = this.me();
    const stats = this.statsOf(room);
    return {
      id: room.id, title: s?.title || room.title, slug: room.slug || null, teamId: room.teamId || null, missionId: m ? room.missionId : null, shareId: s ? room.shareId : null,
      general: !!room.general, private: !s, createdBy: room.createdBy || me.address, createdAt: room.createdAt || null,
      archived: !!room.archived, snoozedUntil: room.snoozedUntil || null, seenAt: room.seenAt || null,
      // You may rename it, add people and close it (rosters are signed by whoever made the room).
      mine: !s || s.owner === me.address,
      unread: (s?.unread || 0) + stats.unread, lastAt: later(later(s?.lastAt, stats.lastAt), room.createdAt),
      // Where today's screens open it, until there is one screen for every room.
      href: s ? "/con/" + s.id : "/sala/" + room.missionId,
      ...(s?.leftAt ? { left: true } : {}), ...(s?.removedAt ? { removed: true } : {}),
    };
  }
  /**
   * The rooms of a team; with no team (or «solo») the private ones and those of no team.
   * Without `gone`, the ones you left or were taken out of stay out.
   */
  list({ team = null, archived = null, gone = false } = {}) {
    const teamId = team && team !== "solo" ? team : null;
    return this.store.list("rooms")
      .filter((r) => (teamId ? r.teamId === teamId : !r.teamId) && (archived === null || !!r.archived === archived))
      .map((r) => this.view(r))
      .filter((v) => (v.missionId || v.shareId) && (gone || (!v.left && !v.removed)))
      .sort((a, b) => String(b.lastAt || "").localeCompare(String(a.lastAt || "")) || a.id.localeCompare(b.id));
  }
  /** Every room you are in, light, for /api/state: the sidebar follows it live. */
  state() {
    const busy = this.work.activityLight();
    return this.store.list("rooms").map((r) => this.view(r)).filter((v) => (v.missionId || v.shareId) && !v.left && !v.removed && !v.archived)
      // Lean (the state is fetched after every change): `unread` only when there is something.
      // A private room says neither its `title` (its sala's name, already in `missions`) nor its
      // `missionId` when that is the room's own id. The address follows from the links: its
      // share's conversation, else its sala (src/lib/rooms.js roomLinks).
      .map((v) => ({
        id: v.id, ...(v.shareId ? { title: v.title } : {}), lastAt: v.lastAt, ...(v.unread ? { unread: v.unread } : {}),
        ...(v.teamId ? { teamId: v.teamId } : {}), ...(v.missionId && (v.shareId || v.missionId !== v.id) ? { missionId: v.missionId } : {}), ...(v.shareId ? { shareId: v.shareId } : {}),
        ...(v.general ? { general: true } : {}), ...(v.snoozedUntil ? { snoozedUntil: v.snoozedUntil } : {}),
        // Bots at work in it now, light: whose, which and in what state (server/room-work.mjs).
        ...(v.shareId && busy.has(v.shareId) ? { activity: busy.get(v.shareId) } : {}),
      }));
  }
  personView(member) {
    const p = this.peers;
    if (member.id === p.address) return { address: member.id, name: p.myName(), role: member.role || "member", presence: "online", status: p.myStatus(), you: true };
    const c = p.contact(member.id);
    return { address: member.id, name: c?.name || "Alguien", role: member.role || "member", presence: p.online(member.id) ? "online" : "offline", status: p.awayOf(c) || { mode: "available", until: null }, you: false };
  }
  /**
   * Your bots in a room. Private: the ones of its sala (and Atlas, who coordinates). With
   * people: every bot of yours that is switched on and is not a personal one; any of them can
   * be named there, and joins the room's sala the first time it works in it.
   */
  myBots(room) {
    const m = this.mission(room);
    const working = (id) => { const a = this.runtime?.activity?.get?.(id); return a && a.missionId === room.missionId ? "working" : "free"; };
    const all = this.store.list("bots").filter((b) => b.enabled !== false);
    const ids = room.shareId ? all.filter((b) => b.audience !== "yo").map((b) => b.id) : [...new Set([...(m?.botIds || []), ...(m && !m.conversation ? ["atlas"] : [])])];
    return ids.map((id) => all.find((b) => b.id === id)).filter(Boolean).slice(0, 24)
      .map((b) => ({ ...cleanBot(b), state: working(b.id), ...(room.shareId && m?.botIds?.includes(b.id) ? { member: true } : {}) }))
      .filter((b) => b.id);
  }
  /** A room with who is in it and the bots of each (GET /api/rooms/:id). */
  detail(x) {
    const room = this.must(typeof x === "string" ? x : x.id);
    const s = this.share(room), me = this.me(), p = s ? this.needPeers() : this.peers;
    const settings = this.store.get("settings", "main") || {};
    const people = s ? s.members.map((member) => this.personView(member))
      : [{ address: me.address, name: me.name, role: "owner", presence: "online", status: p ? p.myStatus() : statusNow(settings), you: true }];
    const bots = [{ owner: { address: me.address, name: me.name, you: true }, bots: this.myBots(room) }];
    // Other people's bots are the ones they announced: to their contacts, to their team, or to this room (room.bots).
    for (const member of s ? s.members : []) {
      if (member.id === me.address) continue;
      const c = p.contact(member.id);
      if (c?.bots?.length) bots.push({ owner: { address: member.id, name: c.name || "Alguien", you: false }, bots: c.bots });
    }
    const requests = s && s.owner === me.address ? this.store.where("roomRequests", "shareId", s.id).filter((r) => r.status === "asked").map((r) => this.requestView(r)) : [];
    // Who is at work here now (your bots and other people's), and what other people ask your bots (server/room-work.mjs).
    const asks = s ? this.work.asksOf(room) : [];
    return { ...this.view(room), people, bots, activity: s ? this.work.activity(room) : [], ...(asks.length ? { asks } : {}), ...(requests.length ? { requests } : {}) };
  }
  requestView(r) {
    const p = this.peers;
    return { id: r.id, roomId: r.roomId, from: { address: r.from, name: p?.contact(r.from)?.name || "Alguien" }, person: { address: r.member.id, name: r.member.name || "Alguien" }, status: r.status, at: r.at };
  }

  // ---------------------------------------------------------------- creating, changing
  needPeers() {
    const p = this.peers;
    if (!p) throw new RoomError("«Personas» se está preparando. Prueba en unos segundos.", 503);
    return p;
  }
  /** A sala with nothing said yet: it waits for the first message (as a copied room does, rooms.mjs). */
  idleMission(title, botIds = []) {
    const bots = [...new Set(botIds)].filter((b) => b !== "atlas");
    for (const b of bots) {
      const bot = this.store.get("bots", b);
      if (!bot || bot.enabled === false) throw new RoomError("Ese bot no está disponible.");
      if (bot.audience === "yo") throw new RoomError("Los bots personales solo participan en su chat privado.");
    }
    if (bots.length > ROOM_LIMITS.bots) throw new RoomError("Como máximo seis bots por sala.");
    const taken = new Set(this.store.list("missions").map((m) => m.room).filter(Boolean));
    return {
      id: randomUUID(), title, room: roomSlug(title, taken), prompt: "", mode: "equipo", kind: "sala", botIds: bots, conversation: false, conversationOf: null,
      safety: "preguntar", status: "completed", createdAt: now(), completedAt: null, error: null, steps: [], automationId: null, learningStatus: "skipped",
      priorMessages: [], chosenBotIds: [], plan: null,
    };
  }
  /**
   * A new room. Alone and without a team it is private: today's sala (with `text`, its first
   * message, the bots start at once). In a team, or with people, it has a share from the start
   * (the team-room path of «Personas»), and a sala too when bots are given.
   */
  create({ title, team = null, botIds = [], people = [], text = "" } = {}) {
    const name = clip(title, ROOM_LIMITS.title);
    if (!name) throw new RoomError("Ponle un nombre a la sala.");
    const teamId = team && team !== "solo" ? team : null;
    const first = String(text || "").trim();
    const id = randomUUID();
    const blank = { id, title: name, slug: roomSlug(name), teamId: null, missionId: null, shareId: null, general: false, createdBy: this.me().address, createdAt: now(), archived: false, snoozedUntil: null, seenAt: null };
    if (!teamId && !people.length) {
      let started = null;
      const room = this.store.tx(() => {
        const mission = first && this.runtime
          ? (started = this.runtime.create({ prompt: first, title: name, mode: "equipo", botIds: botIds.filter((b) => b !== "atlas"), safety: "preguntar", kind: "sala" }))
          : this.store.put("missions", this.idleMission(name, botIds));
        return this.save({ ...blank, title: mission.room || name, slug: mission.room, missionId: mission.id });
      });
      if (started) try { this.runtime.launch(started.id); } catch (error) { this.log(error.message); }
      return this.detail(room.id);
    }
    const p = this.needPeers();
    const mission = botIds.length ? this.idleMission(name, botIds) : null; // checked before anything is sent
    p.createGroup(name, people, { teamId, id });
    // The share is written: its room exists (shareChanged). The sala hangs from that same room.
    this.ensureForShare(this.store.get("peerShares", id));
    if (mission) {
      this.save({ ...this.store.get("rooms", id), missionId: mission.id });
      this.store.put("missions", mission);
    }
    if (first) this.send(id, { text: first });
    return this.detail(id);
  }
  /**
   * Rename, archive or put off. A room with people is renamed only by whoever made it (the
   * new name travels in the roster and comes back as the room's title).
   */
  patch(x, { title, archived, snooze, snoozedUntil } = {}) {
    const room = this.must(x), s = this.share(room), m = this.mission(room);
    if (title !== undefined) {
      const name = clip(title, ROOM_LIMITS.title);
      if (!name) throw new RoomError("Ponle un nombre a la sala.");
      if (s) {
        const p = this.needPeers();
        if (s.owner !== p.address) throw new RoomError("Solo " + (p.contact(s.owner)?.name || "quien creó la sala") + " puede cambiarle el nombre.", 403);
        p.renameGroup(s.id, name);
      }
      if (m) {
        // The sala's #slug follows (unique among salas); a private room is named after it.
        const taken = new Set(this.store.list("missions").filter((x2) => x2.id !== m.id).map((x2) => x2.room).filter(Boolean));
        const base = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
        if (!base && !s) throw new RoomError("Escribe un nombre con letras o números.");
        let slug = base || m.room;
        for (let n = 2; taken.has(slug); n++) slug = base + "-" + n;
        if (slug !== m.room) this.store.patch("missions", m.id, { room: slug });
      }
    }
    const until = snooze ? snoozeUntil(snooze) : snoozedUntil;
    if (archived !== undefined || until !== undefined) {
      if (archived && m && ["running", "queued", "planning"].includes(m.status)) throw new RoomError("Espera a que terminen o páralos antes de archivar la sala.", 409);
      const changes = { ...(archived !== undefined ? { archived: !!archived, ...(archived ? { snoozedUntil: null } : {}) } : {}), ...(until !== undefined ? { snoozedUntil: until || null } : {}) };
      if (m) this.store.patch("missions", m.id, changes);
      this.save({ ...this.store.get("rooms", room.id), ...changes });
    }
    return this.detail(room.id);
  }
  /** You go (its creator closes it for everyone). A room only you are in is archived or deleted, not left. */
  leave(x) {
    const room = this.must(x);
    if (!room.shareId) throw new RoomError("En esta sala solo estás tú: puedes archivarla o borrarla.", 409);
    this.needPeers().leave(room.shareId);
    return { ok: true };
  }
  /** You have seen it: nothing in it is new any more, and the people in it learn you read it. */
  seen(x) {
    const room = this.must(x);
    const at = now();
    this.save({ ...this.store.get("rooms", room.id), seenAt: at });
    if (room.shareId) try { this.peers?.seen(room.shareId); } catch (error) { this.log(error.message); }
    if (room.missionId)
      for (const n of this.store.where("notifications", "missionId", room.missionId)) if (!n.read && ["message", "mention"].includes(n.kind)) this.store.put("notifications", { ...n, read: true, readAt: at });
    return { ok: true, seenAt: at, unread: 0 };
  }
  /** «Personas» marked the conversation read (today's screen): the room is seen too. */
  shareSeen(shareId) {
    const room = this.ofShare(shareId);
    if (room) this.save({ ...room, seenAt: now() });
  }

  // ---------------------------------------------------------------- people
  /**
   * Someone joins the room. The first person makes a private room a room with people: its
   * share is made with the room's own id and its sala stays. From then on what you write
   * there goes to them; they see nothing of what was said before (it never left this computer).
   * `address`: someone you talk to (or a teammate, in a room of a team). `invite` {name, role}:
   * a code for someone who is not in your people yet.
   * Only whoever made the room signs who is in it: anyone else's request goes to them
   * (room.req) and waits for their OK.
   */
  async invite(x, { address = null, invite = null } = {}) {
    const room = this.must(x), p = this.needPeers();
    if (room.general) throw new RoomError("En «general» entra quien entra en el equipo.", 409);
    let s = this.share(room);
    if (s && (s.leftAt || s.removedAt)) throw new RoomError("Ya no estás en esta sala.", 409);
    if (s && s.owner !== p.address) {
      const owner = p.contact(s.owner)?.name || "quien creó la sala";
      if (!address) throw new RoomError("Pídele a " + owner + " que le invite.", 403);
      return this.askOwner(room, s, address);
    }
    if (address) {
      if (!isAddress(address) || address === p.address) throw new RoomError("Esa persona no es válida.");
      if (!s) this.ensureForShare(this.store.get("peerShares", p.createGroup(clip(room.title, ROOM_LIMITS.title), [address], { id: room.id, teamId: room.teamId || null }).id));
      else p.addMembers(s.id, [address]);
      return { added: { address, name: p.contact(address)?.name || "Alguien" }, room: this.detail(room.id) };
    }
    const label = clip(invite?.name, PEER_LIMITS.name);
    if (!label) throw new RoomError("Escribe cómo se llama.");
    // A code puts them in the room when they use it: the room needs its conversation first.
    if (!s) s = this.share(this.ensureForShare(this.store.get("peerShares", p.createGroup(clip(room.title, ROOM_LIMITS.title), [], { id: room.id, teamId: room.teamId || null }).id)));
    const made = await p.createInvite(label, { room: s.id, role: invite?.role === "guest" ? "guest" : "member" });
    return { invite: made, room: this.detail(room.id) };
  }
  /** You are not who made the room: «please add this person» goes to whoever did. */
  askOwner(room, s, address) {
    const p = this.needPeers();
    if (p.roleOf(s, p.address) === "guest") throw new RoomError("Como invitado no puedes añadir a nadie.", 403);
    if (s.members.some((m) => m.id === address)) throw new RoomError("Esa persona ya está en la sala.", 409);
    const c = p.contact(address);
    if (!c || !isAddress(c.box) || !["active", "known"].includes(c.status)) throw new RoomError("Solo puedes proponer a personas con las que ya hablas.");
    const owner = p.contact(s.owner);
    if (!owner?.box) throw new RoomError("No se pudo avisar a quien creó la sala.", 409);
    // Each of the two learns the other's key from you: only as that person signed it themselves.
    const mine = (x) => { const card = verifyCard(x?.card); return card && card.id === x.id && card.box === x.box ? card : null; };
    if (!mine(c)) throw new RoomError("Todavía no puedes proponer a " + c.name + ": su Colmena aún no te ha confirmado su clave. Prueba cuando haya estado conectada.", 409);
    if (!mine(owner)) throw new RoomError("Todavía no puedes proponerlo: la Colmena de " + (owner.name || "quien creó la sala") + " aún no te ha confirmado su clave. Prueba cuando haya estado conectada.", 409);
    // A Colmena only takes a room's list from someone it knows: the person learns from you who
    // made this room (as they would learn of anyone you put in a room of yours).
    p.enqueue(address, { type: "room.intro", share: s.id, owner: { id: owner.id, box: owner.box, name: owner.name, card: owner.card } });
    if (!p.enqueue(s.owner, { type: "room.req", share: s.id, op: "add", member: { id: c.id, box: c.box, name: c.name, card: c.card } })) throw new RoomError("No se pudo avisar a quien creó la sala.", 409);
    void p.flushOutbox();
    return { asked: true, owner: { address: s.owner, name: owner?.name || "Alguien" }, person: { address, name: c.name }, text: "Se lo hemos pedido a " + (owner?.name || "quien creó la sala") + "." };
  }
  receive(from, body) {
    switch (body.type) {
      case "room.req": return this.onRequest(from, body);
      case "room.no": return this.onRefused(from, body);
      case "room.intro": return this.onIntro(from, body);
      case "room.bots": return this.onBots(from, body);
      case "room.sync": return this.onSync(from, body);
      case "room.status": return this.work.onStatus(from, body);
      case "room.handoff": return this.work.onHandoff(from, body);
      default: // a newer Colmena's message: ignored
    }
  }
  /**
   * Someone asks for the roster of a room of yours again (a message told them theirs is old:
   * Peers#newerRoster). A member gets it as it is now, also when it has not changed, so they
   * know nothing was lost. Someone who is not in it learns only that: a roster with you alone
   * and no title. Once every few seconds each.
   */
  onSync(from, body) {
    const p = this.needPeers();
    const s = typeof body.share === "string" ? this.store.get("peerShares", body.share) : null;
    if (!s || s.kind !== "group" || s.owner !== p.address || s.leftAt || s.removedAt) return;
    const key = s.id + ":" + from.id, t = p.clock();
    if (t - (this.synced.get(key) || 0) < 10000) return;
    this.synced.set(key, t);
    if (this.synced.size > 500) this.synced.delete(this.synced.keys().next().value);
    const roster = s.members.some((m) => m.id === from.id) ? p.roster(s)
      : p.roster(s, { title: "", members: [{ id: p.address, role: "owner", box: p.identity.box.pub, name: p.myName() }] });
    if (p.enqueue(from.id, { type: "share", share: roster })) void p.flushOutbox();
  }
  /** A member of a room of yours asks you to add someone: noted, and you are told. Nothing is added until you say so. */
  onRequest(from, body) {
    const p = this.needPeers();
    const s = typeof body.share === "string" ? this.store.get("peerShares", body.share) : null;
    if (body.op !== "add" || !s || s.kind !== "group" || s.owner !== p.address || s.general || s.leftAt || s.removedAt) return;
    if (!["owner", "member"].includes(p.roleOf(s, from.id))) return; // a guest, or someone who is not in it
    // The person proposed, as they signed themselves (their address, box key and name): a key
    // somebody else merely says is theirs is never kept. Someone already known here keeps theirs.
    const card = verifyCard(body.member?.card), had = p.contact(body.member?.id);
    const member = had?.box && had.status !== "removed" ? { id: had.id, box: had.box, name: had.name } : card && card.id === body.member?.id ? { id: card.id, box: card.box, name: card.name } : null;
    if (!isAddress(member?.id) || !isAddress(member.box) || member.id === p.address || s.members.some((m) => m.id === member.id)) return;
    const day = new Date(Date.now() - 864e5).toISOString();
    if (this.store.where("roomRequests", "from", from.id).filter((r) => String(r.at) > day).length >= ROOM_LIMITS.intros) return;
    const open = this.store.where("roomRequests", "shareId", s.id).filter((r) => r.status === "asked");
    if (open.length >= ROOM_LIMITS.requests || open.some((r) => r.member.id === member.id)) return;
    const room = this.roomOfShare(s);
    const name = clip(p.contact(member.id)?.name || member.name, PEER_LIMITS.name) || "Alguien";
    const record = this.store.put("roomRequests", { id: randomUUID(), roomId: room.id, shareId: s.id, missionId: room.missionId || null, from: from.id, member: { id: member.id, box: member.box, name }, status: "asked", at: now() });
    this.notice({ title: from.name + " pide añadir a " + name + " a «" + s.title + "»", text: "Entra en la sala si tú quieres.", room, extra: { roomRequest: record.id } });
  }
  /**
   * Someone you talk to is asking a room's owner to add you, and tells you who that is: known
   * from now on (they can put you in that room; they cannot write to you alone), as the people
   * of any room a contact of yours puts you in.
   */
  onIntro(from, body) {
    const p = this.needPeers(), owner = verifyCard(body.owner?.card);
    // Only with the owner's own card (their address, box key and name, signed by them), and a few a day from one person.
    if (from.status !== "active" || !owner || owner.id !== body.owner.id || owner.id === p.address || p.contact(owner.id)) return;
    const day = new Date(Date.now() - 864e5).toISOString();
    if (this.store.where("peerContacts", "via", "intro:" + from.id).filter((c) => String(c.addedAt) > day).length >= ROOM_LIMITS.intros) return;
    this.store.put("peerContacts", { id: owner.id, box: owner.box, name: clip(owner.name, PEER_LIMITS.name) || "Alguien", status: "known", via: "intro:" + from.id, addedAt: now(), card: owner });
  }
  /** Your one-click answer to a «please add»: in (the new roster goes to everyone) or not. */
  decide(x, requestId, decision) {
    const room = this.must(x), p = this.needPeers();
    const r = this.store.get("roomRequests", String(requestId));
    if (!r || r.roomId !== room.id) throw new RoomError("No existe esa petición.", 404);
    if (r.status !== "asked") throw new RoomError("Esa petición ya está decidida.", 409);
    if (decision === "approve") {
      const known = p.contact(r.member.id);
      // Someone you do not talk to: known through this room, as anyone its owner puts in it.
      if (!known || known.status === "removed") this.store.put("peerContacts", { ...(known || {}), id: r.member.id, box: r.member.box, name: r.member.name, status: known?.status === "removed" ? "removed" : "known", via: "group:" + r.shareId, addedAt: known?.addedAt || now() });
      if (!this.store.get("peerShares", r.shareId)?.members.some((m) => m.id === r.member.id)) p.addMembers(r.shareId, [r.member.id], "member", { vouched: true });
      this.store.patch("roomRequests", r.id, { status: "added", decidedAt: now() });
    } else {
      this.store.patch("roomRequests", r.id, { status: "declined", decidedAt: now() });
      if (p.enqueue(r.from, { type: "room.no", share: r.shareId, member: r.member.id })) void p.flushOutbox();
    }
    return this.detail(room.id);
  }
  onRefused(from, body) {
    const p = this.needPeers();
    const s = typeof body.share === "string" ? this.store.get("peerShares", body.share) : null;
    if (!s || s.owner !== from.id || !isAddress(body.member)) return;
    this.notice({ title: from.name + " no ha añadido a " + (p.contact(body.member)?.name || "esa persona") + " a «" + s.title + "»", text: "Puedes hablarlo en la sala.", room: this.roomOfShare(s) });
  }
  notice({ title, text, room, extra = {} }) {
    try {
      this.peers?.notifier?.notify({ kind: "room", title, text, url: this.view(room).href, extra: { roomId: room.id, ...extra } });
    } catch (error) {
      this.log("No se pudo avisar: " + error.message);
    }
  }

  // ---------------------------------------------------------------- bots of people you only share a room with
  // Contacts get your bots with «profile» and teammates with «team.profile» (teams.mjs). Someone
  // you only share a room with (its owner put you both in it) gets «room.bots»: name, role,
  // colour and shape, nothing of what they know. Stored under whoever signed the envelope.
  roommates(only = null) {
    const p = this.peers;
    const out = new Set();
    if (!p) return out;
    for (const s of only ? [only] : this.store.list("peerShares")) {
      if (s.kind !== "group" || s.leftAt || s.removedAt || !s.members.some((m) => m.id === p.address)) continue;
      for (const m of s.members) {
        if (m.id === p.address) continue;
        const c = p.contact(m.id);
        if (c?.box && c.status !== "active" && !p.teams?.teammate(m.id)) out.add(m.id);
      }
    }
    return out;
  }
  greetRoommates(s) {
    const p = this.peers;
    if (!p) return;
    this.greeted.set(s.id, s.version);
    const bots = p.myBots(), signature = JSON.stringify([bots, "card"]);
    let sent = false;
    for (const id of this.roommates(s)) {
      const c = p.contact(id);
      if (c.roomBotsSig === signature) continue;
      // `hi`: both sides say it when a roster brings them together, and one roster may still be on its way.
      if (!p.enqueue(id, { type: "room.bots", bots, hi: true, got: !!c.roomBotsAt, card: p.myCard() })) continue;
      this.store.patch("peerContacts", id, { roomBotsSig: signature });
      sent = true;
    }
    if (sent) void p.flushOutbox();
  }
  /** Your bots changed: the people you only share rooms with learn it too. */
  announceBots() {
    for (const s of this.store.list("peerShares")) if (s.kind === "group" && !s.leftAt && !s.removedAt) this.greetRoommates(s);
  }
  onBots(from, body) {
    const p = this.needPeers();
    const together = this.store.list("peerShares").some((s) => s.kind === "group" && !s.leftAt && !s.removedAt && s.members.some((m) => m.id === from.id) && s.members.some((m) => m.id === p.address));
    if (!together || !Array.isArray(body.bots)) return;
    p.keepCard(from.id, body.card);
    this.store.patch("peerContacts", from.id, { bots: botsOf(body), roomBotsAt: now() });
    if (body.hi === true && body.got !== true && p.enqueue(from.id, { type: "room.bots", bots: p.myBots(), card: p.myCard() })) void p.flushOutbox();
  }

  // ---------------------------------------------------------------- messages
  /**
   * Sends what you write in a room (POST /api/rooms/:id/messages).
   *  - Private: to its sala, as always (`toMission` is the missions route's own sender).
   *  - With people: through «Personas», to everyone. Whether one of your bots takes a turn is
   *    decided in ONE place for every way a message gets there (ownTurn, called by bots.mjs).
   * `to`: bots of yours it is for; `thread`: the message it replies in the thread of (an id of
   * either store); `replyTo`: the message it answers.
   */
  async send(x, data, { toMission = null } = {}) {
    const room = this.must(x);
    const { text, to = null, thread = null, replyTo = null, mentions = [], people = [], ...rest } = data;
    if (this.share(room) && rest.attachments?.length) throw new RoomError("En una sala con personas los archivos se comparten aparte, con «Adjuntar».");
    const s = this.share(room);
    if (!s) {
      if (!room.missionId) throw new RoomError("No existe esa sala.", 404);
      const options = { ...rest, ...(thread || replyTo ? { replyTo: thread || replyTo } : {}), ...(to?.length ? { to } : {}) };
      const message = toMission ? await toMission(room.missionId, { text, ...options }) : this.runtime.addMessage(room.missionId, text, [], options);
      return { engine: "mission", message, turn: message };
    }
    const p = this.needPeers();
    // The same message may be known here by its mission row and to the others by its peer id.
    const side = (id) => {
      if (!id) return { peer: null, mission: null };
      const row = this.store.get("messages", id);
      if (row && row.missionId === room.missionId) return { peer: row.peerId || null, mission: row.replyTo || row.id };
      const linked = room.missionId && this.store.get("peerMessages", id) ? this.store.where("messages", "missionId", room.missionId).find((m) => m.peerId === id || m.peerParts?.includes(id)) : null;
      return { peer: id, mission: linked ? linked.replyTo || linked.id : null };
    };
    const root = side(thread), answered = side(replyTo);
    const mine = [...new Set(to || [])].map((bot) => ({ owner: p.address, bot }));
    const view = p.post(s.id, text, {
      thread: root.peer, replyTo: answered.peer, people, mentions: [...mentions, ...mine.filter((m) => !mentions.some((x2) => x2.owner === m.owner && x2.bot === m.bot))],
      hint: { missionThread: root.mission || null, options: { ...(rest.use?.length ? { use: rest.use } : {}), ...(rest.deep ? { deep: true } : {}), ...(rest.mode ? { mode: rest.mode } : {}) } },
    });
    const turn = this.turns.get(view.id) || null;
    this.turns.delete(view.id);
    return { engine: "peer", message: view, turn };
  }
  /**
   * THE decision of whether your bots take a turn for a message of yours in a room with people
   * (bots.mjs calls it for every message you post there, whatever screen or route sent it).
   * They do when you name them — picked with «@», given in `to`, or «@Nombre» in a message with
   * no picks — or when you reply in the thread of something one of them said. A message that
   * names nobody is for the people: no router and no Atlas by default, unlike a private room.
   * The turn runs in the room's sala (made now if the room had none), with your bot's tools:
   * it is your own request. Returns the ids of the bots that took it; personal bots («solo para
   * mí») never work in a room and are left to answer as they do in any conversation with people.
   */
  ownTurn(share, message, botIds = [], hint = null) {
    const room = this.roomOfShare(share);
    if (!room || !this.runtime?.addMessage) return [];
    const usable = (id) => { const b = this.store.get("bots", id); return !!b && b.enabled !== false && b.audience !== "yo"; };
    let ids = [...new Set(botIds)].filter(usable).slice(0, 3);
    let replyTo = null;
    const root = hint?.missionThread ? this.store.get("messages", hint.missionThread) : null;
    if (root && root.missionId === room.missionId) {
      replyTo = root.id;
      if (!ids.length && root.role === "assistant" && root.botId && usable(root.botId)) ids = [root.botId];
    }
    if (!ids.length) return [];
    try {
      const mission = this.missionFor(room, ids);
      const before = new Set(this.store.where("messages", "missionId", mission.id).map((m) => m.id));
      const row = this.runtime.addMessage(mission.id, message.text, [], { ...(hint?.options || {}), to: ids, peerId: message.id, context: this.sharedNote(room, share, message), ...(replyTo ? { replyTo } : {}) });
      // A message that stopped the bots or resumed stalled work is written by another path: linked here.
      const linked = row?.role === "user" && !before.has(row.id) ? (row.peerId ? row : this.store.patch("messages", row.id, { peerId: message.id })) : null;
      if (linked) this.turns.set(message.id, linked);
      if (this.turns.size > 200) this.turns.delete(this.turns.keys().next().value);
    } catch (error) {
      this.localNote(share, ids[0], "No puedo ponerme con esto ahora: " + (error.message || "error desconocido"));
    }
    return ids;
  }
  /** The room's sala; made the first time one of your bots works there, and joined by the bots named. */
  missionFor(room, botIds) {
    let m = this.mission(room);
    if (!m) {
      m = this.idleMission(clip(this.share(room)?.title || room.title, ROOM_LIMITS.title), botIds.slice(0, 4));
      this.save({ ...this.store.get("rooms", room.id), missionId: m.id });
      this.store.put("missions", m);
      return m;
    }
    const missing = botIds.filter((b) => b !== "atlas" && !m.botIds.includes(b)).slice(0, Math.max(0, ROOM_LIMITS.bots - m.botIds.length));
    return missing.length ? this.store.patch("missions", m.id, { botIds: [...m.botIds, ...missing] }) : m;
  }
  /**
   * What your bot is told about where it is, and what the people said before (outside content).
   * It is read from the conversation the people share, never from the sala: what was said here
   * before the room had people, and what only you see, is not in it. `reader`: the turn answers
   * that person's request, so it gets only what they can have read (from when they came in).
   */
  sharedNote(room, share, message, { reader = null } = {}) {
    const p = this.needPeers();
    const others = share.members.map((m) => m.id).filter((id) => id !== p.address).map((id) => p.person(id).name);
    const owner = p.myName();
    const since = reader ? this.work.since(share, reader) : "";
    const said = this.store.ordered("peerMessages", "shareId", share.id, { before: { at: message.at, id: message.id }, limit: ROOM_LIMITS.context, lacks: "thread" })
      .filter((m) => !m.local && !m.deletedAt && m.text && (!reader || (m.status !== "failed" && String(m.at) >= since))).reverse();
    const who = (m) => (m.bot ? m.bot.name + " (bot de " + p.person(m.from).name + ")" : p.person(m.from).name);
    const lines = said.map((m) => `[${hhmm(m.at)}] ${who(m)}: ${m.text}`);
    return "\n\n[Colmena] Esto se ha escrito en la sala «" + share.title + "», que " + owner + " comparte con " + (others.length ? others.join(", ") : "otras personas") + ". Tu respuesta final la leerán todos, cada uno en su ordenador: " +
      "no pongas en ella nada privado de " + owner + " (correo, agenda, archivos, lo que recuerdas) que no te haya pedido compartir aquí. Lo que haces mientras trabajas solo lo ve " + owner + "." +
      (lines.length ? "\n" + wrapReport(lines.join("\n"), { source: "chat", label: "Lo que se ha dicho antes en la sala (personas y sus bots)" }).text : "");
  }
  /** A line only you see (never sent): why a bot of yours did not take the turn. */
  localNote(share, botId, text) {
    const p = this.peers, bot = cleanBot(this.store.get("bots", botId));
    if (!p || !bot) return;
    const m = this.store.put("peerMessages", { id: "local-" + Math.random().toString(36).slice(2, 12) + "-" + Date.now().toString(36), shareId: share.id, from: p.address, text, at: now(), status: "local", local: true, bot });
    p.emit("live", { type: "message", shareId: share.id, message: { ...p.messageView(m), local: true } });
  }

  // ---------------------------------------------------------------- your bot's answer goes to the people
  stepChanged(step) {
    const roomId = this.shared.get(step.missionId);
    if (!roomId) return;
    const room = this.store.get("rooms", roomId), p = this.peers;
    const s = this.share(room);
    if (!p || !s || s.leftAt || s.removedAt) return;
    // A routine's turn and an incognito conversation say nothing to the people of a room.
    if (this.work.silent(this.store.get("missions", step.missionId), step)) return;
    const bot = cleanBot(this.store.get("bots", step.botId));
    // While it works the others see it thinking (who it is, never what it does).
    if (step.status === "running" && bot && !this.thinking.has(step.id)) {
      this.thinking.set(step.id, { shareId: s.id, face: bot });
      p.botThinking(s.id, bot, true);
    } else if (step.status !== "running" && this.thinking.has(step.id)) {
      const { shareId, face } = this.thinking.get(step.id);
      this.thinking.delete(step.id);
      p.botThinking(shareId, face, false);
    }
    // The answer first, then the state: whoever reads the room gets them in that order.
    const answerId = step.status === "completed" && bot ? this.relay(room, s, step, bot) : null;
    if (bot) this.work.stepChanged(room, s, step, bot);
    // What it made for a request you allowed goes with the answer, as files.
    if (step.status === "completed" && bot && step.roomAsk) void this.work.deliver(s, step, bot, answerId).catch((error) => this.log(error.message));
  }
  /**
   * Whether a turn belongs to the conversation the people share: it started after the room had
   * people, and what it answers came through that conversation (a message you posted there, or
   * another person's request). A turn of the sala from before, or one for something written to
   * the sala alone, says nothing to them, whenever its step is written again.
   */
  throughShare(s, step) {
    if (step.roomAsk) return true;
    const began = step.startedAt || step.createdAt || "";
    if (!began || String(began) < String(s.createdAt || "")) return false;
    // What it answers; a teammate that was passed the word answers a bot: followed back.
    let asked = step.ackOn ? this.store.get("messages", step.ackOn) : null;
    // Your late answer to a question of a bot goes on from the turn that asked it.
    const source = (m) => (m?.role === "assistant" && m.stepId ? m.stepId : m?.role === "user" && m.lateAnswer && m.approvalId ? this.store.get("approvals", m.approvalId)?.stepId : null);
    for (let i = 0; i < 6 && source(asked); i++) {
      const before = this.store.get("steps", source(asked));
      if (before?.roomAsk) return true;
      asked = before?.ackOn && before.ackOn !== asked.id ? this.store.get("messages", before.ackOn) : null;
    }
    // A part of a plan answers no message of its own: the last thing written before it began.
    if (!step.ackOn) asked = this.store.where("messages", "missionId", step.missionId).filter((m) => m.role === "user" && (m.kind || "message") === "message" && String(m.at) <= String(began)).at(-1) || null;
    return !!asked?.peerId;
  }
  /**
   * A turn of your bot ended in a room with people: its FINAL answer is posted to them, signed
   * as your bot, and the mission message keeps the id it travelled with (`peerId`; `peerParts`
   * when it went in several). Only that: no progress lines, plans, questions, approvals or
   * steps ever leave. Once per turn. Returns the id it travelled with (null when nothing went).
   * A turn that asked whoever made the request (ask_room) already said its part in the room.
   */
  relay(room, s, step, bot) {
    if (step.skipped || step.quietReply || step.kind === "plan" || step.askedRoom) return null;
    if (!this.throughShare(s, step)) return null;
    // (A line that says the bot got stuck is for its owner: never the answer.)
    const rows = this.store.where("messages", "missionId", step.missionId).filter((m) => m.stepId === step.id && m.role === "assistant" && (m.kind || "message") === "message" && !m.stall);
    const last = rows.at(-1);
    if (!last) return null;
    if (rows.some((m) => m.peerId)) return rows.find((m) => m.peerId).peerId;
    // Said in parts, the turn's whole answer is the step's text; else the message itself.
    const parts = splitForPeers(last.part ? String(step.text || "") || last.text : last.text);
    if (!parts.length) return null;
    const p = this.peers;
    const asked = step.ackOn ? this.store.get("messages", step.ackOn) : null;
    const root = step.replyTo ? this.store.get("messages", step.replyTo) : null;
    const of = randomUUID(), ids = [];
    try {
      parts.forEach((part, i) => {
        const sent = p.post(s.id, part.text, {
          bot, id: i ? null : of, replyTo: asked?.peerId || null, thread: root?.peerId || asked?.peerThread || null,
          ...(parts.length > 1 ? { part: { of, n: i + 1, total: parts.length, glue: part.glue } } : {}),
        });
        ids.push(sent.id);
      });
    } catch (error) {
      this.log("La respuesta de " + bot.name + " no pudo salir a la sala: " + error.message);
    }
    if (ids.length) this.store.patch("messages", last.id, { peerId: ids[0], ...(ids.length > 1 ? { peerParts: ids } : {}) });
    return ids[0] || null;
  }
}
