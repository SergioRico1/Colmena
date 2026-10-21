import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import express from "express";
import { z } from "zod";
import { Store } from "../server/store.mjs";
import { registerGoalRoutes } from "../server/goals.mjs";

// Standalone app with the same JSON error contract as server/app.mjs (ZodError → 400, err.status).
async function setup(t, runtime = null) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-goals-")),
    store = new Store(dir);
  const app = express();
  app.use(express.json());
  registerGoalRoutes(app, { store, runtime });
  app.use((err, _req, res, _next) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: "Revisa los datos." });
    const status = Number.isInteger(err?.status) ? err.status : 422;
    res.status(status).json({ error: err.message });
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const send = (method) => async (route, body = {}) => {
    const r = await fetch(origin + "/api" + route, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const get = async (route) => {
    const r = await fetch(origin + "/api" + route);
    return { status: r.status, body: await r.json() };
  };
  return { store, get, post: send("POST"), patch: send("PATCH"), del: send("DELETE") };
}

test("create, list, read, edit and delete a goal; Atlas owns it by default", async (t) => {
  const { get, post, patch, del } = await setup(t);
  assert.deepEqual((await get("/goals")).body, []);
  const created = await post("/goals", { title: "Abrir la tienda online", why: "Vender fuera de la ciudad", dueAt: "2026-12-01", milestones: [{ title: "Elegir la plataforma" }] });
  assert.equal(created.status, 201);
  const g = created.body;
  assert.equal(g.ownerBotId, "atlas");
  assert.equal(g.status, "active");
  assert.equal(g.milestones.length, 1);
  assert.equal(g.milestones[0].done, false);
  assert.deepEqual(g.milestones[0].missions, []);
  assert.equal(new Date(g.dueAt).getDate(), 1, "a date-only due date is the end of that local day");
  assert.equal(new Date(g.dueAt).getHours(), 23);

  assert.equal((await post("/goals", { title: "" })).status, 400);
  assert.equal((await post("/goals", { title: "X", ownerBotId: "nadie" })).status, 422);

  const list = (await get("/goals")).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].progress.milestonesTotal, 1);
  assert.equal(list[0].next.title, "Elegir la plataforma");

  const edited = await patch("/goals/" + g.id, { title: "Abrir la tienda", ownerBotId: "vera", dueAt: null, status: "paused" });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.title, "Abrir la tienda");
  assert.equal(edited.body.ownerBotId, "vera");
  assert.equal(edited.body.dueAt, null);
  assert.equal(edited.body.status, "paused");
  assert.equal((await patch("/goals/" + g.id, { status: "perdido" })).status, 400);

  assert.equal((await del("/goals/" + g.id)).status, 200);
  assert.equal((await get("/goals/" + g.id)).status, 404);
});

test("milestones: add one or many, tick, rename, re-date and remove; progress follows", async (t) => {
  const { get, post, patch, del } = await setup(t);
  const g = (await post("/goals", { title: "Reducir gastos un 10 %" })).body;
  let d = (await post(`/goals/${g.id}/milestones`, { title: "Listar suscripciones", dueAt: "2026-10-20" })).body;
  d = (await post(`/goals/${g.id}/milestones`, { milestones: [{ title: "Negociar la luz" }, { title: "Cancelar lo que no se usa" }] })).body;
  assert.equal(d.milestones.length, 3);
  assert.deepEqual(d.progress, { milestonesDone: 0, milestonesTotal: 3, missionsDone: 0, missionsTotal: 0, percent: 0 });

  const [m1, m2, m3] = d.milestones;
  d = (await patch(`/goals/${g.id}/milestones/${m1.id}`, { done: true })).body;
  assert.equal(d.milestones[0].done, true);
  assert.ok(d.milestones[0].doneAt);
  assert.equal(d.progress.milestonesDone, 1);
  assert.equal(d.progress.percent, 33);
  assert.equal(d.next.id, m2.id, "the next milestone is the first pending one when none has a date");

  d = (await patch(`/goals/${g.id}/milestones/${m3.id}`, { title: "Cancelar dos suscripciones", dueAt: "2026-10-25" })).body;
  assert.equal(d.milestones[2].title, "Cancelar dos suscripciones");
  assert.equal(d.next.id, m3.id, "a dated pending milestone comes first");

  d = (await del(`/goals/${g.id}/milestones/${m2.id}`)).body;
  assert.equal(d.milestones.length, 2);
  assert.equal(d.progress.percent, 50);
  assert.equal((await patch(`/goals/${g.id}/milestones/nope`, { done: true })).status, 404);
  assert.equal((await get("/goals")).body[0].progress.milestonesDone, 1);
});

