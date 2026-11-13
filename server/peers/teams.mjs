// Teams («Equipos», docs/PLAN-equipo-y-salas.md, docs/PEOPLE.md): a named, shared roster of
// people. Every member's Colmena shows the same team; there is still no server that owns it.
//
// Trust: ONE signer. Whoever creates a team signs its roster (name, version, members with
// their role and box key, the room of everyone) with their address key, and every Colmena
// accepts a roster only if that key signed it, it is newer than the one it holds, and it comes
// in the creator's own envelope. Admins do not sign rosters: they send the creator's Colmena a
// request in their own signed envelope (team.req), which it checks against the current roster,
// applies and signs again. So there are no forks to merge and a removed admin has nothing to
// replay: an old roster is older, and a new one needs the creator's key. The price is that an
// admin's change waits until the creator's Colmena is on (the mailbox keeps it for 7 days).
//
//   creator → members        team.roster  {roster}                   the signed truth
//   member  → creator        team.req     {team, op, …}              add · remove · rename · admin · leave
//   member  → creator        team.sync    {team, v}                  «send it again if mine is old»
//   creator → admin → joiner team.no      {team, reason, member?}    the join could not be done
//   teammate → teammate      team.profile {name, bots, status}       who they are, to non-contacts
//   teammate → teammate      team.presence {state, sent}             live only, to non-contacts
//   teammate → teammate      team.dm      {team, profile}            «let us talk directly»
//
// Nobody is put in a team: a roster for a team you never asked to join (with a code) is
// ignored. Teammates are «known» people, like the members of a group: they write in rooms you
// share and you see their name, bots, presence and status, but they have no direct line until
// one of you opens it (team.dm), which needs no code: the address and box key come from the
// roster the creator signed.
// Every team has a room of everyone, «general»: a group owned by the creator whose members are
// the team's, with `teamId` and `general: true` in its roster. An older Colmena sees a group.
import { randomUUID } from "node:crypto";
import { now } from "../store.mjs";
import { isAddress, isTeamId, signTeamRoster, TEAM_MAX_MEMBERS, verifyTeamRoster } from "./protocol.mjs";
import { statusNow } from "../notifications.mjs";
import { botsOf, cleanBot, dmId, PeerError, PEER_LIMITS, statusOf } from "./service.mjs";

export const TEAM_LIMITS = Object.freeze({
  // «general» holds everyone and a conversation holds 32 (an older Colmena cuts a longer list,
  // and could cut itself out); every message is sealed once per member.
  members: TEAM_MAX_MEMBERS,
  // Presence and profile go to every teammate of every team: 8 × 31 people at most.
  teams: 8,
  // Open codes per team in one Colmena (they also count towards the 20 of «Personas»).
  invites: 10,
  name: 60, gone: 64, waiting: 20, syncEvery: 24 * 3600000,
});
export const GENERAL = "general";
const ROLE = { owner: "creador", admin: "admin", member: "miembro" };
const RANK = { creador: 0, admin: 1, miembro: 2 };
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const full = () => Object.assign(new PeerError("El equipo está completo: como mucho " + TEAM_LIMITS.members + " personas.", 409), { reason: "full" });

/** `[{id, name, people, bots, admin, current}]` for /api/teams and /api/state; alone, one «solo» entry. */
export function teamsList(store, peers = null) {
  const teams = peers?.identity && peers.teams ? peers.teams.list() : [];
  return teams.length ? teams : [soloEntry(store, peers)];
}
function soloEntry(store, peers) {
  const settings = store.get("settings", "main") || {};
  return { id: "solo", name: settings.spaceName || peers?.myName?.() || "Solo tú", people: 1, bots: store.list("bots").filter((b) => b.enabled !== false).length, admin: true, current: true };
}
/** Teams you asked to join and are not in yet, for /api/state. */
export const teamsPending = (peers = null) => (peers?.identity && peers.teams ? peers.teams.pending() : []);
/** The «solo» entry as a team of one (also before «Personas» has its keys). */
export function soloView(store, peers = null) {
  const settings = store.get("settings", "main") || {};
  const you = {
    address: peers?.address || null, name: peers?.myName?.() || settings.userName || "Tú", role: ROLE.owner, presence: "online", status: statusNow(settings),
    bots: store.list("bots").filter((b) => b.enabled !== false).slice(0, 24).map(cleanBot).filter(Boolean), you: true, contact: false, dm: null,
  };
  return { ...soloEntry(store, peers), state: "solo", role: ROLE.owner, general: null, members: [you], invitations: [], waiting: [] };
}

