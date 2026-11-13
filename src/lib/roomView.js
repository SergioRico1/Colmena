// The one room screen's model (docs/PLAN-equipo-y-salas.md, scope 3 and 4): who wrote a row and
// how it is named, which rows group under one header, the quiet lines about other owners' bots,
// the member panel, who can be invited and who «@» lists. Pure: no React, no network. It reads
// the shapes of docs/CONTRACT.md §18 (`GET /api/rooms/:id`, `…/timeline`).
import { firstName, listNames } from "./identity.js";

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es", { sensitivity: "base", numeric: true });

/* ───────────── who wrote it ───────────── */

/**
 * The author of any row, in the timeline's shape: {kind: "person", address, name, you} ·
 * {kind: "bot", botId, name, role, shape, color, owner: {address, name, you}} · {kind: "system"}.
 * A timeline item brings it; a row of the sala alone (role/botId) or of a conversation with
 * people (from/author/bot) is read into the same shape. `bots`: your bots, for rows of the sala.
 */
export function authorOf(m, bots = []) {
  if (!m) return { kind: "system" };
  if (m.author?.kind) return m.author;
  // A message of «Personas»: from "me" or an address, `author` {name, initials, color}, `bot`.
  if (m.from !== undefined) {
    const you = m.from === "me";
    const owner = { address: you ? null : m.from, name: m.author?.name || "Alguien", you, initials: m.author?.initials, color: m.author?.color };
    if (m.bot) return { kind: "bot", botId: you ? m.bot.id : { owner: m.from, bot: m.bot.id }, name: m.bot.name || "Bot", role: m.bot.role || "", shape: m.bot.shape, color: m.bot.color, owner };
    return { kind: "person", ...owner };
  }
  if (m.role === "user") return { kind: "person", address: null, name: "Tú", you: true };
  if (m.role === "assistant") {
    const id = m.botId || "atlas";
    const bot = bots.find((b) => b.id === id) || { id, name: id.charAt(0).toUpperCase() + id.slice(1) };
    return { kind: "bot", botId: id, name: bot.name, role: bot.role || "", shape: bot.shape, color: bot.color, portrait: bot.portrait, owner: { address: null, name: "Tú", you: true } };
  }
  return { kind: "system" };
}

/** One key per author: the same person, or the same bot of the same owner. */
export function authorKey(author) {
  if (!author || author.kind === "system") return null;
  if (author.kind === "person") return "person:" + (author.you ? "me" : author.address || author.name);
  const owner = author.owner?.you ? "me" : author.owner?.address || author.owner?.name || "";
  const bot = typeof author.botId === "object" && author.botId ? author.botId.bot : author.botId;
  return "bot:" + owner + ":" + (bot || author.name);
}

/**
 * How a row names its author. A person: the name («Tú» for you). A bot: its name, its role in
 * small text and «bot de Lucía» when it is not yours (your own bots do not repeat it on every row).
 * `label` is the text alternative: it always says whether it is a person or a bot, and whose.
 */
export function authorView(author) {
  if (!author || author.kind === "system") return { kind: "system", name: "", sub: "", label: "" };
  if (author.kind === "person") {
    const name = author.you ? "Tú" : author.name || "Alguien";
    return { kind: "person", you: !!author.you, name, sub: "", label: author.you ? "Tú" : name + ", persona" };
  }
  const mine = !!author.owner?.you;
  const whose = mine ? "" : "bot de " + firstName(author.owner?.name);
  const name = author.name || "Bot";
  return { kind: "bot", you: false, mine, name, role: author.role || "", whose, sub: [author.role, whose].filter(Boolean).join(" · "), label: name + ", " + (mine ? "bot tuyo" : whose) };
}

/* ───────────── grouping ───────────── */

/** Consecutive messages by one author within this long share a header. */
export const GROUP_MS = 5 * 60e3;
const PLAIN = new Set(["message", "progress"]);
const isPlain = (m) => PLAIN.has(m.kind || "message") && !m.errand && !m.deleted;

