import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { Admission, LONG_TURN_CALLS, PLAN_READING_MS, planPauseAt } from "../server/admission.mjs";
import { LIMIT_CODE, botMonthTokens, monthTokens } from "../server/usage.mjs";
import { PROVIDER_LIMIT_CODE } from "../server/limits.mjs";
import { responseCollector } from "../server/provider.mjs";
import { missionSummary, context } from "../server/state.mjs";
import { fixture, answer } from "./fixtures/runtime-fixture.mjs";

const HOUR = 3_600_000;
/** The plan windows a ChatGPT answer carries (provider.mjs planLimitsOf). */
const plan = (usedPercent, { resetsIn = 2 * HOUR, seenAgo = 0, minutes = 300 } = {}) => ({
  primary: { usedPercent, windowMinutes: minutes, resetsAt: resetsIn === null ? null : new Date(Date.now() + resetsIn).toISOString() },
  secondary: null,
  at: new Date(Date.now() - seenAgo).toISOString(),
});
const ask = (runtime, meta = {}, extra = {}) => runtime.infer({ model: "fixture", instructions: "Eres Nora.", input: [{ role: "user", content: "Hola" }], tools: [], ...extra }, meta);
const usageRows = (store) => store.list("usage");

test("at 95 % of the plan a routine's run is parked as «Limitado», and a chat message still gets its answer", async (t) => {
  let calls = 0, percent = 96;
  const { store, runtime } = await fixture(t, async () => { calls += 1; return { ...answer("Hecho.", { input_tokens: 20, output_tokens: 5 }), limits: plan(percent) }; });
  // A chat: the person writes, the bot answers; the answer brings how much of the plan is used.
  const chat = runtime.create({ prompt: "Hola", botIds: ["nora"], conversation: true });
  await runtime.launch(chat.id);
  assert.equal(store.get("missions", chat.id).status, "completed");
  assert.equal(calls, 1);
  // A routine starts its run: it does not call the model, it waits for the renewal.
  store.put("automations", { id: "r1", name: "Resumen diario", botId: "nora", prompt: "Resume el correo" });
  const run = runtime.create({ prompt: "Resume el correo", botIds: ["nora"], automationId: "r1" });
  await runtime.launch(run.id);
  const parked = store.get("missions", run.id);
  assert.equal(calls, 1, "no model call for the routine");
  assert.equal(parked.status, "paused");
  assert.equal(parked.limited.plan, true);
  assert.equal(parked.limited.percent, 96);
  assert.equal(parked.limited.engine, "openai");
  assert.equal(parked.limited.label, "límite de 5 horas");
  assert.equal(parked.limited.resumeAt, parked.limited.resetsAt, "it goes on when the window renews");
  assert.match(parked.error, /^Queda poco del plan de ChatGPT \(96 % usado\)\. Lo dejo en pausa para que puedas seguir chateando; sigue solo cuando se renueve, /);
  assert.ok(store.events(run.id).some((e) => e.type === "provider_limit"));
  // The card and the line the app shows.
  const view = missionSummary(store.get("missions", run.id), context(store, runtime));
  assert.equal(view.statusLabel, "Limitado");
  assert.deepEqual([view.limited.plan, view.limited.percent], [true, 96]);
  assert.match(view.activityLine, /^En pausa · queda poco del plan de ChatGPT/);
  // What the person writes now is answered all the same.
  runtime.addMessage(chat.id, "¿Y mañana?");
  await runtime.missionJobs.get(chat.id);
  assert.equal(store.get("missions", chat.id).status, "completed");
  assert.equal(calls, 2);
  // Side jobs (titles, learning, the watcher…) are left for later; an aside of the person is not.
  await assert.rejects(ask(runtime, { botId: "nora", retry: false }), (e) => e.code === PROVIDER_LIMIT_CODE && e.parked === true && e.limit.plan === true);
  await assert.rejects(ask(runtime, { missionId: chat.id, botId: "nora", retry: false }), (e) => e.parked === true);
  assert.equal(calls, 2);
  await ask(runtime, { botId: "nora", retry: false, interactive: true });
  assert.equal(calls, 3);
  // It is not resumed before the renewal (no substitute engine is tried for a parked run)…
  assert.deepEqual(runtime.resumeLimited(Date.now() + 60_000), []);
  // …and once the window renewed it goes on by itself.
  percent = 3;
  runtime.admission.notePlan("openai", plan(3));
  assert.deepEqual(runtime.resumeLimited(Date.parse(parked.limited.resumeAt) + 1000), [run.id]);
  await runtime.missionJobs.get(run.id);
  assert.equal(store.get("missions", run.id).status, "completed");
  assert.equal(runtime.admission.held.size, 0);
});