export class Teams {
  constructor({ peers, store = peers.store }) {
    this.peers = peers;
    this.store = store;
  }
  start() {
    const safely = (fn) => (event) => { try { fn(event); } catch (error) { this.peers.log?.("Equipos: " + error.message); } };
    this.handlers = {
      team: safely(({ from, body }) => this.receive(from, body)),
      joined: safely((event) => this.onJoined(event)),
      "presence-out": safely((event) => this.presenceOut(event)),
      "profile-out": safely(() => this.profileOut()),
      live: safely((event) => { if (event?.type === "relay" && event.status === "online") this.resync(); }),
    };
    for (const [name, fn] of Object.entries(this.handlers)) this.peers.on(name, fn);
    this.peers.teams = this;
    return this;
  }
  stop() {
    for (const [name, fn] of Object.entries(this.handlers || {})) this.peers.off(name, fn);
    if (this.peers.teams === this) this.peers.teams = null;
  }

  // ---------------------------------------------------------------- records
  get me() { return this.peers.address; }
  clock() { return this.peers.clock(); }
  membership(id) { return typeof id === "string" ? this.store.get("teamMemberships", id) : null; }
  record(id) { return this.store.get("teams", id); }
  /** The teams you are in now, oldest first. */
  active() {
    return this.store.list("teamMemberships").filter((m) => m.state === "active").sort((a, b) => String(a.joinedAt).localeCompare(String(b.joinedAt)))
      .map((m) => this.record(m.id)).filter(Boolean);
  }
  /** Teams you are in or waiting to get into (what the limit counts). */
  count() { return this.store.list("teamMemberships").filter((m) => ["active", "joining"].includes(m.state)).length; }
  must(id) {
    const t = this.membership(id)?.state === "active" ? this.record(id) : null;
    if (!t) throw new PeerError("No existe ese equipo.", 404);
    return t;
  }
  /** A team you created and still run. */
  owned(id) {
    const t = this.membership(id)?.state === "active" ? this.record(id) : null;
    return t && t.owner === this.me ? t : null;
  }
  roleOf(t, address) { return t?.members?.find((m) => m.id === address)?.role || null; }
  admin(t, address = this.me) { return ["owner", "admin"].includes(this.roleOf(t, address)); }
  needAdmin(t) { if (!this.admin(t)) throw new PeerError("Solo quien administra el equipo puede hacer esto.", 403); }
  /** Whether `address` is with you in a team now (in `teamId`, or in any). */
  teammate(address, teamId = null) {
    return (teamId ? [this.membership(teamId)?.state === "active" ? this.record(teamId) : null] : this.active())
      .some((t) => t && t.members.some((m) => m.id === address) && t.members.some((m) => m.id === this.me));
  }
  /** Everyone you share a team with. */
  teammates() {
    const out = new Set();
    for (const t of this.active()) for (const m of t.members) if (m.id !== this.me) out.add(m.id);
    return out;
  }
  current() {
    const id = this.store.get("settings", "main")?.currentTeam;
    const teams = this.active();
    return teams.some((t) => t.id === id) ? id : teams[0]?.id || "solo";
  }
  /** The roster as its creator signs it (only the creator's Colmena can). */
  roster(t, changes = null) {
    return signTeamRoster(this.peers.identity, {
      kind: "team", id: t.id, name: t.name, owner: t.owner, version: t.version, room: t.room, at: t.at,
      members: t.members.map((m) => ({ id: m.id, role: m.role, box: m.box, name: m.id === this.me ? this.peers.myName() : this.peers.contact(m.id)?.name || m.name })),
      ...(changes || {}),
    });
  }
  /**
   * Someone of a team as a «known» person: they can write in rooms you share, not to you
   * alone. Someone you stopped talking to is known again (you share a room), but the direct
   * line stays closed until a new invitation.
   */
  know(person, teamId) {
    if (person.id === this.me || !isAddress(person.id) || !isAddress(person.box)) return;
    const c = this.peers.contact(person.id);
    if (!c) this.store.put("peerContacts", { id: person.id, box: person.box, name: clip(person.name, PEER_LIMITS.name) || "Alguien", status: "known", via: "team:" + teamId, addedAt: now() });
    else if (c.status === "removed") this.store.patch("peerContacts", c.id, { status: "known", noDm: true, box: person.box, via: "team:" + teamId });
    else if (c.status === "known" && c.box !== person.box) this.store.patch("peerContacts", c.id, { box: person.box });
  }
  /**
   * One of you took the other out of their people while you share a team: the direct line
   * closes, but a teammate is still heard in the team's rooms (and its creator's rosters still
   * arrive). Only a new invitation opens the direct line again.
   */
  keep(address) {
    const c = this.peers.contact(address);
    if (c?.status === "removed" && this.teammate(address)) this.store.patch("peerContacts", address, { status: "known", noDm: true });
  }
  notice(t, title, text) {
    try {
      this.peers.notifier?.notify({ kind: "team", title, text, url: "/equipo", extra: { team: t.id } });
    } catch (error) {
      this.peers.log?.("No se pudo avisar: " + error.message);
    }
  }