/**
 * Does `m` continue `prev` (same author, both plain messages, the same day, less than five
 * minutes apart, and `prev` has no thread hanging from it)? Then it shows no avatar or name again.
 */
export function continues(prev, m, { bots = [], hasReplies = false, gap = GROUP_MS } = {}) {
  if (!prev || !m || hasReplies || !isPlain(prev) || !isPlain(m) || !m.at || !prev.at) return false;
  const a = authorKey(authorOf(prev, bots)), b = authorKey(authorOf(m, bots));
  if (!a || a !== b) return false;
  const dt = Date.parse(m.at) - Date.parse(prev.at);
  return dt >= 0 && dt < gap && new Date(m.at).toDateString() === new Date(prev.at).toDateString();
}

/** For a list: which rows continue the one before. */
export const groupFlags = (items, opts) => items.map((m, i) => continues(items[i - 1], m, opts));

/* ───────────── what a timeline item is ───────────── */

const MISSION_KINDS = new Set(["message", "progress", "plan", "question", "deliverable", "guard", "fork", "secret", "learned", "block", "activity"]);

/**
 * "status" | "handoff" | "peer" | "mission", or null for a kind this Colmena does not know (a
 * newer server): it is left out, never drawn half-understood.
 */
export function itemType(item) {
  if (!item || typeof item !== "object") return null;
  // Lines about bots at work (engine "line", server/room.mjs): a status or a handoff.
  if (item.kind === "status") return statusLine(item) ? "status" : null;
  if (item.kind === "handoff") return handoffLine(item) ? "handoff" : null;
  if (item.engine === "line") return null;
  if (item.engine === "peer") return !item.kind || item.kind === "message" ? "peer" : null;
  return !item.kind || MISSION_KINDS.has(item.kind) ? "mission" : null;
}

/* ───────────── other owners' bots: one quiet line ───────────── */