test("«Continuar» overrides the pause for that run only", async (t) => {
  let calls = 0;
  const { store, runtime } = await fixture(t, async () => { calls += 1; return { ...answer("Hecho.", { input_tokens: 20, output_tokens: 5 }), limits: plan(97) }; });
  runtime.admission.notePlan("openai", plan(97));
  store.put("automations", { id: "r1", name: "Resumen diario", botId: "nora", prompt: "Resume el correo" });
  const run = runtime.create({ prompt: "Resume el correo", botIds: ["nora"], automationId: "r1" });
  await runtime.launch(run.id);
  assert.equal(store.get("missions", run.id).limited?.plan, true);
  assert.equal(calls, 0);
  await runtime.resume(run.id); // «Continuar ahora»
  const done = store.get("missions", run.id);
  assert.equal(done.status, "completed");
  assert.equal(done.limited, null);
  assert.equal(calls, 1);
  assert.equal(runtime.runOrigin.has(run.id), false, "the override ends with the run");
  // The next run of the routine is parked again.
  const next = runtime.create({ prompt: "Resume el correo", botIds: ["nora"], automationId: "r1" });
  await runtime.launch(next.id);
  assert.equal(store.get("missions", next.id).limited?.plan, true);
  assert.equal(calls, 1);
});

test("what counts as long work: unattended runs, runs that went on by themselves, and many calls in one turn", async (t) => {
  const { store, runtime } = await fixture(t, async () => answer("ok", { input_tokens: 5, output_tokens: 5 }));
  const chat = runtime.create({ prompt: "Hola", botIds: ["nora"], conversation: true });
  await runtime.launch(chat.id);
  const work = (missionId, extra = {}) => runtime.workOf({ missionId, ...extra });
  assert.equal(runtime.turnCalls.get(chat.id), 1, "each admitted call of the mission counts");
  assert.equal(work(chat.id), "chat");
  runtime.turnCalls.set(chat.id, LONG_TURN_CALLS);
  assert.equal(work(chat.id), "long", "many calls since the person wrote");
  runtime.personSpoke(chat.id);
  assert.equal(work(chat.id), "chat", "a new message of the person starts a fresh turn");
  // A run that went on by itself (after a restart, or a renewed limit) is long until the person writes.
  runtime.runOrigin.set(chat.id, "auto");
  assert.equal(work(chat.id), "long");
  runtime.personSpoke(chat.id);
  assert.equal(work(chat.id), "chat");
  // A routine's run is long; the answer to what the person writes inside it is not.
  store.put("automations", { id: "r1", name: "Rutina", botId: "nora", prompt: "x" });
  const run = runtime.create({ prompt: "x", botIds: ["nora"], automationId: "r1" });
  assert.equal(work(run.id, { stepId: runtime.steps(run.id)[0].id }), "long");
  const mine = store.put("messages", { id: "m-person", missionId: run.id, role: "user", text: "¿Cómo va?", kind: "message", at: new Date().toISOString() });
  const [key] = runtime.queueTurns(run.id, ["nora"], [], { request: "¿Cómo va?", ackOn: mine.id });
  assert.equal(work(run.id, { stepId: run.id + ":" + key }), "chat");
  // The turn a routine opens in a room is the routine's, not the person's.
  const routine = store.put("messages", { id: "m-routine", missionId: chat.id, role: "user", text: "Rutina «x»", kind: "message", automationId: "r1", at: new Date().toISOString() });
  const [roomKey] = runtime.queueTurns(chat.id, ["nora"], [], { request: "Rutina", ackOn: routine.id });
  assert.equal(work(chat.id, { stepId: chat.id + ":" + roomKey }), "long");
  // Side jobs and calls outside a mission are never the person's, unless the caller says so.
  assert.equal(work(chat.id, { side: true }), "side");
  assert.equal(work(null), "side");
  assert.equal(work(null, { interactive: true }), "chat");
});