  // ---------------------------------------------------------------- views
  bots(t) { return t.members.reduce((n, m) => n + (m.id === this.me ? this.peers.myBots().length : (this.peers.contact(m.id)?.bots || []).length), 0); }
  list() {
    const current = this.current();
    return this.active().map((t) => ({ id: t.id, name: t.name, people: t.members.length, bots: this.bots(t), admin: this.admin(t), current: t.id === current }));
  }
  /** Teams you asked to join and are not in yet (waiting, or refused). */
  pending() {
    return this.store.list("teamMemberships").filter((m) => ["joining", "refused"].includes(m.state))
      // `from`: the name of whoever gave you the code, as this Colmena knows them.
      .map((m) => ({ id: m.id, name: m.name || "Equipo", state: m.state, reason: m.reason || null, since: m.askedAt || null, from: (m.via && this.peers.contact(m.via)?.name) || null }));
  }
  memberView(m) {
    if (m.id === this.me) return { address: m.id, name: this.peers.myName(), role: ROLE[m.role], presence: "online", status: this.peers.myStatus(), bots: this.peers.myBots(), you: true, contact: false, dm: null };
    const c = this.peers.contact(m.id);
    const direct = c?.status === "active";
    return {
      address: m.id, name: c?.name || m.name || "Alguien", role: ROLE[m.role], presence: this.peers.online(m.id) ? "online" : "offline",
      status: this.peers.awayOf(c) || { mode: "available", until: null }, bots: c?.bots || [], you: false,
      // A teammate is not a contact until one of you opens a direct conversation.
      contact: direct, dm: direct ? dmId(this.me, m.id) : null,
    };
  }
  view(id) {
    if (id === "solo") return soloView(this.store, this.peers);
    const ms = this.membership(id);
    if (!ms) throw new PeerError("No existe ese equipo.", 404);
    const t = this.record(id);
    if (ms.state !== "active" || !t) return { id, name: t?.name || ms.name || "Equipo", state: ms.state, reason: ms.reason || null, people: 0, bots: 0, admin: false, current: false, role: null, general: null, members: [], invitations: [], waiting: [] };
    const members = t.members.map((m) => this.memberView(m)).sort((a, b) => RANK[a.role] - RANK[b.role] || a.name.localeCompare(b.name, "es"));
    const admin = this.admin(t);
    return {
      id: t.id, name: t.name, state: "active", people: t.members.length, bots: this.bots(t), admin, current: this.current() === t.id, role: ROLE[this.roleOf(t, this.me)],
      general: t.room, members,
      // Codes made in this Colmena that nobody has used yet (each admin sees their own).
      invitations: admin ? this.openInvites(t.id).map((i) => ({ id: i.id, name: i.name, createdAt: i.createdAt, expiresAt: i.expiresAt })) : [],
      // Changes you asked for that the creator's Colmena has not signed yet.
      waiting: ms.waiting || [],
    };
  }
  openInvites(teamId) {
    return this.store.list("peerInvites").filter((i) => i.team === teamId && i.status === "open" && Date.parse(i.expiresAt) > this.clock());
  }
  setCurrent(id) {
    if (id !== "solo") this.must(id);
    else if (this.active().length) throw new PeerError("Elige uno de tus equipos.", 400);
    this.store.patch("settings", "main", { currentTeam: id === "solo" ? null : id });
    return teamsList(this.store, this.peers);
  }

