import test from "node:test";
import assert from "node:assert/strict";
import {
  adminNames, avatarOf, canInvite, canMakeAdmin, canMessage, canRemove, canRename, canUnmakeAdmin, codeKind, countLine, creatorName, currentTeam,
  findCode, isAdmin, leaveText, listNames, pendingLine, presenceWords, realTeams, removeText, roleLabel, roomHint, roomPayload, roomPeople,
  sortMembers, untilText, waitingFor, waitingLine, waitingRest,
} from "../src/lib/teams.js";
import { teamHeader } from "../src/lib/sidebar.js";

const A = (n) => String(n).repeat(43);
// A team as GET /api/teams/:id gives it (server/peers/teams.mjs › view).
const sergio = { address: A("s"), name: "Sergio Rico", role: "creador", presence: "online", status: { mode: "available", until: null }, bots: [{ id: "atlas", name: "Atlas", role: "Coordinación", color: "#12131A", shape: "hex" }], you: false, contact: true, dm: "dm-1" };
const marta = { address: A("m"), name: "Marta Gil", role: "admin", presence: "offline", status: { mode: "available", until: null }, bots: [], you: true, contact: false, dm: null };
const luis = { address: A("l"), name: "Luis Vega", role: "miembro", presence: "offline", status: { mode: "dnd", until: null }, bots: [], you: false, contact: false, dm: null };
const ana = { address: A("a"), name: "Ana Díaz", role: "admin", presence: "online", status: { mode: "available", until: null }, bots: [], you: false, contact: false, dm: null };
const members = [luis, sergio, ana, marta];

test("roles: their words and who administers", () => {
  assert.deepEqual(["creador", "admin", "miembro", "otro"].map(roleLabel), ["Creador", "Administrador", "Miembro", "Miembro"]);
  assert.deepEqual(["creador", "admin", "miembro", null].map(isAdmin), [true, true, false, false]);
});

test("what each role may do to each member", () => {
  // The creator and the admins invite and rename; a member does not.
  assert.deepEqual(["creador", "admin", "miembro"].map(canInvite), [true, true, false]);
  assert.deepEqual(["creador", "admin", "miembro"].map(canRename), [true, true, false]);
  // Nobody removes the creator or themselves; a member removes nobody.
  assert.equal(canRemove("admin", sergio), false);
  assert.equal(canRemove("admin", marta), false, "you leave, you are not removed");
  assert.equal(canRemove("admin", luis), true);
  assert.equal(canRemove("admin", ana), true);
  assert.equal(canRemove("miembro", luis), false);
  assert.equal(canRemove("creador", null), false);
  // Admin is given to a member and taken from an admin; the creator always administers.
  assert.equal(canMakeAdmin("creador", luis), true);
  assert.equal(canMakeAdmin("creador", ana), false);
  assert.equal(canMakeAdmin("miembro", luis), false);
  assert.equal(canUnmakeAdmin("creador", ana), true);
  assert.equal(canUnmakeAdmin("admin", sergio), false);
  assert.equal(canUnmakeAdmin("admin", marta), false, "not on yourself");
  assert.equal(canUnmakeAdmin("miembro", ana), false);
  // A direct message goes to anyone else with an address.
  assert.equal(canMessage(luis), true);
  assert.equal(canMessage(marta), false);
  assert.equal(canMessage({ ...luis, address: null }), false);
});

test("members: you first, then the creator, the admins and the rest by name", () => {
  assert.deepEqual(sortMembers(members).map((m) => m.name), ["Marta Gil", "Sergio Rico", "Ana Díaz", "Luis Vega"]);
  assert.deepEqual(sortMembers(members, { youFirst: false }).map((m) => m.name), ["Sergio Rico", "Ana Díaz", "Marta Gil", "Luis Vega"]);
  const more = [{ name: "zoe", role: "miembro" }, { name: "Álvaro", role: "miembro" }, { name: "berta", role: "miembro" }];
  assert.deepEqual(sortMembers(more).map((m) => m.name), ["Álvaro", "berta", "zoe"], "accents and case do not decide");
  assert.equal(members[0], luis, "the list it was given is left as it was");
  assert.deepEqual(adminNames(members), ["Sergio", "Ana", "tú"]);
  assert.equal(listNames(["Sergio", "Ana", "tú"]), "Sergio, Ana y tú");
  assert.equal(listNames(["Sergio"]), "Sergio");
  assert.equal(creatorName(members), "Sergio");
  assert.equal(creatorName([{ ...sergio, you: true }]), "tú");
  assert.equal(creatorName([]), "quien creó el equipo");
});

