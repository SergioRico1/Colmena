// Bringing people in, in one vocabulary (docs/SCREENS.md › «Invitar»): the one «Invitar» sheet
// (a room, a team, or nothing), «Nuevo mensaje», «Unirme con un código», the pending codes and
// requests. Pure: no React, no network. The shapes are the ones of docs/CONTRACT.md §18 and
// «Personas»: `GET /api/peers` (contacts, invites), `GET /api/rooms/:id`, `GET /api/teams/:id`.
// The server decides what is allowed; these rules only decide what is offered and how it reads.
import { firstName, listNames } from "./identity.js";

/** The words, written once. Buttons say «Invitar»; the rest say exactly this. */
export const WORDS = Object.freeze({
  invite: "Invitar",
  newcomer: "Invitar a alguien que aún no está",
  join: "Unirme con un código",
  dm: "Mensaje directo",
  newMessage: "Nuevo mensaje",
  pending: "Pendiente",
  revoke: "Revocar",
  copyCode: "Copiar código",
  copyMessage: "Copiar mensaje",
  copyAgain: "Copiar de nuevo",
  createCode: "Crear código",
});

/** People in one room as the server allows (PEER_LIMITS.members). */
export const ROOM_LIMIT = 32;

const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es", { sensitivity: "base", numeric: true });
/** «1 persona», «3 personas». */
export const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ───────────── what the sheet is about ───────────── */

/**
 * The context the sheet opens with, normalised: {kind: "room", room} (a room view), {kind:
 * "team", team} ({id, name, admin}) or {kind: "none"}. Anything else is «none».
 */
export function contextOf(ctx) {
  if (ctx?.kind === "room" && ctx.room) return { kind: "room", room: ctx.room };
  if (ctx?.kind === "team" && ctx.team?.id) return { kind: "team", team: ctx.team };
  return { kind: "none" };
}

/** The sheet's title. */
export function sheetTitle(ctx) {
  const c = contextOf(ctx);
  if (c.kind === "room") return `Invitar a #${c.room.title || "sala"}`;
  if (c.kind === "team") return `Invitar a «${c.team.name || "el equipo"}»`;
  return WORDS.newcomer;
}

/** The owner of a room you did not make, or null (you made it, or it is private). */
export function roomOwner(view) {
  if (!view || view.private || view.mine) return null;
  const owner = (view.people || []).find((p) => p.role === "owner" && !p.you);
  return owner ? { address: owner.address, name: owner.name || "quien creó la sala" } : { address: null, name: "quien creó la sala" };
}

/**
 * The one line said before anyone is brought in: who will see what, from when. `n` is how many
 * people are being invited (the verb agrees: «Verá», «Verán»).
 */
export function truthLine(ctx, n = 2) {
  const c = contextOf(ctx);
  const see = n === 1 ? "Verá" : "Verán";
  if (c.kind === "room") return `${see} lo que se escriba a partir de ahora, no lo anterior.`;
  if (c.kind === "team") return `Entrará en «${c.team.name || "el equipo"}» y en #general, con sus bots. Lo anterior no lo verá.`;
  return "Os escribiréis a solas, cada uno desde su Colmena y con sus bots.";
}

/** «Miembro» and «Invitado», each explained in one line. */
export const ROOM_ROLES = Object.freeze([
  { id: "member", label: "Miembro", hint: "Lee, escribe y puede pedir cosas a los bots de la sala." },
  { id: "guest", label: "Invitado", hint: "Lee y escribe, pero sus mensajes no despiertan a ningún bot." },
]);
export const roleHint = (role) => (ROOM_ROLES.find((r) => r.id === role) || ROOM_ROLES[0]).hint;

/* ───────────── can anyone be invited now? ───────────── */

/**
 * Why inviting cannot happen right now, or null. `peers`: `GET /api/peers`.
 * {kind: "preparing" | "nomailbox" | "offline", title, text, action?: {label, href}, codes: false, people}
 * `codes`: whether a code can be made now; `people`: whether people you already reach can be added.
 * `talk`: said for writing to someone (Nuevo mensaje) rather than for inviting.
 */