test("a stale, absent or unreal percent does nothing", async (t) => {
  const { store, runtime } = await fixture(t, async () => answer("ok", { input_tokens: 5, output_tokens: 5 }));
  const gate = new Admission(store);
  const long = () => gate.admit({ engine: "openai", work: "long" });
  assert.equal(long().ok, true, "no provider said anything");
  gate.notePlan("openai", null);
  gate.notePlan("openai", { primary: null, secondary: null, at: new Date().toISOString() });
  assert.equal(long().ok, true, "a provider that gives no percent");
  gate.notePlan("openai", plan(94));
  assert.equal(long().ok, true, "below the threshold");
  gate.notePlan("openai", plan(95));
  assert.equal(long().park.percent, 95);
  assert.equal(gate.admit({ engine: "openai", work: "chat" }).ok, true, "never the person's message");
  assert.equal(gate.admit({ engine: "anthropic", work: "long" }).ok, true, "only the engine the call would use");
  assert.equal(gate.admit({ engine: "openai", work: "long", limited: true }).ok, true, "an engine already out of its plan is the old path's business");
  gate.notePlan("openai", plan(99, { resetsIn: -60_000, seenAgo: 10 * 60_000 }));
  assert.equal(long().ok, true, "the window renewed since it was read");
  gate.notePlan("openai", plan(99, { resetsIn: null }));
  assert.equal(long().park.resetsAt, null, "no renewal time: believed while it is recent");
  gate.notePlan("openai", plan(99, { resetsIn: null, seenAgo: PLAN_READING_MS + 1000 }));
  assert.equal(long().ok, true, "no renewal time and read a while ago");
  gate.notePlan("openai", { primary: { usedPercent: NaN, windowMinutes: 300, resetsAt: null }, secondary: null, at: new Date().toISOString() });
  assert.equal(long().ok, true, "not a number");
  gate.notePlan("openai", { ...plan(99), at: "ayer" });
  assert.equal(long().ok, true, "no time of reading");
  // Two windows almost used up: the one that renews last decides.
  const both = plan(96);
  both.secondary = { usedPercent: 98, windowMinutes: 10080, resetsAt: new Date(Date.now() + 50 * HOUR).toISOString() };
  gate.notePlan("openai", both);
  assert.deepEqual([long().park.percent, long().park.limit.label, long().park.resetsAt], [98, "límite semanal", both.secondary.resetsAt]);
  // The setting: another threshold, or never.
  assert.equal(planPauseAt({}), 95);
  store.patch("settings", "main", (s) => ({ limits: { ...s.limits, planPauseAt: 99 } }));
  assert.equal(long().ok, true);
  store.patch("settings", "main", (s) => ({ limits: { ...s.limits, planPauseAt: 80 } }));
  assert.equal(long().park.percent, 98);
  store.patch("settings", "main", (s) => ({ limits: { ...s.limits, planPauseAt: null } }));
  assert.equal(long().ok, true, "turned off");
  // In the runtime: a routine runs as always when nothing was reported.
  store.put("automations", { id: "r1", name: "Rutina", botId: "nora", prompt: "x" });
  const run = runtime.create({ prompt: "x", botIds: ["nora"], automationId: "r1" });
  await runtime.launch(run.id);
  assert.equal(store.get("missions", run.id).status, "completed");
});

test("two calls at once cannot both fit in a budget that only fits one; the reservation goes when the call ends", async (t) => {
  let release;
  const gateOpen = new Promise((r) => { release = r; });
  let calls = 0;
  const { store, runtime } = await fixture(t, async () => { calls += 1; await gateOpen; return answer("ok", { input_tokens: 300, output_tokens: 100 }); });
  // A worst case here is about 32 000 tokens (the answer's maximum) plus the input.
  store.patch("bots", "nora", { monthlyTokens: 50_000 });
  const first = ask(runtime, { botId: "nora" });
  assert.equal(runtime.admission.held.size, 1);
  assert.ok(runtime.admission.reserved("nora") > 32_000 && runtime.admission.reserved("nora") < 50_000);
  await assert.rejects(ask(runtime, { botId: "nora" }), (e) => e.code === LIMIT_CODE && e.botId === "nora" && /^Nora ha llegado a su presupuesto de este mes \(50\.000 tokens\)/.test(e.message));
  // Another bot has its own month.
  const other = ask(runtime, { botId: "tomas" });
  assert.equal(runtime.admission.reserved("tomas"), 0, "no budget of its own and no space limit: nothing to reserve against");
  release();
  await Promise.all([first, other]);
  assert.equal(calls, 2, "the refused call never reached the provider");
  assert.equal(runtime.admission.held.size, 0);
  assert.equal(botMonthTokens(store, "nora"), 400, "the real usage, not the reservation");
  assert.equal(monthTokens(store), 800);
  await ask(runtime, { botId: "nora" }); // alone again, it fits
  assert.equal(botMonthTokens(store, "nora"), 800);
});

