// Teams in the browser (docs/PLAN-equipo-y-salas.md, docs/PEOPLE.md › Equipos): the words and
// the rules the team menu, the «Equipo» screen and «Nueva sala» share. Pure: no React, no
// network. The shapes are the ones of server/peers/teams.mjs:
//   GET /api/teams      [{id, name, people, bots, admin, current}]; alone, one entry with id "solo"
//   GET /api/teams/:id  {id, name, state, role: creador|admin|miembro, admin, general,
//                        members: [{address, name, role, presence, status: {mode, until}, bots, you, contact, dm}],
//                        invitations: [{id, name, createdAt, expiresAt}], waiting: [{op, address?, at}]}
// The server decides what is allowed (403, 409); these rules only decide what is offered.

export const SOLO = "solo";
export const ROLE_LABEL = { creador: "Creador", admin: "Administrador", miembro: "Miembro" };
const RANK = { creador: 0, admin: 1, miembro: 2 };

/** «Creador», «Administrador» or «Miembro». */
export const roleLabel = (role) => ROLE_LABEL[role] || ROLE_LABEL.miembro;
/** Whoever created the team and the admins they named administer it. */
export const isAdmin = (role) => role === "creador" || role === "admin";

/** The teams you are really in: the «solo» entry of someone without a team is not one. */
export const realTeams = (teams) => (Array.isArray(teams) ? teams.filter((t) => t && t.id && t.id !== SOLO) : []);
/** The team the sidebar shows, or null when you are alone. */
export function currentTeam(teams) {
  const list = realTeams(teams);
  return list.find((t) => t.current) || list[0] || null;
}

export const canInvite = (myRole) => isAdmin(myRole);
export const canRename = (myRole) => isAdmin(myRole);
/** Admins take people out; never themselves (they leave) and never the creator. */
export const canRemove = (myRole, target) => isAdmin(myRole) && !!target && !target.you && target.role !== "creador";
export const canMakeAdmin = (myRole, target) => isAdmin(myRole) && !!target && !target.you && target.role === "miembro";
export const canUnmakeAdmin = (myRole, target) => isAdmin(myRole) && !!target && !target.you && target.role === "admin";
/** An admin (never the creator) can stop administering: they stay in the team as a member. */
export const canStepDown = (myRole, target) => myRole === "admin" && !!target?.you && target.role === "admin";
/** A direct conversation needs the other person's address (a team of one has none). */
export const canMessage = (target) => !!target && !target.you && !!target.address;

/** The names of who can invite, creator first: «Sergio y Marta». */
export function adminNames(members = []) {
  return sortMembers(members.filter((m) => isAdmin(m.role)), { youFirst: false }).map((m) => (m.you ? "tú" : firstName(m.name)));
}

export const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "Alguien";
/** «Ana», «Ana y Luis», «Ana, Luis y Marta». */
export function listNames(names = []) {
  const list = names.filter(Boolean);
  return list.length <= 1 ? list.join("") : list.slice(0, -1).join(", ") + " y " + list[list.length - 1];
}
const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es", { sensitivity: "base", numeric: true });

/** You first, then the creator, the admins and everyone else by name. */
export function sortMembers(members = [], { youFirst = true } = {}) {
  return [...members].sort((a, b) => (youFirst ? (b.you ? 1 : 0) - (a.you ? 1 : 0) : 0) || (RANK[a.role] ?? 2) - (RANK[b.role] ?? 2) || byName(a, b));
}

/** «3 personas · 7 bots». */
export function countLine(team) {
  const n = (v, one, many) => (v === 1 ? `1 ${one}` : `${v} ${many}`);
  return `${n(team?.people || 0, "persona", "personas")} · ${n(team?.bots || 0, "bot", "bots")}`;
}

/** «hasta las 18:00», «hasta mañana a las 9:00», «hasta el lunes 16». */
export function untilText(iso, now = Date.now()) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  const today = new Date(now);
  const time = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return "hasta las " + time;
  if (new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toDateString() === d.toDateString()) return "hasta mañana a las " + time;
  return "hasta el " + d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric" });
}

/**
 * Whether someone is there and their status, in words (never colour alone):
 * {online, mode, text}: «En línea», «Sin conexión», «No molestar · hasta las 18:00», «Fuera hasta el lunes 16».
 */