export function inviteBlock(peers, { talk = false } = {}) {
  if (!peers?.me) return { kind: "preparing", title: "Colmena está preparando las claves de este ordenador.", text: "En unos segundos podrás invitar.", codes: false, people: false };
  const status = peers.relay?.status || "off";
  if (status === "off") {
    return {
      kind: "nomailbox", title: talk ? "Para escribir a otras personas, Colmena usa un buzón cifrado." : "Para invitar a gente, Colmena usa un buzón cifrado.",
      text: "Por él viajan los mensajes cerrados con llave: el buzón guarda sobres que no puede leer.",
      action: { label: "Actívalo", href: "/ajustes/contactos#buzon" }, codes: false, people: false,
    };
  }
  if (status !== "online") {
    return {
      kind: "offline", title: "Sin conexión con el buzón.",
      text: "Los códigos se crean en el buzón, así que hará falta que vuelva. Lo que hagas con quien ya hablas sale en cuanto vuelva.",
      codes: false, people: true,
    };
  }
  return null;
}

/* ───────────── who you can reach ───────────── */

/**
 * The people you can reach, each once: your teammates (`members` of `GET /api/teams/:id`, any
 * team) and the people you talk to (`contacts` of `GET /api/peers`, active only). Never you.
 * Each: {address, name, presence, status, source: "equipo" | "contacto", team, teamId, dm, contact}.
 * `teams`: [{id, name, members}]. `query` filters by name
 * (accents and case do not matter); `exclude`: addresses left out.
 */
export function reachable({ teams = [], contacts = [], query = "", exclude = [] } = {}) {
  const out = new Map();
  const skip = new Set(exclude);
  for (const t of teams || []) {
    for (const m of t?.members || []) {
      if (m.you || !m.address || skip.has(m.address) || out.has(m.address)) continue;
      out.set(m.address, { address: m.address, name: m.name || "Alguien", presence: m.presence === "online" ? "online" : "offline", status: m.status?.mode && m.status.mode !== "available" ? m.status : null, source: "equipo", team: t.name || null, teamId: t.id || null, dm: m.dm || null, contact: !!m.contact });
    }
  }
  for (const c of contacts || []) {
    if (c.status !== "active" || !c.id || skip.has(c.id)) continue;
    const had = out.get(c.id);
    if (had) { out.set(c.id, { ...had, dm: had.dm || c.dm || null, contact: true }); continue; }
    out.set(c.id, { address: c.id, name: c.name || "Alguien", presence: c.online ? "online" : "offline", status: c.away || null, source: "contacto", team: null, teamId: null, dm: c.dm || null, contact: true });
  }
  const q = fold(query);
  return [...out.values()].filter((p) => !q || fold(p.name).includes(q))
    .sort((a, b) => (a.source === b.source ? 0 : a.source === "equipo" ? -1 : 1) || byName(a, b));
}

/** A person's second line in a picker: «Equipo Acme · en línea», «Ya habláis · sin conexión». */
export function reachLine(p) {
  const where = p.source === "equipo" ? (p.team ? `Equipo ${p.team}` : "Del equipo") : "Ya habláis";
  const status = p.status?.mode === "dnd" ? "no molestar" : p.status?.mode === "away" ? "fuera" : p.presence === "online" ? "en línea" : "sin conexión";
  return `${where} · ${status}`;
}

/**
 * The room's picker: who you can bring in and whoever a search finds already inside
 * ({…person, inRoom: true}, said «Ya está en la sala», never offered again).
 */
export function roomPicker({ view, teams = [], contacts = [], query = "" } = {}) {
  const inRoom = (view?.people || []).filter((p) => !p.you && p.address);
  const list = reachable({ teams, contacts, query, exclude: [...inRoom.map((p) => p.address), ...(view?.people || []).filter((p) => p.you).map((p) => p.address)] });
  const q = fold(query);
  const found = q ? inRoom.filter((p) => fold(p.name).includes(q)).map((p) => ({ address: p.address, name: p.name || "Alguien", inRoom: true, presence: p.presence })) : [];
  return [...list, ...found];
}

