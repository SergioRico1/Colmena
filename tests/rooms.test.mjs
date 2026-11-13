import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, settle } from "./fixtures/runtime-fixture.mjs";
import { roomSlug } from "../server/runtime.mjs";
import { forkRoom, snoozeUntil, wakeDue, watchRooms } from "../server/rooms.mjs";
// The one room object (server/room.mjs, docs/ROOMS-CONTRACT.md): further down, on real Colmenas
// over a local mailbox (relay/server.mjs), like tests/peers.test.mjs and tests/teams.test.mjs.
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Store } from "../server/store.mjs";
import { encryptDatabase } from "../server/db-crypto.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { Peers, dmId } from "../server/peers/service.mjs";
import { Teams } from "../server/peers/teams.mjs";
import { PeerBots } from "../server/peers/bots.mjs";
import { Rooms, joinParts, splitForPeers } from "../server/room.mjs";
import { roomTimeline } from "../server/room-timeline.mjs";
import { missionKind } from "../server/mission-kind.mjs";
import { startRelay } from "../relay/server.mjs";

const tick = () => new Promise((r) => setImmediate(r));

test("snooze presets: this afternoon, tomorrow morning, next Monday", () => {
  const thursday = new Date(2026, 9, 15, 11, 0);
  assert.equal(snoozeUntil("tarde", thursday), new Date(2026, 9, 15, 17, 0).toISOString());
  assert.equal(snoozeUntil("tarde", new Date(2026, 9, 15, 18, 0)), new Date(2026, 9, 16, 9, 0).toISOString(), "too late: tomorrow");
  assert.equal(snoozeUntil("manana", thursday), new Date(2026, 9, 16, 9, 0).toISOString());
  assert.equal(snoozeUntil("lunes", thursday), new Date(2026, 9, 19, 9, 0).toISOString());
  assert.equal(snoozeUntil("lunes", new Date(2026, 9, 19, 8, 0)), new Date(2026, 9, 26, 9, 0).toISOString(), "on a Monday: the next one");
});

test("a snoozed or archived room comes back when something happens or its time comes", async (t) => {
  const { store } = await fixture(t, async () => answer("ok"));
  const stop = watchRooms(store);
  t.after(stop);
  const later = new Date(Date.now() + 3600e3).toISOString();
  store.put("missions", { id: "a", title: "Ventas", room: "ventas", status: "waiting", botIds: ["nora"], snoozedUntil: later });
  store.patch("missions", "a", { title: "Ventas Q3" });
  await tick();
  assert.equal(store.get("missions", "a").snoozedUntil, later, "snoozed while it waits: stays snoozed");
  store.put("messages", { id: "m1", missionId: "a", role: "assistant", botId: "nora", text: "Ya está", at: new Date().toISOString() });
  await tick();
  assert.equal(store.get("missions", "a").snoozedUntil, null, "a bot answered: back");
  store.put("missions", { id: "b", title: "Viaje", room: "viaje", status: "completed", botIds: ["nora"], archived: true });
  store.patch("missions", "b", { status: "waiting" });
  await tick();
  assert.equal(store.get("missions", "b").archived, false, "it needs you: back");
  store.put("missions", { id: "c", title: "Gastos", room: "gastos", kind: "sala", status: "completed", botIds: ["tomas"], snoozedUntil: new Date(Date.now() - 1000).toISOString() });
  const notices = [];
  assert.deepEqual(wakeDue(store, (n) => notices.push(n)).map((m) => m.id), ["c"]);
  assert.equal(store.get("missions", "c").snoozedUntil, null);
  assert.match(notices[0].title, /Vuelve #gastos/);
});

test("«Duplicar desde aquí» copies the conversation up to a message and the bot remembers it", async (t) => {
  const inputs = [];
  let n = 0;
  const { store, runtime } = await fixture(t, async ({ input }) => {
    inputs.push(JSON.stringify(input));
    n += 1;
    return answer(n === 1 ? "Opción A: Lisboa." : n === 2 ? "Opción B: Oporto." : "Entonces probamos con Sevilla.");
  });
  const m = runtime.create({ prompt: "Ideas para un viaje", mode: "solo", botIds: ["nora"], conversation: true });
  await runtime.launch(m.id);
  runtime.addMessage(m.id, "Dame otra");
  await settle(runtime);
  const firstAnswer = store.list("messages").find((x) => x.missionId === m.id && x.text === "Opción A: Lisboa.");
  const copy = forkRoom(store, m.id, firstAnswer.id, { slug: roomSlug });
  assert.equal(copy.title, m.title + " (copia)");
  assert.equal(copy.status, "completed");
  const copied = store.list("messages").filter((x) => x.missionId === copy.id);
  assert.deepEqual(copied.filter((x) => x.copied).map((x) => x.text), ["Ideas para un viaje", "Opción A: Lisboa."]);
  assert.ok(copied.some((x) => x.kind === "fork"), "one line says it is a copy");
  runtime.addMessage(copy.id, "¿Y algo en España?");
  await settle(runtime);
  assert.match(inputs.at(-1), /Opción A: Lisboa/);
  assert.doesNotMatch(inputs.at(-1), /Oporto/, "what came after the cut is not in the copy");
  assert.equal(store.list("messages").filter((x) => x.missionId === m.id).length, 4, "the original is untouched");
});

// ---------------------------------------------------------------- the one room object
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
const addr = (p) => p.peers.address;
// The views the missions route gives the timeline, small.
const messageView = (m) => ({ id: m.id, role: m.role, botId: m.botId ?? null, text: m.text || "", at: m.at, kind: m.kind || "message", ...(m.replyTo ? { replyTo: m.replyTo } : {}) });
const stepView = (s) => ({ id: s.id, status: s.status });
const timeline = (p, id, options = {}) => roomTimeline({ store: p.store, room: p.rooms.must(id), peers: p.rooms.peers, me: p.rooms.me(), messageView, stepView, ...options });
const texts = (page) => page.items.map((x) => x.text);

/**
 * Colmenas on a local mailbox, each with its store, its bots (a provider that answers what
 * `reply` says) and its rooms. `old`: one from before rooms and teams (their messages fall
 * through its dispatch). `app`: served over HTTP too (the app makes the rooms itself).
 */
async function world(t, names = ["Sergio Rico", "Marta Ruiz"], { old = [], app = [] } = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), "colmena-rooms-"));
  const relay = await startRelay({ port: 0, directory: path.join(base, "relay") });
  const people = [];
  for (const name of names) {
    const store = new Store(path.join(base, name.split(" ")[0]));
    store.patch("settings", "main", { model: "fixture", learning: false });
    const p = { name, store, notices: [], calls: [], reply: () => answer("Hecho.") };
    p.runtime = new Runtime(store, { respond: async (params) => { p.calls.push(params); return p.reply(params); } }, null, {});
    p.peers = new Peers({ store, vault: null, relayUrl: relay.url, nameOf: () => name, notifier: { notify: (n) => p.notices.push(n) }, log: () => {} });
    if (old.includes(name)) {
      const dispatch = p.peers.dispatch.bind(p.peers);
      p.peers.dispatch = (c, body) => (/^(team|room)\./.test(String(body.type)) ? undefined : dispatch(c, body));
    } else {
      p.teams = new Teams({ peers: p.peers }).start();
      if (app.includes(name)) {
        let origin;
        const web = createApp({ store, runtime: p.runtime, session: { status: () => null, models: [] }, getOrigin: () => origin });
        web.locals.peers = p.peers;
        p.rooms = web.locals.rooms;
        p.server = http.createServer(web);
        await new Promise((r) => p.server.listen(0, "127.0.0.1", r));
        origin = "http://127.0.0.1:" + p.server.address().port;
        const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
        p.call = async (method, route, body) => {
          const res = await fetch(origin + "/api" + route, { method, headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }) });
          return { status: res.status, json: await res.json() };
        };
      } else p.rooms = new Rooms({ store, runtime: p.runtime, getPeers: () => p.peers, log: () => {} }).start();
      p.rooms.attach(p.peers);
    }
    p.bots = new PeerBots({ peers: p.peers, store, runtime: p.runtime, log: () => {} }).start();
    await p.peers.start();
    await until(() => p.peers.relayStatus.status === "online", name + " conectado al buzón");
    people.push(p);
  }
  t.after(async () => {
    for (const p of people) { p.bots.stop(); p.peers.stop(); }
    await pause(300); // in-flight mail settles
    for (const p of people) {
      await p.runtime.shutdown();
      if (p.server) { p.server.closeAllConnections(); await new Promise((r) => p.server.close(r)); }
      p.store.close();
    }
    await relay.close();
    await rm(base, { recursive: true, force: true });
  });
  return people;
}
/** Two people become contacts with a code. */
async function friends(a, b) {
  const inv = await a.peers.createInvite(b.name);
  await b.peers.acceptInvite(inv.code);
  await until(() => a.peers.contact(addr(b))?.status === "active" && b.peers.contact(addr(a))?.status === "active", a.name + " y " + b.name + " se hablan");
}
/** A private room of `owner` with Vera, and `guest` invited to it from the room. */
async function sharedRoom(owner, guest, title = "Informe Q3") {
  const room = owner.rooms.create({ title, botIds: ["vera"] });
  await owner.rooms.invite(room.id, { address: addr(guest) });
  await until(() => guest.rooms?.resolveRoom(room.id) || (!guest.rooms && guest.store.get("peerShares", room.id)), guest.name + " ve la sala");
  return owner.rooms.detail(room.id);
}
const peerRows = (p, shareId) => p.store.ordered("peerMessages", "shareId", shareId, { asc: true });

