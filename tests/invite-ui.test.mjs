// Inviting people in the browser (src/lib/invite.js): one vocabulary, who can be reached where,
// a room's roles and limits, what a pasted code is, the pending codes of each place and the
// words said after each step (singular and plural, first names). Pure: no browser, no server.
import test from "node:test";
import assert from "node:assert/strict";
import {
  WORDS, ROOM_LIMIT, addLabel, askedLine, contextOf, doneLine, dmMenu, expiresText, inviteBlock, joinError, joinView, pendingCodeLine, pendingCodes,
  reachLine, reachable, roleHint, roomOwner, roomPicker, roomRoom, sheetTitle, truthLine,
} from "../src/lib/invite.js";

const NOW = Date.parse("2026-11-13T10:00:00Z");
const ME = "M".repeat(43), LUCIA = "L".repeat(43), PABLO = "P".repeat(43), ZOE = "Z".repeat(43), ALVARO = "A".repeat(43);
const team = { id: "t1", name: "Acme", members: [{ address: ME, name: "Sergio Rico", you: true }, { address: LUCIA, name: "Lucía Martín", presence: "online" }, { address: PABLO, name: "Pablo Ruiz", presence: "offline", dm: "dm-p", contact: true }, { address: ALVARO, name: "Álvaro Gil", presence: "online", status: { mode: "dnd" } }] };
const contacts = [{ id: PABLO, name: "Pablo Ruiz", status: "active", online: true, dm: "dm-p" }, { id: ZOE, name: "Zoe Lara", status: "active", dm: "dm-z" }, { id: "x", name: "Sin aceptar", status: "pending" }];

test("one vocabulary, written once", () => {
  assert.deepEqual([WORDS.invite, WORDS.newcomer, WORDS.join, WORDS.dm, WORDS.pending, WORDS.revoke], ["Invitar", "Invitar a alguien que aún no está", "Unirme con un código", "Mensaje directo", "Pendiente", "Revocar"]);
  assert.equal(sheetTitle({ kind: "room", room: { title: "ventas" } }), "Invitar a #ventas");
  assert.equal(sheetTitle({ kind: "team", team: { id: "t1", name: "Acme" } }), "Invitar a «Acme»");
  assert.equal(sheetTitle(null), "Invitar a alguien que aún no está");
  assert.deepEqual(contextOf({ kind: "team", team: {} }), { kind: "none" }, "a team without id is nothing");
});