  // ---------------------------------------------------------------- the creator's side
  create(name) {
    this.peers.requireRelay();
    const title = clip(name, TEAM_LIMITS.name);
    if (!title) throw new PeerError("Ponle un nombre al equipo.");
    if (this.count() >= TEAM_LIMITS.teams) throw new PeerError("Como mucho " + TEAM_LIMITS.teams + " equipos. Sal de alguno antes.", 409);
    const id = randomUUID(), room = randomUUID(), at = now();
    this.store.tx(() => {
      this.store.put("teams", { id, name: title, owner: this.me, version: 1, room, at, createdAt: at, gone: [], members: [{ id: this.me, role: "owner", box: this.peers.identity.box.pub, name: this.peers.myName() }] });
      this.store.put("teamMemberships", { id, state: "active", owner: this.me, joinedAt: at, version: 1 });
      // The room of everyone: a group that follows the team (the rooms task adopts it by `teamId`).
      this.store.put("peerShares", { id: room, kind: "group", title: GENERAL, owner: this.me, version: 1, createdAt: at, lastAt: at, unread: 0, teamId: id, general: true, members: [{ id: this.me, role: "owner" }] });
      this.store.patch("settings", "main", { currentTeam: id });
    });
    return this.view(id);
  }
  /** A new version of a team of yours: stored, signed and sent to everyone in it (and to `extra`). */
  commit(t, changes, extra = []) {
    const next = this.store.tx(() => {
      this.store.patch("teamMemberships", t.id, { version: t.version + 1 });
      return this.store.patch("teams", t.id, { ...changes, version: t.version + 1, at: now() });
    });
    const roster = this.roster(next);
    for (const id of new Set([...next.members.map((m) => m.id), ...extra])) if (id !== this.me) this.peers.enqueue(id, { type: "team.roster", roster });
    this.syncGeneral(next, extra);
    void this.peers.flushOutbox();
    this.after(t, next);
    return next;
  }
  /** «general» has exactly the team's people; whoever went out is told too. */
  syncGeneral(t, extra = []) {
    const s = this.store.get("peerShares", t.room);
    if (!s || s.owner !== this.me) return;
    const members = t.members.map((m) => ({ id: m.id, role: m.id === t.owner ? "owner" : "member" }));
    if (members.length === s.members.length && members.every((m) => s.members.some((x) => x.id === m.id))) return;
    this.peers.sendRoster(this.store.patch("peerShares", s.id, { members, version: s.version + 1 }), extra);
  }
  addMember(t, person) {
    if (!isAddress(person?.id) || !isAddress(person.box) || person.id === this.me) throw new PeerError("Esa persona no es válida.");
    if (t.members.some((m) => m.id === person.id)) return t;
    if (t.members.length >= TEAM_LIMITS.members) throw full();
    // A key we already hold for them counts more than the one an admin tells us: an admin's
    // word brings a new person in, it never changes what we know of someone.
    const had = this.peers.contact(person.id);
    const box = had?.box || person.box;
    if (!had || had.status === "removed") this.know({ ...person, box }, t.id);
    const c = this.peers.contact(person.id);
    return this.commit(t, { members: [...t.members, { id: person.id, role: "member", box, name: clip(c?.name || person.name, PEER_LIMITS.name) || "Alguien" }], gone: (t.gone || []).filter((x) => x !== person.id) });
  }
  dropMember(t, address) {
    if (address === t.owner) throw new PeerError("A quien creó el equipo no se le puede quitar.", 409);
    if (!t.members.some((m) => m.id === address)) throw new PeerError("Esa persona no está en el equipo.", 404);
    // `gone`: who may still ask for the roster that shows they are out.
    return this.commit(t, { members: t.members.filter((m) => m.id !== address), gone: [...(t.gone || []).filter((x) => x !== address), address].slice(-TEAM_LIMITS.gone) }, [address]);
  }
  renameTeam(t, name) {
    const title = clip(name, TEAM_LIMITS.name);
    if (!title) throw new PeerError("Ponle un nombre al equipo.");
    return title === t.name ? t : this.commit(t, { name: title });
  }
  adminSet(t, address, on) {
    const m = t.members.find((x) => x.id === address);
    if (!m) throw new PeerError("Esa persona no está en el equipo.", 404);
    if (m.role === "owner") throw new PeerError("Quien creó el equipo siempre lo administra.", 409);
    const role = on ? "admin" : "member";
    return m.role === role ? t : this.commit(t, { members: t.members.map((x) => (x.id === address ? { ...x, role } : x)) });
  }
  /** An admin's request (or anyone's «I leave»): checked against the roster as it is now. */
  onRequest(from, body) {
    const t = this.owned(body.team);
    if (!t) return;
    const again = () => { this.peers.enqueue(from.id, { type: "team.roster", roster: this.roster(this.record(t.id)) }); void this.peers.flushOutbox(); };
    const role = this.roleOf(t, from.id);
    // Someone who is no longer in it only learns that they are out.
    if (!role) return void ((t.gone || []).includes(from.id) && again());
    if (body.op === "leave") return void this.dropMember(t, from.id);
    // Not an admin (any more): nothing changes, and they get the roster that says so.
    if (role !== "admin") return again();
    try {
      if (body.op === "add") this.addMember(t, { id: body.member?.id, box: body.member?.box, name: body.member?.name });
      else if (body.op === "remove") this.dropMember(t, String(body.member || ""));
      else if (body.op === "rename") this.renameTeam(t, body.name);
      else if (body.op === "admin") this.adminSet(t, String(body.member || ""), body.on === true);
      else again();
    } catch (error) {
      if (!(error instanceof PeerError)) throw error;
      again();
      // Whoever was waiting to get in is told by the admin who invited them.
      if (body.op === "add" && isAddress(body.member?.id)) this.peers.enqueue(from.id, { type: "team.no", team: t.id, member: body.member.id, reason: error.reason || "refused" });
    }
  }
  onSync(from, body) {
    const t = this.owned(body.team);
    if (!t) return;
    const member = !!this.roleOf(t, from.id);
    if (!member && !(t.gone || []).includes(from.id)) return;
    if (member && Number(body.v) >= t.version) return;
    this.peers.enqueue(from.id, { type: "team.roster", roster: this.roster(t) });
    void this.peers.flushOutbox();
  }
  /** An older Colmena left «general» (it sees a group): that is leaving the team. */
  leftGeneral(share, address) {
    const t = this.owned(share.teamId);
    if (t && t.room === share.id && address !== this.me && this.roleOf(t, address)) this.dropMember(t, address);
  }
  /** Someone used a code of yours for a team: in, if you created it; asked to its creator, if you administer it. */
  onJoined({ invite, from }) {
    const t = this.membership(invite.team)?.state === "active" ? this.record(invite.team) : null;
    const c = this.peers.contact(from);
    if (!c?.box) return;
    const no = (reason) => { this.peers.enqueue(from, { type: "team.no", team: invite.team, reason }); void this.peers.flushOutbox(); };
    if (!t || !this.admin(t)) return no("refused");
    const person = { id: from, box: c.box, name: c.name };
    if (t.owner !== this.me) return this.request(t, { op: "add", member: person });
    try {
      this.addMember(t, person);
    } catch (error) {
      if (!(error instanceof PeerError)) throw error;
      no(error.reason || "refused");
    }
  }