test("the team list: «solo» is not a team; the header says «Solo tú»", () => {
  const solo = [{ id: "solo", name: "Sergio", people: 1, bots: 3, admin: true, current: true }];
  assert.deepEqual(realTeams(solo), []);
  assert.equal(currentTeam(solo), null);
  assert.equal(realTeams(null).length, 0);
  const header = teamHeader(realTeams(solo), { bots: 3 });
  assert.deepEqual([header.solo, header.id, header.line], [true, null, "Solo tú · 3 bots"]);
  const two = [{ id: "t-1", name: "Acme", people: 3, bots: 7, admin: false, current: false }, { id: "t-2", name: "Lab", people: 1, bots: 1, admin: true, current: true }];
  assert.equal(currentTeam(two).id, "t-2");
  assert.equal(currentTeam([two[0]]).id, "t-1", "without a current one, the first");
  assert.equal(countLine(two[0]), "3 personas · 7 bots");
  assert.equal(countLine(two[1]), "1 persona · 1 bot");
  const shown = teamHeader(realTeams(two), { bots: 3 });
  assert.deepEqual([shown.solo, shown.name, shown.admin, shown.others.map((t) => t.name)], [false, "Lab", true, ["Acme"]]);
});

test("presence and status in words", () => {
  const now = new Date(2026, 10, 12, 10, 0).getTime();
  assert.deepEqual(presenceWords(sergio, now), { online: true, mode: "available", text: "En línea" });
  assert.equal(presenceWords(marta, now).text, "Sin conexión");
  assert.equal(presenceWords(luis, now).text, "No molestar");
  const until = new Date(2026, 10, 12, 18, 0).toISOString();
  assert.equal(presenceWords({ ...luis, status: { mode: "dnd", until } }, now).text, "No molestar · hasta las 18:00");
  assert.equal(presenceWords({ ...luis, presence: "online", status: { mode: "away", until: new Date(2026, 10, 13, 9, 0).toISOString() } }, now).text, "Fuera hasta mañana a las 09:00");
  assert.match(presenceWords({ ...luis, status: { mode: "away", until: new Date(2026, 10, 16, 9, 0).toISOString() } }, now).text, /^Fuera hasta el lunes,? 16$/);
  // A status that ran out is no status.
  assert.equal(presenceWords({ ...luis, presence: "online", status: { mode: "dnd", until: new Date(2026, 10, 12, 9, 0).toISOString() } }, now).text, "En línea");
  assert.equal(presenceWords(null, now).text, "Sin conexión");
  assert.equal(untilText(null, now), "");
  assert.deepEqual(avatarOf(marta, now), { me: true, initials: "MG", color: "#E6E7EC", online: false, away: null });
  assert.deepEqual(avatarOf(luis, now).away, { mode: "dnd" });
});

test("what waits for the creator is said in words", () => {
  const waiting = [{ op: "remove", address: luis.address, at: "x" }, { op: "rename", at: "x" }, { op: "admin", address: ana.address, at: "x" }, { op: "add", address: A("n"), at: "x" }];
  assert.equal(waitingLine(waiting[0], members), "Quitar a Luis · pendiente: se aplicará cuando Sergio se conecte");
  assert.equal(waitingLine(waiting[1], members), "Cambiar el nombre · pendiente: se aplicará cuando Sergio se conecte");
  assert.equal(waitingLine(waiting[2], members), "Cambiar si Ana administra · pendiente: se aplicará cuando Sergio se conecte");
  assert.equal(waitingLine(waiting[3], members), "Añadir a una persona · pendiente: se aplicará cuando Sergio se conecte");
  assert.match(waitingLine({ op: "otra" }, []), /^Un cambio · pendiente: se aplicará cuando quien creó el equipo se conecte$/);
  assert.deepEqual(waitingFor(waiting, luis.address).map((w) => w.op), ["remove"]);
  assert.deepEqual(waitingFor(waiting, null), []);
  assert.deepEqual(waitingRest(waiting, members).map((w) => w.op), ["rename", "add"], "the team's own and people not in the list yet");
});

test("leaving says what happens: the creator closes the team for everyone", () => {
  const team = { name: "Acme", people: 4 };
  const member = leaveText(team, "miembro");
  assert.equal(member.action, "Salir del equipo");
  assert.match(member.text, /Dejarás de ver «general» y las salas de «Acme»/);
  assert.match(member.text, /otra invitación/);
  const creator = leaveText(team, "creador");
  assert.equal(creator.action, "Cerrar el equipo");
  assert.equal(creator.title, "¿Cerrar «Acme» para todos?");
  assert.match(creator.text, /se cierra para las otras 3 personas/);
  assert.match(creator.text, /No se puede deshacer/);
  assert.match(leaveText({ name: "Acme", people: 2 }, "creador").text, /para la otra persona/);
  assert.match(leaveText({ name: "Acme", members: [sergio] }, "creador").text, /«Acme» se cierra\./);
  assert.equal(leaveText(team, "admin").action, "Salir del equipo", "an admin just leaves");
  assert.deepEqual(removeText(team, luis), { title: "¿Quitar a Luis de «Acme»?", confirm: "Quitar a Luis", text: "Luis dejará de ver «general» y las salas del equipo. Lo que ya se escribió se queda en su Colmena." });
});