export function presenceWords(member, now = Date.now()) {
  const online = member?.presence === "online";
  const status = member?.status || {};
  const live = !status.until || Date.parse(status.until) > now;
  const mode = live && (status.mode === "dnd" || status.mode === "away") ? status.mode : "available";
  const until = status.until && mode !== "available" ? untilText(status.until, now) : "";
  const text = mode === "dnd" ? "No molestar" + (until ? " · " + until : "") : mode === "away" ? "Fuera" + (until ? " " + until : "") : online ? "En línea" : "Sin conexión";
  return { online, mode, text };
}

/** The person `PeerAvatar` draws (src/components/v2/people/PeerAvatar.jsx), from a team member. */
export function avatarOf(member, now = Date.now()) {
  const p = presenceWords(member, now);
  const initials = String(member?.name || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";
  return { me: !!member?.you, initials, color: "#E6E7EC", online: p.online, away: p.mode === "available" ? null : { mode: p.mode } };
}

/** The creator's first name: the changes of an admin wait for their Colmena. */
export function creatorName(members = []) {
  const c = members.find((m) => m.role === "creador");
  return c ? (c.you ? "tú" : firstName(c.name)) : "quien creó el equipo";
}

/**
 * A change you asked for that the creator has not signed yet, in words:
 * «Quitar a Luis · pendiente: se aplicará cuando Sergio se conecte».
 */
export function waitingLine(entry, members = []) {
  const who = members.find((m) => m.address && m.address === entry?.address);
  const name = who ? firstName(who.name) : null;
  const what = entry?.op === "remove" ? (name ? `Quitar a ${name}` : "Quitar a una persona")
    // `on` says which way (server/peers/teams.mjs); an entry from before it only says that it changes.
    : entry?.op === "admin" ? (entry.on === true ? (name ? `Hacer administrador a ${name}` : "Nombrar a un administrador")
      : entry.on === false ? (who?.you ? "Dejar de administrar" : name ? `Quitar a ${name} como administrador` : "Quitar a un administrador")
        : name ? `Cambiar si ${name} administra` : "Cambiar quién administra")
      : entry?.op === "rename" ? "Cambiar el nombre"
        : entry?.op === "add" ? (name ? `Añadir a ${name}` : "Añadir a una persona") : "Un cambio";
  return `${what} · pendiente: se aplicará cuando ${creatorName(members)} se conecte`;
}
/** What waits about one member (shown under their name). */
export const waitingFor = (waiting = [], address) => (address ? waiting.filter((w) => w.address === address) : []);
/** What waits about the team as a whole, or about someone the list does not show yet. */
export function waitingRest(waiting = [], members = []) {
  const shown = new Set(members.map((m) => m.address).filter(Boolean));
  return waiting.filter((w) => !w.address || !shown.has(w.address));
}

/** The confirmation of «Salir del equipo»: what happens, said before it happens. */
export function leaveText(team, myRole) {
  const name = team?.name || "el equipo";
  if (myRole === "creador") {
    const others = Math.max(0, (team?.people || team?.members?.length || 1) - 1);
    return {
      action: "Cerrar el equipo", title: `¿Cerrar «${name}» para todos?`, confirm: "Cerrar el equipo",
      text: (others ? `Lo creaste tú: si te vas, «${name}» se cierra para ${others === 1 ? "la otra persona" : `las otras ${others} personas`}.` : `Lo creaste tú: si te vas, «${name}» se cierra.`)
        + " Nadie podrá escribir en «general» ni en sus salas. Lo que os escribisteis se queda en la Colmena de cada uno. No se puede deshacer.",
    };
  }
  return {
    action: "Salir del equipo", title: `¿Salir de «${name}»?`, confirm: "Salir del equipo",
    text: `Dejarás de ver «general» y las salas de «${name}». Lo que os escribisteis se queda en tu Colmena. Para volver hará falta otra invitación.`,
  };
}
/** The confirmation of «Quitar del equipo». */
export function removeText(team, member) {
  const who = firstName(member?.name);
  return { title: `¿Quitar a ${who} de «${team?.name || "el equipo"}»?`, confirm: `Quitar a ${who}`, text: `${who} dejará de ver «general» y las salas del equipo. Lo que ya se escribió se queda en su Colmena.` };
}

/** A team you asked to join and are not in yet: {text, action}. */
export function pendingLine(p) {
  if (p?.state === "refused") {
    return { refused: true, action: "Descartar", text: p.reason === "full" ? "El equipo está completo. Pide que hagan sitio y que te manden otra invitación." : `No se pudo entrar. Pide otra invitación a ${p.from ? firstName(p.from) : "quien te la mandó"}.` };
  }
  // `from`: who gave you the code (their name, when this Colmena knows it).
  return { refused: false, action: "Cancelar la petición", text: (p?.from ? `Te invitó ${p.from}. ` : "Has pedido entrar. ") + "Estarás dentro cuando la Colmena de quien creó el equipo esté encendida." };
}

// ---------------------------------------------------------------- codes
const CODE = /COLMENA[\s-]*((?:[0-9A-Z][\s-]*){16})/i;
/**
 * The invitation code inside whatever was pasted (the whole message is fine), written as
 * COLMENA-XXXX-XXXX-XXXX-XXXX, or null. Team, room and person codes look the same: what a code
 * is for is only known after asking (POST /api/peers/invites/preview → codeKind).
 */
export function findCode(text) {
  const m = CODE.exec(String(text || ""));
  // Typed by hand, «COLMENA-WC1P-37PR-G» is a code half written, not sixteen characters of one.
  const raw = (m ? m[1] : String(text || "").replace(/^\s*COLMENA/i, "")).toUpperCase().replace(/[\s-]+/g, "");
  if (!/^[0-9A-Z]{16}$/.test(raw)) return null;
  return "COLMENA-" + raw.match(/.{4}/g).join("-");
}
/**
 * What a code is for, from its preview {name, team, room, already}:
 * a team's goes to POST /api/teams/join; a room's or a person's to POST /api/peers/invites/accept.
 */
export function codeKind(preview) {
  const from = firstName(preview?.name);
  if (preview?.team) return { kind: "team", title: `Entrar en el equipo «${preview.team}»`, text: `Te invita ${preview.name || "alguien"}. Verás a sus personas, los bots de cada una y la sala «general».`, confirm: `Coinciden · entrar en «${preview.team}»`, from };
  if (preview?.room) return { kind: "room", title: `${preview.name || "Alguien"} te invita a la sala «${preview.room}»`, text: "Entrarás en esa sala y podréis escribiros a solas. No es una invitación a un equipo.", confirm: `Coinciden · entrar en «${preview.room}»`, from };
  return { kind: "person", title: `${preview?.name || "Alguien"} te invita a hablar`, text: "Os escribiréis a solas, cada uno desde su Colmena. No es una invitación a un equipo.", confirm: `Coinciden · conectar con ${from}`, from };
}

// ---------------------------------------------------------------- «Nueva sala»
export const ROOM_MAX_BOTS = 6;
export const ROOM_MAX_PEOPLE = 31;
/** Who can go into a new room: the teammates of its team, or the people you talk to. */
export function roomPeople({ team = null, contacts = [] } = {}) {
  const list = team
    ? (team.members || []).filter((m) => !m.you && m.address).map((m) => ({ address: m.address, name: m.name || "Alguien", online: m.presence === "online" }))
    : contacts.filter((c) => c.status === "active" && c.id).map((c) => ({ address: c.id, name: c.name || "Alguien", online: !!c.online }));
  return list.sort(byName);
}
/** The body of POST /api/rooms: without a team or people it is a private room. */
export function roomPayload({ title, team = null, botIds = [], people = [] } = {}) {
  const body = { title: String(title || "").replace(/\s+/g, " ").trim().slice(0, 60) };
  if (team && team !== SOLO) body.team = team;
  if (botIds.length) body.botIds = [...new Set(botIds)].slice(0, ROOM_MAX_BOTS);
  if (people.length) body.people = [...new Set(people)].slice(0, ROOM_MAX_PEOPLE);
  return body;
}
/** What the room will be, in one line under the form. */
export function roomHint({ teamName = null, people = 0, bots = 0 } = {}) {
  const who = [people ? (people === 1 ? "1 persona" : `${people} personas`) : null, bots ? (bots === 1 ? "1 bot tuyo" : `${bots} bots tuyos`) : null].filter(Boolean).join(" y ");
  if (teamName) return `Sala de «${teamName}»${who ? ` con ${who}` : ""}. Solo entra quien invites; lo anterior a su llegada no lo verá.`;
  if (people) return `Sala privada con ${who}. Solo la veis quienes estéis en ella.`;
  return `Sala privada${who ? ` con ${who}` : ""}: solo tú y tus bots, hasta que invites a alguien.`;
}