test("link missions and automations to a milestone; finished missions count; moving and unlinking", async (t) => {
  const { store, post, del } = await setup(t);
  const at = new Date().toISOString();
  store.put("missions", { id: "m1", title: "Comparar plataformas", mode: "equipo", botIds: ["nora"], status: "completed", createdAt: at, updatedAt: at, completedAt: at });
  store.put("missions", { id: "m2", title: "Fotos de producto", mode: "solo", botIds: ["iris"], status: "running", createdAt: at, updatedAt: at });
  store.put("missions", { id: "c1", title: "Charla", mode: "solo", botIds: ["nora"], conversation: true, status: "completed", createdAt: at });
  store.put("automations", { id: "a1", name: "Revisar pedidos", botId: "tomas", enabled: true, trigger: { type: "dia", sentence: "cada día a las 08:00" }, createdAt: at });
  const g = (await post("/goals", { title: "Tienda online", milestones: [{ title: "Elegir plataforma" }, { title: "Subir catálogo" }] })).body;
  const [a, b] = g.milestones;

  let d = (await post(`/goals/${g.id}/link`, { missionId: "m1", milestoneId: a.id })).body;
  d = (await post(`/goals/${g.id}/link`, { missionId: "m2", milestoneId: a.id })).body;
  d = (await post(`/goals/${g.id}/link`, { automationId: "a1", milestoneId: b.id })).body;
  assert.deepEqual(d.milestones[0].missionIds, ["m1", "m2"]);
  assert.equal(d.milestones[0].missions[0].statusLabel, "Terminada");
  assert.equal(d.milestones[1].automations[0].name, "Revisar pedidos");
  assert.deepEqual({ done: d.progress.missionsDone, total: d.progress.missionsTotal }, { done: 1, total: 2 });
  assert.equal(store.get("missions", "m1").goalId, g.id, "the mission record carries goalId");
  assert.equal(store.get("missions", "m1").milestoneId, a.id);
  assert.equal(store.get("missions", "m1").updatedAt, at, "linking does not reorder missions");
  assert.equal(store.get("automations", "a1").goalId, g.id);

  // Linking again elsewhere moves it (one milestone at a time), also across goals.
  d = (await post(`/goals/${g.id}/link`, { missionId: "m2", milestoneId: b.id })).body;
  assert.deepEqual(d.milestones[0].missionIds, ["m1"]);
  assert.deepEqual(d.milestones[1].missionIds, ["m2"]);
  const other = (await post("/goals", { title: "Otro", milestones: [{ title: "Hito" }] })).body;
  await post(`/goals/${other.id}/link`, { missionId: "m2", milestoneId: other.milestones[0].id });
  assert.deepEqual(store.get("goals", g.id).milestones[1].missionIds, []);
  assert.equal(store.get("missions", "m2").goalId, other.id);

  d = (await post(`/goals/${g.id}/link`, { missionId: "m1", milestoneId: a.id, unlink: true })).body;
  assert.deepEqual(d.milestones[0].missionIds, []);
  assert.equal(store.get("missions", "m1").goalId, undefined);

  assert.equal((await post(`/goals/${g.id}/link`, { missionId: "c1", milestoneId: a.id })).status, 422, "chats are not linked");
  assert.equal((await post(`/goals/${g.id}/link`, { missionId: "zz", milestoneId: a.id })).status, 404);
  assert.equal((await post(`/goals/${g.id}/link`, { missionId: "m1", automationId: "a1", milestoneId: a.id })).status, 400);
  assert.equal((await post(`/goals/${g.id}/link`, { missionId: "m1", milestoneId: "nope" })).status, 404);

  // Deleting the goal unlinks its records but keeps them.
  await del(`/goals/${g.id}`);
  assert.equal(store.get("automations", "a1").goalId, undefined);
  assert.ok(store.get("automations", "a1"));
});

