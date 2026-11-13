// The sidebar's model («con quién hablas», docs/PLAN-equipo-y-salas.md): the team header, the
// three groups (Salas, Bots, Personas), what waits for you and the one-line summary at the foot.
// Pure: no React, no network. It reads the same /api/state snapshot every screen has (kept live
// by /api/events), so a new message, a bot that starts or stops and a presence change reach the
// sidebar without polling. It is the shape `GET /api/sidebar?team=` would answer:
//   { rooms: [{id, href, title, unread, waiting}], bots: [{id, name, role, shape, color, state}],
//     people: [{id, href, name, presence, status, unread, waiting}], waitingCount }
import { waitingBy, waitingOf } from "../components/v2/needs.js";
import { listRows } from "./threads.js";
import { isBotChat, isSala, roomLinks } from "./rooms.js";
import { botShape } from "./identity.js";

/** Rooms shown before the quiet ones fold behind «Ver todas». */
export const ROOMS_SHOWN = 8;
/** A bot's state in words. */
export const STATE_WORD = { working: "trabajando", waiting: "te espera", free: "libre", paused: "en pausa", stuck: "atascado", limited: "en su límite" };
export const STATUS_WORD = { dnd: "No molestar", away: "Fuera" };

const time = (v) => Date.parse(v || 0) || 0;
const byName = (a, b) => String(a).localeCompare(String(b), "es", { sensitivity: "base", numeric: true });
const initialsOf = (name) => String(name || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";

/**
 * Circles are people. A bot whose shape is a circle (or unknown) is drawn in the sidebar as a
 * rounded square, so nobody takes it for a person.
 */
export const sidebarShape = botShape;

/**
 * What the sidebar shows, from a store snapshot. `team` narrows rooms and people to one team once
 * they carry a `teamId` (server/peers, not yet): what has none is yours and shows in every team.
 */
export function sidebarModel(store = {}, { now = Date.now(), team = null } = {}) {
  const { bots = [], missions = [], notifications = [], peers = null, paused = false } = store;
  const inTeam = (x) => !team || !x.teamId || x.teamId === team;
  const missionOf = new Map(missions.map((m) => [m.id, m]));

  // What waits for you, by room and by bot: filters of the one list (server/waiting.mjs).
  const waitingNow = waitingOf(store, now);
  const { rooms: waitingIn, bots: waitingOf_ } = waitingBy(waitingNow);
  const add = (map, key) => { if (key) map.set(key, (map.get(key) || 0) + 1); };

  // Unread: a mention or a message you have not opened, by room and by bot (its own chats).
  const unreadIn = new Map(), unreadOf = new Map();
  for (const n of notifications) {
    if (n.read || !n.missionId || (n.kind !== "mention" && n.kind !== "message")) continue;
    add(unreadIn, n.missionId);
    const m = missionOf.get(n.missionId);
    if (m && isBotChat(m)) add(unreadOf, m.botIds[0]);
  }

  const rooms = [];
  // Rooms come from the one room list of the state (server/room.mjs): a sala, a conversation
  // with people, or both under one row. A snapshot without it (an older server) is read as before.
  const listed = Array.isArray(store.rooms) ? store.rooms : null;
  for (const r of listed || []) {
    if (!inTeam(r)) continue;
    const { missionId, shareId, href, title } = roomLinks(r, missions);
    // What waits is answered in the sala (its mission) or, before the room has one, in the room.
    const waiting = [...new Set([r.id, missionId, shareId].filter(Boolean))].reduce((n, key) => n + (waitingIn.get(key) || 0), 0);
    if (!waiting && time(r.snoozedUntil) > now) continue;
    // Bots at work here, anyone's (`activity` of the room: docs/CONTRACT.md §18).
    const working = (r.activity || []).filter((a) => a.state === "working" || a.state === "thinking").length;
    rooms.push({ id: r.id, href, title, unread: r.unread || 0, waiting, at: time(r.lastAt), ...(working ? { working } : {}), ...(shareId ? { withPeople: true } : {}) });
  }
  for (const m of listed ? [] : listRows(missions)) {
    if (!isSala(m) || m.incognito || !inTeam(m)) continue;
    const waiting = waitingIn.get(m.id) || 0;
    // «Posponer» takes a room out until its time, unless it waits for you.
    if (!waiting && time(m.snoozedUntil) > now) continue;
    rooms.push({ id: m.id, href: `/sala/${m.id}`, title: m.room || m.title || "sala", unread: unreadIn.get(m.id) || 0, waiting, at: time(m.rowAt || m.updatedAt || m.createdAt) });
  }
  const people = [];
  const talking = new Set();
  for (const s of peers?.shares || []) {
    if (s.removed || s.left || !inTeam(s)) continue;
    // What another person asks of your bots and waits for your OK (an errand in state «asked»)
    // counts in its conversation, like any other thing that waits for you.
    if (s.kind !== "dm" && listed) continue;
    if (s.kind !== "dm") { rooms.push({ id: s.id, href: `/sala/${s.id}`, title: s.title || "sala", unread: s.unread || 0, waiting: waitingIn.get(s.id) || 0, at: time(s.lastAt), withPeople: true }); continue; }
    const other = (s.members || []).find((p) => !p.me) || null;
    talking.add(s.id);
    people.push(personRow({ id: other?.id || s.id, href: `/con/${s.id}`, name: s.title || other?.name, person: other, unread: s.unread || 0, waiting: waitingIn.get(s.id) || 0 }));
  }
  // People you are connected with and have not written to yet.
  for (const c of peers?.contacts || []) {
    if (c.status !== "active" || !c.dm || talking.has(c.dm) || !inTeam(c)) continue;
    people.push(personRow({ id: c.id, href: `/con/${c.dm}`, name: c.name, person: c, unread: 0 }));
  }
  rooms.sort((a, b) => byName(a.title, b.title) || byName(a.id, b.id));
  people.sort((a, b) => byName(a.name, b.name) || byName(a.id, b.id));

  const team_ = bots.filter((b) => b.enabled !== false).map((b) => {
    const waiting = waitingOf_.get(b.id) || 0;
    const state = paused || b.status === "pausado" ? "paused" : b.status === "trabaja" ? "working" : waiting ? "waiting" : b.status === "limitado" ? "limited" : b.status === "bloqueado" ? "stuck" : "free";
    return { id: b.id, href: `/chat/${b.id}`, name: b.name || "Bot", role: b.role || "", shape: sidebarShape(b.shape), color: b.color || "#C9CBD1", portrait: b.portrait ?? null, state, waiting, unread: unreadOf.get(b.id) || 0 };
  });

  const waitingCount = waitingNow.length;
  return { rooms, bots: team_, people, waitingCount, summary: summaryOf(team_, waitingCount, paused) };
}

function personRow({ id, href, name, person, unread, waiting = 0 }) {
  const status = STATUS_WORD[person?.away?.mode] ? person.away.mode : null;
  return { id, href, name: name || "Alguien", initials: person?.initials || initialsOf(name), color: person?.color || "#E9E6DA", presence: person?.online ? "online" : "offline", status, unread, waiting };
}

/** The foot's line. It counts the same rows the Bots group shows and the same number as Inicio. */
export function summaryOf(bots = [], waitingCount = 0, paused = false) {
  const working = bots.filter((b) => b.state === "working").length;
  const parts = [paused ? "Equipo en pausa" : working ? `${working} trabajando` : bots.length ? "Nadie trabajando" : "Sin bots"];
  if (waitingCount) parts.push(waitingCount === 1 ? "1 te espera" : `${waitingCount} te esperan`);
  return { working, waiting: waitingCount, text: parts.join(" · ") };
}

/** «5 cosas te esperan», for the Inicio badge. */
export const waitingLabel = (n) => (n === 1 ? "1 cosa te espera" : `${n} cosas te esperan`);

/**
 * Which rooms show: all of them up to ROOMS_SHOWN; beyond that, the ones with something new
 * (unread, waiting for you, or open now) and the most recent quiet ones up to the limit. The
 * rest fold behind «Ver todas».
 */
export function foldRooms(rooms = [], { limit = ROOMS_SHOWN, current = null, all = false } = {}) {
  if (all || rooms.length <= limit) return { shown: rooms, hidden: 0 };
  const lively = (r) => r.unread > 0 || r.waiting > 0 || r.working > 0 || r.href === current;
  const keep = new Set(rooms.filter(lively).map((r) => r.id));
  for (const r of rooms.filter((x) => !lively(x)).sort((a, b) => (b.at || 0) - (a.at || 0))) {
    if (keep.size >= limit) break;
    keep.add(r.id);
  }
  const shown = rooms.filter((r) => keep.has(r.id));
  return { shown, hidden: rooms.length - shown.length };
}

/**
 * The team header, from `GET /api/teams` → [{id, name, people, bots, admin, current}]. No teams
 * yet is «Solo tú»: your own Colmena and how many bots you have.
 */
export function teamHeader(teams = [], { bots = 0, chosen = null } = {}) {
  const count = (n, one, many) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
  const list = Array.isArray(teams) ? teams.filter((t) => t && t.id) : [];
  if (!list.length) return { solo: true, id: null, name: "Colmena", line: bots ? `Solo tú · ${count(bots, "bot", "bots")}` : "Solo tú", admin: false, others: [] };
  const team = list.find((t) => t.id === chosen) || list.find((t) => t.current) || list[0];
  return {
    solo: false, id: team.id, name: team.name || "Equipo", admin: !!team.admin,
    line: `${count(team.people || 0, "persona", "personas")} · ${count(team.bots || 0, "bot", "bots")}`,
    others: list.filter((t) => t.id !== team.id).map((t) => ({ id: t.id, name: t.name || "Equipo" })),
  };
}

/** A row's name for a screen reader: «informe-q3, sala, 3 sin leer, te espera». */
export function rowLabel(kind, row) {
  const parts = [kind === "room" ? row.title : row.name, kind === "room" ? "sala" : kind === "bot" ? "bot" : "persona"];
  if (kind === "bot") parts.push(STATE_WORD[row.state] || STATE_WORD.free);
  if (kind === "person") { parts.push(row.presence === "online" ? "en línea" : "sin conexión"); if (row.status) parts.push(STATUS_WORD[row.status]); }
  if (kind === "room" && row.working > 0) parts.push(row.working === 1 ? "un bot trabajando" : `${row.working} bots trabajando`);
  if (row.unread > 0) parts.push(`${row.unread} sin leer`);
  if (row.waiting > 0 && row.state !== "waiting") parts.push("te espera");
  return parts.join(", ");
}

/** Is this address a conversation (a room, a chat with a bot, a person)? Its path, or null. */
export function conversationPath(pathname) {
  const m = /^\/(sala|chat|con)\/([^/?#]+)/.exec(String(pathname || ""));
  return m && m[2] !== "nueva" ? `/${m[1]}/${m[2]}` : null;
}

/**
 * Where /chats goes: the last conversation you had open if it still exists, else the first
 * room, else nowhere (null: the empty state).
 */
export function chatsTarget(model, last = null) {
  const path = conversationPath(last);
  const { rooms = [], bots = [], people = [] } = model || {};
  if (path && [...rooms, ...bots, ...people].some((r) => r.href === path)) return path;
  return rooms[0]?.href || null;
}

const LAST_KEY = "colmena:last-conversation";
/** The last conversation open in this window (localStorage; absent or blocked → null). */
export function readLastConversation() {
  try { return localStorage.getItem(LAST_KEY) || null; } catch { return null; }
}
export function rememberConversation(pathname) {
  const path = conversationPath(pathname);
  if (!path) return;
  try { localStorage.setItem(LAST_KEY, path); } catch {}
}
