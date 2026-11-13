// The rules of teams and of the rosters of shared rooms (server/peers/teams.mjs,
// server/peers/service.mjs, docs/PEOPLE.md › Equipos): real Colmenas over a local mailbox
// (tests/fixtures/people-world.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { addr, team, until, world } from "./fixtures/people-world.mjs";
import { verifyTeamRoster } from "../server/peers/protocol.mjs";

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