test("the space's monthly limit is reserved too, across bots", async (t) => {
  let release;
  const gateOpen = new Promise((r) => { release = r; });
  const { store, runtime } = await fixture(t, async () => { await gateOpen; return answer("ok", { input_tokens: 300, output_tokens: 100 }); });
  store.patch("settings", "main", { limits: { monthlyTokens: 50_000, pauseAtLimit: true, warnAt80: true } });
  const first = ask(runtime, { botId: "nora" });
  await assert.rejects(ask(runtime, { botId: "tomas" }), (e) => e.code === LIMIT_CODE && /límite mensual del espacio/.test(e.message));
  release();
  await first;
  assert.equal(runtime.admission.held.size, 0);
  // Not pausing at the limit: nothing is reserved against it.
  store.patch("settings", "main", { limits: { monthlyTokens: 50_000, pauseAtLimit: false, warnAt80: true } });
  assert.equal(runtime.admission.admit({ botId: "nora", need: 1e9 }).reservation, null);
});

test("a bot that used up its budget stops with a plain message naming it; the others go on", async (t) => {
  const { store, runtime } = await fixture(t, async () => answer("ok", { input_tokens: 600, output_tokens: 500 }));
  store.patch("bots", "nora", { monthlyTokens: 1000 });
  const first = runtime.create({ prompt: "uno", botIds: ["nora"] });
  await runtime.launch(first.id);
  assert.equal(store.get("missions", first.id).status, "completed");
  assert.equal(botMonthTokens(store, "nora"), 1100);
  const second = runtime.create({ prompt: "dos", botIds: ["nora"] });
  await runtime.launch(second.id);
  const stopped = store.get("missions", second.id);
  assert.equal(stopped.status, "paused");
  assert.match(stopped.error, /^Nora ha llegado a su presupuesto de este mes \(1000 tokens\)\. Súbelo en su ficha/);
  assert.ok(store.events(second.id).some((e) => e.type === "limit"));
  const third = runtime.create({ prompt: "tres", botIds: ["tomas"] });
  await runtime.launch(third.id);
  assert.equal(store.get("missions", third.id).status, "completed");
  // Raised: «Continuar» goes on.
  store.patch("bots", "nora", { monthlyTokens: 100_000 });
  await runtime.resume(second.id);
  assert.equal(store.get("missions", second.id).status, "completed");
  assert.equal(runtime.admission.held.size, 0);
});

test("the bot's month is built from the usage already recorded", async (t) => {
  const { store, runtime } = await fixture(t, async () => answer("ok", { input_tokens: 70, output_tokens: 30 }));
  await ask(runtime, { botId: "nora" });
  await ask(runtime, { botId: "tomas" });
  assert.equal(store.get("usageBotMonths", new Date().toISOString().slice(0, 7) + ":nora"), null, "nothing kept until a budget asks");
  assert.equal(botMonthTokens(store, "nora"), 100);
  await ask(runtime, { botId: "nora" });
  assert.equal(botMonthTokens(store, "nora"), 200);
  assert.equal(botMonthTokens(store, "nora", "2020-01"), 0);
});

