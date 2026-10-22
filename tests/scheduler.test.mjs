import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Scheduler } from "../server/scheduler.mjs";
import { nextRun, normalizeTrigger, sentence, subtitle, isHoliday } from "../server/triggers.mjs";

const local = (...args) => new Date(...args).toISOString();

async function fixture(t, { connected = () => true, connections = null } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-sched-"));
  const store = new Store(directory);
  const created = [];
  const runtime = {
    create(input) {
      const mission = store.put("missions", { id: "m" + (created.length + 1), title: input.title, prompt: input.prompt, mode: input.mode, botIds: input.botIds, automationId: input.automationId, status: "queued", createdAt: new Date().toISOString() });
      created.push(input);
      return mission;
    },
    launch() {},
  };
  const scheduler = new Scheduler(store, runtime, connected, { connections });
  t.after(async () => {
    scheduler.stop();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { store, scheduler, created };
}

test("nextRun «dia» in local time, with weekdays and holidays", () => {
  const from = new Date(2026, 9, 15, 11, 0); // Thursday 15 Oct 2026, 11:00
  const weekdays = { type: "dia", config: { hora: "08:00", dias: [1, 2, 3, 4, 5], festivo: "saltar" } };
  assert.equal(nextRun(weekdays, from), local(2026, 9, 16, 8, 0));
  assert.equal(nextRun({ type: "dia", config: { hora: "13:00", dias: [4] } }, from), local(2026, 9, 15, 13, 0));
  assert.equal(nextRun({ type: "dia", config: { hora: "08:00", dias: [6, 0] } }, from), local(2026, 9, 17, 8, 0));
  // Monday 12 Oct 2026 is a national holiday.
  const saturday = new Date(2026, 9, 10, 12, 0);
  assert.ok(isHoliday(new Date(2026, 9, 12)));
  assert.equal(nextRun(weekdays, saturday), local(2026, 9, 13, 8, 0));
  assert.equal(nextRun({ ...weekdays, config: { ...weekdays.config, festivo: "igual" } }, saturday), local(2026, 9, 12, 8, 0));
  assert.equal(nextRun({ type: "dia", config: { hora: "08:00", dias: [1], festivo: "siguiente" } }, saturday), local(2026, 9, 13, 8, 0));
  assert.equal(nextRun({ type: "dia", config: { hora: "08:00", dias: [1], festivo: "saltar" } }, saturday), local(2026, 9, 19, 8, 0));
  assert.equal(nextRun({ type: "dia", config: { hora: "08:00", dias: [1, 2, 3, 4, 5] } }, from, { holidays: ["2026-10-16"] }), local(2026, 9, 19, 8, 0));
});

test("nextRun «semana» respects the weekday and every-N-weeks phase", () => {
  const from = new Date(2026, 9, 15, 11, 0);
  assert.equal(nextRun({ type: "semana", config: { semDia: 4, semHora: "09:00", semCada: "1" } }, from), local(2026, 9, 22, 9, 0));
  assert.equal(nextRun({ type: "semana", config: { semDia: 4, semHora: "12:00", semCada: "1" } }, from), local(2026, 9, 15, 12, 0));
  const anchor = new Date(2026, 9, 1, 0, 0).toISOString(); // Thursday 1 Oct
  assert.equal(nextRun({ type: "semana", config: { semDia: 4, semHora: "09:00", semCada: "2" } }, from, { anchor }), local(2026, 9, 29, 9, 0));
  assert.equal(nextRun({ type: "semana", config: { semDia: 1, semHora: "09:00", semCada: "3" } }, new Date(2027, 5, 1), { anchor }), local(2027, 5, 14, 9, 0));
});

test("nextRun «vez» is the date once, then nothing", () => {
  const trigger = { type: "vez", config: { vezFecha: "2026-10-30", vezHora: "10:00" } };
  assert.equal(nextRun(trigger, new Date(2026, 9, 15)), local(2026, 9, 30, 10, 0));
  assert.equal(nextRun(trigger, new Date(2026, 9, 30, 10, 0)), null);
  assert.equal(nextRun({ type: "correo", config: {} }, new Date()), null);
});

test("sentences and subtitles follow the Disparador design", () => {
  assert.equal(normalizeTrigger({ type: "dia", config: { hora: "08:00", dias: [5, 1, 2, 3, 4] } }).sentence, "sean las 08:00 de lunes a viernes");
  assert.equal(sentence({ type: "semana", config: { semDia: 1, semHora: "09:00", semCada: "2" } }), "sea lunes a las 09:00, cada 2 semanas");
  assert.equal(sentence({ type: "vez", config: { vezFecha: "2026-10-30", vezHora: "10:00" } }), "llegue el viernes 30 de octubre a las 10:00");
  assert.equal(sentence({ type: "sala", config: { sala: "facturación", salaModo: "palabras", palabras: "urgente, error" } }), "alguien escriba «urgente, error» en # facturación");
  assert.equal(sentence({ type: "correo", config: { buzon: "facturas@x.es", deModo: "algunos", remitentes: ["a@b.c"], asunto: "factura", adjuntos: "pdf" } }), "llegue un correo a facturas@x.es de a@b.c con «factura» en el asunto y un PDF adjunto");
  const reference = new Date(2026, 9, 15, 11, 0);
  const rule = { enabled: true, state: "scheduled", trigger: { type: "dia", config: { hora: "08:00", dias: [1, 2, 3, 4, 5] } }, lastRun: new Date(2026, 9, 15, 8, 0).toISOString(), lastStatus: "completed" };
  assert.equal(subtitle(rule, reference), "Días laborables, 08:00 · Hoy ✓");
  assert.equal(subtitle({ ...rule, trigger: { type: "semana", config: { semDia: 4, semHora: "10:00" } }, state: "waiting" }, reference), "Jueves, 10:00 · Te espera");
  assert.equal(subtitle({ ...rule, enabled: false, trigger: { type: "semana", config: { semDia: 1, semHora: "09:00" } } }, reference), "Lunes, 09:00 · Pausada");
  assert.equal(subtitle({ ...rule, trigger: { type: "dia", config: { hora: "13:00", dias: [0, 1, 2, 3, 4, 5, 6] } }, lastRun: new Date(2026, 9, 14, 13, 0).toISOString() }, reference), "Cada día, 13:00 · Ayer ✓");
  assert.equal(subtitle({ ...rule, trigger: { type: "correo", config: {} }, lastRun: new Date(2026, 9, 15, 10, 0).toISOString() }, reference), "Cuando llega un correo · Hace 1 h ✓");
});

test("time rule fires once, advances nextRun, never overlaps and pauses after «vez»", async (t) => {
  const { store, scheduler, created } = await fixture(t);
  const trigger = normalizeTrigger({ type: "dia", config: { hora: "08:00", dias: [0, 1, 2, 3, 4, 5, 6] } });
  store.put("automations", { id: "r", name: "Diario", botId: "vera", prompt: "Resume", enabled: true, trigger, nextRun: new Date(0).toISOString(), createdAt: new Date().toISOString() });
  const time = Date.now();
  scheduler.tick(time);
  let rule = store.get("automations", "r");
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].botIds, ["vera"]);
  assert.equal(created[0].mode, "solo");
  assert.equal(rule.state, "running");
  assert.ok(Date.parse(rule.nextRun) > time);
  // Due again while the previous run is unfinished: no second mission.
  store.patch("automations", "r", { nextRun: new Date(0).toISOString() });
  scheduler.tick(time + 1000);
  assert.equal(created.length, 1);
  // The previous run waits on the user for more than a day: visible as waiting.
  store.patch("missions", "m1", { status: "waiting" });
  store.db.prepare("UPDATE records SET data=json_set(data,'$.updatedAt',?) WHERE kind='missions' AND id='m1'").run(new Date(time - 25 * 3600000).toISOString());
  scheduler.tick(time + 2000);
  rule = store.get("automations", "r");
  assert.equal(rule.state, "waiting");
  assert.match(rule.error, /más de 24 h esperando tu respuesta/);
  // Once it ends, the delayed run happens (once).
  store.patch("missions", "m1", { status: "completed" });
  scheduler.tick(time + 3000);
  assert.equal(created.length, 2);
  // «vez»: runs and pauses itself.
  store.put("automations", { id: "v", name: "Una vez", botId: "atlas", prompt: "Hazlo", enabled: true, trigger: normalizeTrigger({ type: "vez", config: { vezFecha: "2099-01-01", vezHora: "10:00" } }), nextRun: new Date(0).toISOString() });
  scheduler.tick(time + 4000);
  const once = store.get("automations", "v");
  assert.equal(once.enabled, false);
  assert.equal(once.nextRun, null);
  assert.equal(created.at(-1).mode, "equipo"); // «Que decida Atlas»
  assert.deepEqual(created.at(-1).botIds, []);
});

