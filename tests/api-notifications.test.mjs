import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { Notifier } from "../server/notifications.mjs";

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-notify-")),
    store = new Store(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { store };
}
const at = (h, m = 0) => new Date(2026, 9, 15, h, m).getTime(); // Thursday 15 Oct 2026, local time

test("notifications only when a mission ends, needs the person or fails", async (t) => {
  const { store } = await fixture(t);
  const events = [];
  const notifier = new Notifier(store, { emit: (e) => events.push(e) });
  notifier.start();
  t.after(() => notifier.stop());
  store.put("missions", { id: "m1", title: "Informe Q3", mode: "equipo", botIds: [], room: "informe-q3", status: "queued", createdAt: new Date().toISOString() });
  for (const status of ["planning", "running", "running"]) store.patch("missions", "m1", { status, activityLine: "Iris está escribiendo" });
  assert.equal(store.list("notifications").length, 0, "intermediate steps never notify");

  store.put("approvals", { id: "a1", missionId: "m1", botId: "vera", kind: "send", title: "Enviar el resumen", status: "pending", createdAt: new Date().toISOString() });
  store.patch("missions", "m1", { status: "waiting" });
  store.patch("missions", "m1", { status: "running" });
  store.patch("missions", "m1", { status: "completed" });
  const list = store.list("notifications");
  assert.deepEqual(list.map((n) => n.kind), ["needs", "done"]);
  assert.equal(list[0].botId, "vera");
  assert.match(list[0].title, /^Vera te necesita en «Informe Q3»$/);
  assert.equal(list[0].text, "Enviar el resumen");
  assert.equal(list[0].url, "/sala/m1");
  assert.equal(list[1].read, false);
  assert.deepEqual(events.map((e) => e.type), ["notify", "notify"]);
  assert.equal(events[1].url, "/sala/m1");

  store.put("missions", { id: "m2", title: "Chat", mode: "solo", conversation: true, botIds: ["nora"], status: "running", createdAt: new Date().toISOString() });
  store.patch("missions", "m2", { status: "completed" });
  assert.equal(store.list("notifications").length, 2, "a chat reply is read in the chat itself");
  store.patch("missions", "m2", { status: "blocked", error: "Sin cuenta de IA" });
  const failed = store.list("notifications").find((n) => n.kind === "failed");
  assert.equal(failed.text, "Sin cuenta de IA");
  assert.equal(failed.url, "/chat/nora?c=m2");
});

test("Atlas's round: digest only when something waits, once per situation, in working hours", async (t) => {
  const { store } = await fixture(t);
  const notifier = new Notifier(store, { emit: () => {}, clock: () => at(10) });
  assert.equal(notifier.round(at(10)), null, "nothing to report → no notification");
  assert.equal(store.list("notifications").length, 0);

  store.put("approvals", { id: "a1", missionId: "m1", botId: "vera", kind: "question", status: "pending", createdAt: new Date(at(7)).toISOString() });
  store.put("approvals", { id: "a2", missionId: "m1", botId: "vera", kind: "question", status: "pending", createdAt: new Date(at(9, 45)).toISOString() });
  store.put("missions", { id: "m9", title: "Bloqueada", status: "blocked", createdAt: new Date(at(8)).toISOString() });
  store.put("skills", { id: "s1", name: "Conciliar", status: "pending", createdAt: new Date(at(10) - 4 * 86400000).toISOString() });
  store.put("skills", { id: "s2", name: "Nueva", status: "pending", createdAt: new Date(at(9)).toISOString() });
  store.put("automations", { id: "r1", name: "Precios", enabled: true, state: "blocked", error: "x", createdAt: new Date(at(8)).toISOString() });

  assert.equal(notifier.round(at(21)), null, "outside 8–20 h");
  const digest = notifier.round(at(10));
  assert.equal(digest.kind, "digest");
  assert.equal(digest.botId, "atlas");
  assert.equal(digest.text, "1 aprobación espera desde hace más de 2 h · 1 misión bloqueada · 1 automatización falla o espera · 1 habilidad lleva más de 3 días sin revisar.");
  assert.equal(digest.url, "/bandeja");
  assert.equal(notifier.round(at(10, 30)), null, "same situation → no repeated digest");
  store.patch("missions", "m9", { status: "completed" });
  assert.ok(notifier.round(at(11)), "a different situation → new digest");

  // maybeRound runs at most every 30 minutes.
  const quiet = new Notifier(store, { emit: () => {} });
  quiet.maybeRound(at(12));
  assert.equal(quiet.maybeRound(at(12, 10)), null);
});

test("GET /api/notifications, POST /read and unread in /api/state", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-notify-api-")),
    store = new Store(dir);
  const runtime = new Runtime(store, { respond: async () => { throw Error("no"); } });
  let origin;
  const app = createApp({ store, runtime, session: { status: () => null, models: [] }, getOrigin: () => origin });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    await runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
  const post = (route, body) => fetch(origin + "/api" + route, { method: "POST", headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: JSON.stringify(body) });
  const notifier = app.locals.scheduler.notifier;
  for (let i = 0; i < 12; i++) notifier.notify({ kind: "done", missionId: "m" + i, botId: "nora", title: "Nora ha terminado " + i, text: "Entrega lista" });
  let state = await (await fetch(origin + "/api/state")).json();
  assert.equal(state.unread, 12);
  assert.equal(state.notifications.length, 10);
  assert.equal(state.notifications[0].title, "Nora ha terminado 11");
  const all = await (await fetch(origin + "/api/notifications")).json();
  assert.equal(all.length, 12);
  assert.equal((await post("/notifications/read", {})).status, 400);
  const one = await (await post("/notifications/read", { ids: [all[0].id] })).json();
  assert.deepEqual([one.changed, one.unread], [1, 11]);
  assert.equal((await (await post("/notifications/read", { all: true })).json()).unread, 0);
  state = await (await fetch(origin + "/api/state")).json();
  assert.equal(state.unread, 0);
});