/** «12 min», «45 s», «1 h 5 min». */
export function durationText(ms) {
  const s = Math.round(Number(ms) / 1000);
  if (!Number.isFinite(s) || s <= 0) return "";
  if (s < 60) return s + " s";
  const min = Math.round(s / 60);
  if (min < 60) return min + " min";
  const h = Math.floor(min / 60), rest = min % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/**
 * The line for a status item {state, bot: {name}, owner: {name, you}, tools?, ms?}. Always
 * neutral: what waits for someone else is never honey. Unknown state → null (the item is skipped).
 */
export function statusLine(item) {
  // The server writes the sentence (`text`); the words below are for a line that came without it.
  if (typeof item?.text === "string" && item.text.trim()) return item.text.trim();
  if (!item?.state) return null;
  const bot = item?.bot?.name || "El bot";
  const you = !!item?.owner?.you;
  const owner = firstName(item?.owner?.name);
  const took = durationText(item?.ms);
  switch (item?.state) {
    case "thinking": return `${bot} está pensando`;
    case "working": return `${bot} está trabajando`;
    case "done": {
      const n = Number(item.tools) || 0;
      const what = n ? `${bot} usó ${n === 1 ? "1 herramienta" : n + " herramientas"}` : `${bot} ha terminado`;
      return took ? `${what} · ${took}` : what;
    }
    case "waiting": return you ? `${bot} espera tu OK` : `${bot} espera el OK de ${owner}`;
    case "declined": return you ? "Has dicho que ahora no" : `${owner} ha dicho que ahora no`;
    case "stopped": return you ? `Has parado a ${bot}` : `${owner} ha parado a ${bot}`;
    case "limited": return you ? `${bot} está en pausa: límite de tu plan` : `${bot} está en pausa: límite del plan de ${owner}`;
    case "failed": return `${bot} no ha podido terminar`;
    case "throttled": return `${bot} está en pausa un momento: demasiadas peticiones seguidas`;
    case "away": return you ? `${bot} seguirá cuando vuelvas` : `${owner} no está; ${bot} seguirá cuando vuelva`;
    default: return null;
  }
}

/** States of a bot that is still at it (or held): shown as a live line under the conversation. */
const LIVE_STATES = new Set(["thinking", "working", "waiting", "limited", "away"]);

/**
 * The live lines of a room: what other owners' bots are doing right now, from the room view's
 * `activity` (one per owner and bot). Your own bots are left out (their work shows as a turn of
 * the sala and what waits for you as a card), and so is whatever already ended: that is a line
 * of the conversation (`engine: "line"`), not a state.
 */
export function liveLines(activity = []) {
  return (activity || [])
    .filter((a) => a && !a.owner?.you && LIVE_STATES.has(a.state) && a.bot)
    .map((a) => ({ ...a, id: "live:" + (a.owner?.address || "") + ":" + (a.bot.id || a.bot.name), kind: "status", at: null }));
}

/**
 * «Vera (de Sergio) está pensando…» comes with the typing events of a Colmena from before
 * statuses; a bot that already has a live line is not said twice.
 */
export function thinkingLeft(names = [], lines = [], own = []) {
  // `lines`: every state the room knows of other owners' bots, ended ones too («ha parado a Vera»).
  const shown = lines.filter((l) => !l.owner?.you).map((l) => fold(l.bot?.name)).filter(Boolean);
  const mine = own.map(fold);
  // `own`: your bots at work here (their turn shows live); theirs are written «Vera (de Sergio)».
  return (names || []).filter((n) => !mine.includes(fold(n)) && !shown.some((b) => fold(n) === b || fold(n).startsWith(b + " (")));
}

/** A handoff between two bots: both names and the sentence a screen reader gets. */
export function handoffLine(item) {
  // As built the bot that hands over is `bot`; `from` is accepted too.
  const from = (item?.from || item?.bot)?.name, to = item?.to?.name;
  if (!from || !to) return null;
  return { from, to, fromBot: item.from || item.bot, toBot: item.to, label: `${from} pasa el trabajo a ${to}` };
}

/** A bot's live state in the member panel, in words. `mine`: it is your bot. */
export function stateWord(state, { mine = false, owner = null } = {}) {
  switch (state) {
    case "thinking": return "pensando";
    case "working": return "trabajando";
    case "waiting": return mine ? "te espera" : "espera a " + firstName(owner?.name);
    case "limited": case "throttled": return "en pausa";
    case "away": return "su dueño no está";
    case "coordinates": return "coordina";
    default: return "libre";
  }
}

/* ───────────── member panel ───────────── */

export const STATUS_WORD = { dnd: "No molestar", away: "Fuera" };

/** A person's role in the room, in words. */
export function roomRole(person) {
  if (person?.role === "owner") return person.you ? "creaste la sala" : "creó la sala";
  return person?.role === "guest" ? "invitado" : "miembro";
}

/** Presence and status in words (never colour alone). */
export function presenceWord(person) {
  const status = STATUS_WORD[person?.status?.mode];
  if (status) return status;
  if (person?.you) return "aquí";
  return person?.presence === "online" ? "en línea" : "sin conexión";
}

/**
 * The member panel of a room view: people (you first, then whoever made it, then by name) and
 * bots grouped by owner («Tus bots» first, then «Bots de Lucía»…), each with its state in words.
 * `working` / `waiting`: ids of your bots at work or waiting for you here; `activity`: the
 * room's live states of other owners' bots [{owner: {address}, bot: {id}, state}].
 */
export function memberPanel(view, { working = [], waiting = [], activity = [] } = {}) {
  const rank = (p) => (p.you ? 0 : p.role === "owner" ? 1 : p.role === "guest" ? 3 : 2);
  const people = [...(view?.people || [])].sort((a, b) => rank(a) - rank(b) || byName(a, b))
    .map((p) => ({ ...p, name: p.name || "Alguien", roleWord: roomRole(p), presenceWord: presenceWord(p) }));
  const live = (owner, bot) => activity.find((a) => a?.owner?.address === owner.address && (a.bot?.id === bot.id || a.bot?.name === bot.name))?.state || null;
  const groups = (view?.bots || []).filter((g) => g?.bots?.length).map((g) => {
    const mine = !!g.owner?.you;
    const bots = g.bots.map((b) => {
      const state = mine
        ? (working.includes(b.id) ? "working" : waiting.includes(b.id) ? "waiting" : b.id === "atlas" && view?.private ? "coordinates" : "free")
        : live(g.owner, b) || (b.state === "working" ? "working" : "free");
      return { ...b, state, stateWord: stateWord(state, { mine, owner: g.owner }) };
    });
    return { owner: g.owner, mine, label: mine ? "Tus bots" : "Bots de " + firstName(g.owner?.name), bots };
  }).sort((a, b) => Number(b.mine) - Number(a.mine) || byName(a.owner || {}, b.owner || {}));
  return { people, groups, botCount: groups.reduce((n, g) => n + g.bots.length, 0) };
}

/**
 * A room with nothing said yet: what it is for and the one thing to do next.
 * {title, text, action: "invite" | null, actionLabel}. `teamName`: the room's team, if any.
 */
export function roomEmpty(view, { teamName = null } = {}) {
  const name = view?.title || "sala";
  const alone = (view?.people || []).length <= 1;
  if (view?.private || !view) return { title: `Aún no hay mensajes en #${name}`, text: "Escribe qué necesitas. Tus bots se reparten el trabajo y lo ves aquí.", action: null };
  if (view.general && alone) {
    return {
      title: teamName ? `De momento solo estás tú en «${teamName}»` : "De momento solo estás tú",
      text: "Invita a alguien: le das un código, lo pega en su Colmena y entra aquí, en «general», con sus bots.",
      action: "invite", actionLabel: "Invitar al equipo",
    };
  }
  if (view.general) return { title: `Aún no hay mensajes en #${name}`, text: "Aquí está todo el equipo. Escribe el primer mensaje, o nombra a un bot con @ para que conteste aquí.", action: null };
  if (alone) return { title: `Aún no hay nadie más en #${name}`, text: "Invita a alguien a la sala. Verá lo que se escriba desde que entre, no lo anterior.", action: "invite", actionLabel: "Invitar a una persona" };
  return { title: `Aún no hay mensajes en #${name}`, text: "Escribe a las personas de la sala, o nombra a un bot con @ para que conteste aquí.", action: null };
}

/** The member panel of a room where nobody has bots: what would bring one. */
export function noBotsText(view) {
  if (view?.private) return "Esta sala aún no tiene bots. Añade uno para pedirle trabajo aquí.";
  return "Aún no hay bots en esta sala. Los de cada persona aparecen aquí cuando su dueño los tiene encendidos; nómbralos con @ para que contesten.";
}

/** Where a room is: «Privada» (only you), its team's name, or «Por invitación» (people, no team). */
export function roomPlace(view, teams = []) {
  if (!view) return { text: "", private: false };
  if (view.private) return { text: "Privada", private: true, hint: "Solo tú y tus bots" };
  const team = view.teamId ? teams.find((t) => t.id === view.teamId) : null;
  const n = (view.people || []).length;
  return { text: team?.name || "Por invitación", private: false, people: n };
}

/** The text alternative of the header's avatar stack: names, and who is a person and who a bot. */
export function stackLabel(panel) {
  const people = panel.people.map((p) => (p.you ? "tú" : p.name));
  const bots = panel.groups.flatMap((g) => g.bots.map((b) => b.name + (g.mine ? "" : " (de " + firstName(g.owner?.name) + ")")));
  const parts = [];
  if (people.length) parts.push((people.length === 1 ? "Persona: " : "Personas: ") + listNames(people));
  if (bots.length) parts.push((bots.length === 1 ? "Bot: " : "Bots: ") + listNames(bots));
  return parts.join(". ");
}

/* ───────────── inviting ───────────── */

/**
 * Who you can add from the room: teammates of the room's team and your contacts, each once,
 * never you nor someone already in. `query` filters by name (accents and case do not matter).
 * `team`: `GET /api/teams/:id` (members) or null · `contacts`: `peers.contacts`.
 */
export function inviteCandidates({ view, team = null, contacts = [], query = "" } = {}) {
  const inRoom = new Set((view?.people || []).map((p) => p.address));
  const seen = new Set();
  const out = [];
  const add = (address, name, source, online) => {
    if (!address || inRoom.has(address) || seen.has(address)) return;
    seen.add(address);
    out.push({ address, name: name || "Alguien", source, presence: online ? "online" : "offline" });
  };
  for (const m of team?.members || []) if (!m.you) add(m.address, m.name, "equipo", m.presence === "online");
  for (const c of contacts || []) if (c.status === "active") add(c.id, c.name, "contacto", !!c.online);
  const q = fold(query).trim();
  return out.filter((p) => !q || fold(p.name).includes(q)).sort((a, b) => (a.source === b.source ? 0 : a.source === "equipo" ? -1 : 1) || byName(a, b));
}

/** What adding someone does, said before doing it. `owner`: who made the room (when it is not you). */
export function inviteTruth(view) {
  const owner = (view?.people || []).find((p) => p.role === "owner");
  const asks = !!view && !view.private && !view.mine;
  return {
    asks,
    owner: owner && !owner.you ? owner.name : null,
    line: "Verá lo que se escriba a partir de ahora, no lo anterior.",
    ask: asks && owner ? `Se lo pediremos a ${firstName(owner.name)}` : null,
  };
}

/* ───────────── «@» ───────────── */

/**
 * What «@» lists in a room, in groups: your bots first, then the people here (never you), then
 * each owner's bots. Items: {type: "bot", bot} (yours), {type: "person", person},
 * {type: "peerbot", bot, owner}. `query`: what was typed after «@».
 */
export function mentionGroups({ view, query = "", limit = 8 } = {}) {
  const q = fold(query);
  const starts = (name) => !q || fold(name).startsWith(q) || fold(name).split(/\s+/).some((w) => w.startsWith(q));
  const out = [];
  const group = (label, items) => { if (items.length) out.push({ label, items: items.slice(0, limit) }); };
  const groups = [...(view?.bots || [])].sort((a, b) => Number(!!b.owner?.you) - Number(!!a.owner?.you) || byName(a.owner || {}, b.owner || {}));
  const mine = groups.filter((g) => g.owner?.you).flatMap((g) => g.bots);
  group("Tus bots", mine.filter((b) => starts(b.name)).map((bot) => ({ type: "bot", key: "bot:" + bot.id, bot })));
  group("Personas", (view?.people || []).filter((p) => !p.you && starts(p.name)).sort(byName).map((person) => ({ type: "person", key: "person:" + person.address, person })));
  for (const g of groups.filter((x) => !x.owner?.you))
    group("Bots de " + firstName(g.owner?.name), g.bots.filter((b) => starts(b.name)).map((bot) => ({ type: "peerbot", key: "peerbot:" + g.owner.address + ":" + bot.id, bot, owner: g.owner })));
  return out;
}

/** Whether «@name» is still in the text (accents and case out; «@Veranito» is not «@Vera»). */
function names(text, name) {
  if (!name) return false;
  const esc = fold(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^\\p{L}\\p{N}])@" + esc + "(?![\\p{L}\\p{N}])", "u").test(fold(text));
}