test("scheduler blocks without an AI account and respects the global pause", async (t) => {
  let connected = false;
  const { store, scheduler, created } = await fixture(t, { connected: () => connected });
  store.put("automations", { id: "r", name: "Diario", botId: "vera", prompt: "x", enabled: true, trigger: normalizeTrigger({ type: "dia", config: { dias: [1] } }), nextRun: new Date(0).toISOString() });
  scheduler.tick();
  assert.equal(store.get("automations", "r").state, "blocked");
  assert.match(store.get("automations", "r").error, /Conecta una cuenta de IA/);
  connected = true;
  store.patch("settings", "main", { paused: true });
  scheduler.tick();
  assert.equal(created.length, 0);
  store.patch("settings", "main", { paused: false });
  scheduler.tick();
  assert.equal(created.length, 1);
  assert.equal(store.get("automations", "r").blockedBy, null);
});

test("«sala» fires on a matching message, ignores its own runs and the bot itself", async (t) => {
  const { store, scheduler, created } = await fixture(t);
  scheduler.engine.start();
  store.put("missions", { id: "room", title: "Facturación", room: "facturacion", status: "running", botIds: ["tomas"], createdAt: new Date().toISOString() });
  store.put("automations", { id: "s", name: "Urgencias", botId: "tomas", prompt: "Atiende", enabled: true, trigger: normalizeTrigger({ type: "sala", config: { sala: "facturación", salaModo: "palabras", palabras: "urgente, error", deQuien: "todos" } }) });
  const wait = () => new Promise((r) => setTimeout(r, 30));
  store.put("messages", { id: "1", missionId: "room", role: "user", text: "Nada importante", at: new Date().toISOString() });
  store.put("messages", { id: "2", missionId: "room", role: "assistant", botId: "tomas", text: "Error urgente", at: new Date().toISOString() });
  await wait();
  assert.equal(created.length, 0);
  store.put("messages", { id: "3", missionId: "room", role: "user", text: "¡Es URGENTE!", at: new Date().toISOString() });
  // A busy machine (CI) may take longer than 30 ms to fire it: wait for it, up to 5 s.
  for (const end = Date.now() + 5000; !created.length && Date.now() < end; ) await wait();
  assert.equal(created.length, 1);
  assert.match(created[0].prompt, /<<<CONTENIDO_EXTERNO id="[0-9a-f]{16}">>>\nFuente: Mensajes de chat · Urgencias/, "the event arrives as outside data");
  assert.equal(store.get("automations", "s").lastEvent.id, "3");
  store.put("messages", { id: "4", missionId: "m1", role: "user", text: "urgente", at: new Date().toISOString() }); // its own run
  await wait();
  assert.equal(store.get("automations", "s").queue.length, 0);
});