test("teams you asked to join", () => {
  assert.deepEqual([pendingLine({ state: "joining" }).refused, pendingLine({ state: "joining" }).action], [false, "Cancelar la petición"]);
  assert.match(pendingLine({ state: "refused", reason: "full" }).text, /completo/);
  assert.match(pendingLine({ state: "refused", reason: "refused" }).text, /otra invitación/);
  assert.equal(pendingLine({ state: "refused", reason: null }).action, "Descartar");
});

test("the join field finds the code in whatever is pasted", () => {
  assert.equal(findCode("COLMENA-AB12-CD34-EF56-GH78"), "COLMENA-AB12-CD34-EF56-GH78");
  assert.equal(findCode("  colmena ab12 cd34 ef56 gh78 "), "COLMENA-AB12-CD34-EF56-GH78");
  assert.equal(findCode("ab12cd34ef56gh78"), "COLMENA-AB12-CD34-EF56-GH78", "without the word");
  assert.equal(findCode("Hola, soy Sergio. Entra en mi equipo con este código:\nCOLMENA-AB12-CD34-EF56-GH78\nDescarga Colmena en https://example.com"), "COLMENA-AB12-CD34-EF56-GH78");
  assert.equal(findCode("COLMENA-AB12-CD34"), null);
  assert.equal(findCode("hola qué tal"), null);
  assert.equal(findCode(""), null);
  // What the server takes: 16 to 60 characters (POST /api/teams/join).
  assert.ok(findCode("ab12cd34ef56gh78").length >= 16 && findCode("ab12cd34ef56gh78").length <= 60);
});

test("what a code is for, before you confirm", () => {
  const team = codeKind({ name: "Sergio Rico", team: "Acme", room: null, words: [] });
  assert.deepEqual([team.kind, team.title, team.confirm, team.from], ["team", "Entrar en el equipo «Acme»", "Coinciden · entrar en «Acme»", "Sergio"]);
  const room = codeKind({ name: "Sergio Rico", team: null, room: "ventas" });
  assert.deepEqual([room.kind, room.title], ["room", "Sergio Rico te invita a la sala «ventas»"]);
  assert.match(room.text, /No es una invitación a un equipo/);
  const person = codeKind({ name: "Sergio Rico", team: null, room: null });
  assert.deepEqual([person.kind, person.confirm], ["person", "Coinciden · conectar con Sergio"]);
  // A team wins over a room: that code goes to /api/teams/join.
  assert.equal(codeKind({ name: "S", team: "Acme", room: "general" }).kind, "team");
  assert.equal(codeKind(null).kind, "person");
});

test("«Nueva sala»: who can go in and what is sent", () => {
  const team = { members };
  assert.deepEqual(roomPeople({ team }).map((p) => p.name), ["Ana Díaz", "Luis Vega", "Sergio Rico"], "teammates, not you, by name");
  assert.deepEqual(roomPeople({ team })[0], { address: ana.address, name: "Ana Díaz", online: true });
  const contacts = [{ id: A("c"), name: "Carla", status: "active", online: true }, { id: A("p"), name: "Pendiente", status: "pending" }, { id: A("k"), name: "Conocida", status: "known" }];
  assert.deepEqual(roomPeople({ contacts }).map((p) => p.name), ["Carla"], "a private room: only people you talk to");
  assert.deepEqual(roomPeople({ team, contacts }).length, 3, "a team's room ignores your contacts");
  assert.deepEqual(roomPeople(), []);

  assert.deepEqual(roomPayload({ title: "  lanzamiento   web " }), { title: "lanzamiento web" }, "private: nothing else");
  assert.deepEqual(roomPayload({ title: "x", team: "solo" }), { title: "x" });
  assert.deepEqual(roomPayload({ title: "x", team: "t-1", botIds: ["atlas", "atlas", "vera"], people: [ana.address] }), { title: "x", team: "t-1", botIds: ["atlas", "vera"], people: [ana.address] });
  assert.equal(roomPayload({ title: "x", botIds: ["a", "b", "c", "d", "e", "f", "g"] }).botIds.length, 6);
  assert.equal(roomPayload({ title: "y".repeat(90) }).title.length, 60);

  assert.match(roomHint({ teamName: "Acme", people: 2, bots: 1 }), /^Sala de «Acme» con 2 personas y 1 bot tuyo\./);
  assert.match(roomHint({ people: 1 }), /^Sala privada con 1 persona\./);
  assert.match(roomHint({ bots: 2 }), /^Sala privada con 2 bots tuyos: solo tú y tus bots/);
  assert.match(roomHint(), /^Sala privada: solo tú y tus bots/);
});