/**
 * What a message names, for `POST /api/rooms/:id/messages`: `to` (your bots, by id), `mentions`
 * ([{owner, bot}] of other people's bots) and `people` (addresses). Only picks whose «@name»
 * is still written count; a hand-written «@Vera» is left to the server (it reads yours).
 */
export function mentionTargets(text, picks = []) {
  const to = [], mentions = [], people = [];
  for (const p of picks) {
    if (!names(text, p.label)) continue;
    if (p.type === "bot" && !to.includes(p.id)) to.push(p.id);
    if (p.type === "peerbot" && !mentions.some((x) => x.owner === p.owner && x.bot === p.id)) mentions.push({ owner: p.owner, bot: p.id });
    if (p.type === "person" && !people.includes(p.id)) people.push(p.id);
  }
  return { ...(to.length ? { to: to.slice(0, 4) } : {}), ...(mentions.length ? { mentions: mentions.slice(0, 8) } : {}), ...(people.length ? { people: people.slice(0, 16) } : {}) };
}

/**
 * Said once under the box when «@» picked someone else's bot: it is a request to its owner.
 * «Vera es de Lucía: le llegará a ella para que decida».
 */
export function requestHint(text, picks = []) {
  const theirs = picks.filter((p) => p.type === "peerbot" && names(text, p.label));
  if (!theirs.length) return "";
  const p = theirs[0];
  const owner = firstName(p.ownerName);
  return theirs.length === 1 || theirs.every((x) => x.owner === p.owner)
    ? `${listNames(theirs.map((x) => x.label))} ${theirs.length === 1 ? "es" : "son"} de ${owner}: le llegará a ${owner} para que decida`
    : "Esos bots son de otras personas: le llegará a cada una para que decida";
}

