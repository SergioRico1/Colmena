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
import {
  parseWhen, standingOrdersText, createStandingOrder, createIntent, startStanding, matchIntents, keywordIn,
} from "../server/standing.mjs";

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-standing-")),
    store = new Store(dir);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { store };
}

async function api(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-standing-api-")),
    store = new Store(dir);
  store.patch("settings", "main", { model: "fixture", learning: false });
  const runtime = new Runtime(store, { respond: async () => ({ text: "ok", output: [] }) });
  let origin;
  const app = createApp({ store, runtime, session: { status: () => ({ email: "a@b.c" }), models: [] }, getOrigin: () => origin });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    app.locals.interaction?.standing?.stop();
    await runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
  const call = async (method, route, body) => {
    const res = await fetch(origin + "/api" + route, { method, headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
    return { status: res.status, body: await res.json() };
  };
  return { store, runtime, origin, call, app };
}

test("«Cuándo» in plain Spanish becomes a trigger only when it is a day or a time", () => {
  const ref = new Date(2026, 9, 15, 10, 0); // Thursday 15 Oct 2026
  assert.deepEqual(parseWhen("Cada lunes a las 9", ref).config, { semDia: 1, semHora: "09:00", semCada: "1" });
  assert.deepEqual(parseWhen("de lunes a viernes a las 8:30", ref).config.dias, [1, 2, 3, 4, 5]);
  assert.equal(parseWhen("de lunes a viernes a las 8:30", ref).config.hora, "08:30");
  assert.equal(parseWhen("los martes y jueves a las 7 de la tarde", ref).config.hora, "19:00");
  const once = parseWhen("el 20 de octubre a las 10", ref);
  assert.equal(once.type, "vez");
  assert.equal(once.config.vezFecha, "2026-10-20");
  assert.equal(parseWhen("el 3/2", ref).config.vezFecha, "2027-02-03", "a past date means next year");
  assert.equal(parseWhen("todos los días por la tarde", ref).config.hora, "16:00");
  assert.match(parseWhen("a las 18:15", ref).sentence, /18:15/);
  assert.equal(parseWhen("cuando llegue una factura", ref), null);
  assert.equal(parseWhen("", ref), null);
});

test("standingOrdersText: active orders only, red lines always win", async (t) => {
  const { store } = await fixture(t);
  assert.equal(standingOrdersText(store, "vera"), "");
  createStandingOrder(store, { botId: "vera", title: "Facturas", what: "Apunta las facturas en la hoja de gastos.", when: "Cada lunes a las 9", needsOk: "Antes de pagar", stopWhen: "Si pasa de 500 €" });
  createStandingOrder(store, { botId: "vera", title: "Pausado", what: "No debería salir.", active: false });
  createStandingOrder(store, { botId: "nora", title: "De otra", what: "Tampoco." });
  const text = standingOrdersText(store, "vera");
  assert.match(text, /^# Encargos permanentes/);
  assert.match(text, /«Facturas»/);
  assert.match(text, /Qué haces: Apunta las facturas/);
  assert.match(text, /Necesita el OK de la persona: Antes de pagar/);
  assert.match(text, /Paras y preguntas cuando: Si pasa de 500 €/);
  assert.match(text, /líneas rojas mandan siempre: enviar algo fuera, mover dinero, borrar archivos e instalar programas/);
  assert.doesNotMatch(text, /Pausado|Tampoco/);
});

test("recordatorios por tema: aviso + system message, whole words, cooldown, budget and expiry", async (t) => {
  const { store } = await fixture(t);
  let clock = Date.parse("2026-10-15T10:00:00Z");
  const events = [];
  const notifier = new Notifier(store, { emit: (e) => events.push(e), clock: () => clock });
  const standing = startStanding(store, { notifier, clock: () => clock });
  t.after(() => standing.stop());
  store.put("missions", { id: "m1", title: "Contratos", room: "contratos", mode: "solo", botIds: ["leo"], status: "running", createdAt: new Date(clock).toISOString() });
  const intent = createIntent(store, { keywords: ["renovación", "Iberdrola"], remind: "El preaviso es de 30 días.", botId: "vera", maxHits: 2 });
  assert.equal(keywordIn(intent, "Hablemos de la RENOVACION del contrato"), "renovación", "accents and case are ignored");
  assert.equal(keywordIn(intent, "renovaciones"), null, "whole words only");

  store.put("messages", { id: "u1", missionId: "m1", role: "user", text: "¿Qué pasa con la renovación?", at: new Date(clock).toISOString() });
  const notes = store.list("notifications");
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, "intent");
  assert.equal(notes[0].text, "El preaviso es de 30 días.");
  assert.match(notes[0].title, /«renovación»/);
  assert.equal(notes[0].url, "/sala/m1");
  assert.equal(events.at(-1).type, "notify");
  const system = store.where("messages", "missionId", "m1").filter((m) => m.role === "system");
  assert.equal(system.length, 1);
  assert.match(system[0].text, /^Recordatorio: El preaviso es de 30 días\. \(se ha hablado de «renovación»\)\.$/);
  assert.equal(system[0].intentId, intent.id);
  assert.equal(store.get("intents", intent.id).hits, 1);

  store.put("messages", { id: "a1", missionId: "m1", role: "assistant", botId: "leo", text: "La renovación de Iberdrola vence pronto.", at: new Date(clock).toISOString() });
  assert.equal(store.get("intents", intent.id).hits, 1, "cooldown of 30 min per room");
  clock += 31 * 60000;
  store.put("messages", { id: "a2", missionId: "m1", role: "assistant", botId: "leo", text: "Iberdrola ha contestado.", at: new Date(clock).toISOString() });
  const spent = store.get("intents", intent.id);
  assert.equal(spent.hits, 2);
  assert.equal(spent.active, false, "budget exhausted → inactive");
  clock += 31 * 60000;
  store.put("messages", { id: "u2", missionId: "m1", role: "user", text: "renovación otra vez", at: new Date(clock).toISOString() });
  assert.equal(store.list("notifications").filter((n) => n.kind === "intent").length >= 1, true);
  assert.equal(store.get("intents", intent.id).hits, 2, "never beyond the budget");

  const old = createIntent(store, { keywords: ["presupuesto"], remind: "Pide dos.", expiresAt: new Date(clock - 1000).toISOString() });
  assert.deepEqual(matchIntents(store, { missionId: "m1", role: "user", text: "el presupuesto" }, clock), [], "expired intents never fire");
  const scoped = createIntent(store, { keywords: ["presupuesto"], remind: "Solo aquí.", missionId: "otra" });
  assert.deepEqual(matchIntents(store, { missionId: "m1", role: "user", text: "el presupuesto" }, clock), [], "scoped to another room");
  assert.ok(old && scoped);
});

test("API: encargos CRUD, «Crear la automatización», recordatorios and /api/state", async (t) => {
  const { call } = await api(t);
  assert.equal((await call("POST", "/standing-orders", { botId: "vera", title: "x" })).status, 400, "«Qué haces» is required");
  const created = await call("POST", "/standing-orders", { botId: "vera", title: "Resumen de clientes", what: "Resume los correos de clientes y dime cuáles piden respuesta.", when: "cada lunes a las 9", needsOk: "Antes de responder a nadie" });
  assert.equal(created.status, 201);
  assert.equal(created.body.schedule.type, "semana");
  const situational = await call("POST", "/standing-orders", { botId: "vera", title: "Facturas", what: "Apunta cada factura.", when: "cuando llegue una factura" });
  assert.equal(situational.body.schedule, null);
  assert.equal((await call("POST", `/standing-orders/${situational.body.id}/automation`, {})).status, 422, "no automation without a day or a time");

  const auto = await call("POST", `/standing-orders/${created.body.id}/automation`, {});
  assert.equal(auto.status, 201);
  assert.ok(auto.body.automationId);
  assert.equal(auto.body.order.automationId, auto.body.automationId);
  assert.equal((await call("POST", `/standing-orders/${created.body.id}/automation`, {})).status, 409);
  let state = (await call("GET", "/state")).body;
  const rule = state.automations.find((a) => a.id === auto.body.automationId);
  assert.equal(rule.botId, "vera");
  assert.equal(rule.trigger.type, "semana");
  assert.equal(state.standingOrders.length, 2);

  const paused = await call("PATCH", `/standing-orders/${created.body.id}`, { active: false });
  assert.equal(paused.body.active, false);

  const intent = await call("POST", "/intents", { keywords: ["renovación"], remind: "El preaviso es de 30 días.", botId: "vera", maxHits: 2 });
  assert.equal(intent.status, 201);
  assert.equal((await call("POST", "/intents", { keywords: [], remind: "x y z" })).status, 400);
  assert.equal((await call("POST", "/intents", { keywords: ["a b"], remind: "Recuerda", expiresAt: "2020-01-01T00:00:00Z" })).status, 422);
  state = (await call("GET", "/state")).body;
  assert.equal(state.intents.length, 1);
  assert.equal((await call("PATCH", `/intents/${intent.body.id}`, { active: false })).body.active, false);
  assert.equal((await call("DELETE", `/intents/${intent.body.id}`)).status, 200);
  assert.equal((await call("DELETE", `/standing-orders/${situational.body.id}`)).status, 200);
  assert.equal((await call("GET", "/standing-orders?botId=vera")).body.length, 1);
});

test("the createApp listener turns a room message into a reminder", async (t) => {
  const { store, call } = await api(t);
  store.put("missions", { id: "m9", title: "Proveedores", room: "proveedores", mode: "solo", botIds: ["nora"], status: "completed", createdAt: new Date().toISOString() });
  await call("POST", "/intents", { keywords: ["contrato"], remind: "Revisa la permanencia." });
  store.put("messages", { id: "x1", missionId: "m9", role: "user", text: "Mira el contrato nuevo", at: new Date().toISOString() });
  const n = store.list("notifications").find((x) => x.kind === "intent");
  assert.ok(n, "aviso created");
  assert.equal(n.botId, "atlas");
  assert.ok(store.where("messages", "missionId", "m9").some((m) => m.role === "system" && /Revisa la permanencia/.test(m.text)));
});
