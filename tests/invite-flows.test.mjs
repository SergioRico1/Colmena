// Inviting people, as the one «Invitar» sheet uses it (docs/CONTRACT.md §18, docs/PEOPLE.md):
// what each open code is for and its message again, revoking, what a pasted code is, a room's
// roles, the neutral «Pendiente» of whoever asked the owner, the owner's request in the one count
// of what waits, and a conversation silenced or archived on this computer only.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { addr, friends, pause, sharedRoom, team, until, world } from "./fixtures/people-world.mjs";
import { waitingItems } from "../server/waiting.mjs";
import { dmId } from "../server/peers/service.mjs";

test("each open code says what it opens, can be copied again and stops working when revoked", async (t) => {
  const [sergio, marta] = await world(t, ["Sergio Rico", "Marta Ruiz"]);
  const room = sergio.rooms.create({ title: "Diseño" });
  const forRoom = await sergio.rooms.invite(room.id, { invite: { name: "Ana López", role: "guest" } });
  const forTalk = await sergio.peers.createInvite("Luis");
  const acme = sergio.teams.create("Acme");
  const forTeam = await sergio.teams.invite(acme.id, "Eva");
  const rows = sergio.peers.stateView().invites;
  const of = (id) => rows.find((r) => r.id === id);
  assert.deepEqual([of(forRoom.invite.id).kind, of(forRoom.invite.id).room, of(forRoom.invite.id).roomTitle, of(forRoom.invite.id).role], ["room", room.id, room.title, "guest"]);
  assert.deepEqual([of(forTalk.id).kind, of(forTalk.id).room, of(forTalk.id).team], ["person", null, null]);
  assert.deepEqual([of(forTeam.id).kind, of(forTeam.id).team], ["team", acme.id]);
  // «Copiar de nuevo»: the same code and its message, which names where it leads.
  const again = sergio.peers.inviteView(forRoom.invite.id);
  assert.equal(again.code, forRoom.invite.code);
  assert.match(again.text, /^Hola Ana, soy Sergio Rico\. Te invito a la sala #diseno en Colmena\./);
  assert.match(again.text, /«Unirme con un código»/);
  assert.match(sergio.peers.inviteView(forTeam.id).text, /Te invito al equipo «Acme»/);
  // What a pasted code is, before saying yes: its kind and who made it.
  const preview = await marta.peers.previewInvite(forRoom.invite.code);
  assert.deepEqual([preview.kind, preview.room, preview.address, preview.words.length], ["room", room.title, addr(sergio), 4]);
  assert.equal((await marta.peers.previewInvite(forTeam.code)).kind, "team");
  assert.equal((await marta.peers.previewInvite(forTalk.code)).kind, "person");
  // «Revocar»: gone from the lists, from the mailbox, and it cannot be copied again.
  await sergio.peers.cancelInvite(forTalk.id);
  assert.equal(sergio.peers.stateView().invites.some((r) => r.id === forTalk.id), false);
  assert.throws(() => sergio.peers.inviteView(forTalk.id), (e) => e.status === 410 && /ya no sirve/.test(e.message));
  await assert.rejects(marta.peers.previewInvite(forTalk.code), (e) => e.status === 404 && /caducó \(duran 24 horas\), ya se usó o lo revocaron/.test(e.message));
});

test("a code past its 24 hours is refused in plain words", async (t) => {
  const people = await world(t, ["Sergio Rico", "Marta Ruiz"]);
  const [sergio, marta] = people;
  const inv = await sergio.peers.createInvite("Marta");
  // The mailbox's own clock decides: its card is marked as expired there.
  const db = new DatabaseSync(path.join(path.dirname(sergio.store.directory), "relay", "relay.sqlite"));
  db.prepare("UPDATE invites SET expires = ?").run(Date.now() - 1000);
  db.close();
  await assert.rejects(marta.peers.previewInvite(inv.code), (e) => e.status === 404 && /ya no sirve/.test(e.message));
});

test("the owner adds with a role; whoever is in already is said so", async (t) => {
  const [sergio, marta, luis] = await world(t, ["Sergio Rico", "Marta Ruiz", "Luis Gómez"]);
  await friends(sergio, marta);
  await friends(sergio, luis);
  const room = sergio.rooms.create({ title: "Prensa" });
  const first = await sergio.rooms.invite(room.id, { address: addr(marta), role: "guest" });
  assert.equal(first.added.role, "guest");
  assert.equal(first.room.people.find((p) => p.address === addr(marta)).role, "guest");
  const second = await sergio.rooms.invite(room.id, { address: addr(luis) });
  assert.equal(second.room.people.find((p) => p.address === addr(luis)).role, "member");
  await assert.rejects(sergio.rooms.invite(room.id, { address: addr(luis) }), (e) => e.status === 409 && /Luis Gómez ya está en la sala/.test(e.message));
});

test("«please add»: the requester sees it pending, the owner has it in what waits for them", async (t) => {
  const [sergio, marta, luis] = await world(t, ["Sergio Rico", "Marta Ruiz", "Luis Gómez"]);
  await friends(sergio, marta);
  await friends(marta, luis);
  const room = await sharedRoom(sergio, marta);
  await marta.rooms.invite(room.id, { address: addr(luis) });
  // Marta: neutral, it waits for Sergio. Never in her own count.
  assert.deepEqual(marta.rooms.detail(room.id).asked.map((a) => a.person.name), ["Luis Gómez"]);
  assert.equal(waitingItems(marta.store).some((i) => i.kind === "roomadd"), false);
  // Sergio: it waits for him, in that room.
  const request = await until(() => sergio.rooms.detail(room.id).requests?.[0], "Sergio tiene la petición");
  const item = waitingItems(sergio.store).find((i) => i.kind === "roomadd");
  assert.deepEqual([item.id, item.roomId, item.title, item.room], [request.id, room.id, "Marta pide añadir a Luis Gómez", room.title]);
  assert.equal(sergio.rooms.detail(room.id).asked, undefined, "the owner asks nobody");
  // «Ahora no»: Marta's pending line goes, and nothing waits for Sergio any more.
  sergio.rooms.decide(room.id, request.id, "decline");
  await until(() => !marta.rooms.detail(room.id).asked, "Marta deja de verlo pendiente");
  assert.equal(waitingItems(sergio.store).some((i) => i.kind === "roomadd"), false);
  // Asked again and «Añadir»: once Luis is in, it is no longer pending for Marta.
  await marta.rooms.invite(room.id, { address: addr(luis) });
  assert.equal(marta.rooms.detail(room.id).asked.length, 1);
  const again = await until(() => sergio.rooms.detail(room.id).requests?.[0], "otra petición");
  sergio.rooms.decide(room.id, again.id, "approve");
  await until(() => marta.rooms.detail(room.id).people.some((p) => p.address === addr(luis)), "Marta ve a Luis dentro");
  assert.equal(marta.rooms.detail(room.id).asked, undefined);
});

test("silencing and archiving a conversation stay on this computer", async (t) => {
  const [sergio, marta] = await world(t, ["Sergio Rico", "Marta Ruiz"]);
  await friends(sergio, marta);
  const dm = dmId(addr(sergio), addr(marta));
  const sent = () => marta.out.filter((o) => o.to === addr(sergio)).length;
  const before = sent();
  const view = sergio.peers.setSharePrefs(dm, { muted: true });
  assert.equal(view.muted, true);
  assert.equal(sent(), before, "nothing travels");
  const notices = sergio.notices.length;
  await marta.peers.post(dm, "¿Lo vemos mañana?");
  await until(() => sergio.peers.stateView().shares.find((s) => s.id === dm)?.unread === 1, "llega sin leer");
  await pause(100);
  assert.equal(sergio.notices.length, notices, "silenced: no notice");
  // Archived: out of the list until someone writes there again.
  sergio.peers.setSharePrefs(dm, { archived: true, muted: false });
  assert.equal(sergio.peers.stateView().shares.some((s) => s.id === dm), false);
  await marta.peers.post(dm, "Vale, a las diez.");
  await until(() => sergio.peers.stateView().shares.some((s) => s.id === dm), "vuelve al escribir");
  assert.ok(sergio.notices.length > notices, "no longer silenced");
});

test("a team's code is listed for its admins, by team", async (t) => {
  const [sergio, marta] = await world(t, ["Sergio Rico", "Marta Ruiz"]);
  const view = await team(sergio, [marta], "Estudio");
  await sergio.teams.invite(view.id, "Eva");
  assert.deepEqual(sergio.teams.view(view.id).invitations.map((i) => i.name), ["Eva"]);
  assert.deepEqual(sergio.peers.stateView().invites.filter((i) => i.team === view.id).map((i) => i.name), ["Eva"]);
});