test("Atlas proposes milestones as a draft; nothing is created until the person accepts", async (t) => {
  const calls = [];
  const runtime = {
    provider: { status: () => ({ kind: "chatgpt" }) },
    infer: async (params, meta) => {
      calls.push({ params, meta });
      return { text: JSON.stringify({ milestones: [{ title: "Elegir la plataforma", dueAt: "2099-01-10", hint: "Nora compara tres" }, { title: "Subir el catálogo", dueAt: "" }, { title: "Ya existe" }, { title: "Lanzar", dueAt: "2001-01-01" }], note: "Empieza por la plataforma." }) };
    },
  };
  const { store, post, del, get } = await setup(t, runtime);
  store.patch("settings", "main", { model: "gpt-x" });
  const g = (await post("/goals", { title: "Tienda online", why: "Vender más", milestones: [{ title: "Ya existe" }] })).body;
  const r = await post(`/goals/${g.id}/plan`);
  assert.equal(r.status, 200);
  assert.equal(calls[0].params.model, "gpt-x");
  assert.equal(calls[0].meta.botId, "atlas");
  assert.deepEqual(r.body.draft.milestones.map((m) => m.title), ["Elegir la plataforma", "Subir el catálogo", "Lanzar"], "existing milestones are not repeated");
  assert.equal(r.body.draft.milestones[2].dueAt, null, "past dates are dropped");
  assert.equal(r.body.draft.note, "Empieza por la plataforma.");
  let d = (await get(`/goals/${g.id}`)).body;
  assert.equal(d.milestones.length, 1, "the draft never creates milestones by itself");
  assert.equal(d.planDraft.milestones.length, 3);
  assert.equal(d.hasDraft, true);

  d = (await post(`/goals/${g.id}/plan/accept`, { indexes: [0, 2] })).body;
  assert.deepEqual(d.milestones.map((m) => m.title), ["Ya existe", "Elegir la plataforma", "Lanzar"]);
  assert.equal(d.planDraft, null);
  assert.equal((await post(`/goals/${g.id}/plan/accept`, {})).status, 409);

  await post(`/goals/${g.id}/plan`);
  d = (await del(`/goals/${g.id}/plan`)).body;
  assert.equal(d.planDraft, null);
  assert.equal(d.milestones.length, 3);
});

test("plan without an AI account → 422 with a clear message; invalid model output → 422", async (t) => {
  const { post } = await setup(t, { provider: { status: () => ({ kind: null }) }, infer: async () => ({ text: "{}" }) });
  const g = (await post("/goals", { title: "Algo" })).body;
  const r = await post(`/goals/${g.id}/plan`);
  assert.equal(r.status, 422);
  assert.match(r.body.error, /Conecta una cuenta de IA/);

  const none = await setup(t, null);
  const g2 = (await none.post("/goals", { title: "Algo" })).body;
  assert.equal((await none.post(`/goals/${g2.id}/plan`)).status, 422);

  const bad = await setup(t, { provider: { status: () => ({ kind: "local" }) }, infer: async () => ({ text: "no es json" }) });
  bad.store.patch("settings", "main", { model: "m" });
  const g3 = (await bad.post("/goals", { title: "Algo" })).body;
  const r3 = await bad.post(`/goals/${g3.id}/plan`);
  assert.equal(r3.status, 422);
  assert.match(r3.body.error, /Atlas no pudo proponer/);
  assert.equal((await bad.get(`/goals/${g3.id}`)).body.planDraft, null);
});