  // ---------------------------------------------------------------- what you do
  /** Sends the creator a change you may ask for; it shows as «waiting» until a new roster comes. */
  request(t, body) {
    if (!this.peers.enqueue(t.owner, { type: "team.req", team: t.id, ...body })) throw new PeerError("No se pudo avisar a quien creó el equipo.", 409);
    const target = typeof body.member === "string" ? body.member : body.member?.id || null;
    this.store.patch("teamMemberships", t.id, (ms) => ({ waiting: [...(ms.waiting || []), { op: body.op, ...(target ? { address: target } : {}), ...(body.op === "admin" ? { on: body.on === true } : {}), at: now() }].slice(-TEAM_LIMITS.waiting) }));
    void this.peers.flushOutbox();
  }
  rename(id, name) {
    const t = this.must(id);
    this.needAdmin(t);
    const title = clip(name, TEAM_LIMITS.name);
    if (!title) throw new PeerError("Ponle un nombre al equipo.");
    if (t.owner === this.me) this.renameTeam(t, title);
    else if (title !== t.name) this.request(t, { op: "rename", name: title });
    return this.view(id);
  }
  remove(id, address) {
    const t = this.must(id);
    this.needAdmin(t);
    if (address === this.me) throw new PeerError("Para irte tú, sal del equipo.", 409);
    if (address === t.owner) throw new PeerError("A quien creó el equipo no se le puede quitar.", 409);
    if (!this.roleOf(t, address)) throw new PeerError("Esa persona no está en el equipo.", 404);
    if (t.owner === this.me) this.dropMember(t, address);
    else this.request(t, { op: "remove", member: address });
    return this.view(id);
  }
  setAdmin(id, address, on) {
    const t = this.must(id);
    this.needAdmin(t);
    const role = this.roleOf(t, address);
    if (!role) throw new PeerError("Esa persona no está en el equipo.", 404);
    if (role === "owner") throw new PeerError("Quien creó el equipo siempre lo administra.", 409);
    if (t.owner === this.me) this.adminSet(t, address, on);
    else if ((role === "admin") !== !!on) this.request(t, { op: "admin", member: address, on: !!on });
    return this.view(id);
  }
  /** A code for one person, good for 24 hours: whoever uses it joins the team. */
  async invite(id, name = "") {
    const t = this.must(id);
    this.needAdmin(t);
    const open = this.openInvites(t.id);
    if (open.length >= TEAM_LIMITS.invites) throw new PeerError("Hay demasiadas invitaciones sin usar en este equipo. Cancela alguna.", 409);
    if (t.members.length + open.length >= TEAM_LIMITS.members) throw full();
    const owner = t.members.find((m) => m.role === "owner");
    // The card names the creator and their key: the joiner will only take rosters signed by them.
    return this.peers.createInvite(clip(name, PEER_LIMITS.name) || "Alguien", { team: { id: t.id, name: t.name, owner: t.owner, ownerBox: owner.box, ownerName: owner.id === this.me ? this.peers.myName() : this.peers.contact(owner.id)?.name || owner.name } });
  }
  /**
   * You accept a code for a team (Peers.acceptInvite calls this before saying hello): the team
   * is noted as «joining», tied to the creator the card names. It becomes yours when a roster
   * signed by that creator arrives with you in it; the hello waits in the outbox meanwhile.
   */
  joining(card) {
    const team = card.team;
    if (!team || typeof team !== "object" || !isTeamId(team.id) || !isAddress(team.owner) || !isAddress(team.ownerBox) || team.owner === this.me) throw new PeerError("La invitación al equipo está dañada. Pide otra.");
    const ms = this.membership(team.id);
    if (ms?.state === "active") throw new PeerError("Ya estás en ese equipo.", 409);
    // A team we knew under another creator is not this one.
    if (ms && ms.owner !== team.owner) throw new PeerError("La invitación al equipo está dañada. Pide otra.");
    if (ms?.state !== "joining" && this.count() >= TEAM_LIMITS.teams) throw new PeerError("Como mucho " + TEAM_LIMITS.teams + " equipos. Sal de alguno antes.", 409);
    if (team.owner !== card.addr) this.know({ id: team.owner, box: team.ownerBox, name: team.ownerName }, team.id);
    this.store.put("teamMemberships", { ...(ms || {}), id: team.id, state: "joining", owner: team.owner, via: card.addr, name: clip(team.name, TEAM_LIMITS.name) || "Equipo", askedAt: now(), syncAt: this.clock(), reason: null, version: ms?.version || 0 });
    return team.id;
  }
  async join(code) {
    const preview = await this.peers.previewInvite(code);
    if (!preview.team) throw new PeerError("Ese código es para hablar con una persona, no para entrar en un equipo.");
    const out = await this.peers.acceptInvite(code);
    return { id: out.team, name: preview.team, state: "joining", from: preview.name };
  }
  /** You go: the creator signs the roster without you. If you created it, it closes for everyone. */
  leave(id) {
    const ms = this.membership(id);
    if (!ms) throw new PeerError("No existe ese equipo.", 404);
    if (ms.state !== "active") {
      // Giving up a join, or clearing one that was refused. What is left only remembers the
      // last version seen, so an old roster cannot bring the team back.
      if (["joining", "refused"].includes(ms.state)) ms.version ? this.store.patch("teamMemberships", id, { state: "left", endedAt: now() }) : this.store.remove("teamMemberships", id);
      return { ok: true };
    }
    const t = this.record(id);
    const share = this.store.get("peerShares", t.room);
    if (t.owner === this.me) {
      const closed = this.store.patch("teams", id, { version: t.version + 1, at: now(), closed: true });
      const roster = this.roster(closed, { members: [], closed: true });
      for (const m of t.members) if (m.id !== this.me) this.peers.enqueue(m.id, { type: "team.roster", roster });
      this.store.patch("teamMemberships", id, { state: "closed", version: closed.version, endedAt: now() });
    } else {
      this.peers.enqueue(t.owner, { type: "team.req", team: id, op: "leave" });
      this.store.patch("teamMemberships", id, { state: "left", endedAt: now(), waiting: [] });
    }
    if (share && !share.leftAt && !share.removedAt) this.peers.leave(share.id, { team: true });
    void this.peers.flushOutbox();
    return { ok: true };
  }
  /**
   * A direct conversation with a teammate, without a code: their address and box key are the
   * ones in the roster the creator signed. They become a contact here («pending») and get
   * team.dm; their Colmena checks we are in that team with them and answers «welcome».
   */
  openDm(id, address) {
    const t = this.must(id);
    const m = t.members.find((x) => x.id === address);
    if (!m || address === this.me) throw new PeerError("Esa persona no está en el equipo.", 404);
    const c = this.peers.contact(address);
    if (c?.status !== "active") {
      if (c?.noDm) throw new PeerError("Dejasteis de hablar a solas. Para volver, mándale una invitación.", 409);
      this.store.put("peerContacts", { ...(c || { addedAt: now() }), id: address, box: c?.box || m.box, name: c?.name || clip(m.name, PEER_LIMITS.name) || "Alguien", status: "pending", via: "team:" + t.id });
      this.peers.enqueue(address, { type: "team.dm", team: t.id, profile: this.peers.myProfile() });
      void this.peers.flushOutbox();
    }
    return { contact: this.peers.contactView(this.peers.contact(address)), share: this.peers.shareView(this.peers.ensureDm(address)) };
  }