/** How many more fit in a room: {left, full, text}. `picked`: how many are selected now. */
export function roomRoom(view, picked = 0) {
  const now = (view?.people || []).length || 1;
  const left = Math.max(0, ROOM_LIMIT - now - picked);
  const full = ROOM_LIMIT - now <= 0;
  return { left, full, text: full ? `La sala está completa: caben ${ROOM_LIMIT} personas.` : left === 0 ? `Con estas, la sala queda completa (${ROOM_LIMIT} personas).` : "" };
}

/* ───────────── pending codes ───────────── */

/** The open codes of one context, newest first. `invites`: `peers.invites`. */
export function pendingCodes(invites = [], ctx, now = Date.now()) {
  const c = contextOf(ctx);
  const room = c.kind === "room" ? [c.room.shareId, c.room.id].filter(Boolean) : [];
  return (invites || []).filter((i) => Date.parse(i.expiresAt) > now)
    .filter((i) => (c.kind === "room" ? i.kind === "room" && room.includes(i.room) : c.kind === "team" ? i.team === c.team.id : (i.kind || "person") === "person"))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

/** «Caduca en 24 h», «Caduca en 35 min», «Caduca en menos de un minuto», «Caducado». */
export function expiresText(iso, now = Date.now()) {
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "Caducado";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "Caduca en menos de un minuto";
  if (min < 60) return `Caduca en ${min} min`;
  return `Caduca en ${Math.round(min / 60)} h`;
}

/** A pending code in one line: «Para Marta · como invitado · caduca en 23 h». */
export function pendingCodeLine(inv, now = Date.now()) {
  return [inv?.name && inv.name !== "Alguien" ? `Para ${inv.name}` : "Sin nombre", inv?.role === "guest" ? "como invitado" : null, expiresText(inv?.expiresAt, now).toLowerCase()].filter(Boolean).join(" · ");
}

/** Under a fresh code: how long it lasts and how many times it works. */
export const CODE_RULES = "Caduca en 24 h · sirve una sola vez";
/** Why the four words matter, said once to whoever invites. */
export const WORDS_WHY = "Al pegarlo, a los dos os saldrán las mismas cuatro palabras. Comparadlas de viva voz, en persona o por teléfono: si coinciden, nadie se ha puesto en medio.";

/* ───────────── what happened ───────────── */

/**
 * The status line after «Añadir»/«Pedírselo»: `done` [{name, asked}] of this round; `owner`: who
 * decides in a room you did not make. «Marta ya está en #ventas», «Marta y Luis ya están en
 * #ventas», «Pendiente: se lo hemos pedido a Sergio (Marta)».
 */
export function doneLine(done = [], { room = "sala", owner = null } = {}) {
  const added = done.filter((d) => !d.asked).map((d) => firstName(d.name));
  const asked = done.filter((d) => d.asked).map((d) => firstName(d.name));
  const parts = [];
  if (added.length) parts.push(`${listNames(added)} ${added.length === 1 ? "ya está" : "ya están"} en #${room}.`);
  if (asked.length) parts.push(`${WORDS.pending}: se lo hemos pedido a ${firstName(owner || "quien creó la sala")} (${listNames(asked)}).`);
  return parts.join(" ");
}

/** The button of the room's picker: «Añadir a Marta», «Añadir a 3 personas», «Pedírselo a Sergio». */
export function addLabel(picked = [], { owner = null } = {}) {
  if (owner) return `Pedírselo a ${firstName(owner)}`;
  if (!picked.length) return "Añadir";
  return picked.length === 1 ? `Añadir a ${firstName(picked[0].name)}` : `Añadir a ${count(picked.length, "persona", "personas")}`;
}

/** What the requester sees about a «please add» still waiting: neutral, it waits for the owner. */
export function askedLine(asked = [], owner = null) {
  if (!asked.length) return "";
  return `${WORDS.pending}: se lo hemos pedido a ${firstName(owner || "quien creó la sala")} (${listNames(asked.map((a) => firstName(a.person?.name)))}).`;
}

/* ───────────── joining with a code ───────────── */

/**
 * What a pasted code is, from `POST /api/peers/invites/preview` {name, kind, room, team}:
 * {kind, from, title, text, confirm, done, doneText, arrived, arrivedText}: `done` right after accepting,
 * `arrived` once you are really in (the owner's Colmena confirmed it).
 */
export function joinView(preview) {
  const from = firstName(preview?.name);
  const kind = preview?.team ? "team" : preview?.room ? "room" : "person";
  if (kind === "team") {
    return {
      kind, from, title: `${preview.name || "Alguien"} te invita al equipo «${preview.team}»`,
      text: "Verás a sus personas, los bots de cada una y la sala #general. Tus bots y tus datos siguen en tu ordenador.",
      confirm: `Coinciden · entrar en «${preview.team}»`,
      done: `Has pedido entrar en «${preview.team}»`, arrived: `Ya estás en «${preview.team}»`, arrivedText: "Están a la vista sus personas, los bots de cada una y #general.", doneText: "Estarás dentro en cuanto la Colmena de quien creó el equipo lo confirme (si está encendida, en unos segundos). Mientras, se ve como pendiente en la cabecera de la barra.",
    };
  }
  if (kind === "room") {
    return {
      kind, from, title: `${preview.name || "Alguien"} te invita a la sala #${preview.room}`,
      text: "Verás lo que se escriba a partir de ahora, no lo anterior. También podréis escribiros a solas.",
      confirm: `Coinciden · entrar en #${preview.room}`,
      done: `Vas a entrar en #${preview.room}`, arrived: `Ya estás en #${preview.room}`, arrivedText: "Verás lo que se escriba a partir de ahora.", doneText: `Estarás dentro en cuanto la Colmena de ${from} lo confirme (si está encendida, en unos segundos).`,
    };
  }
  return {
    kind, from, title: `${preview?.name || "Alguien"} te invita a hablar`,
    text: "Os escribiréis a solas, cada uno desde su Colmena. Sus mensajes llegan cerrados con llave: solo los abre tu ordenador.",
    confirm: `Coinciden · conectar con ${from}`,
    done: `Ya puedes escribirte con ${from}`, arrived: `Ya puedes escribirte con ${from}`, arrivedText: null, doneText: `Si ${from} no tiene Colmena abierta ahora, lo que le escribas le llegará en cuanto la abra.`,
  };
}

/** Errors of «Unirme con un código» in plain words, by what failed. */
export function joinError(error) {
  const status = error?.status;
  const msg = String(error?.message || "");
  if (status === 404) return msg || "Ese código ya no sirve: caducó, ya se usó o lo revocaron. Pide uno nuevo a quien te lo mandó.";
  if (status === 502 || status === 503 || /fetch|network|conexi/i.test(msg)) return "No se pudo consultar el buzón, así que no sabemos si el código vale. Comprueba la conexión y vuelve a probar.";
  return msg || "No se pudo usar el código. Vuelve a probar.";
}

/* ───────────── a direct conversation ───────────── */

/** The header's menu of a direct conversation: what each choice does, said before it happens. */
export function dmMenu({ name = "", muted = false } = {}) {
  const who = firstName(name);
  return {
    profile: "Ver perfil",
    mute: muted ? "Volver a avisarme" : "Silenciar",
    muteHint: muted ? `Te volverá a avisar cuando ${who} escriba.` : `No te avisará ni sonará. Los mensajes de ${who} siguen llegando y se ven sin leer.`,
    archive: "Archivar",
    archiveHint: `Sale de la barra hasta que alguno de los dos escriba. No se borra nada ni se avisa a ${who}.`,
    remove: "Quitar de contactos",
    removeTitle: `¿Quitar a ${who} de tus contactos?`,
    removeText: `Dejaréis de poder escribiros a solas; lo que os escribisteis se queda en tu Colmena. Si estáis en el mismo equipo, seguiréis viéndoos en sus salas. Para volver a hablar a solas hará falta otra invitación.`,
  };
}
