// «Equipos»: a roster of people signed by whoever created it (server/peers/teams.mjs), on
// real Colmenas over a local mailbox (relay/server.mjs), like tests/peers.test.mjs.
// Creating, joining with a code, leaving and closing; «general» following the team; admins
// asking the creator; teammates who are not contacts seeing each other's bots, presence and
// status; a direct conversation between teammates; what a forger, a removed member or a
// non-admin cannot do; an older Colmena; a restart in the middle of joining.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { Peers, dmId } from "../server/peers/service.mjs";
import { Teams, teamsList, TEAM_LIMITS } from "../server/peers/teams.mjs";
import { newIdentity, signTeamRoster, verifyTeamRoster, TEAM_MAX_MEMBERS } from "../server/peers/protocol.mjs";
import { startRelay } from "../relay/server.mjs";

const until = async (fn, what = "condición", ms = 10000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw Error("No llegó a cumplirse: " + what);
    await new Promise((r) => setTimeout(r, 30));
  }
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Starts (or starts again) someone's Colmena on their own store. `old`: one that knows no teams. */
async function boot(person, relay) {
  person.peers = new Peers({ store: person.store, vault: null, relayUrl: relay.url, nameOf: () => person.name, notifier: { notify: (n) => person.notices.push(n) }, log: () => {} });
  if (person.old) {
    // An older Colmena: no teams module, and every team message type falls through its dispatch.
    const dispatch = person.peers.dispatch.bind(person.peers);
    person.peers.dispatch = (c, body) => (String(body.type).startsWith("team.") ? undefined : dispatch(c, body));
    person.teams = null;
  } else {
    person.teams = new Teams({ peers: person.peers }).start();
  }
  await person.peers.start();
  await until(() => person.peers.relayStatus.status === "online", person.name + " conectado al buzón");
  return person;
}
async function world(t, names = ["Sergio Rico", "Marta Ruiz", "Luis Gómez"], { old = [] } = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), "colmena-teams-"));
  // Always the local mailbox: these tests never touch a deployed one.
  const relay = await startRelay({ port: 0, directory: path.join(base, "relay") });
  const people = [];
  for (const name of names) people.push(await boot({ name, store: new Store(path.join(base, name.split(" ")[0])), notices: [], old: old.includes(name) }, relay));
  t.after(async () => {
    for (const p of people) p.peers.stop();
    await pause(300); // in-flight mail settles
    for (const p of people) p.store.close();
    await relay.close();
    await rm(base, { recursive: true, force: true });
  });
  return { relay, people, base };
}
const addr = (p) => p.peers.address;
const inTeam = (p, teamId) => p.teams.membership(teamId)?.state === "active";
const rosterOf = (p, teamId) => p.store.get("teams", teamId);
const memberIn = (p, teamId, other) => p.teams.view(teamId).members.find((m) => m.address === addr(other));
/** `inviter` makes a code for the team and `joiner` uses it; done when everyone listed sees them in. */
async function bring(inviter, joiner, teamId, everyone = [inviter]) {
  const inv = await inviter.teams.invite(teamId, joiner.name);
  const out = joiner.teams ? await joiner.teams.join(inv.code) : await joiner.peers.acceptInvite(inv.code);
  for (const p of [...everyone, ...(joiner.teams ? [joiner] : [])]) await until(() => inTeam(p, teamId) && rosterOf(p, teamId).members.some((m) => m.id === addr(joiner)), p.name + " ve a " + joiner.name + " en el equipo");
  return { inv, out };
}
/** Sends `body` as `from` straight to `to` (what a tampered Colmena could do) and waits until it was handled. */
async function raw(from, to, body) {
  const queued = from.peers.enqueue(addr(to), body);
  assert.ok(queued, "the envelope was sealed");
  await from.peers.flushOutbox();
  await until(() => to.store.get("peerSeen", queued.id), to.name + " ha procesado el sobre");
}