  // ---------------------------------------------------------------- receiving
  receive(from, body) {
    switch (body.type) {
      case "team.roster": return this.onRoster(from, body.roster);
      case "team.req": return this.onRequest(from, body);
      case "team.sync": return this.onSync(from, body);
      case "team.no": return this.onRefused(from, body);
      case "team.profile": return this.onProfile(from, body);
      case "team.presence": return this.onPresence(from, body);
      case "team.dm": return this.onDm(from, body);
      default: // a newer Colmena's message: ignored
    }
  }
  /**
   * A roster from a team's creator. Taken only if: the creator's key signed it, the creator
   * sent it, it is a team we asked to join under that creator, and it is newer than anything
   * we saw of that team (also after leaving it).
   */
  onRoster(from, raw) {
    const r = verifyTeamRoster(raw);
    if (!r || r.owner !== from.id || r.owner === this.me) return;
    const ms = this.membership(r.id);
    const mine = r.closed ? null : r.members.find((m) => m.id === this.me);
    // Never asked to join (or gave it up): not ours, and its creator is told to take us out.
    if (!ms) return void (mine && this.decline(r));
    if (ms.owner !== r.owner) return;
    const cur = this.record(r.id);
    if (r.version <= Math.max(cur?.version || 0, ms.version || 0)) return;
    if (!mine) {
      // Out (removed, or the team was closed). An older roster with us in it can never undo this.
      const was = ms.state === "active";
      this.store.patch("teamMemberships", r.id, { version: r.version, waiting: [], ...(was ? { state: r.closed ? "closed" : "removed", endedAt: now() } : {}) });
      if (cur) this.store.patch("teams", r.id, { version: r.version, ...(r.closed ? { closed: true } : {}) });
      if (!was) return;
      const share = cur && this.store.get("peerShares", cur.room);
      if (share && !share.removedAt) this.store.patch("peerShares", share.id, { removedAt: now() });
      const name = cur?.name || ms.name || "el equipo";
      if (r.closed) this.notice(r, "«" + name + "» se ha cerrado", "Quien lo creó lo ha cerrado. Lo que os escribisteis se queda en tu Colmena.");
      else this.notice(r, "Ya no estás en «" + name + "»", "Te han quitado del equipo. Lo que os escribisteis se queda en tu Colmena.");
      return;
    }
    if (mine.box !== this.peers.identity.box.pub) return;
    // In it, but we left or were taken out: only a new code brings us back.
    if (!["joining", "active"].includes(ms.state)) {
      this.store.patch("teamMemberships", r.id, { version: r.version });
      return this.decline(r);
    }
    const { gone: _gone, closed: _closed, ...kept } = cur || { createdAt: now() };
    const next = this.store.tx(() => {
      this.store.patch("teamMemberships", r.id, { state: "active", version: r.version, waiting: [], reason: null, ...(ms.state === "joining" ? { joinedAt: now(), syncAt: this.clock() } : {}) });
      return this.store.put("teams", {
        ...kept, id: r.id, name: clip(r.name, TEAM_LIMITS.name) || "Equipo", owner: r.owner, version: r.version, room: r.room, at: typeof r.at === "string" ? r.at.slice(0, 40) : now(),
        members: r.members.map((m) => ({ id: m.id, role: m.role, box: m.box, name: clip(m.name, PEER_LIMITS.name) || "Alguien" })),
      });
    });
    for (const m of next.members) this.know(m, next.id);
    this.adoptGeneral(next);
    this.after(cur, next, ms.state === "joining");
  }
  /** A roster has us in a team we are not in: nobody is put in a team, so its creator takes us out. */
  decline(r) {
    if (this.peers.enqueue(r.owner, { type: "team.req", team: r.id, op: "leave" })) void this.peers.flushOutbox();
  }
  /** What a new roster means for you: who joined, whether you now administer, and saying hello. */
  after(prev, next, joined = false) {
    const before = new Set((prev?.members || []).map((m) => m.id));
    const fresh = next.members.filter((m) => m.id !== this.me && !before.has(m.id));
    if (!joined) {
      const names = fresh.map((m) => this.peers.contact(m.id)?.name || m.name || "Alguien");
      if (names.length === 1) this.notice(next, names[0] + " se ha unido a «" + next.name + "»", "Ya está en «" + GENERAL + "».");
      else if (names.length > 1) this.notice(next, names.length + " personas se han unido a «" + next.name + "»", names.slice(0, 4).join(", ") + (names.length > 4 ? "…" : "") + ".");
      if (this.roleOf(prev, this.me) === "member" && this.roleOf(next, this.me) === "admin") this.notice(next, "Ahora administras «" + next.name + "»", "Puedes invitar y quitar personas, cambiar el nombre y nombrar a otros administradores.");
    }
    this.greet((joined ? next.members.filter((m) => m.id !== this.me) : fresh).map((m) => m.id));
  }
  /** The team's room of everyone, once the team says which it is (its roster may come first). */
  adoptGeneral(t) {
    const s = this.store.get("peerShares", t.room);
    if (!s || s.owner !== t.owner || s.kind !== "group") return;
    if (s.general && s.teamId === t.id && !s.removedAt && !s.leftAt) return;
    // Back in the team with a new code: the room opens again.
    this.store.patch("peerShares", s.id, { teamId: t.id, general: true, removedAt: null, leftAt: null });
  }
  /**
   * `teamId` and `general` of a group's roster (already verified as its owner's), kept only
   * if that team is yours and says the same: a room of a team belongs to one of its members,
   * and «general» is the one room the team's roster names, owned by its creator.
   */
  tieOf(roster) {
    const t = typeof roster.teamId === "string" && this.membership(roster.teamId)?.state === "active" ? this.record(roster.teamId) : null;
    if (!t || !t.members.some((m) => m.id === roster.owner)) return {};
    return { teamId: t.id, ...(roster.general === true && roster.owner === t.owner && roster.id === t.room ? { general: true } : {}) };
  }
  onRefused(from, body) {
    const ms = this.membership(body.team);
    if (ms?.state === "joining" && [ms.owner, ms.via].includes(from.id)) {
      this.store.patch("teamMemberships", ms.id, { state: "refused", reason: body.reason === "full" ? "full" : "refused", endedAt: now() });
      return;
    }
    // The creator could not add someone you invited: you pass it on (they know you, not them).
    const t = ms?.state === "active" ? this.record(ms.id) : null;
    if (t && t.owner === from.id && this.admin(t) && isAddress(body.member) && body.member !== this.me) {
      this.peers.enqueue(body.member, { type: "team.no", team: t.id, reason: body.reason === "full" ? "full" : "refused" });
      void this.peers.flushOutbox();
    }
  }

