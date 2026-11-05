import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { Scheduler } from "../server/scheduler.mjs";
import { nextRun, normalizeTrigger, subtitle } from "../server/triggers.mjs";

// Routines that deliver into one conversation, «cada N minutos/horas», latest-only catch-up
// and edits that never overwrite each other (DeepSeek Harness schedule: targets, every, catch-up).

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-delivery-"));
  const store = new Store(directory);
  const created = [];
  const added = [];
  const runtime = {
    create(input) {
      const mission = store.put("missions", { id: "m" + (created.length + 1), title: input.title, prompt: input.prompt, mode: input.mode, botIds: input.botIds, automationId: input.automationId, status: "queued", createdAt: new Date().toISOString() });
      created.push(input);
      return mission;
    },
    addMessage(missionId, text) {
      added.push({ missionId, text });
      store.patch("missions", missionId, { status: "queued" });
      return store.put("messages", { id: "msg" + added.length, missionId, role: "user", text, kind: "message", at: new Date().toISOString() });
    },
    launch() {},
  };
  const scheduler = new Scheduler(store, runtime, () => true);
  t.after(async () => {
    scheduler.stop();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { store, scheduler, created, added };
}

const daily = () => normalizeTrigger({ type: "dia", config: { hora: "08:00", dias: [0, 1, 2, 3, 4, 5, 6] } });

test("«cada» triggers: 15 minutes at least, aligned to their anchor, with labels", () => {
  assert.throws(() => normalizeTrigger({ type: "cada", config: { cadaN: 10, cadaUnidad: "minutos" } }), /cada 15 minutos/);
  assert.throws(() => normalizeTrigger({ type: "cada", config: { cadaN: 200, cadaUnidad: "horas" } }), /168 horas/);
  const quarter = normalizeTrigger({ type: "cada", config: { cadaN: "15", cadaUnidad: "minutos" } });
  assert.deepEqual(quarter.config, { cadaN: 15, cadaUnidad: "minutos" });
  assert.equal(quarter.sentence, "pasen 15 minutos desde la vez anterior");
  assert.equal(normalizeTrigger({ type: "cada", config: { cadaN: 1, cadaUnidad: "horas" } }).sentence, "pase una hora desde la vez anterior");
  const anchor = "2026-11-05T10:00:00.000Z";
  assert.equal(nextRun(quarter, new Date("2026-11-05T10:20:00.000Z"), { anchor }), "2026-11-05T10:30:00.000Z");
  assert.equal(nextRun(quarter, new Date("2026-11-05T10:30:00.000Z"), { anchor }), "2026-11-05T10:45:00.000Z");
  assert.equal(nextRun(quarter, new Date("2026-11-05T09:00:00.000Z"), { anchor }), "2026-11-05T10:15:00.000Z");
  assert.equal(subtitle({ enabled: false, trigger: quarter }), "Cada 15 min · Pausada");
  assert.equal(subtitle({ enabled: false, trigger: normalizeTrigger({ type: "cada", config: { cadaN: 2, cadaUnidad: "horas" } }) }), "Cada 2 h · Pausada");
});

test("missed runs are caught up once, the latest, and say so", async (t) => {
  const { store, scheduler, created } = await fixture(t);
  const time = Date.parse("2026-11-05T12:07:00.000Z");
  const trigger = normalizeTrigger({ type: "cada", config: { cadaN: 1, cadaUnidad: "horas" } });
  // Closed since 08:00: 08, 09, 10, 11 and 12 came due; one run, for 12:00.
  store.put("automations", { id: "r", name: "Revisión", botId: "vera", prompt: "Revisa", enabled: true, trigger, anchorAt: "2026-11-05T07:00:00.000Z", nextRun: "2026-11-05T08:00:00.000Z" });
  scheduler.tick(time);
  assert.equal(created.length, 1);
  assert.match(created[0].prompt, /tenía 5 ejecuciones pendientes/);
  const rule = store.get("automations", "r");
  assert.equal(rule.lastScheduledAt, "2026-11-05T12:00:00.000Z");
  assert.equal(rule.lastMerged, 4);
  assert.equal(rule.nextRun, "2026-11-05T13:00:00.000Z");
  scheduler.tick(time + 1000);
  assert.equal(created.length, 1);
  // One run late (but only one) gets a short note; on time, none.
  store.patch("missions", "m1", { status: "completed" });
  store.patch("automations", "r", { nextRun: "2026-11-05T13:00:00.000Z" });
  scheduler.tick(Date.parse("2026-11-05T13:40:00.000Z"));
  assert.match(created[1].prompt, /tocaba el .*va con retraso/);
  assert.doesNotMatch(created[1].prompt, /pendientes/);
  store.patch("missions", "m2", { status: "completed" });
  scheduler.tick(Date.parse("2026-11-05T14:00:30.000Z"));
  assert.equal(created[2].prompt, "Revisa");
  // A daily rule away for months still runs once.
  store.put("automations", { id: "d", name: "Diario", botId: "vera", prompt: "Resume", enabled: true, trigger: daily(), nextRun: new Date(0).toISOString() });
  scheduler.tick(time);
  assert.equal(created.filter((c) => c.automationId === "d").length, 1);
  assert.ok(Date.parse(store.get("automations", "d").lastScheduledAt) <= time);
  assert.ok(Date.parse(store.get("automations", "d").lastScheduledAt) > time - 86400000);
});

test("«misma»: the conversation is created once, reused, and created again if deleted", async (t) => {
  const { store, scheduler, created, added } = await fixture(t);
  store.put("automations", { id: "r", name: "Resumen", botId: "vera", prompt: "Resume lo importante", enabled: true, trigger: daily(), delivery: { mode: "misma", missionId: null }, nextRun: new Date(0).toISOString() });
  const time = Date.now();
  scheduler.tick(time);
  assert.equal(created.length, 1);
  assert.equal(created[0].title, "Resumen");
  let rule = store.get("automations", "r");
  assert.deepEqual(rule.delivery, { mode: "misma", missionId: "m1" });
  // The next run goes into the same conversation, as a message.
  store.patch("missions", "m1", { status: "completed" });
  store.patch("automations", "r", { nextRun: new Date(time - 60000).toISOString() });
  scheduler.tick(time + 1000);
  assert.equal(created.length, 1);
  assert.equal(added.length, 1);
  assert.equal(added[0].missionId, "m1");
  assert.match(added[0].text, /^Rutina «Resumen»: Resume lo importante/);
  assert.equal(store.get("messages", "msg1").automationId, "r");
  rule = store.get("automations", "r");
  assert.equal(rule.deliveries.length, 1);
  assert.equal(rule.lastMissionId, "m1");
  const runs = scheduler.runs("r");
  assert.equal(runs.length, 2);
  assert.equal(runs.filter((x) => x.messageId === "msg1").length, 1);
  // Deleted: the next run creates a new one and keeps it.
  store.remove("missions", "m1");
  store.patch("automations", "r", { nextRun: new Date(time - 60000).toISOString() });
  scheduler.tick(time + 2000);
  assert.equal(created.length, 2);
  assert.deepEqual(store.get("automations", "r").delivery, { mode: "misma", missionId: "m2" });
});

test("a run due while the room is busy waits and goes as one delivery", async (t) => {
  const { store, scheduler, created, added } = await fixture(t);
  store.put("missions", { id: "room", title: "Ventas", status: "running", botIds: ["vera"], mode: "solo", createdAt: new Date().toISOString() });
  const trigger = normalizeTrigger({ type: "cada", config: { cadaN: 15, cadaUnidad: "minutos" } });
  store.put("automations", { id: "r", name: "Pulso", botId: "vera", prompt: "Mira las ventas", enabled: true, trigger, anchorAt: "2026-11-05T09:45:00.000Z", delivery: { mode: "sala", missionId: "room" }, nextRun: "2026-11-05T10:00:00.000Z" });
  // Busy at 10:00, 10:15 and 10:30: nothing is stacked.
  for (const t of ["10:00:10", "10:15:10", "10:30:10"]) scheduler.tick(Date.parse("2026-11-05T" + t + ".000Z"));
  assert.equal(added.length, 0);
  assert.equal(store.get("automations", "r").state, "running");
  // Free at 10:40: one message for the three.
  store.patch("missions", "room", { status: "completed" });
  scheduler.tick(Date.parse("2026-11-05T10:40:00.000Z"));
  assert.equal(added.length, 1);
  assert.equal(created.length, 0);
  assert.equal(added[0].missionId, "room");
  assert.match(added[0].text, /tenía 3 ejecuciones pendientes/);
  const rule = store.get("automations", "r");
  assert.equal(rule.lastMerged, 2);
  assert.equal(rule.nextRun, "2026-11-05T10:45:00.000Z");
  assert.deepEqual(rule.delivery, { mode: "sala", missionId: "room" });
  assert.equal(scheduler.runs("r")[0].statusLabel, "Juntaba 3");
  // «Probar ahora» while the room works: refused, nothing stacked.
  assert.throws(() => scheduler.runNow("r"), /conversación de esta rutina está ocupada/);
});

test("event rules into one room merge the events that piled up while it was busy", async (t) => {
  const { store, scheduler, added } = await fixture(t);
  store.put("missions", { id: "room", title: "Facturas", status: "running", botIds: ["vera"], mode: "solo", createdAt: new Date().toISOString() });
  const trigger = normalizeTrigger({ type: "sala", config: { sala: "otra", salaModo: "todo" } });
  const event = (n) => ({ id: "e" + n, kind: "sala", summary: "Mensaje " + n, data: { texto: "hola " + n } });
  store.put("automations", { id: "r", name: "Atiende", botId: "vera", prompt: "Atiende", enabled: true, trigger, delivery: { mode: "sala", missionId: "room" }, queue: [event(1), event(2), event(3)] });
  scheduler.tick();
  assert.equal(added.length, 0);
  store.patch("missions", "room", { status: "completed" });
  scheduler.tick();
  assert.equal(added.length, 1);
  assert.match(added[0].text, /3 avisos juntos/);
  assert.match(added[0].text, /Mensaje 1[\s\S]*Mensaje 3/);
  assert.deepEqual(store.get("automations", "r").queue, []);
});

async function api(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-delivery-api-"));
  const store = new Store(dir);
  const runtime = new Runtime(store, { respond: async () => { throw Error("No provider calls in API tests"); } });
  let origin;
  const server = http.createServer(createApp({ store, runtime, session: { status: () => null, models: [] }, getOrigin: () => origin }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
  t.after(async () => {
    await runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const send = (method) => (route, body = {}) => fetch(origin + "/api" + route, { method, headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: JSON.stringify(body) });
  return { store, post: send("POST"), patch: send("PATCH") };
}

test("API: delivery targets are validated and edits never overwrite each other", async (t) => {
  const { store, post, patch } = await api(t);
  const base = { name: "Pulso", botId: "vera", prompt: "Mira", trigger: { type: "cada", config: { cadaN: 30, cadaUnidad: "minutos" } } };
  assert.equal((await post("/automations", { ...base, delivery: { mode: "sala", missionId: "nope" } })).status, 422);
  assert.equal((await post("/automations", { ...base, trigger: { type: "cada", config: { cadaN: 5, cadaUnidad: "minutos" } } })).status, 422);
  store.put("missions", { id: "room", title: "Ventas", status: "completed", botIds: ["vera"], mode: "solo", createdAt: new Date().toISOString() });
  const created = await post("/automations", { ...base, delivery: { mode: "sala", missionId: "room" } });
  assert.equal(created.status, 201);
  const rule = await created.json();
  assert.deepEqual(rule.delivery, { mode: "sala", missionId: "room" });
  assert.ok(rule.editedAt);
  const stored = store.get("automations", rule.id);
  assert.equal(Date.parse(stored.nextRun), Date.parse(stored.anchorAt) + 30 * 60000);
  // Two editors loaded the same version: the first saves, the second is refused.
  const first = await patch("/automations/" + rule.id, { prompt: "Mira las ventas", expectedEditedAt: rule.editedAt });
  assert.equal(first.status, 200);
  const saved = await first.json();
  assert.notEqual(saved.editedAt, rule.editedAt);
  const second = await patch("/automations/" + rule.id, { prompt: "Otra cosa", expectedEditedAt: rule.editedAt });
  assert.equal(second.status, 409);
  assert.match((await second.json()).error, /ha cambiado mientras la editabas/);
  assert.equal(store.get("automations", rule.id).prompt, "Mira las ventas");
  // The scheduler's own bookkeeping is not an edit.
  store.patch("automations", rule.id, { state: "running", lastRun: new Date().toISOString() });
  assert.equal((await patch("/automations/" + rule.id, { delivery: { mode: "misma" }, expectedEditedAt: saved.editedAt })).status, 200);
  assert.deepEqual(store.get("automations", rule.id).delivery, { mode: "misma", missionId: null });
  // A changed interval starts a new phase.
  const anchor = store.get("automations", rule.id).anchorAt;
  await new Promise((r) => setTimeout(r, 5));
  assert.equal((await patch("/automations/" + rule.id, { trigger: { type: "cada", config: { cadaN: 2, cadaUnidad: "horas" } } })).status, 200);
  assert.ok(store.get("automations", rule.id).anchorAt > anchor);
});
