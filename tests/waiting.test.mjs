import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { pendingCount } from "../server/notifications.mjs";
import { isExpired, waitingCount, waitingItems } from "../server/waiting.mjs";
import { countIn, needsCount, needsOf, waitingBy, waitingOf } from "../src/components/v2/needs.js";
import { needsYou } from "../src/lib/format.js";
import { sidebarModel } from "../src/lib/sidebar.js";

// One count of what waits for you (server/waiting.mjs): the list, and every number the app
// shows agreeing on the same seeded store: Inicio, the sidebar, Trabajo, Equipo, the taskbar.

const NOW = Date.now();
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const later = (min) => new Date(NOW + min * 60000).toISOString();

function seed(store) {
  const mission = (id, status, extra = {}) => store.put("missions", { id, title: id, room: id, prompt: "x", mode: "equipo", botIds: ["atlas", "vera"], conversation: false, status, createdAt: ago(300), updatedAt: ago(100), ...extra });
  const ask = (id, missionId, botId, kind, extra = {}) => store.put("approvals", { id, missionId, botId, kind, status: "pending", title: id, createdAt: ago(20), ...extra });
  // A task with two requests that wait and one put off.
  mission("m-task", "waiting");
  ask("a-perm", "m-task", "vera", "permission", { tool: "qa", createdAt: ago(50) });
  ask("a-q", "m-task", "vera", "question", { tool: "ask_user", options: [{ id: "o1", label: "Sí" }], createdAt: ago(40) });
  ask("a-off", "m-task", "vera", "write", { tool: "write_file", args: { path: "n.md" }, snoozedUntil: later(60) });
  // A task that waits for its plan, with no request of its own.
  mission("m-plan", "awaiting_plan", { updatedAt: ago(90) });
  // A task whose only request is put off: it comes back with it, it is not counted meanwhile.
  mission("m-off", "awaiting_plan");
  ask("a-plan-off", "m-off", "atlas", "plan", { tool: "propose_plan", snoozedUntil: later(30) });
  // A send that ran out of its 30 minutes: it cannot be approved, so it does not wait.
  mission("m-late", "waiting");
  ask("a-late", "m-late", "vera", "send", { tool: "qa_send", email: { to: ["a@x.com"], subject: "S", body: "B" }, createdAt: ago(45) });
  // A send still in time, in a chat with one bot.
  mission("m-chat", "waiting", { conversation: true, botIds: ["nora"], mode: "solo" });
  ask("a-send", "m-chat", "nora", "send", { tool: "qa_send", email: { to: ["a@x.com"], subject: "S", body: "B" }, createdAt: ago(10) });
  // A debate that waits for a choice but is archived, and one in a bot's own chat.
  mission("m-arch", "awaiting_choice", { archived: true });
  mission("m-pick", "awaiting_choice", { conversation: true, botIds: ["nora"], mode: "debate", updatedAt: ago(5) });
  // Settled work never waits.
  mission("m-done", "completed");
  ask("a-done", "m-done", "vera", "permission", { status: "approved", decidedAt: ago(2), decidedBy: "tú" });
  // The bot that watches your apps left a question; an answered one is gone.
  mission("m-watch", "completed", { conversation: true, botIds: ["nora"], watch: true, mode: "solo" });
  store.put("watchNotes", { id: "n-open", missionId: "m-watch", botId: "nora", status: "open", title: "Factura nueva", question: "¿La pago?", createdAt: ago(30) });
  store.put("watchNotes", { id: "n-old", missionId: "m-watch", botId: "nora", status: "answered", title: "Vieja", createdAt: ago(900) });
  // People: an errand someone sent to your bot waits for your OK; decided and outbound ones do not.
  store.put("peerErrands", { id: "e-in", dir: "in", from: "lucia", fromName: "Lucía Paz", bot: { id: "vera", name: "Vera" }, text: "Resume el acta de ayer", state: "asked", shareId: "dm-lucia", at: ago(15) });
  store.put("peerErrands", { id: "e-ok", dir: "in", from: "lucia", fromName: "Lucía Paz", bot: { id: "vera", name: "Vera" }, text: "Otra cosa", state: "working", shareId: "dm-lucia", at: ago(200) });
  store.put("peerErrands", { id: "e-out", dir: "out", to: "lucia", toName: "Lucía Paz", bot: { id: "x", name: "Nico" }, text: "Lo mío", state: "asked", at: ago(12) });
}
const EXPECTED = ["m-plan", "a-perm", "a-q", "n-open", "e-in", "a-send", "m-pick"]; // the oldest first