  // ---------------------------------------------------------------- teammates who are not contacts
  profile() { return { type: "team.profile", name: this.peers.myName(), bots: this.peers.myBots(), status: this.peers.myStatus() }; }
  /**
   * Your name, bots and status to new teammates you do not talk to directly (contacts get
   * «profile»). Both sides say hello when a roster brings them together, and one of the two
   * rosters may still be on its way: a hello that finds no teammate is dropped. So a hello
   * says whether we already have theirs (`got`), and whoever gets one without it answers.
   */
  greet(ids) {
    for (const id of ids) {
      const c = this.peers.contact(id);
      if (c && c.status !== "active") this.peers.enqueue(id, { ...this.profile(), hi: true, got: !!c.profileAt });
    }
    if (ids.length) void this.peers.flushOutbox();
  }
  /** Your name, bots or status changed: teammates who are not contacts learn it too. */
  profileOut() {
    for (const id of this.teammates()) if (this.peers.contact(id)?.status !== "active") this.peers.enqueue(id, this.profile());
  }
  /**
   * What a teammate says of themselves. It is stored under whoever signed the envelope: there
   * is no field to say whose bots they are, so nobody can announce someone else's.
   */
  onProfile(from, body) {
    if (!this.teammate(from.id)) return;
    this.store.patch("peerContacts", from.id, { profileAt: now(), ...(clip(body.name, PEER_LIMITS.name) ? { name: clip(body.name, PEER_LIMITS.name) } : {}), ...(Array.isArray(body.bots) ? { bots: botsOf(body) } : {}), ...("status" in body ? { away: statusOf(body) } : {}) });
    if (body.hi === true && body.got !== true) {
      this.peers.enqueue(from.id, this.profile());
      void this.peers.flushOutbox();
    }
    // Someone we do not see connected: they learn we are here (and answer if they are).
    if (this.peers.client?.status === "online" && !this.peers.online(from.id) && this.clock() - (this.peers.lastPresenceTo.get(from.id) || 0) > 60000) this.presenceTo(from.id, "online");
  }
  presenceTo(id, state) {
    this.peers.lastPresenceTo.set(id, this.clock());
    this.peers.ephemeral(id, { type: "team.presence", state, sent: this.clock() }, { always: true });
  }
  /** Follows your presence to contacts: «online» to every teammate on connecting, then only to who is there. */
  presenceOut({ state, everyone }) {
    for (const id of this.teammates()) {
      if (this.peers.contact(id)?.status === "active" || (!everyone && !this.peers.online(id))) continue;
      this.presenceTo(id, state);
    }
  }
  onPresence(from, body) {
    if (!this.teammate(from.id)) return;
    const p = this.peers;
    const was = p.online(from.id);
    const sent = Number.isSafeInteger(body.sent) ? body.sent : 0;
    if (sent && sent < (p.presence.get(from.id)?.sent || 0)) return;
    p.presence.set(from.id, { state: body.state === "online" ? "online" : "away", at: this.clock(), sent });
    p.emit("live", { type: "presence", id: from.id, online: p.online(from.id) });
    if (was !== p.online(from.id)) p.changed();
    // They just came: we are here too (once a minute at most, as between contacts).
    const since = this.clock() - (p.lastPresenceTo.get(from.id) || 0);
    if (body.state === "online" && (!was || since > 60000)) this.presenceTo(from.id, "online");
  }
  /** A teammate opens a direct conversation: accepted because the roster vouches for them. */
  onDm(from, body) {
    if (typeof body.team !== "string" || !this.teammate(from.id, body.team)) return;
    const c = this.peers.contact(from.id);
    if (!c?.box || (c.status !== "active" && c.noDm)) return;
    if (c.status !== "active") this.store.patch("peerContacts", c.id, { status: "active", via: c.via || "team:" + body.team, ...(body.profile && typeof body.profile === "object" ? { bots: botsOf(body.profile), away: statusOf(body.profile) } : {}) });
    this.peers.ensureDm(from.id);
    this.peers.enqueue(from.id, { type: "welcome", profile: this.peers.myProfile() });
    void this.peers.flushOutbox().then(() => this.peers.sayOnline(from.id));
  }
  /** Once a day and team, on connecting: ask the creator for the roster if ours is old. */
  resync() {
    for (const ms of this.store.list("teamMemberships")) {
      if (!["active", "joining"].includes(ms.state) || ms.owner === this.me || this.clock() - (ms.syncAt || 0) < TEAM_LIMITS.syncEvery) continue;
      if (this.peers.enqueue(ms.owner, { type: "team.sync", team: ms.id, v: ms.version || 0 })) this.store.patch("teamMemberships", ms.id, { syncAt: this.clock() });
    }
    void this.peers.flushOutbox();
  }
}