test("connector rules are blocked with a clear reason and never simulate a trigger", async (t) => {
  const connections = { call: async (op) => (op === "accounts" ? { items: [] } : Promise.reject(Error("unexpected " + op))) };
  const { store, scheduler, created } = await fixture(t, { connections });
  store.put("automations", { id: "c", name: "Facturas", botId: "tomas", prompt: "Guarda", enabled: true, trigger: normalizeTrigger({ type: "correo", config: { asunto: "factura" } }) });
  await scheduler.engine.poll(store.get("automations", "c"));
  const rule = store.get("automations", "c");
  assert.equal(rule.state, "blocked");
  assert.equal(rule.error, "Conecta Correo en Ajustes para activar esta regla.");
  scheduler.tick();
  assert.equal(created.length, 0);
  assert.throws(() => scheduler.runNow("c"), /no hay con qué probarla/);
  // Sheets connected but without an audited read: still blocked, explained.
  connections.call = async () => ({ items: [{ id: "x", toolkit: "googlesheets", status: "ACTIVE" }] });
  store.put("automations", { id: "h", name: "Gastos", botId: "tomas", prompt: "x", enabled: true, trigger: normalizeTrigger({ type: "hoja", config: { hoja: "Gastos 2026" } }) });
  await scheduler.engine.poll(store.get("automations", "h"));
  assert.match(store.get("automations", "h").error, /no tiene una lectura auditada/);
});

test("store transactions are atomic and notify only after commit", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-store-"));
  const store = new Store(directory);
  t.after(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const seen = [];
  store.listeners.add((e) => e.type === "record" && seen.push(e.kind + ":" + e.op));
  assert.throws(() => store.tx(() => {
    store.put("people", { id: "p1", name: "A" });
    throw Error("boom");
  }), /boom/);
  assert.equal(store.get("people", "p1"), null);
  assert.deepEqual(seen, []);
  store.tx(() => {
    store.put("people", { id: "p1", name: "A" });
    store.patch("people", "p1", { name: "B" });
  });
  assert.deepEqual(seen, ["people:insert", "people:update"]);
  assert.equal(store.patch("people", "p1", (old) => ({ name: old.name + "!" })).name, "B!");
  assert.equal(store.remove("people", "p1"), true);
  assert.equal(store.remove("people", "p1"), false);
  assert.throws(() => store.tx(async () => {}), /síncronas/);
  // Legacy seeds without accents are migrated on open.
  store.put("bots", { ...store.get("bots", "bruno"), role: "Codigo y sistemas", instructions: "Resuelve problemas tecnicos, produce codigo revisable y distingue pruebas ejecutadas de recomendaciones. Pragmatico y cuidadoso.", location: "nube" });
  store.migrate();
  assert.equal(store.get("bots", "bruno").role, "Código");
  assert.match(store.get("bots", "bruno").instructions, /técnicos.*Pragmático/);
  assert.equal(store.get("bots", "bruno").location, "local");
  // Migration defaults and event retention.
  const bot = store.get("bots", "tomas");
  assert.equal(bot.tools.hojas, "escribe");
  assert.deepEqual(bot.channels, { colmena: true, correo: false, chat: false, movil: false });
  store.db.prepare("INSERT INTO events(mission,data) VALUES(?,?)").run("m", JSON.stringify({ at: "2000-01-01T00:00:00.000Z" }));
  store.event("m", "fresh");
  assert.equal(store.purgeEvents(), 1);
  assert.equal(store.events("m").length, 1);
});