async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-waiting-"));
  const store = new Store(dir);
  const runtime = new Runtime(store, { respond: async () => { throw Error("No provider calls in API tests"); } });
  let origin;
  const server = http.createServer(createApp({ store, runtime, session: { status: () => null, models: [] }, getOrigin: () => origin }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    await runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { store, state: async () => (await fetch(origin + "/api/state")).json() };
}

test("a request to your bot in a room that has no sala yet waits in that room", async (t) => {
  const { store } = await setup(t);
  store.put("approvals", { id: "roomask:r1", missionId: null, roomId: "room-1", botId: "vera", kind: "question", tool: "room_request", status: "pending", title: "Marta pide a Vera", createdAt: ago(3), roomRequest: { id: "r1", roomId: "room-1" } });
  store.put("approvals", { id: "roomask:r2", missionId: "m-sala", roomId: "room-2", botId: "vera", kind: "question", tool: "room_request", status: "pending", title: "Luis pide a Vera", createdAt: ago(2), roomRequest: { id: "r2", roomId: "room-2" } });
  assert.deepEqual(waitingItems(store, NOW).map((i) => [i.id, i.missionId, i.roomId]), [["roomask:r1", null, "room-1"], ["roomask:r2", "m-sala", "m-sala"]]);
});

test("waitingItems: what waits for the person, each with its room, its bot and its kind", async (t) => {
  const { store } = await setup(t);
  seed(store);
  const items = waitingItems(store, NOW);
  assert.deepEqual(items.map((i) => i.id), EXPECTED);
  assert.deepEqual(items.map((i) => [i.kind, i.what, i.missionId, i.roomId, i.botId]), [
    ["mission", "awaiting_plan", "m-plan", "m-plan", null], // it waits as a room, not for one bot
    ["approval", "permission", "m-task", "m-task", "vera"],
    ["approval", "question", "m-task", "m-task", "vera"],
    ["note", "note", "m-watch", "m-watch", "nora"],
    ["errand", "errand", null, "dm-lucia", "vera"],
    ["approval", "send", "m-chat", "m-chat", "nora"],
    ["mission", "awaiting_choice", "m-pick", "m-pick", "nora"], // a bot's own chat names its bot
  ]);
  assert.equal(items.find((i) => i.kind === "errand").title, "Lucía pide a Vera: Resume el acta de ayer");
  assert.equal(waitingCount(store, NOW), 7);
  assert.equal(pendingCount(store, NOW), 7, "the taskbar and tray counter is the same list");
  // Put off: back when its time comes, and its room with it (never both).
  assert.deepEqual(waitingItems(store, NOW + 31 * 60000).map((i) => i.id).filter((id) => /off/.test(id)), ["a-plan-off"]);
  assert.equal(isExpired(store.get("approvals", "a-late"), NOW), true);
  assert.equal(isExpired(store.get("approvals", "a-send"), NOW), false);
  assert.equal(isExpired(store.get("approvals", "a-perm"), NOW + 9e9), false, "what stays on the computer never expires");
  // A key not given in time stops waiting too.
  store.put("approvals", { id: "a-key", missionId: "m-task", botId: "vera", kind: "secret", status: "pending", title: "Clave", expiresAt: later(5), createdAt: ago(1) });
  assert.equal(waitingCount(store, NOW), 8);
  assert.equal(waitingCount(store, NOW + 6 * 60000), 7);
});

test("every count is that list or a filter of it: Inicio, the sidebar, Trabajo, Equipo and the taskbar", async (t) => {
  const { store, state: load } = await setup(t);
  seed(store);
  const state = await load();
  const total = pendingCount(store);
  assert.equal(total, 7);
  assert.deepEqual(state.waiting.map((i) => i.id), EXPECTED, "/api/state carries the list");
  assert.ok(Buffer.byteLength(JSON.stringify(state.waiting)) / state.waiting.length < 220, "light: ids only");

  // Inicio and the sidebar.
  assert.equal(needsCount(state), total);
  const needs = needsOf(state);
  assert.deepEqual(needs.asks.map((a) => a.id).sort(), ["a-perm", "a-q", "a-send"]);
  assert.deepEqual(needs.choices.map((m) => m.id).sort(), ["m-pick", "m-plan"]);
  assert.deepEqual(needs.notes.map((n) => n.id), ["n-open"]);
  assert.deepEqual(needs.errands.map((e) => e.id), ["e-in"]);
  assert.deepEqual(needs.snoozed.map((a) => a.id), ["a-plan-off", "a-off"], "put off: beside the list, not in it");
  assert.equal(needs.asks.length + needs.choices.length + needs.notes.length + needs.errands.length, total);
  const model = sidebarModel({ ...state, peers: { shares: [{ id: "dm-lucia", kind: "dm", title: "Lucía Paz", members: [{ id: "me", me: true }, { id: "lucia", name: "Lucía Paz" }] }], contacts: [] } });
  assert.equal(model.waitingCount, total);
  assert.equal(model.summary.waiting, total);
  assert.ok(model.summary.text.endsWith("7 te esperan"), model.summary.text);
  assert.equal(model.people.find((p) => p.name === "Lucía Paz").waiting, 1, "what a person asks of your bot waits in your conversation with them");

  // Each room says how many of those things are its own; together with the errand, the total.
  const byRoom = Object.fromEntries(state.missions.filter((m) => m.waiting).map((m) => [m.id, m.waiting]));
  assert.deepEqual(byRoom, { "m-task": 2, "m-plan": 1, "m-chat": 1, "m-pick": 1, "m-watch": 1 });
  assert.equal(Object.values(byRoom).reduce((a, b) => a + b, 0) + needs.errands.length, total);
  assert.deepEqual(state.missions.filter(needsYou).map((m) => m.id).sort(), Object.keys(byRoom).sort());
  assert.equal(needsYou(state.missions.find((m) => m.id === "m-off")), false, "its only request is put off");
  assert.equal(needsYou(state.missions.find((m) => m.id === "m-late")), false, "its request expired");

  // Trabajo lists tasks only: its column counts the part of the list that is in tasks and says so.
  const tasks = state.missions.filter((m) => !m.conversation && m.status !== "cancelled" && !m.archived && needsYou(m));
  assert.deepEqual(tasks.map((m) => m.id).sort(), ["m-plan", "m-task"]);
  assert.deepEqual(countIn(tasks, total), { here: 3, total: 7, more: true, text: "3 de 7" });
  assert.deepEqual(countIn(state.missions, 5), { here: 6, total: 5, more: false, text: "6" });

  // Equipo: a bot's «te espera» is the list filtered by bot; the server's own word agrees.
  const { bots } = waitingBy(waitingOf(state));
  assert.deepEqual(Object.fromEntries(bots), { vera: 3, nora: 3 });
  const status = Object.fromEntries(state.bots.map((b) => [b.id, [b.status, b.waitingIn]]));
  assert.deepEqual(status.vera, ["espera", 2], "Vera: #m-task and the conversation with Lucía");
  assert.deepEqual(status.nora, ["espera", 3]);
  assert.deepEqual(status.atlas, ["libre", 0], "a plan put off does not make Atlas wait");
  assert.deepEqual(model.bots.filter((b) => b.waiting).map((b) => [b.id, b.state, b.waiting]), [["nora", "waiting", 3], ["vera", "waiting", 3]]);
});

test("a state without the list (a snapshot kept by an older version) counts the same way", async (t) => {
  const { store, state: load } = await setup(t);
  seed(store);
  store.remove("peerErrands", "e-in"); // the older state knew nothing of people-side asks
  const state = await load();
  const { waiting: _list, ...old } = state;
  const here = state.waiting.filter((i) => i.kind !== "errand");
  assert.deepEqual(waitingOf(old).map((i) => [i.kind, i.id, i.botId]), here.map((i) => [i.kind, i.id, i.botId]));
  assert.equal(needsCount(old), here.length);
});

test("a request you have just decided leaves the count at once", async (t) => {
  const { store, state: load } = await setup(t);
  seed(store);
  const state = await load();
  // The store hides the record while its undo notice is up (lib/undoToast.js).
  const hidden = { ...state, approvals: state.approvals.filter((a) => a.id !== "a-perm") };
  assert.equal(needsCount(hidden), 6);
  assert.equal(sidebarModel(hidden).waitingCount, 6);
});