test("a stream that dies half-way leaves its partial usage, and its reservation is released", async (t) => {
  let mode = "cut";
  const { store, runtime } = await fixture(t, async (params) => {
    if (mode === "refused") throw Object.assign(Error("OpenAI rechazo la peticion (400)."), { status: 400 });
    params.onEvent({ type: "response.created" });
    params.onDelta("Media respuesta antes de que se corte la conexión.");
    if (mode === "reported") throw Object.assign(Error("OpenAI interrumpio la respuesta."), { usage: { input_tokens: 40, output_tokens: 7 } });
    throw Error("OpenAI cortó la respuesta a medias.");
  });
  store.patch("bots", "nora", { monthlyTokens: 1_000_000 });
  const params = { instructions: "Eres Nora. ".repeat(30) };
  // Cut with no figure from the provider: counted from what was sent and what had arrived.
  await assert.rejects(ask(runtime, { botId: "nora" }, params), /cortó la respuesta/);
  let rows = usageRows(store);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].partial, rows[0].estimated, rows[0].botId, rows[0].purpose], [true, true, "nora", "step"]);
  assert.ok(rows[0].input >= 100 && rows[0].output >= 10 && rows[0].output <= 30, JSON.stringify(rows[0]));
  assert.equal(botMonthTokens(store, "nora"), rows[0].tokens);
  assert.equal(monthTokens(store), rows[0].tokens);
  assert.equal(runtime.admission.held.size, 0, "released on error");
  // The provider said what the cut answer used: that figure, not an estimate.
  mode = "reported";
  await assert.rejects(ask(runtime, { botId: "nora" }, params));
  rows = usageRows(store);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[1].tokens, rows[1].partial, rows[1].estimated], [47, true, undefined]);
  // A call that never started used nothing.
  mode = "refused";
  await assert.rejects(ask(runtime, { botId: "nora" }, params));
  assert.equal(usageRows(store).length, 2);
  assert.equal(runtime.admission.held.size, 0);
  // Inside a mission: the failed turn's partial usage counts for its bot, and nothing stays reserved.
  mode = "cut";
  const m = runtime.create({ prompt: "Hola", botIds: ["nora"] });
  await runtime.launch(m.id);
  assert.notEqual(store.get("missions", m.id).status, "completed");
  const mine = usageRows(store).filter((u) => u.missionId === m.id);
  assert.ok(mine.length >= 1 && mine.every((u) => u.partial && u.botId === "nora"));
  assert.equal(runtime.admission.held.size, 0);
});

test("every retry that died half-way is counted, and one reservation covers them all", async (t) => {
  let n = 0, heldDuring = [];
  const { store, runtime } = await fixture(t, async (params) => {
    n += 1;
    heldDuring.push(runtime.admission.held.size);
    if (n < 3) { params.onDelta("a medias"); throw Object.assign(Error("OpenAI rechazo la peticion (503)."), { status: 503 }); }
    return answer("ok", { input_tokens: 10, output_tokens: 5 });
  }, { retryDelays: [1, 1] });
  store.patch("bots", "nora", { monthlyTokens: 1_000_000 });
  await ask(runtime, { botId: "nora" });
  assert.deepEqual(heldDuring, [1, 1, 1]);
  assert.deepEqual(usageRows(store).map((u) => !!u.partial), [true, true, false]);
  assert.equal(runtime.admission.held.size, 0);
});

test("the provider's own count of a cut answer travels with the error", () => {
  const collector = responseCollector({ errors: { name: "OpenAI" } });
  assert.throws(
    () => collector.handle({ type: "response.incomplete", response: { id: "r1", incomplete_details: { reason: "max_output_tokens" }, usage: { input_tokens: 900, output_tokens: 4000 } } }),
    (e) => e.usage?.output_tokens === 4000 && e.incomplete === "max_output_tokens",
  );
});

test("the bot's budget is a field of the bot (PATCH /api/bots/:id), shown with what it used this month", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-admission-api-"));
  const store = new Store(dir);
  const runtime = new Runtime(store, { respond: async () => answer("ok", { input_tokens: 70, output_tokens: 30 }) });
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
  const patch = (route, body) => fetch(origin + "/api" + route, { method: "PATCH", headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: JSON.stringify(body) });
  const saved = await patch("/bots/nora", { monthlyTokens: 250_000 });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).monthlyTokens, 250_000);
  assert.equal(store.get("bots", "nora").monthlyTokens, 250_000);
  assert.equal((await patch("/bots/nora", { monthlyTokens: 10 })).status, 400, "too small to be a budget");
  assert.equal((await patch("/bots/nora", { monthlyTokens: "mucho" })).status, 400);
  await runtime.infer({ model: "fixture", instructions: "x", input: [], tools: [] }, { botId: "nora" });
  const detail = await (await fetch(origin + "/api/bots/nora")).json();
  assert.deepEqual([detail.monthlyTokens, detail.monthTokens], [250_000, 100]);
  const state = await (await fetch(origin + "/api/state")).json();
  assert.equal(state.bots.find((b) => b.id === "nora").monthlyTokens, 250_000);
  const cleared = await patch("/bots/nora", { monthlyTokens: null });
  assert.equal((await cleared.json()).monthlyTokens ?? null, null);
  // The threshold of the plan pause is a setting.
  const settings = await (await patch("/settings", { limits: { planPauseAt: 90 } })).json();
  assert.equal(settings.limits.planPauseAt, 90);
  assert.equal((await patch("/settings", { limits: { planPauseAt: 20 } })).status, 400);
  assert.equal((await (await patch("/settings", { limits: { planPauseAt: null } })).json()).limits.planPauseAt, null);
});