test("a conversation with people is read by pages through its own index, also in an encrypted database", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-ordered-"));
  let store = new Store(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const at = (n) => new Date(Date.UTC(2026, 10, 1, 10, 0, n)).toISOString();
  for (let i = 0; i < 40; i++) store.put("peerMessages", { id: "a-" + String(i).padStart(3, "0"), shareId: "sala-a", from: "x", text: "a" + i, at: at(i), ...(i === 7 ? { thread: "a-005" } : {}) });
  for (let i = 0; i < 40; i++) store.put("peerMessages", { id: "b-" + String(i).padStart(3, "0"), shareId: "sala-b", from: "x", text: "b" + i, at: at(i) });
  // Two written in the same millisecond keep one order: by id.
  store.put("peerMessages", { id: "a-039b", shareId: "sala-a", from: "x", text: "a39b", at: at(39) });
  const check = () => {
    const ids = (rows) => rows.map((m) => m.id);
    assert.deepEqual(ids(store.ordered("peerMessages", "shareId", "sala-a", { limit: 3 })), ["a-039b", "a-039", "a-038"]);
    assert.deepEqual(ids(store.ordered("peerMessages", "shareId", "sala-a", { limit: 2, before: { at: at(39), id: "a-039" } })), ["a-038", "a-037"]);
    assert.deepEqual(ids(store.ordered("peerMessages", "shareId", "sala-a", { limit: 3, asc: true, after: { at: at(5), id: "a-005" } })), ["a-006", "a-007", "a-008"]);
    assert.deepEqual(ids(store.ordered("peerMessages", "shareId", "sala-a", { limit: 3, asc: true, after: { at: at(5), id: "a-005" }, lacks: "thread" })), ["a-006", "a-008", "a-009"]);
    assert.deepEqual(ids(store.ordered("peerMessages", "shareId", "sala-a", { has: "thread" })), ["a-007"]);
    assert.equal(store.ordered("peerMessages", "shareId", "sala-a").length, 41);
    assert.equal(store.where("peerMessages", "shareId", "sala-b").length, 40);
    const src = store.encrypted ? "meta" : "data";
    const plan = store.db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM records WHERE kind=? AND json_extract(${src},'$.shareId')=? ORDER BY json_extract(${src},'$.at') DESC LIMIT 5`).all("peerMessages", "sala-a").map((r) => r.detail).join(" | ");
    assert.match(plan, /records_share/, "one walk of the conversation's index: " + plan);
  };
  check();
  store.close();
  const key = randomBytes(32);
  encryptDatabase(path.join(directory, "colmena.sqlite"), key);
  store = new Store(directory, { key });
  assert.equal(store.encrypted, true);
  check();
  // A database encrypted by an earlier Colmena has no such index: opening it makes it.
  store.db.exec("DROP INDEX records_share");
  store.close();
  store = new Store(directory, { key });
  check();
});

test("a mission is a chat, a room or a task: said once when it is made, worked out for older ones", async (t) => {
  assert.equal(missionKind({ conversation: true, botIds: ["nora"] }), "chat");
  assert.equal(missionKind({ conversation: true, botIds: ["nora"], incognito: true }), "chat");
  assert.equal(missionKind({ conversation: true, botIds: ["nora", "vera"] }), "sala", "a chat with company is a room");
  assert.equal(missionKind({ mode: "equipo", botIds: [], title: "Informe Q3", prompt: "Preparad el informe del trimestre" }), "sala", "named by the person");
  assert.equal(missionKind({ mode: "equipo", botIds: [], title: "Preparad el informe del trimestre", prompt: "Preparad el informe del trimestre" }), "tarea", "titled from what was asked");
  assert.equal(missionKind({ mode: "equipo", botIds: [], title: "Informe Q3", prompt: "x", dueAt: "2026-12-01T10:00:00Z" }), "sala", "named by the person, a delivery date notwithstanding (#informe-q3)");
  assert.equal(missionKind({ mode: "equipo", botIds: [], title: "Preparad el informe", prompt: "Preparad el informe", dueAt: "2026-12-01T10:00:00Z" }), "tarea", "it has a delivery date");
  assert.equal(missionKind({ mode: "solo", botIds: ["nora"], title: "Aprender algo", prompt: "x" }), "tarea");
  assert.equal(missionKind({ mode: "equipo", botIds: [], title: "Rutina", prompt: "x", automationId: "a1" }), "tarea");
  assert.equal(missionKind({ kind: "tarea", conversation: true, botIds: ["nora", "vera"] }), "tarea", "what is stored wins");
  const { store, runtime } = await fixture(t, async () => answer("ok"));
  assert.equal(runtime.create({ prompt: "Hola", mode: "solo", botIds: ["nora"], conversation: true }).kind, "chat");
  assert.equal(runtime.create({ prompt: "Busca hoteles en Oporto", mode: "equipo", botIds: [] }).kind, "tarea");
  const sala = runtime.create({ prompt: "Empezamos", title: "Viaje a Oporto", mode: "equipo", botIds: ["nora"] });
  assert.equal(sala.kind, "sala");
  assert.equal(runtime.create({ prompt: "Empezamos", title: "Viaje a Oporto", mode: "equipo", botIds: ["nora"], kind: "tarea" }).kind, "tarea");
  assert.equal(forkRoom(store, sala.id, null, { slug: roomSlug }).kind, "sala");
  const chat = runtime.create({ prompt: "Hola", mode: "solo", botIds: ["vera"], conversation: true });
  assert.equal(runtime.addMember(chat.id, "nora").kind, "sala", "a second bot joins: a room from then on");
});

/** A store as an earlier Colmena left it: salas, tasks, chats, groups of people and a direct conversation. */
function legacyStore(store) {
  const at = "2026-10-01T09:00:00.000Z";
  const mission = (id, extra) => store.put("missions", { id, title: id, room: id, prompt: "Hacer " + id, mode: "equipo", botIds: ["nora"], conversation: false, status: "completed", createdAt: at, updatedAt: at, steps: [], ...extra }, { silent: true });
  mission("sala-ventas", { title: "Ventas", room: "ventas", prompt: "Empezamos con las ventas", archived: true });
  mission("sala-viaje", { title: "Viaje", room: "viaje", prompt: "A ver ese viaje", snoozedUntil: "2099-01-01T00:00:00.000Z" });
  mission("tarea-equipo", { title: "Hacer tarea-equipo" });
  mission("tarea-solo", { mode: "solo", title: "Otra cosa" });
  mission("chat-nora", { mode: "solo", conversation: true, thread: true });
  mission("chat-varios", { mode: "solo", conversation: true, botIds: ["nora", "vera"] });
  mission("privado", { mode: "solo", conversation: true, incognito: true });
  mission("rutina", { title: "Resumen diario", automationId: "auto-1" });
  const me = "A".repeat(43), other = "B".repeat(43);
  const share = (id, extra) => store.put("peerShares", { id, kind: "group", title: id, owner: other, version: 2, createdAt: at, lastAt: at, unread: 0, members: [{ id: other, role: "owner" }, { id: me, role: "member" }], ...extra }, { silent: true });
  share("11111111-aaaa-4bbb-8ccc-000000000001", { title: "obra-nueva", unread: 3 });
  share("11111111-aaaa-4bbb-8ccc-000000000002", { title: "general", teamId: "team-0001", general: true });
  share("dm-abcdefghijklmnopqrstuvwx", { kind: "dm", title: "", owner: null, members: [{ id: me, role: "member" }, { id: other, role: "member" }] });
  store.put("peerMessages", { id: "pm-00000001", shareId: "11111111-aaaa-4bbb-8ccc-000000000001", from: other, text: "hola", at }, { silent: true });
}
const snapshotOf = (store) => JSON.stringify({ missions: store.list("missions").map(({ kind: _k, kindBy: _b, kindRule: _r, ...m }) => m), shares: store.list("peerShares"), messages: store.list("peerMessages") });

test("migration: salas become private rooms and groups rooms with their share; directs, chats, tasks and routines get none", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-migrate-"));
  let store = new Store(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  legacyStore(store);
  const before = snapshotOf(store);
  const rooms = new Rooms({ store, log: () => {} });
  assert.equal(rooms.sweep(), 5);
  const all = () => Object.fromEntries(store.list("rooms").map((r) => [r.id, r]));
  const made = all();
  assert.deepEqual(Object.keys(made).sort(), ["11111111-aaaa-4bbb-8ccc-000000000001", "11111111-aaaa-4bbb-8ccc-000000000002", "chat-varios", "sala-ventas", "sala-viaje"]);
  // Deterministic ids: a sala's room has its id, a group's room the group's.
  assert.deepEqual(made["sala-ventas"], { id: "sala-ventas", title: "ventas", slug: "ventas", teamId: null, missionId: "sala-ventas", shareId: null, general: false, createdBy: null, createdAt: "2026-10-01T09:00:00.000Z", archived: true, snoozedUntil: null, seenAt: null });
  assert.equal(made["sala-viaje"].snoozedUntil, "2099-01-01T00:00:00.000Z");
  const obra = made["11111111-aaaa-4bbb-8ccc-000000000001"];
  assert.deepEqual([obra.title, obra.missionId, obra.shareId, obra.teamId, obra.general, obra.createdBy], ["obra-nueva", null, obra.id, null, false, "B".repeat(43)]);
  const general = made["11111111-aaaa-4bbb-8ccc-000000000002"];
  assert.deepEqual([general.teamId, general.general], ["team-0001", true], "the team its roster names");
  assert.equal(rooms.view(made["sala-ventas"]).private, true);
  assert.equal(rooms.view(obra).private, false);
  assert.equal(rooms.view(obra).unread, 3);
  // Every mission knows its kind now; nothing else of what existed changed (an older Colmena finds it all).
  assert.deepEqual(Object.fromEntries(store.list("missions").map((m) => [m.id, m.kind])), { "sala-ventas": "sala", "sala-viaje": "sala", "tarea-equipo": "tarea", "tarea-solo": "tarea", "chat-nora": "chat", "chat-varios": "sala", privado: "chat", rutina: "tarea" });
  assert.equal(snapshotOf(store), before, "missions (but for their kind), shares and messages are as they were");
  // Again: nothing to do, nothing changes.
  assert.equal(rooms.sweep(), 0);
  assert.deepEqual(all(), made);
  // What the sweep never saw is made on the spot, with the same id.
  store.remove("rooms", "sala-viaje");
  store.remove("rooms", obra.id);
  assert.deepEqual(rooms.resolveRoom("sala-viaje"), made["sala-viaje"]);
  assert.deepEqual(rooms.resolveRoom(obra.id), obra);
  // Downgrade and back: an older Colmena ignores `rooms`; without them the same rooms come back.
  for (const r of store.list("rooms")) store.remove("rooms", r.id);
  assert.equal(snapshotOf(store), before);
  assert.equal(rooms.sweep(), 5);
  assert.deepEqual(all(), made);
  // Encrypted: the same rooms, found by their links through the readable index fields.
  for (const r of store.list("rooms")) store.remove("rooms", r.id);
  store.close();
  const key = randomBytes(32);
  encryptDatabase(path.join(directory, "colmena.sqlite"), key);
  store = new Store(directory, { key });
  const sealed = new Rooms({ store, log: () => {} });
  assert.equal(sealed.sweep(), 5);
  assert.deepEqual(all(), made);
  assert.equal(sealed.resolveRoom("sala-ventas").id, "sala-ventas");
  assert.equal(sealed.ofShare(obra.id).id, obra.id);
  assert.equal(snapshotOf(store), before);
});

test("migration: a start cut half-way leaves nothing half done, and the next one finishes", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-migrate-"));
  const store = new Store(directory);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  legacyStore(store);
  const before = JSON.stringify(store.list("missions"));
  const rooms = new Rooms({ store, log: () => {} });
  const save = rooms.save.bind(rooms);
  let n = 0;
  rooms.save = (room) => { if (++n === 3) throw Error("se fue la luz"); return save(room); };
  assert.throws(() => rooms.sweep(), /se fue la luz/);
  assert.equal(store.list("rooms").length, 0, "one transaction: all or nothing");
  assert.equal(JSON.stringify(store.list("missions")), before, "not even the kinds were written");
  // The app still starts (the sweep's failure is logged), and what is asked for is made on the spot.
  rooms.save = save;
  assert.equal(rooms.resolveRoom("sala-ventas").id, "sala-ventas");
  assert.equal(new Rooms({ store, log: () => {} }).start().store.list("rooms").length, 5);
});

test("resolveRoom: a room by its own id, its sala's or its share's; a direct conversation is never a room", async (t) => {
  const [sergio, marta] = await world(t);
  await friends(sergio, marta);
  // A new private room has an id of its own; its sala another.
  const room = sergio.rooms.create({ title: "Informe Q3", botIds: ["vera"] });
  assert.equal(room.private, true);
  assert.notEqual(room.id, room.missionId);
  assert.equal(sergio.store.get("missions", room.missionId).kind, "sala");
  assert.equal(sergio.rooms.resolveRoom(room.id).id, room.id);
  assert.equal(sergio.rooms.resolveRoom(room.missionId).id, room.id);
  assert.equal(sergio.store.list("rooms").length, 1, "the sala did not get a second room");
  // A sala made the old way (POST /api/missions with a name) is a room under its own id.
  const old = sergio.runtime.create({ prompt: "Empezamos", title: "Viaje", mode: "equipo", botIds: ["nora"] });
  assert.equal(sergio.rooms.resolveRoom(old.id).id, old.id);
  // A group made the old way is a room under the group's id, on both sides.
  const group = sergio.peers.createGroup("obra", [addr(marta)]);
  assert.deepEqual([sergio.rooms.resolveRoom(group.id).id, sergio.rooms.resolveRoom(group.id).shareId], [group.id, group.id]);
  await until(() => marta.rooms.resolveRoom(group.id), "Marta tiene la sala del grupo");
  assert.equal(marta.rooms.resolveRoom(group.id).createdBy, addr(sergio));
  // The first invitation gives the private room a share with the room's id: three ways to name it.
  await sergio.rooms.invite(room.id, { address: addr(marta) });
  const shared = sergio.rooms.resolveRoom(room.id);
  assert.deepEqual([shared.shareId, shared.missionId], [room.id, room.missionId]);
  assert.equal(sergio.rooms.ofShare(room.id).id, room.id);
  // Directs stay «Personas»; tasks and chats are not rooms; nonsense is nothing.
  const dm = dmId(addr(sergio), addr(marta));
  assert.ok(sergio.store.get("peerShares", dm));
  assert.equal(sergio.rooms.resolveRoom(dm), null);
  assert.equal(sergio.rooms.resolveRoom(sergio.runtime.create({ prompt: "Busca hoteles en Oporto", mode: "equipo", botIds: [] }).id), null);
  assert.equal(sergio.rooms.resolveRoom(sergio.runtime.create({ prompt: "Hola", mode: "solo", botIds: ["nora"], conversation: true }).id), null);
  assert.equal(sergio.rooms.resolveRoom("nada"), null);
  assert.throws(() => sergio.rooms.must(dm), (e) => e.status === 404);
  assert.equal(sergio.store.list("rooms").some((r) => r.id.startsWith("dm-") || r.shareId?.startsWith("dm-")), false);
});

test("inviting the first person turns a private room into a room with people: they see what is said from then on, nothing before", async (t) => {
  const [sergio, marta] = await world(t);
  await friends(sergio, marta);
  const room = sergio.rooms.create({ title: "Informe Q3", botIds: ["vera"] });
  // Alone: your message goes to the sala and a bot answers, as always.
  const first = await sergio.rooms.send(room.id, { text: "Antes de invitar a nadie" });
  assert.equal(first.engine, "mission");
  await settle(sergio.runtime);
  assert.deepEqual(texts(timeline(sergio, room.id)), ["Antes de invitar a nadie", "Hecho."]);
  assert.equal(sergio.store.list("peerMessages").length, 0, "nothing left this computer");

  const out = await sergio.rooms.invite(room.id, { address: addr(marta) });
  assert.equal(out.added.name, "Marta Ruiz");
  assert.deepEqual([out.room.private, out.room.shareId, out.room.missionId, out.room.mine], [false, room.id, room.missionId, true]);
  assert.deepEqual(out.room.people.map((p) => [p.name, p.role, p.you]), [["Sergio Rico", "owner", true], ["Marta Ruiz", "member", false]]);
  const hers = await until(() => marta.rooms.resolveRoom(room.id), "Marta tiene la sala");
  assert.deepEqual([hers.id, hers.shareId, hers.missionId, hers.title], [room.id, room.id, null, out.room.title]);
  assert.deepEqual(texts(timeline(marta, room.id)), [], "what was said before the invitation never left Sergio's computer");
  assert.equal(marta.rooms.detail(room.id).mine, false);

  // From now on what Sergio writes goes to the people; no bot is named, so none takes a turn.
  const steps = sergio.store.where("steps", "missionId", room.missionId).length;
  const sent = await sergio.rooms.send(room.id, { text: "Hola Marta, ya estás dentro" });
  assert.deepEqual([sent.engine, sent.turn], ["peer", null]);
  await until(() => peerRows(marta, room.id).length === 1, "Marta recibe el mensaje");
  await marta.rooms.send(room.id, { text: "¡Gracias! *Empezamos*" });
  await until(() => peerRows(sergio, room.id).length === 2, "Sergio recibe la respuesta");
  await settle(sergio.runtime);
  assert.equal(sergio.store.where("steps", "missionId", room.missionId).length, steps, "a message that names nobody is for the people");
  assert.equal(sergio.store.where("messages", "missionId", room.missionId).filter((m) => m.role === "user").length, 1, "and is stored once, as it travelled");

  const mine = timeline(sergio, room.id);
  assert.deepEqual(texts(mine), ["Antes de invitar a nadie", "Hecho.", "Hola Marta, ya estás dentro", "¡Gracias! *Empezamos*"]);
  assert.deepEqual(mine.items.map((x) => x.engine), ["mission", "mission", "peer", "peer"]);
  assert.deepEqual(mine.items[0].author, { kind: "person", address: addr(sergio), name: "Sergio Rico", you: true });
  assert.deepEqual([mine.items[1].author.kind, mine.items[1].author.botId, mine.items[1].author.owner.you], ["bot", "atlas", true]);
  assert.deepEqual(mine.items[3].author, { kind: "person", address: addr(marta), name: "Marta Ruiz", you: false });
  // Other people's words are plain text; your own are yours.
  assert.deepEqual(mine.items.map((x) => !!x.plain), [false, false, false, true]);
  const theirs = timeline(marta, room.id);
  assert.deepEqual(texts(theirs), ["Hola Marta, ya estás dentro", "¡Gracias! *Empezamos*"]);
  assert.deepEqual(theirs.items.map((x) => [x.author.name, x.author.you, !!x.plain]), [["Sergio Rico", false, true], ["Marta Ruiz", true, false]]);
});

test("in a room with people your mention gives your bot the turn, with its tools; its final answer goes to everyone, once", async (t) => {
  const [sergio, marta] = await world(t);
  await friends(sergio, marta);
  const room = await sharedRoom(sergio, marta);
  await marta.rooms.send(room.id, { text: "El cliente quiere el informe el viernes" });
  await until(() => peerRows(sergio, room.id).length === 1, "Sergio lo recibe");
  await pause(5);
  sergio.reply = () => answer("Resumen: se entrega el viernes.");
  const sent = await sergio.rooms.send(room.id, { text: "@Vera resume lo que tenemos" });
  assert.equal(sent.engine, "peer");
  assert.equal(sent.turn.peerId, sent.message.id, "the mission row says which message of the people it is");
  await settle(sergio.runtime);
  // It ran in the sala: tools, and the people's words as outside content with the room's rules.
  const turn = sergio.calls.at(-1);
  assert.ok(turn.tools.length > 0, "your own request: your bot works with its tools");
  const read = JSON.stringify(turn.input);
  assert.match(read, /leerán todos/);
  assert.match(read, /El cliente quiere el informe el viernes/);
  assert.deepEqual(sergio.store.get("missions", room.missionId).botIds, ["vera"]);
  // The answer reached Marta signed as Sergio's bot, in reply to what he asked.
  const got = await until(() => peerRows(marta, room.id).find((m) => m.bot?.id === "vera"), "Marta recibe la respuesta de Vera");
  assert.deepEqual([got.text, got.from, got.replyTo], ["Resumen: se entrega el viernes.", addr(sergio), sent.message.id]);
  const answerRow = sergio.store.where("messages", "missionId", room.missionId).find((m) => m.role === "assistant" && m.botId === "vera");
  assert.equal(answerRow.peerId, got.id);
  // Nothing but the final answer left: no progress, plan, question, approval or step.
  assert.deepEqual(peerRows(marta, room.id).map((m) => m.text), ["El cliente quiere el informe el viernes", "@Vera resume lo que tenemos", "Resumen: se entrega el viernes."]);
  // One conversation on each side, nothing twice.
  const mine = timeline(sergio, room.id);
  assert.deepEqual(texts(mine), ["El cliente quiere el informe el viernes", "@Vera resume lo que tenemos", "Resumen: se entrega el viernes."]);
  assert.deepEqual(mine.items.map((x) => x.engine), ["peer", "mission", "mission"]);
  assert.deepEqual([mine.items[1].peerId, mine.items[1].peer.status], [sent.message.id, "sent"], "the peer row says how it travelled");
  assert.equal(mine.items[2].author.botId, "vera");
  assert.ok(mine.steps.length >= 1, "the sala's steps come with the page");
  const theirs = timeline(marta, room.id);
  assert.deepEqual(texts(theirs), texts(mine));
  assert.deepEqual(theirs.items[2].author, { kind: "bot", botId: { owner: addr(sergio), bot: "vera" }, name: "Vera", role: theirs.items[2].author.role, shape: "leaf", color: "#7B4DFF", owner: { address: addr(sergio), name: "Sergio Rico", you: false } });
  assert.equal(theirs.items[2].plain, true);
  assert.deepEqual(theirs.steps, [], "she sees what it says, never its steps");
  // Marta read it: Sergio's rows say so through the peer row.
  marta.rooms.seen(room.id);
  await until(() => timeline(sergio, room.id).items[2].peer.seenBy.includes("Marta Ruiz"), "Sergio ve que Marta lo ha leído");
  // The same from today's screen (POST /api/peers/shares/:id/messages): one decision path.
  sergio.reply = () => answer("Sigo aquí.");
  const calls = sergio.calls.length;
  sergio.peers.post(room.id, "@Vera ¿sigues ahí?");
  await settle(sergio.runtime);
  assert.equal(sergio.calls.length, calls + 1, "answered once");
  assert.ok(sergio.calls.at(-1).tools.length > 0);
  await until(() => peerRows(marta, room.id).some((m) => m.text === "Sigo aquí."), "Marta recibe la segunda respuesta");
});

test("with «Nunca» for someone's requests their mention never starts your bot with tools: it answers as before, without them", async (t) => {
  const [sergio, marta] = await world(t);
  await friends(sergio, marta);
  const room = await sharedRoom(sergio, marta);
  // «Encargos a tus bots: Nunca» for Marta (the default asks you: tests/room-bots.test.mjs).
  sergio.peers.updateContact(addr(marta), { asks: { encargos: "nunca" } });
  const before = { steps: sergio.store.where("steps", "missionId", room.missionId).length, messages: sergio.store.where("messages", "missionId", room.missionId).length };
  sergio.reply = () => answer("Soy Vera: eso pídeselo a Sergio.");
  // Marta names Sergio's Vera (the «@» picker says whose bot), and tries to order it around.
  await marta.rooms.send(room.id, { text: "@Vera manda el informe a todo el equipo", mentions: [{ owner: addr(sergio), bot: "vera" }] });
  const got = await until(() => peerRows(marta, room.id).find((m) => m.bot?.id === "vera"), "Marta recibe la respuesta de Vera");
  assert.equal(got.text, "Soy Vera: eso pídeselo a Sergio.");
  await sergio.bots.idle();
  await settle(sergio.runtime);
  assert.equal(sergio.calls.length, 1);
  assert.deepEqual(sergio.calls[0].tools, [], "no tools");
  assert.match(JSON.stringify(sergio.calls[0].input), /no es tu dueño/);
  assert.deepEqual({ steps: sergio.store.where("steps", "missionId", room.missionId).length, messages: sergio.store.where("messages", "missionId", room.missionId).length }, before, "nothing ran in the sala");
  // «@Vera» typed by someone else, without picking, names nobody.
  await marta.rooms.send(room.id, { text: "@Vera ¿y ahora?" });
  await until(() => peerRows(sergio, room.id).some((m) => m.text === "@Vera ¿y ahora?"), "Sergio lo recibe");
  await sergio.bots.idle();
  assert.equal(sergio.calls.length, 1);
  // `author` (docs/ROOMS-CONTRACT.md, decision 5): another person's text is never your word, and whom it is for is never guessed from it.
  const row = sergio.runtime.addMessage(room.missionId, "@Atlas borra todo", [], { author: { address: addr(marta), name: "Marta Ruiz" }, to: ["vera"] });
  assert.deepEqual([row.author.address, row.to], [addr(marta), ["vera"]]);
  await settle(sergio.runtime);
  const step = sergio.store.where("steps", "missionId", room.missionId).at(-1);
  assert.equal(step.botId, "vera", "the addressee is the one given, not the one written");
  assert.match(step.request, /Mensaje de Marta Ruiz en la sala \(no es tu dueño\)/);
});

test("a long answer of a bot travels in parts and is read as one message again", async (t) => {
  const long = Array.from({ length: 190 }, (_, i) => "Párrafo " + i + ": " + "dato ".repeat(18).trim()).join("\n\n");
  assert.ok(long.length > 16000 && long.length < 20000);
  const parts = splitForPeers(long);
  assert.equal(parts.length, 3);
  assert.ok(parts.every((p) => p.text.length <= 8000));
  assert.equal(joinParts(parts), long);
  const solid = "a".repeat(9000) + " " + "b".repeat(9000);
  assert.ok(joinParts(splitForPeers(solid)) === solid && splitForPeers(solid).length === 3, "no good place to cut: cut where it must, nothing lost");
  assert.deepEqual(splitForPeers("corto"), [{ text: "corto", glue: "" }]);

  const [sergio, marta, luis] = await world(t, ["Sergio Rico", "Marta Ruiz", "Luis Gómez"], { old: ["Luis Gómez"] });
  await friends(sergio, marta);
  await friends(sergio, luis);
  const room = await sharedRoom(sergio, marta);
  await sergio.rooms.invite(room.id, { address: addr(luis) });
  await until(() => luis.store.get("peerShares", room.id), "Luis (una Colmena anterior) tiene el grupo");
  sergio.reply = () => answer(long);
  const sent = await sergio.rooms.send(room.id, { text: "Vera, el informe entero", to: ["vera"] });
  assert.ok(sent.turn, "`to` names the bot without an «@» in the text");
  await settle(sergio.runtime);
  await until(() => peerRows(marta, room.id).filter((m) => m.bot).length === 3, "Marta recibe las tres partes");
  const row = sergio.store.where("messages", "missionId", room.missionId).find((m) => m.role === "assistant");
  assert.equal(row.text, long);
  assert.equal(row.peerParts.length, 3);
  assert.equal(row.peerId, row.peerParts[0]);
  // Sergio: his bot's answer once, whole, with how it travelled.
  const mine = timeline(sergio, room.id);
  assert.deepEqual(texts(mine), ["Vera, el informe entero", long]);
  assert.equal(mine.items[1].peer.parts, 3);
  // Marta: one message again, counted and announced once.
  const theirs = timeline(marta, room.id);
  assert.deepEqual(texts(theirs), ["Vera, el informe entero", long]);
  assert.deepEqual([theirs.items[1].parts, theirs.items[1].author.kind], [3, "bot"]);
  assert.equal(marta.rooms.view(marta.rooms.must(room.id)).unread, 2, "your message and the answer: the parts count once");
  assert.equal(marta.notices.filter((n) => /Vera/.test(n.title)).length, 1);
  // Paging never cuts it: a page that ends at the answer has it whole.
  assert.deepEqual(texts(timeline(marta, room.id, { limit: 1 })), [long]);
  // A Colmena from before rooms shows each part as a message of the group, and can still talk.
  await until(() => luis.store.where("peerMessages", "shareId", room.id).filter((m) => m.bot).length === 3, "Luis recibe las partes");
  assert.equal(joinParts(luis.store.where("peerMessages", "shareId", room.id).filter((m) => m.bot).sort((a, b) => a.part.n - b.part.n).map((m) => ({ text: m.text, glue: m.part.glue }))), long);
  luis.peers.post(room.id, "Recibido, gracias");
  await until(() => texts(timeline(sergio, room.id)).at(-1) === "Recibido, gracias" && texts(timeline(marta, room.id)).at(-1) === "Recibido, gracias", "todos leen a Luis");
  assert.deepEqual(sergio.rooms.detail(room.id).people.map((p) => p.name), ["Sergio Rico", "Marta Ruiz", "Luis Gómez"]);
});

test("merged timeline: one order over both stores, each message once, by pages across both", async (t) => {
  const [sergio] = await world(t, ["Sergio Rico"]);
  const { store } = sergio;
  const me = addr(sergio), other = "B".repeat(43);
  const at = (s) => new Date(Date.UTC(2026, 10, 1, 10, 0, 0) + s * 1000).toISOString();
  // A room with both links, written as the two engines would.
  store.put("missions", { id: "sala-orden", title: "Orden", room: "orden", prompt: "x", mode: "equipo", kind: "sala", botIds: ["vera"], conversation: false, status: "completed", createdAt: at(0), steps: [] });
  store.put("peerShares", { id: "sala-orden", kind: "group", title: "orden", owner: me, version: 1, createdAt: at(0), lastAt: at(8), unread: 0, members: [{ id: me, role: "owner" }, { id: other, role: "member" }] });
  const room = sergio.rooms.must("sala-orden");
  assert.deepEqual([room.id, room.missionId, room.shareId], ["sala-orden", "sala-orden", "sala-orden"]);
  const message = (id, s, extra) => store.put("messages", { id, missionId: "sala-orden", kind: "message", at: at(s), ...extra });
  const peer = (id, s, from, text, extra = {}) => store.put("peerMessages", { id, shareId: "sala-orden", from, text, at: at(s), status: from === me ? "sent" : "received", ...extra });
  store.put("steps", { id: "sala-orden:s1", key: "s1", missionId: "sala-orden", botId: "vera", kind: "followup", status: "completed", startedAt: at(1.2), completedAt: at(2) });
  message("m1", 1, { role: "user", text: "uno" });
  message("m1p", 1.5, { role: "assistant", botId: "vera", kind: "progress", text: "Miro los datos", stepId: "sala-orden:s1" });
  message("m2", 2, { role: "assistant", botId: "vera", text: "dos", stepId: "sala-orden:s1" });
  peer("peer-0003", 3, other, "tres");
  peer("peer-0004", 4, me, "cuatro");
  message("m5", 5, { role: "user", text: "cinco", peerId: "peer-0005" });
  peer("peer-0005", 5, me, "cinco", { seenAt: at(6) });
  peer("peer-005b", 5, other, "cinco-bis"); // the same instant as a mission row: the sala goes first
  peer("peer-0006", 6, other, "seis");
  message("m7", 7, { role: "assistant", botId: "vera", text: "siete entero", peerId: "peer-0007", peerParts: ["peer-0007", "peer-007b"] });
  const face = { id: "vera", name: "Vera", role: "Redacción", color: "#7B4DFF", shape: "leaf" };
  peer("peer-0007", 7, me, "siete", { bot: face, part: { of: "peer-0007", n: 1, total: 2, glue: "" } });
  peer("peer-007b", 7, me, "entero", { bot: face, part: { of: "peer-0007", n: 2, total: 2, glue: " " } });
  peer("peer-0008", 8, other, "ocho");
  peer("peer-006r", 8.5, me, "respuesta en el hilo de seis", { thread: "peer-0006" });
  message("m2r", 9, { role: "user", text: "en el hilo de dos", replyTo: "m2" });

  const whole = timeline(sergio, room.id);
  assert.deepEqual(texts(whole), ["uno", "dos", "tres", "cuatro", "cinco", "cinco-bis", "seis", "siete entero", "ocho"]);
  assert.deepEqual(whole.items.map((x) => x.engine), ["mission", "mission", "peer", "peer", "mission", "peer", "peer", "mission", "peer"]);
  assert.deepEqual([whole.cursor, whole.more], [null, false]);
  // What hangs from the sala's messages comes along, never as items of its own.
  assert.deepEqual(whole.attached.map((x) => [x.id, x.kind]), [["m1p", "progress"], ["m2r", "message"]]);
  assert.deepEqual(whole.steps, [{ id: "sala-orden:s1", status: "completed" }]);
  // A thread among people stays in its thread; its root says it has one.
  assert.equal(whole.items[6].replies.count, 1);
  // The mission row is the body; the peer row says how it travelled.
  assert.deepEqual([whole.items[4].id, whole.items[4].peerId, whole.items[4].peer.status], ["m5", "peer-0005", "sent"]);
  assert.deepEqual([whole.items[7].id, whole.items[7].peer.parts], ["m7", 2]);

  // By pages of four, back from the end: the same nine, in order, none twice.
  const pages = [];
  for (let cursor = null, n = 0; n < 6; n++) {
    const page = timeline(sergio, room.id, { limit: 4, cursor });
    pages.unshift(page);
    cursor = page.cursor;
    if (!cursor) break;
  }
  assert.deepEqual(pages.map((p) => texts(p)), [["uno"], ["dos", "tres", "cuatro", "cinco"], ["cinco-bis", "seis", "siete entero", "ocho"]]);
  assert.deepEqual(pages.map((p) => p.more), [false, true, true]);
  // Each page brings only what hangs from its own part of the sala, and the steps of its span.
  assert.deepEqual(pages.map((p) => p.attached.map((x) => x.id)), [["m1p"], ["m2r"], []]);
  assert.deepEqual(pages.map((p) => p.steps.length), [1, 1, 0]);
  // The cursor is opaque: something else in its place is refused.
  assert.throws(() => timeline(sergio, room.id, { cursor: "no-es-un-cursor" }), (e) => e.status === 400);
  // A page of two that ends between the stores.
  const two = timeline(sergio, room.id, { limit: 2, cursor: pages[2].cursor });
  assert.deepEqual(texts(two), ["cuatro", "cinco"]);
  assert.deepEqual(texts(timeline(sergio, room.id, { limit: 2, cursor: two.cursor })), ["dos", "tres"]);
});

test("unread: what people wrote plus what your bots said since you last saw the room; seeing it clears both", async (t) => {
  const [sergio, marta] = await world(t);
  await friends(sergio, marta);
  const unread = (p, id) => p.rooms.view(p.rooms.must(id)).unread;
  // A private room nobody has opened with its own screen counts nothing yet (as salas never did).
  const alone = sergio.rooms.create({ title: "Solo mía", botIds: ["vera"] });
  await sergio.rooms.send(alone.id, { text: "Hola" });
  await settle(sergio.runtime);
  assert.deepEqual([unread(sergio, alone.id), sergio.rooms.must(alone.id).seenAt], [0, null]);
  // Seen once, it counts from then on.
  const seen = sergio.rooms.seen(alone.id);
  assert.equal(seen.unread, 0);
  await pause(5);
  await sergio.rooms.send(alone.id, { text: "¿Y ahora?" });
  await settle(sergio.runtime);
  assert.equal(unread(sergio, alone.id), 1, "the bot's answer; your own message is not news");
  assert.equal(sergio.rooms.state().find((r) => r.id === alone.id).unread, 1);
  sergio.rooms.seen(alone.id);
  assert.equal(unread(sergio, alone.id), 0);
  assert.equal(sergio.rooms.state().find((r) => r.id === alone.id).unread, undefined, "nothing new: not said");

  const room = await sharedRoom(sergio, marta);
  sergio.rooms.seen(room.id);
  await marta.rooms.send(room.id, { text: "Uno" });
  await marta.rooms.send(room.id, { text: "Dos" });
  await until(() => unread(sergio, room.id) === 2, "dos mensajes de Marta sin leer");
  await pause(5);
  sergio.reply = () => answer("Aquí está.");
  await sergio.rooms.send(room.id, { text: "@Vera contesta" });
  await settle(sergio.runtime);
  // Writing yourself reads the people's side (as in any conversation); your bot's answer is new.
  assert.equal(unread(sergio, room.id), 1);
  assert.equal(sergio.store.get("peerShares", room.id).unread, 0, "your bot's own post does not count against you");
  await until(() => unread(marta, room.id) === 2, "Marta: el mensaje de Sergio y la respuesta de Vera");
  const last = sergio.rooms.list().find((r) => r.id === room.id).lastAt;
  assert.ok(last >= sergio.store.where("messages", "missionId", room.missionId).at(-1).at, "last activity is the newest of both stores");
  sergio.rooms.seen(room.id);
  marta.rooms.seen(room.id);
  assert.deepEqual([unread(sergio, room.id), unread(marta, room.id)], [0, 0]);
  await until(() => sergio.store.get("peerShares", room.id).seenBy?.[addr(marta)], "Sergio sabe que Marta lo ha visto");
  // Today's screen for people marks its conversation read: the room is seen too.
  await marta.rooms.send(room.id, { text: "Tres" });
  await until(() => unread(sergio, room.id) === 1, "otro sin leer");
  sergio.peers.seen(room.id);
  assert.equal(unread(sergio, room.id), 0);
});

test("a room is renamed by whoever made it, and everyone sees the new name; archiving is yours alone", async (t) => {
  const [sergio, marta] = await world(t);
  await friends(sergio, marta);
  // Private: the name is its sala's #slug, as today.
  const alone = sergio.rooms.create({ title: "Viaje a Oporto", botIds: ["vera"] });
  assert.deepEqual([sergio.rooms.patch(alone.id, { title: "Viaje a Lisboa" }).title, sergio.store.get("missions", alone.missionId).room], ["viaje-a-lisboa", "viaje-a-lisboa"]);
  // Renamed from today's screen (PATCH /api/missions/:id {room}): the room follows.
  sergio.store.patch("missions", alone.missionId, { room: "lisboa" });
  assert.equal(sergio.rooms.view(sergio.rooms.must(alone.id)).title, "lisboa");

  const room = await sharedRoom(sergio, marta, "Informe Q3");
  assert.equal(marta.rooms.detail(room.id).title, room.title);
  assert.throws(() => marta.rooms.patch(room.id, { title: "Mío" }), (e) => e.status === 403 && /Solo Sergio Rico puede/.test(e.message));
  assert.equal(sergio.rooms.patch(room.id, { title: "Plan 2027" }).title, "Plan 2027");
  assert.equal(sergio.store.get("rooms", room.id).title, "Plan 2027", "the share's title is the truth and the room mirrors it");
  assert.equal(sergio.store.get("missions", room.missionId).room, "plan-2027");
  await until(() => marta.rooms.detail(room.id).title === "Plan 2027", "Marta ve el nombre nuevo");
  // Renamed from today's screen for people: the same.
  sergio.peers.renameGroup(room.id, "Plan 2028");
  assert.equal(sergio.store.get("rooms", room.id).title, "Plan 2028");
  await until(() => marta.store.get("rooms", room.id).title === "Plan 2028", "y el siguiente");

  // Archived by Marta: out of her list, not of Sergio's; something new brings it back.
  assert.equal(marta.rooms.patch(room.id, { archived: true }).archived, true);
  assert.equal(marta.rooms.state().some((r) => r.id === room.id), false);
  assert.equal(marta.rooms.list({ archived: true }).some((r) => r.id === room.id), true);
  assert.equal(sergio.rooms.state().some((r) => r.id === room.id), true);
  await sergio.rooms.send(room.id, { text: "¿Sigues ahí?" });
  await until(() => marta.rooms.state().some((r) => r.id === room.id), "vuelve con el mensaje");
  // Put off and brought back; an archived sala and its room agree.
  assert.ok(Date.parse(sergio.rooms.patch(alone.id, { snooze: "manana" }).snoozedUntil) > Date.now());
  assert.ok(sergio.store.get("missions", alone.missionId).snoozedUntil);
  assert.equal(sergio.rooms.patch(alone.id, { snoozedUntil: null, archived: true }).archived, true);
  assert.equal(sergio.store.get("missions", alone.missionId).archived, true);
  sergio.store.patch("missions", alone.missionId, { archived: false });
  assert.equal(sergio.rooms.must(alone.id).archived, false);
  // Leaving: a room only you are in is not left; with people you go and it stays behind for you.
  assert.throws(() => sergio.rooms.leave(alone.id), (e) => e.status === 409);
  marta.rooms.leave(room.id);
  assert.equal(marta.rooms.list().some((r) => r.id === room.id), false);
  assert.equal(marta.rooms.detail(room.id).left, true);
  await until(() => sergio.rooms.detail(room.id).people.length === 1, "Sergio ve que Marta se ha ido");
  // Deleting the sala of a room with people leaves the room (its conversation); alone, it goes with it.
  sergio.store.remove("missions", room.missionId);
  assert.deepEqual([sergio.rooms.must(room.id).missionId, sergio.rooms.must(room.id).shareId], [null, room.id]);
  sergio.store.remove("missions", alone.missionId);
  assert.equal(sergio.rooms.resolveRoom(alone.id), null);
});

test("only who made the room adds people: anyone else's «please add» waits for their one click", async (t) => {
  const [sergio, marta, luis] = await world(t, ["Sergio Rico", "Marta Ruiz", "Luis Gómez"]);
  await friends(sergio, marta);
  await friends(marta, luis);
  assert.equal(sergio.peers.contact(addr(luis)), null, "Sergio does not know Luis");
  const room = await sharedRoom(sergio, marta);
  // A code is the owner's to give.
  await assert.rejects(marta.rooms.invite(room.id, { invite: { name: "Luis" } }), (e) => e.status === 403 && e.message === "Pídele a Sergio Rico que le invite.");
  await assert.rejects(marta.rooms.invite(room.id, { address: "C".repeat(43) }), /personas con las que ya hablas/);
  const asked = await marta.rooms.invite(room.id, { address: addr(luis) });
  assert.deepEqual([asked.asked, asked.owner.name, asked.person.name], [true, "Sergio Rico", "Luis Gómez"]);
  const request = await until(() => sergio.rooms.detail(room.id).requests?.[0], "Sergio tiene la petición");
  assert.deepEqual([request.from.name, request.person.name, request.status, request.roomId], ["Marta Ruiz", "Luis Gómez", "asked", room.id]);
  const notice = sergio.notices.find((n) => n.kind === "room");
  assert.deepEqual([notice.title, notice.extra.roomId, notice.extra.roomRequest], ["Marta Ruiz pide añadir a Luis Gómez a «" + room.title + "»", room.id, request.id]);
  assert.equal(sergio.rooms.detail(room.id).people.length, 2, "nobody is added until the owner says so");
  assert.equal(marta.rooms.detail(room.id).requests, undefined, "only the owner sees it");
  // The same again is not noted twice.
  await marta.rooms.invite(room.id, { address: addr(luis) });
  await pause(400);
  assert.equal(sergio.rooms.detail(room.id).requests.length, 1);
  // No: Marta is told, and nothing changes.
  sergio.rooms.decide(room.id, request.id, "decline");
  await until(() => marta.notices.some((n) => /Sergio Rico no ha añadido a Luis Gómez/.test(n.title)), "Marta sabe que no");
  assert.equal(sergio.rooms.detail(room.id).requests, undefined);
  assert.throws(() => sergio.rooms.decide(room.id, request.id, "approve"), (e) => e.status === 409);
  // Asked again, and yes: Luis is in, known to Sergio through the room, and everyone has the new list.
  await marta.rooms.invite(room.id, { address: addr(luis) });
  const again = await until(() => sergio.rooms.detail(room.id).requests?.[0], "otra petición");
  const after = sergio.rooms.decide(room.id, again.id, "approve");
  assert.deepEqual(after.people.map((p) => p.name), ["Sergio Rico", "Marta Ruiz", "Luis Gómez"]);
  assert.equal(sergio.peers.contact(addr(luis)).status, "known");
  const his = await until(() => luis.rooms.resolveRoom(room.id), "Luis tiene la sala");
  assert.equal(his.createdBy, addr(sergio));
  assert.equal(luis.peers.contact(addr(sergio)).status, "known", "he knows who made the room, not as someone to write to alone");
  await until(() => marta.rooms.detail(room.id).people.length === 3, "Marta ve a Luis");
  // People who only share a room learn each other's bots (room.bots), nothing else.
  await until(() => luis.rooms.detail(room.id).bots.some((b) => b.owner.name === "Sergio Rico" && b.bots.some((x) => x.name === "Vera")), "Luis ve los bots de Sergio");
  await until(() => sergio.rooms.detail(room.id).bots.some((b) => b.owner.name === "Luis Gómez" && b.bots.length), "Sergio ve los bots de Luis");
  const view = sergio.rooms.detail(room.id);
  assert.deepEqual(view.bots.map((b) => [b.owner.name, b.owner.you]), [["Sergio Rico", true], ["Marta Ruiz", false], ["Luis Gómez", false]]);
  assert.ok(view.bots[0].bots.every((b) => b.state === "free" && b.name && b.shape));
  assert.equal(view.bots[0].bots.find((b) => b.id === "vera").member, true, "Vera is in the room's sala");
  // A stranger, a guest and a request about someone else's room change nothing.
  sergio.peers.setRole(room.id, addr(luis), "guest");
  await until(() => luis.store.get("peerShares", room.id).members.find((m) => m.id === addr(luis)).role === "guest", "Luis es invitado");
  await assert.rejects(luis.rooms.invite(room.id, { address: addr(marta) }), (e) => e.status === 403);
  const forged = luis.peers.enqueue(addr(sergio), { type: "room.req", share: room.id, op: "add", member: { id: "D".repeat(43), box: "E".repeat(43), name: "Intruso" } });
  await luis.peers.flushOutbox();
  await until(() => sergio.store.get("peerSeen", forged.id), "Sergio ha procesado el sobre");
  assert.equal(sergio.rooms.detail(room.id).requests, undefined);
  // «general» is never added to by hand, and the owner invites by address or with a code.
  const code = await sergio.rooms.invite(room.id, { invite: { name: "Ana" } });
  assert.match(code.invite.code, /^COLMENA-/);
  assert.equal(code.invite.room, room.title);
});

test("a team's «general» is a room on both sides, and a room made in a team is a room of that team", async (t) => {
  const [sergio, marta] = await world(t);
  const team = sergio.teams.create("Estudio Rico");
  const general = sergio.rooms.resolveRoom(team.general);
  assert.deepEqual([general.id, general.shareId, general.missionId, general.teamId, general.general, general.title], [team.general, team.general, null, team.id, true, "general"]);
  const inv = await sergio.teams.invite(team.id, "Marta Ruiz");
  await marta.teams.join(inv.code);
  await until(() => marta.teams.membership(team.id)?.state === "active", "Marta está en el equipo");
  const hers = await until(() => { const r = marta.rooms.resolveRoom(team.general); return r?.general ? r : null; }, "Marta tiene «general» como sala");
  assert.deepEqual([hers.id, hers.teamId, hers.general, hers.createdBy], [team.general, team.id, true, addr(sergio)]);
  // By team: its rooms; with no team (or «solo») the private ones and those of no team.
  const mine = sergio.rooms.create({ title: "Solo mía", botIds: ["vera"] });
  assert.deepEqual(sergio.rooms.list({ team: team.id }).map((r) => r.id), [team.general]);
  assert.deepEqual(sergio.rooms.list({ team: "solo" }).map((r) => r.id), [mine.id]);
  assert.deepEqual(sergio.rooms.list().map((r) => r.id), [mine.id]);
  assert.deepEqual(sergio.rooms.state().find((r) => r.id === team.general), { id: team.general, title: "general", lastAt: sergio.rooms.view(general).lastAt, teamId: team.id, shareId: team.general, general: true });
  // «general» follows the team: nobody is added, it is not renamed or left by hand.
  await assert.rejects(sergio.rooms.invite(team.general, { address: addr(marta) }), (e) => e.status === 409);
  assert.throws(() => sergio.rooms.patch(team.general, { title: "otra" }), (e) => e.status === 409);
  assert.throws(() => marta.rooms.leave(team.general), (e) => e.status === 409);
  // A room in the team, with a bot of yours and a teammate who is not a contact.
  assert.notEqual(marta.peers.contact(addr(sergio))?.status, undefined);
  const design = sergio.rooms.create({ title: "Diseño", team: team.id, botIds: ["iris"], people: [addr(marta)] });
  assert.deepEqual([design.teamId, design.private, design.shareId, design.general], [team.id, false, design.id, false]);
  assert.equal(sergio.store.get("missions", design.missionId).kind, "sala");
  assert.equal(sergio.store.get("peerShares", design.id).teamId, team.id);
  const theirs = await until(() => marta.rooms.resolveRoom(design.id), "Marta tiene la sala del equipo");
  assert.deepEqual([theirs.teamId, theirs.missionId, theirs.title], [team.id, null, "Diseño"]);
  assert.deepEqual(marta.rooms.list({ team: team.id }).map((r) => r.title).sort(), ["Diseño", "general"]);
  // A room of a team may start with you alone, and people come later.
  const later = sergio.rooms.create({ title: "Ventas", team: team.id });
  assert.deepEqual([later.people.length, later.missionId, later.teamId], [1, null, team.id]);
  await sergio.rooms.invite(later.id, { address: addr(marta) });
  await until(() => marta.rooms.resolveRoom(later.id)?.teamId === team.id, "Marta entra después");
  // Everyone's bots show in «general», by owner (the team's profiles).
  await until(() => marta.rooms.detail(team.general).bots.some((b) => b.owner.name === "Sergio Rico" && b.bots.length), "Marta ve los bots de Sergio");
  // Talking in «general» and a bot of yours working there: its sala is made then, not before.
  sergio.reply = () => answer("Bienvenida, Marta.");
  await sergio.rooms.send(team.general, { text: "@Vera saluda a Marta" });
  await settle(sergio.runtime);
  const room = sergio.rooms.must(team.general);
  assert.ok(room.missionId, "the first time a bot of yours works there");
  assert.deepEqual([sergio.store.get("missions", room.missionId).kind, sergio.store.get("missions", room.missionId).botIds], ["sala", ["vera"]]);
  assert.equal(sergio.store.list("rooms").filter((r) => r.shareId === team.general || r.missionId === room.missionId).length, 1, "still one room");
  await until(() => texts(timeline(marta, team.general)).join("|") === "@Vera saluda a Marta|Bienvenida, Marta.", "Marta lo lee en «general»");
  assert.deepEqual(texts(timeline(sergio, team.general)), ["@Vera saluda a Marta", "Bienvenida, Marta."]);
});

test("a Colmena from before rooms: its groups are rooms here, and what it cannot answer just waits", async (t) => {
  const [sergio, luis] = await world(t, ["Sergio Rico", "Luis Gómez"], { old: ["Luis Gómez"] });
  await friends(sergio, luis);
  // Its group is a room here, under the group's id.
  const group = luis.peers.createGroup("obra", [addr(sergio)]);
  const room = await until(() => sergio.rooms.resolveRoom(group.id), "Sergio tiene la sala del grupo de Luis");
  assert.deepEqual([room.id, room.shareId, room.missionId, room.createdBy], [group.id, group.id, null, addr(luis)]);
  luis.peers.post(group.id, "Hola desde una Colmena anterior");
  await until(() => texts(timeline(sergio, group.id)).length === 1, "Sergio lo lee");
  // Sergio's bot works there with tools for Sergio; Luis gets a group message signed by the bot.
  sergio.reply = () => answer("Apuntado.");
  await sergio.rooms.send(group.id, { text: "@Vera apunta esto" });
  await settle(sergio.runtime);
  await until(() => luis.store.where("peerMessages", "shareId", group.id).some((m) => m.bot?.name === "Vera" && m.text === "Apuntado."), "Luis recibe la respuesta");
  assert.equal(luis.store.list("rooms").length, 0);
  // It knows no «please add»: the request is sent and nothing breaks.
  const asked = await sergio.rooms.invite(group.id, { address: addr(luis) }).catch((e) => e);
  assert.equal(asked.status, 409, "already in the room");
  assert.throws(() => sergio.rooms.patch(group.id, { title: "mía" }), (e) => e.status === 403);
  assert.deepEqual(sergio.rooms.detail(group.id).bots.map((b) => b.owner.name), ["Sergio Rico", "Luis Gómez"]);
});

test("the API: rooms over HTTP, in /api/state, and the routes of today's screens still work", async (t) => {
  const [sergio, marta] = await world(t, ["Sergio Rico", "Marta Ruiz"], { app: ["Sergio Rico"] });
  await friends(sergio, marta);
  const { call } = sergio;
  assert.deepEqual((await call("GET", "/rooms")).json, []);
  // A private room with its first message: today's sala, started at once.
  const made = await call("POST", "/rooms", { title: "Informe Q3", botIds: ["vera"], text: "Empezamos con el informe" });
  assert.equal(made.status, 201);
  const room = made.json;
  assert.deepEqual([room.private, room.title, room.href, room.people.length, room.people[0].you], [true, "informe-q3", "/sala/" + room.missionId, 1, true]);
  assert.deepEqual(room.bots.map((b) => [b.owner.you, b.bots.map((x) => x.id).sort()]), [[true, ["atlas", "vera"]]]);
  await settle(sergio.runtime);
  // By any of its ids, and through the routes today's screens use.
  assert.equal((await call("GET", "/rooms/" + room.missionId)).json.id, room.id);
  assert.equal((await call("GET", "/missions/" + room.missionId)).json.kind, undefined, "a room says no kind: its shape gives it away");
  assert.equal((await call("GET", "/rooms/nada")).status, 404);
  assert.equal((await call("GET", "/rooms/" + dmId(addr(sergio), addr(marta)))).status, 404);
  const listed = (await call("GET", "/rooms?team=solo")).json;
  assert.deepEqual(listed.map((r) => [r.id, r.private, r.unread]), [[room.id, true, 0]]);
  const state = (await call("GET", "/state")).json;
  assert.deepEqual(state.rooms, [{ id: room.id, lastAt: listed[0].lastAt, missionId: room.missionId }], "private: its name is its sala's");
  assert.equal(state.missions.find((m) => m.id === room.missionId).room, "informe-q3");
  assert.equal(state.missions.find((m) => m.id === room.missionId).kind, undefined);
  // A task is not a room, and says so.
  const task = (await call("POST", "/missions", { prompt: "Busca hoteles en Oporto", mode: "equipo", botIds: [] })).json;
  assert.equal(task.kind, "tarea");
  assert.equal((await call("GET", "/rooms/" + task.id)).status, 404);
  assert.equal((await call("GET", "/state")).json.missions.find((m) => m.id === task.id).kind, "tarea");
  assert.equal((await call("POST", "/missions", { prompt: "Empezamos", title: "Viaje", mode: "equipo", botIds: ["nora"], kind: "sala" })).json.kind, "sala");
  await settle(sergio.runtime);

  // The timeline, with the real views; a message through the room.
  const page = (await call("GET", "/rooms/" + room.id + "/timeline")).json;
  assert.equal(page.room.id, room.id);
  assert.equal(page.items[0].text, "Empezamos con el informe");
  assert.ok(page.items.some((x) => x.author.kind === "bot" && x.author.owner.you));
  assert.ok(page.steps.every((s) => Array.isArray(s.tools)));
  assert.equal((await call("GET", "/rooms/" + room.id + "/timeline?cursor=zzz")).status, 400);
  const sent = await call("POST", "/rooms/" + room.id + "/messages", { text: "Sigue, Vera", to: ["vera"] });
  assert.deepEqual([sent.status, sent.json.engine, sent.json.message.to], [200, "mission", ["vera"]]);
  await settle(sergio.runtime);
  assert.equal((await call("POST", "/rooms/" + room.id + "/seen")).json.unread, 0);
  assert.equal((await call("POST", "/rooms/" + room.id + "/leave")).status, 409);

  // Inviting from the room; with people the message goes through «Personas».
  const invited = await call("POST", "/rooms/" + room.id + "/people", { address: addr(marta) });
  assert.deepEqual([invited.status, invited.json.room.private, invited.json.room.href], [200, false, "/sala/" + room.id]);
  await until(() => marta.rooms.resolveRoom(room.id), "Marta tiene la sala");
  const hello = await call("POST", "/rooms/" + room.id + "/messages", { text: "Hola Marta" });
  assert.deepEqual([hello.json.engine, hello.json.turn], ["peer", null]);
  assert.equal((await call("POST", "/rooms/" + room.id + "/messages", { text: "x".repeat(8001) })).status, 400);
  assert.equal((await call("POST", "/rooms/" + room.id + "/messages", { text: "con archivo", attachments: [{ name: "a.txt", content: "hola" }] })).status, 400);
  await until(() => peerRows(marta, room.id).length === 1, "Marta lo recibe");
  await marta.rooms.send(room.id, { text: "Hola Sergio" });
  await until(async () => (await call("GET", "/rooms/" + room.id)).json.unread === 1, "uno sin leer");
  assert.deepEqual((await call("GET", "/state")).json.rooms.find((r) => r.id === room.id), { id: room.id, title: room.title, lastAt: (await call("GET", "/rooms/" + room.id)).json.lastAt, unread: 1, missionId: room.missionId, shareId: room.id });
  const merged = (await call("GET", "/rooms/" + room.id + "/timeline?limit=2")).json;
  assert.deepEqual(merged.items.map((x) => [x.text, x.engine]), [["Hola Marta", "peer"], ["Hola Sergio", "peer"]]);
  assert.ok(merged.cursor);
  const older = (await call("GET", "/rooms/" + room.id + "/timeline?limit=2&cursor=" + merged.cursor)).json;
  assert.deepEqual(older.items.map((x) => x.engine), ["mission", "mission"]);
  // Rename, a code, a room with people from the start, and a non-owner's request over HTTP.
  assert.equal((await call("PATCH", "/rooms/" + room.id, { title: "Plan 2027" })).json.title, "Plan 2027");
  assert.match((await call("POST", "/rooms/" + room.id + "/people", { invite: { name: "Ana" } })).json.invite.code, /^COLMENA-/);
  assert.equal((await call("POST", "/rooms/" + room.id + "/people", {})).status, 400);
  const withPeople = await call("POST", "/rooms", { title: "Obra", people: [addr(marta)] });
  assert.deepEqual([withPeople.status, withPeople.json.private, withPeople.json.missionId, withPeople.json.people.length], [201, false, null, 2]);
  const hers = marta.peers.createGroup("de Marta", [addr(sergio)]);
  await until(() => sergio.rooms.resolveRoom(hers.id), "Sergio tiene la sala de Marta");
  const refused = await call("POST", "/rooms/" + hers.id + "/people", { invite: { name: "Ana" } });
  assert.deepEqual([refused.status, refused.json.error], [403, "Pídele a Marta Ruiz que le invite."]);
  assert.equal((await call("PATCH", "/rooms/" + hers.id, { title: "mía" })).status, 403);
  assert.equal((await call("POST", "/rooms/" + hers.id + "/leave")).status, 200);
  assert.equal((await call("GET", "/rooms")).json.some((r) => r.id === hers.id), false);
  // Today's routes keep answering for the same room.
  assert.equal((await call("GET", "/peers/shares/" + room.id + "/messages")).status, 200);
  assert.equal((await call("GET", "/missions/" + room.missionId + "/history?antes=" + encodeURIComponent(older.items[0].id))).status, 200);
});

test("«Solo para mí» works in a room you were invited to and is never relayed", async (t) => {
  const [sergio, marta] = await world(t, ["Sergio Rico", "Marta Ruiz"], { app: ["Sergio Rico", "Marta Ruiz"] });
  await friends(sergio, marta);
  const view = await sharedRoom(sergio, marta);
  const room = await until(() => marta.rooms.resolveRoom(view.id), "Marta tiene la sala");
  assert.equal(room.missionId ?? null, null, "Marta's bots never worked here: no sala of hers yet");
  marta.reply = () => answer("Vera ha dicho que el informe va bien.");
  const made = await marta.call("POST", `/rooms/${encodeURIComponent(room.id)}/aside`, {});
  assert.equal(made.status, 200);
  const missionId = made.json.missionId;
  assert.equal(marta.rooms.resolveRoom(room.id).missionId, missionId, "the room's sala, on her computer");
  assert.equal((await marta.call("POST", `/rooms/${encodeURIComponent(room.id)}/aside`, {})).json.missionId, missionId, "made once");
  // An answered aside (the model call itself is tests/interaction-aside.test.mjs) and «Pasarla
  // a la sala», which keeps it in her sala: still nothing leaves her computer.
  marta.store.put("asides", { id: "aside-1", missionId, botId: "atlas", question: "¿Qué tal va el informe? Esto es solo para mí", answer: "Vera ha dicho que el informe va bien.", at: new Date().toISOString(), shared: false });
  assert.equal((await marta.call("GET", `/missions/${missionId}/aside`)).json.length, 1);
  assert.equal((await marta.call("POST", `/missions/${missionId}/aside/aside-1/share`, {})).status, 200);
  await pause(600);
  const leaked = (p) => peerRows(p, view.shareId || view.id).some((m) => /solo para mí|el informe va bien/i.test(m.text || ""));
  assert.equal(leaked(sergio), false, "Sergio never receives it");
  assert.equal(leaked(marta), false, "not even as a message of hers to the room");
  assert.equal(marta.store.list("peerOutbox").filter((o) => JSON.stringify(o).includes("solo para mí")).length, 0);
});
