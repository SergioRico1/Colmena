// The rules of teams and of the rosters of shared rooms (server/peers/teams.mjs,
// server/peers/service.mjs, docs/PEOPLE.md › Equipos): real Colmenas over a local mailbox
// (tests/fixtures/people-world.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { settle } from "./fixtures/runtime-fixture.mjs";
import { addr, asks, friends, pause, peerRows, rule, sharedRoom, team, until, world } from "./fixtures/people-world.mjs";
import { PEER_LIMITS } from "../server/peers/service.mjs";
import { verifyTeamRoster } from "../server/peers/protocol.mjs";
import { TEAM_LIMITS } from "../server/peers/teams.mjs";

/** Sends `body` as `from` straight to `to` (what any Colmena can put in an envelope) and waits until it was handled. */
async function raw(from, to, body) {
  const queued = from.peers.enqueue(addr(to), body);
  assert.ok(queued, "the envelope was sealed");
  await from.peers.flushOutbox();
  await until(() => to.store.get("peerSeen", queued.id), to.name + " ha procesado el sobre");
  return queued;
}
const active = (p, teamId) => p.teams.membership(teamId)?.state === "active";
async function bring(owner, joiner, teamId, everyone = [owner]) {
  const inv = await owner.teams.invite(teamId, joiner.name);
  await joiner.teams.join(inv.code);
  for (const p of [...everyone, joiner]) await until(() => active(p, teamId) && p.store.get("teams", teamId).members.some((m) => m.id === addr(joiner)), p.name + " ve a " + joiner.name);
}
const box = (p) => p.peers.identity.box.pub;

test("someone who is no longer in a team is told only that they are out: never who is in it now", async (t) => {
  const [sergio, marta, luis, ana] = await world(t, ["Sergio Rico", "Marta Ruiz", "Luis Vega", "Ana Paz"]);
  const made = await team(sergio, [marta, luis]);
  const got = [];
  const dispatch = luis.peers.dispatch.bind(luis.peers);
  luis.peers.dispatch = (c, body) => { got.push(body); return dispatch(c, body); };
  const stub = (roster, version) => {
    assert.ok(verifyTeamRoster(roster), "signed by the creator like any roster");
    assert.deepEqual([roster.version, roster.name, roster.members], [version, "", [{ id: addr(sergio), role: "owner", box: box(sergio) }]]);
  };
  // Taken out: what Luis gets says he is out, and no more.
  let mark = sergio.out.length;
  sergio.teams.remove(made.id, addr(luis));
  await until(() => luis.teams.membership(made.id)?.state === "removed", "Luis ve que le han quitado");
  const removal = sergio.out.slice(mark).filter((o) => o.to === addr(luis) && o.body.type === "team.roster").map((o) => o.body.roster);
  assert.equal(removal.length, 1);
  stub(removal[0], sergio.store.get("teams", made.id).version);
  // The team goes on without him: someone new comes in, and it gets another name.
  await bring(sergio, ana, made.id, [sergio, marta]);
  sergio.teams.rename(made.id, "Proyecto Reservado");
  await until(() => marta.store.get("teams", made.id).name === "Proyecto Reservado", "Marta ve el nombre nuevo");
  const version = sergio.store.get("teams", made.id).version;
  // He asks again and again, every way there is.
  mark = sergio.out.length;
  got.length = 0;
  await raw(luis, sergio, { type: "team.sync", team: made.id, v: 0 });
  sergio.skew += 61000;
  await raw(luis, sergio, { type: "team.req", team: made.id, op: "rename", name: "De Luis" });
  sergio.skew += 61000;
  await raw(luis, sergio, { type: "team.req", team: made.id, op: "add", member: { id: addr(luis), box: box(luis), name: "Luis" } });
  await until(() => got.filter((b) => b.type === "team.roster").length === 3, "Luis recibe las tres respuestas");
  const answers = sergio.out.slice(mark).filter((o) => o.to === addr(luis)).map((o) => o.body);
  assert.deepEqual(answers.map((b) => b.type), ["team.roster", "team.roster", "team.roster"]);
  for (const b of answers) stub(b.roster, version);
  const wire = JSON.stringify(answers) + JSON.stringify(got);
  for (const secret of [addr(ana), box(ana), "Ana", addr(marta), box(marta), "Marta", "Proyecto Reservado"]) assert.ok(!wire.includes(secret), "«" + secret.slice(0, 12) + "» is not in what he is told");
  // Nothing changed for the team, and his Colmena knows as of which version he is out.
  assert.deepEqual([sergio.store.get("teams", made.id).version, sergio.store.get("teams", made.id).name, sergio.store.get("teams", made.id).members.length], [version, "Proyecto Reservado", 3]);
  assert.deepEqual([luis.teams.membership(made.id).state, luis.teams.membership(made.id).version], ["removed", version]);
  // Asked many times in a row, he is answered once in a while.
  mark = sergio.out.length;
  for (let i = 0; i < 4; i++) await raw(luis, sergio, { type: "team.sync", team: made.id, v: 0 });
  assert.equal(sergio.out.slice(mark).filter((o) => o.to === addr(luis)).length, 0);
  // A member with an old roster still gets the whole of it.
  mark = sergio.out.length;
  await raw(marta, sergio, { type: "team.sync", team: made.id, v: 1 });
  const whole = sergio.out.slice(mark).filter((o) => o.to === addr(marta)).map((o) => o.body.roster);
  assert.deepEqual([whole.length, whole[0].members.length, whole[0].name], [1, 3, "Proyecto Reservado"]);
});