test("the truth before inviting: who sees what, from when, in the right number", () => {
  const room = { kind: "room", room: { title: "ventas" } };
  assert.equal(truthLine(room, 1), "Verá lo que se escriba a partir de ahora, no lo anterior.");
  assert.equal(truthLine(room, 3), "Verán lo que se escriba a partir de ahora, no lo anterior.");
  assert.match(truthLine({ kind: "team", team: { id: "t", name: "Acme" } }), /Entrará en «Acme» y en #general/);
  assert.equal(roleHint("guest"), "Lee y escribe, pero sus mensajes no despiertan a ningún bot.");
  assert.match(roleHint("member"), /puede pedir cosas a los bots/);
  assert.match(roleHint("otra cosa"), /puede pedir cosas a los bots/, "anything else is a member");
});

test("who can be reached: teammates first, then contacts, each once, never you", () => {
  const list = reachable({ teams: [team], contacts });
  assert.deepEqual(list.map((p) => [p.name, p.source, p.dm]), [["Álvaro Gil", "equipo", null], ["Lucía Martín", "equipo", null], ["Pablo Ruiz", "equipo", "dm-p"], ["Zoe Lara", "contacto", "dm-z"]]);
  assert.equal(list.find((p) => p.name === "Lucía Martín").teamId, "t1", "a teammate's direct conversation opens through their team");
  assert.deepEqual(reachable({ teams: [team], contacts, query: "ALVARO" }).map((p) => p.name), ["Álvaro Gil"], "accents and case do not matter");
  assert.deepEqual(reachable({ contacts, exclude: [ZOE] }).map((p) => p.name), ["Pablo Ruiz"]);
  assert.deepEqual(reachLine(list[0]), "Equipo Acme · no molestar");
  assert.equal(reachLine(list[3]), "Ya habláis · sin conexión");
  assert.equal(reachLine(list.find((p) => p.name === "Pablo Ruiz")), "Equipo Acme · sin conexión", "presence as the team says it");
});

test("a room's picker: whoever is in is said so, never offered; the limit is 32", () => {
  const view = { title: "ventas", teamId: "t1", people: [{ address: ME, name: "Sergio", you: true, role: "owner" }, { address: LUCIA, name: "Lucía Martín", role: "member" }] };
  assert.deepEqual(roomPicker({ view, teams: [team], contacts }).map((p) => p.name), ["Álvaro Gil", "Pablo Ruiz", "Zoe Lara"]);
  assert.deepEqual(roomPicker({ view, teams: [team], contacts, query: "luc" }).map((p) => [p.name, !!p.inRoom]), [["Lucía Martín", true]]);
  assert.deepEqual(roomRoom(view, 0), { left: 30, full: false, text: "" });
  const nearly = { people: Array.from({ length: ROOM_LIMIT - 1 }, (_, i) => ({ address: "p" + i })) };
  assert.equal(roomRoom(nearly, 1).text, "Con estas, la sala queda completa (32 personas).");
  assert.equal(roomRoom({ people: Array.from({ length: ROOM_LIMIT }, (_, i) => ({ address: "p" + i })) }).full, true);
  // Whoever did not make the room asks its owner.
  assert.equal(roomOwner({ mine: true, people: [] }), null);
  assert.deepEqual(roomOwner({ mine: false, people: [{ address: LUCIA, name: "Lucía Martín", role: "owner" }, { address: ME, you: true, role: "member" }] }), { address: LUCIA, name: "Lucía Martín" });
  assert.equal(roomOwner({ private: true, mine: false, people: [] }), null);
});

test("the words after each step: added, asked, singular and plural", () => {
  assert.equal(addLabel([]), "Añadir");
  assert.equal(addLabel([{ name: "Marta Ruiz" }]), "Añadir a Marta");
  assert.equal(addLabel([{ name: "Marta" }, { name: "Luis" }, { name: "Eva" }]), "Añadir a 3 personas");
  assert.equal(addLabel([{ name: "Marta" }], { owner: "Sergio Rico" }), "Pedírselo a Sergio");
  assert.equal(doneLine([{ name: "Marta Ruiz" }], { room: "ventas" }), "Marta ya está en #ventas.");
  assert.equal(doneLine([{ name: "Marta Ruiz" }, { name: "Luis Gómez" }], { room: "ventas" }), "Marta y Luis ya están en #ventas.");
  assert.equal(doneLine([{ name: "Marta", asked: true }, { name: "Luis", asked: true }], { owner: "Sergio Rico" }), "Pendiente: se lo hemos pedido a Sergio (Marta y Luis).");
  assert.equal(askedLine([{ person: { name: "Luis Gómez" } }], "Sergio Rico"), "Pendiente: se lo hemos pedido a Sergio (Luis).");
  assert.equal(askedLine([], "Sergio"), "");
});

test("pending codes belong where they lead, and say until when", () => {
  const at = (h) => new Date(NOW + h * 3600e3).toISOString();
  const invites = [
    { id: "a", name: "Ana", kind: "room", room: "r1", role: "guest", expiresAt: at(23), createdAt: at(-1) },
    { id: "b", name: "Luis", kind: "person", expiresAt: at(5), createdAt: at(-2) },
    { id: "c", name: "Eva", kind: "team", team: "t1", expiresAt: at(20), createdAt: at(-3) },
    { id: "d", name: "Viejo", kind: "person", expiresAt: at(-1), createdAt: at(-30) },
    { id: "e", name: "Alguien", expiresAt: at(1), createdAt: at(0) },
  ];
  assert.deepEqual(pendingCodes(invites, { kind: "room", room: { id: "r1", shareId: "r1" } }, NOW).map((i) => i.id), ["a"]);
  assert.deepEqual(pendingCodes(invites, { kind: "team", team: { id: "t1" } }, NOW).map((i) => i.id), ["c"]);
  assert.deepEqual(pendingCodes(invites, null, NOW).map((i) => i.id), ["e", "b"], "newest first; an old Colmena's row without kind is to talk; expired ones are gone");
  assert.equal(pendingCodeLine(invites[0], NOW), "Para Ana · como invitado · caduca en 23 h");
  assert.equal(pendingCodeLine(invites[4], NOW), "Sin nombre · caduca en 1 h");
  assert.equal(expiresText(at(0.5), NOW), "Caduca en 30 min");
  assert.equal(expiresText(new Date(NOW + 20000).toISOString(), NOW), "Caduca en menos de un minuto");
  assert.equal(expiresText(at(-1), NOW), "Caducado");
});

test("why inviting cannot happen now, and the way out", () => {
  assert.equal(inviteBlock({ me: null }).kind, "preparing");
  const off = inviteBlock({ me: { name: "S" }, relay: { status: "off" } });
  assert.deepEqual([off.kind, off.title, off.action.label, off.action.href, off.codes, off.people], ["nomailbox", "Para invitar a gente, Colmena usa un buzón cifrado.", "Actívalo", "/ajustes/contactos#buzon", false, false]);
  const offline = inviteBlock({ me: { name: "S" }, relay: { status: "offline" } });
  assert.deepEqual([offline.kind, offline.codes, offline.people], ["offline", false, true], "people you reach still get it when the mailbox is back");
  assert.equal(inviteBlock({ me: { name: "S" }, relay: { status: "online" } }), null);
  assert.equal(inviteBlock({ me: { name: "S" }, relay: { status: "off" } }, { talk: true }).title, "Para escribir a otras personas, Colmena usa un buzón cifrado.");
});

test("what a pasted code is, and where accepting takes you", () => {
  const team = joinView({ name: "Sergio Rico", team: "Acme", room: null });
  assert.deepEqual([team.kind, team.title, team.confirm, team.from], ["team", "Sergio Rico te invita al equipo «Acme»", "Coinciden · entrar en «Acme»", "Sergio"]);
  const room = joinView({ name: "Sergio Rico", room: "ventas" });
  assert.deepEqual([room.kind, room.title, room.confirm], ["room", "Sergio Rico te invita a la sala #ventas", "Coinciden · entrar en #ventas"]);
  assert.match(room.text, /a partir de ahora, no lo anterior/);
  const person = joinView({ name: "Sergio Rico" });
  assert.deepEqual([person.kind, person.confirm, person.done], ["person", "Coinciden · conectar con Sergio", "Ya puedes escribirte con Sergio"]);
  assert.equal(joinView({ name: "S", team: "Acme", room: "general" }).kind, "team", "a team wins over a room");
  assert.equal(joinView(null).kind, "person");
  // Errors in words: expired, used or revoked; the mailbox out of reach.
  assert.match(joinError({ status: 404, message: "" }), /caducó, ya se usó o lo revocaron/);
  assert.match(joinError({ status: 502, message: "x" }), /No se pudo consultar el buzón/);
  assert.match(joinError({ message: "Failed to fetch" }), /No se pudo consultar el buzón/);
  assert.equal(joinError({ status: 409, message: "Ya estás en ese equipo." }), "Ya estás en ese equipo.");
});

test("a direct conversation's menu says what each choice means", () => {
  const m = dmMenu({ name: "Marta Ruiz" });
  assert.deepEqual([m.profile, m.mute, m.archive, m.remove], ["Ver perfil", "Silenciar", "Archivar", "Quitar de contactos"]);
  assert.match(m.muteHint, /Los mensajes de Marta siguen llegando/);
  assert.match(m.archiveHint, /hasta que alguno de los dos escriba/);
  assert.equal(m.removeTitle, "¿Quitar a Marta de tus contactos?");
  assert.match(m.removeText, /seguiréis viéndoos en sus salas[\s\S]*otra invitación/);
  assert.equal(dmMenu({ name: "Marta", muted: true }).mute, "Volver a avisarme");
});