test("a team roster holds only with its creator's signature and a sound shape", () => {
  const owner = newIdentity(), other = newIdentity();
  const member = (id, role = "member") => ({ id: id.sign.pub, role, box: id.box.pub, name: "x" });
  const base = { kind: "team", id: "11111111-2222-3333-4444-555555555555", name: "Acme", owner: owner.sign.pub, version: 3, room: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", at: "2026-11-12T10:00:00.000Z", members: [member(owner, "owner"), member(other)] };
  const signed = signTeamRoster(owner, base);
  assert.ok(verifyTeamRoster(signed));
  // Anything changed after signing, or signed by someone else, is nothing.
  assert.equal(verifyTeamRoster({ ...signed, name: "Otro" }), null);
  assert.equal(verifyTeamRoster({ ...signed, version: 4 }), null);
  assert.equal(verifyTeamRoster({ ...signed, members: [...signed.members, member(newIdentity())] }), null);
  assert.equal(verifyTeamRoster(signTeamRoster(other, base)), null);
  assert.equal(verifyTeamRoster({ ...base }), null);
  // Well signed but unsound: two owners, the same person twice, the creator missing, a group's kind, too many people.
  assert.equal(verifyTeamRoster(signTeamRoster(owner, { ...base, members: [member(owner, "owner"), member(other, "owner")] })), null);
  assert.equal(verifyTeamRoster(signTeamRoster(owner, { ...base, members: [member(owner, "owner"), member(other), member(other)] })), null);
  assert.equal(verifyTeamRoster(signTeamRoster(owner, { ...base, members: [member(other)] })), null);
  assert.equal(verifyTeamRoster(signTeamRoster(owner, { ...base, kind: "group" })), null);
  assert.equal(verifyTeamRoster(signTeamRoster(owner, { ...base, members: [member(owner, "owner"), ...Array.from({ length: TEAM_MAX_MEMBERS }, () => member(newIdentity()))] })), null);
  // A closed team has nobody.
  assert.ok(verifyTeamRoster(signTeamRoster(owner, { ...base, members: [], closed: true })));
  assert.equal(verifyTeamRoster(signTeamRoster(owner, { ...base, closed: true })), null);
});

test("alone there is one «solo» entry; creating a team gives it a «general» room; the API and /api/state carry it", async (t) => {
  const { people: [sergio] } = await world(t, ["Sergio Rico"]);
  const { store } = sergio;
  const bots = store.list("bots").filter((b) => b.enabled !== false).length;
  assert.deepEqual(teamsList(store, sergio.peers), [{ id: "solo", name: store.get("settings", "main").spaceName, people: 1, bots, admin: true, current: true }]);
  // Without a name for the space, the person's.
  const spaceName = store.get("settings", "main").spaceName;
  store.patch("settings", "main", { spaceName: "" });
  assert.equal(teamsList(store, sergio.peers)[0].name, "Sergio Rico");
  // Before «Personas» has its keys the entry is there too.
  assert.equal(teamsList(store, null)[0].id, "solo");
  store.patch("settings", "main", { spaceName });

  const runtime = new Runtime(store, { respond: async () => { throw Error("No provider calls here"); } });
  let origin;
  const app = createApp({ store, runtime, session: { status: () => null, models: [] }, getOrigin: () => origin });
  app.locals.peers = sergio.peers;
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  t.after(async () => { await runtime.shutdown(); server.closeAllConnections(); await new Promise((r) => server.close(r)); });
  const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
  const call = async (method, route, body) => {
    const res = await fetch(origin + "/api" + route, { method, headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }) });
    return { status: res.status, json: await res.json() };
  };
  assert.deepEqual((await call("GET", "/teams")).json, [{ id: "solo", name: spaceName, people: 1, bots, admin: true, current: true }]);
  assert.deepEqual((await call("GET", "/state")).json.teams, [{ id: "solo", name: spaceName, people: 1, bots, admin: true, current: true }]);
  const solo = (await call("GET", "/teams/solo")).json;
  assert.equal(solo.members.length, 1);
  assert.equal(solo.members[0].you, true);
  assert.equal(solo.members[0].role, "creador");
  assert.equal(solo.members[0].bots.length, bots);
  assert.equal((await call("PUT", "/teams/current", { id: "solo" })).status, 200);

  const created = await call("POST", "/teams", { name: "  Estudio   Rico " });
  assert.equal(created.status, 200);
  const team = created.json;
  assert.equal(team.name, "Estudio Rico");
  assert.equal(team.role, "creador");
  assert.equal(team.admin, true);
  assert.deepEqual(team.members.map((m) => [m.name, m.role, m.you, m.presence]), [["Sergio Rico", "creador", true, "online"]]);
  assert.deepEqual(team.members[0].bots.map((b) => Object.keys(b).sort()), team.members[0].bots.map(() => ["color", "id", "name", "role", "shape"]));
  // The synthetic entry is gone: the team is the only one, and the current one.
  assert.deepEqual((await call("GET", "/teams")).json, [{ id: team.id, name: "Estudio Rico", people: 1, bots, admin: true, current: true }]);
  const state = (await call("GET", "/state")).json;
  assert.deepEqual(state.teams, [{ id: team.id, name: "Estudio Rico", people: 1, bots, admin: true, current: true }]);
  assert.deepEqual(state.teamsPending, []);
  // «general»: a group that carries the team's id, with everyone (only you, for now).
  const general = store.get("peerShares", team.general);
  assert.deepEqual([general.kind, general.title, general.teamId, general.general, general.owner], ["group", "general", team.id, true, addr(sergio)]);
  assert.deepEqual(general.members, [{ id: addr(sergio), role: "owner" }]);
  assert.ok(state.peers.shares.some((s) => s.id === team.general && s.kind === "group" && s.teamId === team.id && s.general === true), "a group in the list of conversations, tied to its team");
  const roster = sergio.teams.roster(rosterOf(sergio, team.id));
  assert.equal(roster.room, team.general);
  assert.ok(verifyTeamRoster(roster));
  // «general» is not changed by hand, and is not left on its own.
  assert.equal((await call("PATCH", "/peers/shares/" + team.general, { title: "otra" })).status, 409);
  assert.equal((await call("POST", "/peers/shares/" + team.general + "/leave", {})).status, 409);

  // Rename, an invitation with its code, and what an admin sees of it.
  assert.equal((await call("PATCH", "/teams/" + team.id, { name: "Estudio" })).json.name, "Estudio");
  const inv = (await call("POST", "/teams/" + team.id + "/invite", { name: "Marta" })).json;
  assert.match(inv.code, /^COLMENA-(?:[0-9A-HJKMNP-TV-Z]{4}-){3}[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.match(inv.text, /Te invito al equipo «Estudio» en Colmena\./);
  assert.ok(Date.parse(inv.expiresAt) - Date.now() <= 24 * 3600000 && Date.parse(inv.expiresAt) - Date.now() > 23 * 3600000, "24 hours");
  assert.deepEqual((await call("GET", "/teams/" + team.id)).json.invitations.map((i) => i.name), ["Marta"]);
  assert.equal((await call("POST", "/teams/join", { code: inv.code })).status, 400, "your own code");
  // A second team, switching, and the limits.
  const second = (await call("POST", "/teams", { name: "Familia" })).json;
  assert.deepEqual((await call("GET", "/teams")).json.map((x) => [x.name, x.current]), [["Estudio", false], ["Familia", true]]);
  assert.deepEqual((await call("PUT", "/teams/current", { id: team.id })).json.map((x) => [x.name, x.current]), [["Estudio", true], ["Familia", false]]);
  assert.equal(store.get("settings", "main").currentTeam, team.id);
  assert.equal((await call("PUT", "/teams/current", { id: "solo" })).status, 400);
  assert.equal((await call("PUT", "/teams/current", { id: "no-existe-ese-equipo" })).status, 404);
  assert.equal((await call("GET", "/teams/no-existe-ese-equipo")).status, 404);
  assert.equal((await call("DELETE", "/teams/" + team.id + "/members/" + addr(sergio))).status, 409, "you leave, you are not removed");
  for (let i = 2; i < TEAM_LIMITS.teams; i++) assert.equal((await call("POST", "/teams", { name: "Equipo " + i })).status, 200);
  assert.equal((await call("POST", "/teams", { name: "Uno más" })).status, 409, "as many teams as the limit");
  for (let i = 1; i < TEAM_LIMITS.invites; i++) await sergio.teams.invite(team.id, "Persona " + i);
  await assert.rejects(sergio.teams.invite(team.id, "Otra"), /demasiadas invitaciones/);
  // Leaving the team you created closes it; the last one left gives way to «solo» again.
  assert.equal((await call("POST", "/teams/" + second.id + "/leave", {})).status, 200);
  assert.ok(!(await call("GET", "/teams")).json.some((x) => x.id === second.id));
  assert.ok(store.get("peerShares", second.general).leftAt);
  for (const x of (await call("GET", "/teams")).json) await call("POST", "/teams/" + x.id + "/leave", {});
  assert.deepEqual((await call("GET", "/teams")).json.map((x) => x.id), ["solo"]);
});

test("joining with a code: the same team for everyone, «general» follows it, teammates see bots, presence and status without being contacts", async (t) => {
  const { people: [sergio, marta, luis] } = await world(t);
  const team = sergio.teams.create("Acme");
  await bring(sergio, marta, team.id);
  // While the creator has not answered, the team shows as one you are waiting to get into.
  const inv = await sergio.teams.invite(team.id, "Luis");
  const preview = await luis.peers.previewInvite(inv.code);
  assert.deepEqual([preview.name, preview.team], ["Sergio Rico", "Acme"]);
  const joined = await luis.teams.join(inv.code);
  assert.deepEqual([joined.id, joined.name, joined.state], [team.id, "Acme", "joining"]);
  for (const p of [sergio, marta, luis]) await until(() => inTeam(p, team.id) && rosterOf(p, team.id).members.length === 3, p.name + " ve a los tres");
  // Everyone holds the same roster, signed by Sergio.
  const versions = [sergio, marta, luis].map((p) => { const r = rosterOf(p, team.id); return JSON.stringify([r.name, r.version, r.owner, r.room, r.members.map((m) => [m.id, m.role, m.box])]); });
  assert.equal(new Set(versions).size, 1);
  assert.deepEqual(marta.teams.list().map(({ bots: _bots, ...x }) => x), [{ id: team.id, name: "Acme", people: 3, admin: false, current: true }]);
  assert.deepEqual(marta.teams.view(team.id).members.map((m) => [m.name, m.role, m.you]), [["Sergio Rico", "creador", false], ["Luis Gómez", "miembro", false], ["Marta Ruiz", "miembro", true]]);
  assert.deepEqual(marta.teams.pending(), []);
  // «general»: the three of them, on the three computers, tied to the team.
  for (const p of [sergio, marta, luis]) {
    await until(() => p.store.get("peerShares", team.general)?.members.length === 3, p.name + " tiene «general» con los tres");
    const g = p.store.get("peerShares", team.general);
    assert.deepEqual([g.kind, g.title, g.teamId, g.general, g.owner], ["group", "general", team.id, true, addr(sergio)]);
  }
  // Marta and Luis never exchanged a code: known to each other, not contacts.
  assert.equal(marta.peers.contact(addr(luis)).status, "known");
  assert.equal(luis.peers.contact(addr(marta)).status, "known");
  const hello = marta.peers.post(team.general, "Hola a los dos.");
  await until(() => luis.store.get("peerMessages", hello.id) && sergio.store.get("peerMessages", hello.id), "«general» llega a todos");
  // …yet each sees the other's name, bots, presence and status in the team.
  await until(() => memberIn(marta, team.id, luis).bots.length === luis.peers.myBots().length && memberIn(luis, team.id, marta).bots.length === marta.peers.myBots().length, "se ven los bots");
  assert.deepEqual(memberIn(marta, team.id, luis).bots, luis.peers.myBots());
  assert.ok(luis.peers.myBots().length > 0);
  await until(() => memberIn(marta, team.id, luis).presence === "online" && memberIn(luis, team.id, marta).presence === "online", "se ven conectados");
  assert.deepEqual(memberIn(marta, team.id, luis).status, { mode: "available", until: null });
  luis.peers.setStatus("dnd");
  await until(() => memberIn(marta, team.id, luis).status.mode === "dnd", "Marta ve «No molestar» de Luis");
  const bot = luis.store.list("bots").find((b) => b.enabled !== false);
  luis.store.patch("bots", bot.id, { name: "Vera Dos" });
  luis.peers.announceProfile();
  await until(() => memberIn(marta, team.id, luis).bots.some((b) => b.id === bot.id && b.name === "Vera Dos"), "Marta ve el bot con su nombre nuevo");
  assert.equal(marta.teams.list()[0].bots, sergio.peers.myBots().length + marta.peers.myBots().length + luis.peers.myBots().length);
  assert.equal(memberIn(marta, team.id, luis).contact, false);
  assert.equal(marta.peers.contact(addr(luis)).status, "known", "seeing someone in a team does not make them a contact");
  // Informative notices, never «te necesita»: who joined.
  const joinedNotice = marta.notices.find((n) => n.title === "Luis Gómez se ha unido a «Acme»");
  assert.deepEqual([joinedNotice.kind, joinedNotice.url, joinedNotice.extra.team], ["team", "/equipo", team.id]);
  assert.ok(sergio.notices.some((n) => n.title === "Marta Ruiz se ha unido a «Acme»") && sergio.notices.some((n) => n.title === "Luis Gómez se ha unido a «Acme»"));
  assert.ok(!luis.notices.some((n) => /se ha unido/.test(n.title)), "whoever joins is not told about those already there");

  // A teammate has no direct line…
  luis.peers.store.patch("peerContacts", addr(marta), { status: "active" });
  const sneaky = luis.peers.post(luis.peers.ensureDm(addr(marta)).id, "Escríbeme a mí solo");
  await pause(400);
  assert.equal(marta.store.get("peerMessages", sneaky.id), null);
  luis.peers.store.patch("peerContacts", addr(marta), { status: "known" });
  // …until one of them opens it, with no code: the roster vouches for the address and the key.
  const dm = marta.teams.openDm(team.id, addr(luis));
  assert.equal(dm.share.id, dmId(addr(marta), addr(luis)));
  assert.equal(marta.peers.contact(addr(luis)).box, rosterOf(marta, team.id).members.find((m) => m.id === addr(luis)).box);
  await until(() => marta.peers.contact(addr(luis)).status === "active" && luis.peers.contact(addr(marta)).status === "active", "los dos son contactos");
  const direct = marta.peers.post(dm.share.id, "Ahora sí, a solas.");
  await until(() => luis.store.get("peerMessages", direct.id), "el directo llega");
  const back = luis.peers.post(dm.share.id, "Recibido.");
  await until(() => marta.store.get("peerMessages", back.id), "y vuelve");
  assert.equal(memberIn(marta, team.id, luis).dm, dm.share.id);
  await assert.rejects(async () => marta.teams.openDm(team.id, newIdentity().sign.pub), /no está en el equipo/);

  // Rename by its creator reaches everyone.
  sergio.teams.rename(team.id, "Acme Studio");
  for (const p of [marta, luis]) await until(() => rosterOf(p, team.id).name === "Acme Studio", p.name + " ve el nombre nuevo");
  assert.equal(marta.store.get("peerShares", team.general).title, "general", "the room keeps its name");
  // Luis leaves: out of the team and of «general» on every computer.
  luis.teams.leave(team.id);
  assert.deepEqual(luis.teams.list(), []);
  assert.equal(teamsList(luis.store, luis.peers)[0].id, "solo");
  assert.ok(luis.store.get("peerShares", team.general).leftAt);
  for (const p of [sergio, marta]) await until(() => rosterOf(p, team.id).members.length === 2 && p.store.get("peerShares", team.general).members.length === 2, p.name + " ve que Luis se ha ido");
  const after = marta.peers.post(team.general, "Seguimos Sergio y yo.");
  await until(() => sergio.store.get("peerMessages", after.id), "Sergio lo recibe");
  await pause(300);
  assert.equal(luis.store.get("peerMessages", after.id), null);
  // Its creator leaves: the team closes for whoever is left, with a plain notice.
  sergio.teams.leave(team.id);
  await until(() => marta.teams.membership(team.id).state === "closed", "Marta ve el equipo cerrado");
  assert.ok(marta.notices.some((n) => n.kind === "team" && n.title === "«Acme Studio» se ha cerrado"));
  await until(() => marta.store.get("peerShares", team.general).removedAt, "«general» se cierra");
  assert.equal(teamsList(marta.store, marta.peers)[0].id, "solo");
});

test("admins ask the creator: grant, rename, invite and remove; several teams; a room of a team", async (t) => {
  const { people: [sergio, marta, luis] } = await world(t);
  const team = sergio.teams.create("Acme");
  await bring(sergio, marta, team.id);
  // A member cannot administer.
  assert.throws(() => marta.teams.rename(team.id, "Mío"), (e) => e.status === 403);
  await assert.rejects(marta.teams.invite(team.id, "Luis"), (e) => e.status === 403);
  assert.throws(() => marta.teams.setAdmin(team.id, addr(marta), true), (e) => e.status === 403);
  // Sergio names Marta admin: she is told, and it shows on both sides.
  sergio.teams.setAdmin(team.id, addr(marta), true);
  await until(() => marta.teams.view(team.id).role === "admin", "Marta es admin");
  assert.ok(marta.notices.some((n) => n.kind === "team" && n.title === "Ahora administras «Acme»"));
  assert.equal(memberIn(sergio, team.id, marta).role, "admin");
  assert.equal(marta.teams.list()[0].admin, true);
  // Her rename is a request: nothing changes here until Sergio's Colmena signs it.
  const asked = marta.teams.rename(team.id, "Acme Lab");
  assert.equal(asked.name, "Acme");
  assert.deepEqual(asked.waiting.map((w) => w.op), ["rename"]);
  await until(() => rosterOf(marta, team.id).name === "Acme Lab" && rosterOf(sergio, team.id).name === "Acme Lab", "el nombre de Marta llega firmado por Sergio");
  assert.deepEqual(marta.teams.view(team.id).waiting, []);
  // Her invitation: Luis says hello to her, she asks Sergio, Sergio signs him in.
  await bring(marta, luis, team.id, [sergio, marta]);
  assert.equal(luis.teams.membership(team.id).owner, addr(sergio));
  await until(() => luis.peers.contact(addr(marta)).status === "active", "whoever gave you the code is a contact");
  assert.equal(luis.peers.contact(addr(sergio)).status, "known", "the creator is a teammate");
  assert.equal(sergio.peers.contact(addr(luis)).status, "known");
  await until(() => memberIn(sergio, team.id, luis).bots.length === luis.peers.myBots().length && memberIn(luis, team.id, sergio).bots.length === sergio.peers.myBots().length, "Sergio y Luis se ven los bots sin ser contactos");
  await until(() => luis.store.get("peerShares", team.general)?.members.length === 3, "Luis está en «general»");
  // Nobody can demote or remove the creator; an admin cannot be told apart by the roster from afar: only Sergio signs.
  assert.throws(() => marta.teams.remove(team.id, addr(sergio)), (e) => e.status === 409);
  assert.throws(() => marta.teams.setAdmin(team.id, addr(sergio), false), (e) => e.status === 409);
  // What an admin asks about who administers says which way it goes while it waits; and an
  // admin can stop administering (she stays in as a member).
  assert.deepEqual(marta.teams.setAdmin(team.id, addr(luis), true).waiting.map((w) => [w.op, w.address, w.on]), [["admin", addr(luis), true]]);
  await until(() => marta.teams.view(team.id).waiting.length === 0 && memberIn(marta, team.id, luis).role === "admin", "Luis administra");
  assert.deepEqual(luis.teams.setAdmin(team.id, addr(luis), false).waiting.map((w) => [w.op, w.address, w.on]), [["admin", addr(luis), false]]);
  await until(() => luis.teams.view(team.id).role === "miembro" && luis.teams.view(team.id).waiting.length === 0, "Luis deja de administrar");
  assert.equal(memberIn(sergio, team.id, luis).role, "miembro");
  // Several teams: Marta creates another and Sergio joins it; each list says where you administer.
  const other = marta.teams.create("Familia");
  await bring(marta, sergio, other.id);
  assert.deepEqual(sergio.teams.list().map((x) => [x.name, x.people, x.admin, x.current]), [["Acme Lab", 3, true, true], ["Familia", 2, false, false]]);
  assert.deepEqual(sergio.teams.setCurrent(other.id).map((x) => [x.name, x.current]), [["Acme Lab", false], ["Familia", true]]);
  assert.deepEqual(marta.teams.list().map((x) => [x.name, x.admin]), [["Acme Lab", true], ["Familia", true]]);
  // A room of a team, by invitation: Luis and Sergio are teammates, not contacts.
  assert.throws(() => luis.peers.createGroup("ventas", [addr(sergio)]), /con las que ya hablas/);
  assert.throws(() => luis.peers.createGroup("ventas", [addr(sergio)], { teamId: other.id }), (e) => e.status === 404, "a team he is not in");
  const room = luis.peers.createGroup("ventas", [addr(sergio)], { teamId: team.id });
  await until(() => sergio.store.get("peerShares", room.id), "Sergio recibe la sala");
  assert.deepEqual([sergio.store.get("peerShares", room.id).teamId, sergio.store.get("peerShares", room.id).general], [team.id, undefined]);
  assert.equal(marta.store.get("peerShares", room.id), null, "by invitation: not everyone");
  // A group that claims to be the «general» of a team, or a team its owner is not in, is not believed.
  const fake = marta.peers.createGroup("general", [addr(sergio)], { teamId: other.id });
  marta.store.patch("peerShares", fake.id, { general: true, teamId: team.id, version: 2 });
  marta.peers.sendRoster(marta.store.get("peerShares", fake.id));
  await until(() => sergio.store.get("peerShares", fake.id)?.version === 2, "Sergio recibe la lista");
  assert.deepEqual([sergio.store.get("peerShares", fake.id).general, sergio.store.get("peerShares", fake.id).teamId], [undefined, team.id], "Marta is in that team, but its «general» is the creator's");
  // Marta (admin) removes Luis through Sergio: he is told, plainly, and is out of «general».
  marta.teams.remove(team.id, addr(luis));
  await until(() => luis.teams.membership(team.id).state === "removed", "Luis ve que le han quitado");
  const removed = luis.notices.filter((n) => /Ya no estás|te ha quitado/.test(n.title));
  assert.deepEqual(removed.map((n) => [n.kind, n.title]), [["team", "Ya no estás en «Acme Lab»"]], "one notice, not one more for «general»");
  await until(() => luis.store.get("peerShares", team.general).removedAt, "«general» se cierra para Luis");
  for (const p of [sergio, marta]) await until(() => rosterOf(p, team.id).members.length === 2 && p.store.get("peerShares", team.general).members.length === 2, p.name + " ya no ve a Luis");
  assert.deepEqual(luis.teams.list(), []);
  // Unnamed, Marta can no longer ask.
  sergio.teams.setAdmin(team.id, addr(marta), false);
  await until(() => marta.teams.view(team.id).role === "miembro", "Marta ya no es admin");
  assert.throws(() => marta.teams.rename(team.id, "Otra vez"), (e) => e.status === 403);
  // Marta takes Sergio out of her people: the direct line closes on both sides, the team goes on.
  marta.peers.removeContact(addr(sergio));
  await until(() => sergio.peers.contact(addr(marta)).status === "known", "Sergio deja de tenerla como contacto");
  assert.deepEqual([marta.peers.contact(addr(sergio)).status, marta.peers.contact(addr(sergio)).noDm], ["known", true]);
  sergio.teams.rename(team.id, "Acme Tres");
  await until(() => rosterOf(marta, team.id).name === "Acme Tres", "la lista del creador sigue llegando");
  const still = marta.peers.post(team.general, "En el equipo seguimos.");
  await until(() => sergio.store.get("peerMessages", still.id), "y se leen en «general»");
  assert.throws(() => sergio.teams.openDm(team.id, addr(marta)), (e) => e.status === 409);
  await raw(sergio, marta, { type: "team.dm", team: team.id, profile: sergio.peers.myProfile() });
  assert.equal(marta.peers.contact(addr(sergio)).status, "known", "only a new invitation opens the direct line again");
});

test("attacks: forged, replayed and downgraded rosters, a removed member, a non-admin, someone else's bots", async (t) => {
  const { people: [sergio, marta, luis] } = await world(t);
  const team = sergio.teams.create("Acme");
  await bring(sergio, marta, team.id);
  await bring(sergio, luis, team.id, [sergio, marta]);
  const sergioAt = (p) => p.peers.contact(addr(sergio));
  const snapshot = (p) => { const r = rosterOf(p, team.id); return JSON.stringify([r.name, r.version, r.members.map((m) => [m.id, m.role])]); };
  await until(() => memberIn(sergio, team.id, luis).bots.length > 0, "Sergio ve los bots de Luis");
  const luisBots = JSON.stringify(memberIn(sergio, team.id, luis).bots);

  // A non-admin's requests change nothing, whatever the Colmena that sends them.
  const before = snapshot(sergio);
  await raw(luis, sergio, { type: "team.req", team: team.id, op: "rename", name: "Hackeado" });
  await raw(luis, sergio, { type: "team.req", team: team.id, op: "remove", member: addr(marta) });
  await raw(luis, sergio, { type: "team.req", team: team.id, op: "admin", member: addr(luis), on: true });
  const stranger = newIdentity();
  await raw(luis, sergio, { type: "team.req", team: team.id, op: "add", member: { id: stranger.sign.pub, box: stranger.box.pub, name: "Intruso" } });
  assert.equal(snapshot(sergio), before);
  assert.equal(sergio.peers.contact(stranger.sign.pub), null);
  // A roster Luis signs himself: with Sergio as owner the signature fails; with himself as owner it is another team.
  const real = sergio.teams.roster(rosterOf(sergio, team.id));
  const promoted = { ...real, version: real.version + 50, name: "De Luis", members: real.members.map((m) => (m.id === addr(luis) ? { ...m, role: "admin" } : m)) };
  const forged = signTeamRoster(luis.peers.identity, promoted);
  const usurped = signTeamRoster(luis.peers.identity, { ...promoted, owner: addr(luis), members: promoted.members.map((m) => ({ ...m, role: m.id === addr(luis) ? "owner" : "member" })) });
  assert.ok(verifyTeamRoster(usurped), "well formed and well signed, by the wrong person");
  await raw(luis, marta, { type: "team.roster", roster: forged });
  await raw(luis, marta, { type: "team.roster", roster: usurped });
  // The real roster with a newer number and the old signature, and Sergio's real one relayed by Luis.
  await raw(luis, marta, { type: "team.roster", roster: { ...real, version: real.version + 1 } });
  marta.teams.onRoster(sergioAt(marta), forged);
  marta.teams.onRoster(sergioAt(marta), usurped);
  assert.equal(snapshot(marta), before);
  // A team nobody asked to join is not accepted, however well signed.
  const uninvited = luis.teams.create("Trampa");
  const trap = luis.teams.roster({ ...rosterOf(luis, uninvited.id), members: [...rosterOf(luis, uninvited.id).members, { id: addr(marta), role: "member", box: marta.peers.identity.box.pub, name: "Marta" }] });
  assert.ok(verifyTeamRoster(trap));
  await raw(luis, marta, { type: "team.roster", roster: trap });
  assert.equal(marta.teams.membership(uninvited.id), null);
  assert.deepEqual(marta.teams.list().map((x) => x.id), [team.id]);

  // Bots: what someone announces is theirs. Naming another person in it changes nothing of that person.
  await raw(marta, sergio, { type: "team.profile", address: addr(luis), from: addr(luis), owner: addr(luis), name: "Marta Ruiz", bots: [{ id: "falso", name: "Falso", role: "Espía", color: "#000000", shape: "hex", owner: addr(luis) }] });
  assert.equal(JSON.stringify(memberIn(sergio, team.id, luis).bots), luisBots);
  assert.deepEqual(memberIn(sergio, team.id, marta).bots, [{ id: "falso", name: "Falso", role: "Espía", color: "#000000", shape: "hex" }], "her own list, cleaned");
  // A message signed as a bot is still its sender's: «Falso · bot de Marta».
  const asBot = marta.peers.post(team.general, "Soy de Luis, de verdad.", { bot: { id: "vera", name: "Vera", role: "x", color: "#123456", shape: "hex" } });
  await until(() => sergio.store.get("peerMessages", asBot.id), "llega");
  assert.equal(sergio.store.get("peerMessages", asBot.id).from, addr(marta));

  // Sergio removes Luis. The roster from when he was in is older: it never comes back.
  const withLuis = sergio.teams.roster(rosterOf(sergio, team.id));
  sergio.teams.remove(team.id, addr(luis));
  await until(() => luis.teams.membership(team.id).state === "removed" && rosterOf(marta, team.id).members.length === 2, "Luis está fuera");
  const current = snapshot(sergio);
  assert.ok(verifyTeamRoster(withLuis), "a real roster, signed by Sergio, only older");
  await raw(luis, marta, { type: "team.roster", roster: withLuis });
  marta.teams.onRoster(sergioAt(marta), withLuis);
  assert.equal(snapshot(marta), current, "an older version never replaces a newer one");
  luis.teams.onRoster(sergioAt(luis), withLuis);
  assert.equal(luis.teams.membership(team.id).state, "removed", "nor on his own computer");
  // He cannot put himself back, alone or with a new person's name.
  await raw(luis, sergio, { type: "team.req", team: team.id, op: "add", member: { id: addr(luis), box: luis.peers.identity.box.pub, name: "Luis" } });
  await raw(luis, sergio, { type: "team.req", team: team.id, op: "leave" });
  assert.equal(snapshot(sergio), current);
  // Out of the team he is out of «general», and what he announces is no longer heard.
  const gone = luis.peers.enqueue(addr(marta), { type: "msg", share: team.general, id: "11111111-aaaa-bbbb-cccc-000000000001", at: new Date().toISOString(), text: "Sigo aquí" });
  await luis.peers.flushOutbox();
  await until(() => marta.store.get("peerSeen", gone.id), "Marta procesa el sobre");
  assert.equal(marta.store.get("peerMessages", "11111111-aaaa-bbbb-cccc-000000000001"), null);
  await raw(luis, marta, { type: "team.profile", name: "Otro nombre", bots: [] });
  assert.equal(marta.peers.contact(addr(luis)).name, "Luis Gómez");
  await raw(luis, marta, { type: "team.dm", team: team.id, profile: luis.peers.myProfile() });
  assert.equal(marta.peers.contact(addr(luis)).status, "known", "no direct line through a team he is not in");
  assert.throws(() => marta.teams.openDm(team.id, addr(luis)), /no está en el equipo/);
  // An admin who was unnamed has nothing to replay either.
  sergio.teams.setAdmin(team.id, addr(marta), true);
  await until(() => marta.teams.view(team.id).admin, "Marta es admin");
  sergio.teams.setAdmin(team.id, addr(marta), false);
  await until(() => !marta.teams.view(team.id).admin, "Marta deja de serlo");
  const now = snapshot(sergio);
  await raw(marta, sergio, { type: "team.req", team: team.id, op: "rename", name: "De Marta" });
  await raw(marta, sergio, { type: "team.req", team: team.id, op: "admin", member: addr(marta), on: true });
  assert.equal(snapshot(sergio), now);

  // With a new code Luis is back, in the team and in «general».
  await bring(sergio, luis, team.id, [sergio, marta]);
  await until(() => { const g = luis.store.get("peerShares", team.general); return g.members.length === 3 && !g.removedAt && !g.leftAt; }, "«general» se abre otra vez para Luis");
  const again = luis.peers.post(team.general, "De vuelta.");
  await until(() => marta.store.get("peerMessages", again.id) && sergio.store.get("peerMessages", again.id), "y se le oye");
});

test("a full team refuses, and whoever was waiting learns it", async (t) => {
  const { people: [sergio, marta] } = await world(t, ["Sergio Rico", "Marta Ruiz"]);
  const team = sergio.teams.create("Acme");
  const inv = await sergio.teams.invite(team.id, "Marta");
  // The team fills up after the code was made.
  const filler = () => { const id = newIdentity(); return { id: id.sign.pub, role: "member", box: id.box.pub, name: "Alguien" }; };
  sergio.store.patch("teams", team.id, { members: [...rosterOf(sergio, team.id).members, ...Array.from({ length: TEAM_LIMITS.members - 1 }, filler)] });
  assert.equal(rosterOf(sergio, team.id).members.length, 32);
  await assert.rejects(sergio.teams.invite(team.id, "Otra"), /está completo/);
  await marta.teams.join(inv.code);
  await until(() => marta.teams.membership(team.id).state === "refused", "Marta sabe que no ha entrado");
  assert.deepEqual(marta.teams.pending().map((x) => [x.name, x.state, x.reason, x.from]), [["Acme", "refused", "full", "Sergio Rico"]], "and who gave her the code");
  assert.deepEqual(marta.teams.list(), []);
  assert.equal(rosterOf(sergio, team.id).members.length, 32);
  // She clears it; nothing is left of a team she was never in.
  marta.teams.leave(team.id);
  assert.equal(marta.teams.membership(team.id), null);
});

test("a Colmena that knows no teams: a member with no team data that still talks in «general»", async (t) => {
  const { people: [sergio, marta, luis] } = await world(t, ["Sergio Rico", "Marta Ruiz", "Luis Gómez"], { old: ["Luis Gómez"] });
  const team = sergio.teams.create("Acme");
  await bring(sergio, marta, team.id);
  // Luis pastes the team's code where he pastes any invitation: Sergio's Colmena puts him in.
  await bring(sergio, luis, team.id, [sergio, marta]);
  assert.equal(luis.store.list("teams").length, 0);
  // He sees «general» as one more group, with everyone in it.
  await until(() => luis.store.get("peerShares", team.general)?.members.length === 3, "Luis ve «general»");
  const g = luis.store.get("peerShares", team.general);
  assert.deepEqual([g.kind, g.title, g.general, g.teamId], ["group", "general", undefined, undefined]);
  assert.ok(luis.notices.some((n) => n.title === "Sergio Rico te ha añadido a «general»"));
  const fromOld = luis.peers.post(team.general, "Hola desde la versión anterior.");
  await until(() => marta.store.get("peerMessages", fromOld.id) && sergio.store.get("peerMessages", fromOld.id), "lo que escribe llega");
  const toOld = marta.peers.post(team.general, "Te leemos, Luis.");
  await until(() => luis.store.get("peerMessages", toOld.id), "y lo que le escriben");
  // To the others he is a member with a name and nothing else: no bots, not seen connected.
  const view = memberIn(marta, team.id, luis);
  assert.deepEqual([view.name, view.role, view.bots, view.presence, view.contact], ["Luis Gómez", "miembro", [], "offline", false]);
  assert.equal(marta.teams.list()[0].people, 3);
  // What the team says keeps working around him: a rename, a new roster.
  sergio.teams.rename(team.id, "Acme Dos");
  await until(() => rosterOf(marta, team.id).name === "Acme Dos", "Marta ve el nombre nuevo");
  const still = luis.peers.post(team.general, "Sigo aquí.");
  await until(() => marta.store.get("peerMessages", still.id), "sigue hablando");
  // Leaving the only room he sees of the team is leaving the team.
  luis.peers.leave(team.general);
  for (const p of [sergio, marta]) await until(() => rosterOf(p, team.id).members.length === 2 && p.store.get("peerShares", team.general).members.length === 2, p.name + " ve que Luis se ha ido");
});

test("a restart in the middle of joining: the join waits in the outbox and completes", async (t) => {
  const { relay, people: [sergio, marta] } = await world(t, ["Sergio Rico", "Marta Ruiz"]);
  const team = sergio.teams.create("Acme");
  const inv = await sergio.teams.invite(team.id, "Marta");
  // Sergio's Colmena is closed when Marta uses the code, and hers closes right after.
  sergio.peers.stop();
  await marta.teams.join(inv.code);
  marta.peers.stop();
  assert.equal(marta.store.get("teamMemberships", team.id).state, "joining");
  await pause(200);
  // She opens again: still waiting, shown as such, nothing half done.
  await boot(marta, relay);
  assert.deepEqual(marta.teams.pending().map((x) => [x.id, x.name, x.state]), [[team.id, "Acme", "joining"]]);
  assert.deepEqual(marta.teams.list(), []);
  assert.equal(teamsList(marta.store, marta.peers)[0].id, "solo");
  await marta.peers.flushOutbox();
  await until(() => marta.store.list("peerOutbox").length === 0, "el saludo sale hacia el buzón");
  // Sergio opens: the hello was waiting for him, he signs her in, she is in.
  await boot(sergio, relay);
  await until(() => inTeam(marta, team.id) && rosterOf(marta, team.id).members.length === 2, "Marta entra");
  assert.deepEqual(marta.teams.pending(), []);
  await until(() => marta.store.get("peerShares", team.general)?.members.length === 2, "y está en «general»");
  const hello = marta.peers.post(team.general, "Ya estoy.");
  await until(() => sergio.store.get("peerMessages", hello.id), "Sergio la lee");
  // A roster that got lost is asked for again: the creator answers a member whose copy is old.
  sergio.teams.rename(team.id, "Acme Dos");
  await until(() => rosterOf(marta, team.id).name === "Acme Dos", "Marta ve el nombre");
  const kept = rosterOf(marta, team.id);
  marta.store.put("teams", { ...kept, name: "Acme", version: kept.version - 1 });
  marta.store.patch("teamMemberships", team.id, { version: kept.version - 1, syncAt: 0 });
  marta.teams.resync();
  await until(() => rosterOf(marta, team.id).name === "Acme Dos", "la lista vuelve a estar al día");
  // Giving up a join that never completes leaves nothing behind.
  const other = sergio.teams.create("Otro");
  const second = await sergio.teams.invite(other.id, "Marta");
  sergio.peers.stop();
  await marta.teams.join(second.code);
  assert.equal(marta.teams.membership(other.id).state, "joining");
  marta.teams.leave(other.id);
  assert.equal(marta.teams.membership(other.id), null);
  // Her hello was already on its way: Sergio's Colmena puts her in, hers says no, and she is out again.
  await boot(sergio, relay);
  await until(() => rosterOf(sergio, other.id).version >= 3 && rosterOf(sergio, other.id).members.length === 1, "Sergio la quita al saber que no entró");
  assert.equal(marta.teams.membership(other.id), null);
  assert.deepEqual(marta.teams.list().map((x) => x.name), ["Acme Dos"]);
});