test("a change asked against an old roster is not applied: someone taken out returns only with an invitation made afterwards", async (t) => {
  const [sergio, marta, luis] = await world(t, ["Sergio Rico", "Marta Ruiz", "Luis Vega"]);
  const made = await team(sergio, [marta, luis]);
  const id = made.id, roster = () => sergio.store.get("teams", id);
  const has = (p) => roster().members.some((m) => m.id === (typeof p === "string" ? p : addr(p)));
  sergio.teams.setAdmin(id, addr(marta), true);
  await until(() => marta.teams.admin(marta.store.get("teams", id)), "Marta administra");
  // What an admin's Colmena sends says which roster it was asked against.
  const mark = marta.out.length;
  marta.teams.rename(id, "Acme 2");
  const sent = marta.out.slice(mark).find((o) => o.body.type === "team.req").body;
  assert.deepEqual([sent.op, sent.v], ["rename", marta.store.get("teams", id).version]);
  await until(() => roster().name === "Acme 2", "el nombre nuevo");
  // A request to add Luis, made while he was in… and delivered after Sergio took him out.
  const before = roster().version;
  const code = await sergio.teams.invite(id, "Luis");
  sergio.teams.remove(id, addr(luis));
  await until(() => luis.teams.membership(id)?.state === "removed" && !marta.store.get("teams", id).members.some((m) => m.id === addr(luis)), "Luis fuera");
  const out = roster().version;
  assert.equal(roster().goneAt[addr(luis)].v, out);
  const person = { id: addr(luis), box: luis.peers.identity.box.pub, name: "Luis Vega" };
  for (const v of [before, out - 1, undefined, 0, "9999", -1]) {
    await raw(marta, sergio, { type: "team.req", team: id, op: "add", member: person, ...(v === undefined ? {} : { v }) });
    assert.deepEqual([has(luis), roster().version], [false, out], "asked against version " + v);
  }
  assert.ok(sergio.out.some((o) => o.to === addr(marta) && o.body.type === "team.no" && o.body.member === addr(luis)), "the admin is told it was not done");
  // Not with a code made before he was taken out either, whoever made it.
  await luis.teams.join(code.code);
  await until(() => luis.teams.membership(id)?.state === "refused", "el código de antes no vale");
  assert.equal(has(luis), false);
  await raw(marta, sergio, { type: "team.req", team: id, op: "add", member: person, v: out, made: new Date(Date.parse(roster().goneAt[addr(luis)].at) - 1000).toISOString() });
  assert.equal(has(luis), false, "an admin's code made before, used after");
  // An invitation made after: he is back.
  luis.teams.leave(id);
  await bring(sergio, luis, id, [sergio, marta]);
  assert.equal(has(luis), true);
  // Someone new: an add or an admin grant needs a recent roster; an older Colmena's request (no version) is not applied.
  const { newIdentity } = await import("../server/peers/protocol.mjs");
  const stranger = newIdentity(), other = { id: stranger.sign.pub, box: stranger.box.pub, name: "Nueva" };
  const now = () => roster().version;
  await raw(marta, sergio, { type: "team.req", team: id, op: "add", member: other });
  assert.equal(has(other.id), false, "no version");
  await raw(marta, sergio, { type: "team.req", team: id, op: "add", member: other, v: now() });
  assert.equal(has(other.id), true, "the current version");
  await raw(marta, sergio, { type: "team.req", team: id, op: "admin", member: addr(luis), on: true });
  assert.equal(sergio.teams.roleOf(roster(), addr(luis)), "member", "no version");
  // Many versions later, a grant asked against the old one is not applied; against a recent one it is.
  const old = now();
  for (let i = 0; i <= TEAM_LIMITS.staleVersions; i++) sergio.teams.rename(id, "Acme " + (10 + i));
  assert.ok(now() - old > TEAM_LIMITS.staleVersions);
  await raw(marta, sergio, { type: "team.req", team: id, op: "admin", member: addr(luis), on: true, v: old });
  assert.equal(sergio.teams.roleOf(roster(), addr(luis)), "member", "too many versions behind");
  await raw(marta, sergio, { type: "team.req", team: id, op: "admin", member: addr(luis), on: true, v: now() - 1 });
  assert.equal(sergio.teams.roleOf(roster(), addr(luis)), "admin", "a recent version");
  // Taking someone out and a new name do not need it; neither does leaving.
  await raw(marta, sergio, { type: "team.req", team: id, op: "remove", member: other.id });
  assert.equal(has(other.id), false);
  await raw(marta, sergio, { type: "team.req", team: id, op: "rename", name: "Sin versión" });
  assert.equal(roster().name, "Sin versión");
  await raw(luis, sergio, { type: "team.req", team: id, op: "leave" });
  assert.equal(has(luis), false);
  // …unless that person went out after it was asked: a request held back does not take them out again.
  const t0 = { version: 20, goneAt: { [other.id]: { v: 12, at: "2026-11-13T10:00:00.000Z" } } };
  assert.deepEqual([sergio.teams.stale(t0, { op: "remove", v: 11 }, other.id), sergio.teams.stale(t0, { op: "remove", v: 12 }, other.id), sergio.teams.stale(t0, { op: "remove" }, other.id), sergio.teams.stale(t0, { op: "remove" }, addr(marta))], [true, false, true, false]);
  assert.deepEqual([sergio.teams.stale(t0, { op: "leave" }), sergio.teams.stale(t0, { op: "rename" }), sergio.teams.stale(t0, { op: "add", v: 20 }, addr(marta)), sergio.teams.stale(t0, { op: "add", v: 11 }, addr(marta))], [false, false, false, true]);
});