/**
 * The request on a message someone wrote to one of YOUR bots (`asks` of a timeline item) that
 * still waits for your decision, or null. Its card sits over the composer; the message, which
 * may be far above, only points at it.
 */
export function askWaiting(item) {
  const ask = (item?.asks || []).find((a) => a?.state === "asked" && a.id);
  return ask ? { id: ask.id, anchor: "peticion-" + ask.id, text: `${ask.bot?.name || "Tu bot"} espera tu OK` } : null;
}

/** What each answer to «someone asks your bot» sends, and its button. */
export function askChoices(ask) {
  const who = firstName(ask?.from?.name);
  return [["go", "Adelante"], ["later", "Ahora no"], ["always", "Siempre para " + who], ["never", "Nunca para " + who]];
}

/* ───────────── announcing ───────────── */

/**
 * One sentence for the polite live region about rows that arrived since the last one: who wrote
 * (never you), and whether something now waits for you. Empty when there is nothing to say.
 */
export function newsLine(items = [], { bots = [], waiting = 0 } = {}) {
  const who = [];
  let n = 0;
  for (const m of items) {
    const a = authorOf(m, bots);
    if (a.kind === "system" || (a.kind === "person" && a.you)) continue;
    n++;
    const name = authorView(a).name;
    if (!who.includes(name)) who.push(name);
  }
  const parts = [];
  if (n) parts.push((n === 1 ? "Mensaje nuevo de " : `${n} mensajes nuevos de `) + listNames(who.slice(0, 3)) + (who.length > 3 ? " y más" : ""));
  if (waiting > 0) parts.push(waiting === 1 ? "Algo te espera en esta sala" : `${waiting} cosas te esperan en esta sala`);
  return parts.join(". ");
}

/**
 * The same ended state said twice in a row about one bot (a stop reaches the others once from
 * the sala and once from the turn): the second line within a few seconds is left out.
 */
export function withoutRepeats(rows = [], ms = 5000) {
  let last = null;
  const out = [];
  for (const m of rows) {
    if (m?.engine === "line" && m.kind === "status") {
      const key = [m.owner?.address || "", m.bot?.id || "", m.state || "", m.text || ""].join("|");
      const at = Date.parse(m.at) || 0;
      if (last && last.key === key && Math.abs(at - last.at) < ms) continue;
      last = { key, at };
    }
    out.push(m);
  }
  return rows.length === out.length ? rows : out;
}

/** Timeline pages joined: older pages first, each id once (the newest copy wins). */
export function joinItems(...lists) {
  const at = new Map();
  for (const list of lists) for (const m of list || []) if (m?.id) at.set(m.id, m);
  return [...at.values()].sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
}