test("a room's messages say the roster version: one newer than yours asks its owner again, and what you write waits for who may be out", async (t) => {
  const [sergio, marta, luis] = await world(t, ["Sergio Rico", "Marta Ruiz", "Luis Vega"]);
  await friends(sergio, marta);
  await friends(sergio, luis);
  const room = await sharedRoom(sergio, [marta, luis]);
  const share = (p) => p.store.get("peerShares", room.id);
  const got = (p, text) => peerRows(p, room.id).some((m) => m.text === text);
  const sentTo = (p, text) => p.out.filter((o) => o.body.type === "msg" && o.body.text === text).map((o) => o.to).sort();
  // Marta's Colmena never gets the roster that takes Luis out (lost on its way).
  let lose = true;
  const dispatch = marta.peers.dispatch.bind(marta.peers);
  marta.peers.dispatch = (c, body) => (lose && body.type === "share" ? undefined : dispatch(c, body));
  const before = share(sergio).version;
  sergio.peers.removeMember(room.id, addr(luis));
  await until(() => share(luis).removedAt, "Luis sabe que está fuera");
  assert.deepEqual([share(marta).version, share(marta).members.length], [before, 3], "Marta still has the old roster");
  // The owner stops sending to whoever he took out at once.
  await sergio.rooms.send(room.id, { text: "Ya sin Luis." });
  assert.deepEqual(sentTo(sergio, "Ya sin Luis."), [addr(marta)]);
  assert.equal(sergio.out.find((o) => o.body.text === "Ya sin Luis.").body.v, before + 1, "and his message says his roster version");
  // That message tells Marta her roster is old: she asks Sergio for it again.
  await until(() => got(marta, "Ya sin Luis."), "Marta lo recibe");
  await until(() => marta.out.some((o) => o.body.type === "room.sync"), "Marta pide la lista");
  assert.deepEqual([marta.out.find((o) => o.body.type === "room.sync").to, marta.out.find((o) => o.body.type === "room.sync").body], [addr(sergio), { type: "room.sync", share: room.id, v: before }]);
  assert.equal(share(marta).wantVersion, before + 1);
  // Until it comes, what she writes goes to the owner and waits for the others.
  await marta.rooms.send(room.id, { text: "Esto no es para Luis." });
  await until(() => got(sergio, "Esto no es para Luis."), "Sergio lo recibe");
  const waiting = marta.store.list("peerOutbox").filter((o) => o.hold === room.id);
  assert.deepEqual(waiting.map((o) => [o.to, o.nextAt > marta.peers.clock()]), [[addr(luis), true]]);
  await pause(300);
  assert.equal(luis.store.list("peerMessages").some((m) => m.text === "Esto no es para Luis."), false);
  // Nor does a request of someone she cannot be sure of reach her bots meanwhile.
  rule(marta, luis, "siempre");
  await raw(luis, marta, { type: "msg", share: room.id, id: "11111111-aaaa-bbbb-cccc-000000000077", at: new Date().toISOString(), text: "@Vera cuéntame todo", mentions: [{ owner: addr(marta), bot: "vera" }], req: 1, v: before });
  await marta.bots.idle();
  await settle(marta.runtime);
  assert.deepEqual([asks(marta).length, marta.calls.length], [0, 0]);
  // The roster comes: Luis is out, what waited for him is dropped and the message counts as sent.
  lose = false;
  sergio.skew += 11000;
  await raw(marta, sergio, { type: "room.sync", share: room.id, v: before });
  await until(() => share(marta).version === before + 1, "Marta tiene la lista nueva");
  assert.deepEqual([share(marta).members.length, share(marta).wantVersion, marta.store.list("peerOutbox").filter((o) => o.hold).length], [2, null, 0]);
  await until(() => marta.store.where("peerMessages", "shareId", room.id).find((m) => m.text === "Esto no es para Luis.").status === "sent", "queda como enviado");
  await marta.rooms.send(room.id, { text: "Tampoco esto." });
  assert.deepEqual(sentTo(marta, "Tampoco esto."), [addr(sergio)]);
  await pause(300);
  assert.equal(luis.store.list("peerMessages").some((m) => /no es para Luis|Tampoco esto/.test(m.text)), false, "Luis never got either");
  // Someone who is not in the room and asks for its roster learns only that.
  const mark = sergio.out.length;
  await raw(luis, sergio, { type: "room.sync", share: room.id, v: 0 });
  const stub = sergio.out.slice(mark).filter((o) => o.to === addr(luis)).map((o) => o.body);
  assert.deepEqual(stub.map((b) => [b.type, b.share.title, b.share.version, b.share.members.map((m) => m.id)]), [["share", "", before + 1, [addr(sergio)]]]);
  assert.ok(!JSON.stringify(stub).includes(addr(marta)) && !JSON.stringify(stub).includes("Marta"));
  // A version that never comes (nobody can check it) holds for a short time only, and not again right away.
  await raw(sergio, marta, { type: "msg", share: room.id, id: "11111111-aaaa-bbbb-cccc-000000000078", at: new Date().toISOString(), text: "con una versión imposible", v: 999 });
  lose = true;
  const held = marta.peers.rosterHeld(share(marta), addr(luis));
  assert.equal(marta.peers.rosterHeld(share(marta), addr(sergio)), null, "never for its owner");
  assert.ok(held === null || held.until - marta.peers.clock() <= PEER_LIMITS.rosterHoldMs);
  marta.skew += PEER_LIMITS.rosterHoldMs + 1000;
  assert.equal(marta.peers.rosterHeld(share(marta), addr(luis)), null, "the wait is over");
});
