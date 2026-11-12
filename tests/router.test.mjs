import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store, id, now } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { answer, settle } from "./fixtures/runtime-fixture.mjs";
import { ROUTER, ROUTER_INSTRUCTIONS, coordinationAsk, lastExchange, parsePick, quotedBot, routerInput, spokenLines } from "../server/router.mjs";

const MODELS = [{ slug: "grande" }, { slug: "mini", utility: true }];
const isRouter = (params) => params.instructions === ROUTER_INSTRUCTIONS;
const pick = (para, motivo = "") => answer(JSON.stringify({ para, ...(motivo ? { motivo } : {}) }));

/**
 * A runtime with the router on and a team room whose plan is done. `route(params)` answers the
 * router's call; every other call is a bot answering «Hecho.». `calls` are the router's calls.
 */
async function room(t, route = () => pick("atlas"), { botIds = ["nora", "tomas"], options = {} } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-router-"));
  const store = new Store(directory);
  store.patch("settings", "main", { model: "grande", learning: false });
  const calls = [];
  const provider = {
    session: { models: MODELS },
    respond: async (params) => {
      if (!isRouter(params)) return answer("Hecho.");
      calls.push(params);
      return route(params);
    },
  };
  const runtime = new Runtime(store, provider, null, { routing: true, ...options });
  t.after(async () => {
    await runtime.shutdown();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const mission = runtime.create({ prompt: "Preparad la feria", mode: "equipo", botIds, title: "Feria" });
  // The plan was made and delivered: the room is at rest.
  for (const s of runtime.steps(mission.id)) store.patch("steps", s.id, { status: "completed", text: "Plan hecho.", completedAt: now() });
  store.patch("missions", mission.id, { status: "completed" });
  const turns = () => runtime.steps(mission.id).filter((s) => s.kind === "followup");
  const said = (botId, text, at = now()) => store.put("messages", { id: id(), missionId: mission.id, role: "assistant", botId, text, kind: "message", at });
  const asked = (text, extra = {}) => store.put("messages", { id: id(), missionId: mission.id, role: "user", text, kind: "message", attachments: [], at: now(), ...extra });
  const send = async (text, opts) => {
    const message = runtime.addMessage(mission.id, text, [], opts);
    await settle(runtime);
    return store.get("messages", message.id);
  };
  return { store, runtime, mission, calls, turns, said, asked, send };
}

test("router helpers: coordination words, quotes, the last exchange and the model's JSON", () => {
  for (const t of ["Reparte esto entre todos", "organizaos para la feria", "Hacedlo entre los tres", "Necesito un plan para el lanzamiento", "- web\n- cartel\n- nota de prensa", "Quiero un informe, una presentación y un correo para el cliente"])
    assert.ok(coordinationAsk(t), t);
  for (const t of ["¿Cuánto costó el stand?", "Hazme un resumen del informe", "para mañana"]) assert.equal(coordinationAsk(t), null, t);
  const lines = [
    { role: "user", text: "¿Qué sabemos del mercado?", at: "2026-11-12T10:00:00Z" },
    { role: "assistant", botId: "nora", text: "El mercado **crece un 4 %** al año según el INE.", at: "2026-11-12T10:00:20Z" },
  ];
  assert.equal(quotedBot("> El mercado crece un 4 % al año\n¿seguro?", lines), "nora");
  assert.equal(quotedBot("> crece\n¿seguro?", lines), null, "too short to say whose it is");
  assert.equal(quotedBot("¿seguro que crece un 4 % al año según el INE?", lines), null, "not a quote");
  const at = Date.parse("2026-11-12T10:05:00Z");
  assert.equal(lastExchange(lines, at), "nora");
  assert.equal(lastExchange(lines, at + ROUTER.recentMs), null, "more than ten minutes ago");
  assert.equal(lastExchange([...lines, { role: "assistant", botId: "tomas", text: "Y yo añado costes.", at: "2026-11-12T10:01:00Z" }], at), null, "two bots answered");
  assert.equal(lastExchange([{ ...lines[0], to: ["tomas"] }, lines[1]], at), null, "the message was for another bot");
  assert.equal(lastExchange([lines[1], lines[0]], at), null, "nobody answered the last message");
  assert.equal(spokenLines([{ role: "user", text: "en un hilo", replyTo: "x" }, { role: "system", text: "nota" }, { role: "assistant", botId: "nora", text: "[SIN NOVEDADES]" }, lines[0]]).length, 1);
  const ok = ["nora", "tomas", "iris", "vera"];
  assert.deepEqual(parsePick('{"para":"nora","motivo":"Es investigación"}', ok), { to: ["nora"], why: "Es investigación" });
  assert.deepEqual(parsePick('```json\n{"para":["nora","tomas","nora"]}\n```', ok).to, ["nora", "tomas"]);
  assert.deepEqual(parsePick('{"para":"Atlas"}', ok).to, ["atlas"]);
  assert.deepEqual(parsePick('{"para":["atlas","nora"]}', ok).to, ["atlas"], "Atlas among several is coordination");
  for (const bad of ["Nora", '{"para":"bruno"}', '{"para":[]}', '{"para":["nora","tomas","iris","vera"]}', '{"para":7}', '["nora"]', '{"para":["nora","leo"]}'])
    assert.equal(parsePick(bad, ok), null, bad);
});

test("the prompt stays small: the message, six lines of the room and one line per bot", () => {
  const long = "palabra ".repeat(2000);
  const lines = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", botId: "nora", text: long }));
  const bots = ["nora", "tomas", "iris", "vera", "bruno", "leo"].map((b) => ({ id: b, name: b, role: "Especialidad", instructions: long }));
  const input = JSON.parse(routerInput(long, lines, bots, () => "Nora"));
  assert.equal(input.sala.length, ROUTER.lines);
  assert.equal(input.bots.length, 6);
  const size = ROUTER_INSTRUCTIONS.length + routerInput(long, lines, bots, () => "Nora").length;
  assert.ok(size < 3600, "prompt of " + size + " characters");
});

test("rule: a message that quotes a bot's message goes to that bot, without a model call", async (t) => {
  const r = await room(t);
  r.asked("¿Qué sabemos del mercado?");
  r.said("tomas", "Los costes del stand suben a 4.200 euros con el montaje.", new Date(Date.now() - 3_600_000).toISOString());
  const message = await r.send("> Los costes del stand suben a 4.200 euros\n¿Con IVA?");
  assert.deepEqual(message.routed.to, ["tomas"]);
  assert.equal(message.routed.by, "regla");
  assert.match(message.routed.why, /Citas un mensaje de Tomás/);
  assert.deepEqual(r.turns().map((s) => s.botId), ["tomas"]);
  assert.equal(r.calls.length, 0);
});

test("rule: the bot the person was just talking with keeps the conversation for ten minutes", async (t) => {
  const r = await room(t, () => pick("tomas"));
  await r.send("@Nora ¿qué sabemos del mercado?");
  assert.deepEqual(r.turns().map((s) => s.botId), ["nora"]);
  const next = await r.send("¿Y en Portugal?");
  assert.deepEqual(next.routed.to, ["nora"]);
  assert.equal(next.routed.by, "regla");
  assert.match(next.routed.why, /Estabas hablando con Nora/);
  assert.equal(r.calls.length, 0);
  // Ten minutes later the exchange is over: the model picks.
  for (const m of r.store.where("messages", "missionId", r.mission.id)) r.store.patch("messages", m.id, { at: new Date(Date.now() - 11 * 60_000).toISOString() });
  const later = await r.send("¿Cuánto nos costaría?");
  assert.deepEqual(later.routed.to, ["tomas"]);
  assert.equal(later.routed.by, "modelo");
  assert.equal(r.calls.length, 1);
});

test("rule: a request to split or coordinate goes to Atlas, even right after talking with a bot", async (t) => {
  const r = await room(t, () => pick("nora"));
  await r.send("@Nora ¿qué sabemos del mercado?");
  const message = await r.send("Repartid entre todos lo que falta de la feria");
  assert.deepEqual(message.routed.to, ["atlas"]);
  assert.equal(message.routed.by, "regla");
  assert.equal(r.turns().at(-1).botId, "atlas");
  assert.equal(r.calls.length, 0);
});

test("the model's pick is honoured: one bot, Atlas, or up to three for a message to everyone", async (t) => {
  const answers = [pick("tomas", "Son cifras"), pick("atlas"), pick(["nora", "tomas"], "Pregunta a todos")];
  const r = await room(t, () => answers.shift());
  const one = await r.send("¿Cuánto llevamos gastado?");
  assert.deepEqual(one.routed, { to: ["tomas"], by: "modelo", why: "Son cifras", ms: one.routed.ms });
  assert.equal(one.routing, false);
  assert.equal(r.turns().at(-1).botId, "tomas");
  // What the model read: the message, the room and the bots that can be chosen, on the cheap model.
  const call = r.calls[0];
  assert.equal(call.model, "mini");
  assert.deepEqual(call.tools, []);
  const input = JSON.parse(call.input[0].content);
  assert.equal(input.mensaje, "¿Cuánto llevamos gastado?");
  assert.deepEqual(input.bots.map((b) => b.split(" · ")[0]), ["nora", "tomas"]);
  assert.ok(!input.sala.some((l) => l.includes("¿Cuánto llevamos gastado?")), "the message is not repeated among the room's lines");
  // The chosen bot runs as if it had been mentioned: an ordinary turn of its own.
  const turn = r.turns().at(-1);
  assert.equal(turn.kind, "followup");
  assert.equal(turn.ackOn, one.id);
  r.store.patch("messages", r.store.where("messages", "missionId", r.mission.id).filter((m) => m.role === "assistant").at(-1).id, { at: new Date(Date.now() - 11 * 60_000).toISOString() });
  const atlas = await r.send("¿Cómo lo veis de tiempo?");
  assert.deepEqual([atlas.routed.to, atlas.routed.by], [["atlas"], "modelo"]);
  for (const m of r.store.where("messages", "missionId", r.mission.id)) r.store.patch("messages", m.id, { at: new Date(Date.now() - 11 * 60_000).toISOString() });
  const all = await r.send("¿Qué opináis?");
  assert.deepEqual(all.routed.to, ["nora", "tomas"]);
  const chain = r.turns().slice(-2);
  assert.deepEqual(chain.map((s) => s.botId), ["nora", "tomas"]);
  assert.ok(chain[0].chain && chain[0].chain === chain[1].chain, "they answer one after another");
});

test("a model that is wrong, slow or fails leaves the message to Atlas", async (t) => {
  const cases = [
    ["not JSON", () => answer("Creo que Nora"), {}],
    ["an id that is not in the room", () => pick("bruno"), {}],
    ["a failure", () => { throw Error("502"); }, {}],
    ["too slow", () => new Promise((resolve) => setTimeout(() => resolve(pick("nora")), 400)), { routerTimeoutMs: 30 }],
  ];
  for (const [name, route, options] of cases) {
    const r = await room(t, route, { options });
    const started = Date.now();
    const message = await r.send("¿Cuánto llevamos gastado?");
    assert.deepEqual([message.routed.to, message.routed.by], [["atlas"], "atlas"], name);
    assert.ok(message.routed.why, name);
    assert.deepEqual(r.turns().map((s) => s.botId), ["atlas"], name);
    assert.equal(r.calls.length, 1, name);
    if (options.routerTimeoutMs) assert.ok(Date.now() - started < 380, "the slow pick was not waited for");
  }
});

test("the router is a side job: skipped when the plan is nearly used up, and Atlas answers", async (t) => {
  const r = await room(t, () => pick("nora"));
  r.runtime.admission.notePlan(r.runtime.engineOfModel("mini"), { at: new Date().toISOString(), primary: { usedPercent: 97, windowMinutes: 300, resetsAt: new Date(Date.now() + 3_600_000).toISOString() } });
  const message = await r.send("¿Cuánto llevamos gastado?");
  assert.deepEqual([message.routed.to, message.routed.by], [["atlas"], "atlas"]);
  assert.equal(r.calls.length, 0, "no model call was made");
  assert.deepEqual(r.turns().map((s) => s.botId), ["atlas"]);
});

test("with the setting off every message that names nobody goes to Atlas, as before", async (t) => {
  const r = await room(t, () => pick("nora"));
  r.store.patch("settings", "main", { routing: false });
  await r.send("@Nora ¿qué sabemos del mercado?");
  const message = await r.send("¿Y en Portugal?");
  assert.equal(message.routed, undefined);
  assert.equal(message.routing, undefined);
  assert.equal(r.turns().at(-1).botId, "atlas");
  assert.equal(r.calls.length, 0);
});

test("the router never decides for a mention, a thread, a chat, a debate, a lone specialist or a plan under way", async (t) => {
  const r = await room(t, () => pick("tomas"));
  const named = await r.send("@Nora ¿qué sabemos del mercado?");
  assert.equal(named.routed, undefined);
  assert.deepEqual(named.to, ["nora"]);
  // A reply in a thread stays with the bot of that thread.
  const answerOfNora = r.store.where("messages", "missionId", r.mission.id).find((m) => m.role === "assistant" && m.botId === "nora");
  const inThread = await r.send("¿Seguro?", { replyTo: answerOfNora.id });
  assert.equal(inThread.routed, undefined);
  assert.equal(r.turns().at(-1).botId, "nora");
  // A routine writing in the room is not the person.
  const routine = await r.send("Rutina «Lunes»: repasa lo pendiente", { route: false });
  assert.equal(routine.routed, undefined);
  assert.equal(r.turns().at(-1).botId, "atlas");
  assert.equal(r.calls.length, 0);

  const chat = r.runtime.create({ prompt: "Hola", mode: "solo", botIds: ["nora"], conversation: true });
  await settle(r.runtime);
  const inChat = r.runtime.addMessage(chat.id, "¿Y en Portugal?");
  await settle(r.runtime);
  assert.equal(r.store.get("messages", inChat.id).routed, undefined);
  assert.equal(r.runtime.steps(chat.id).at(-1).botId, "nora");

  const debate = r.runtime.create({ prompt: "¿Feria o web?", mode: "debate", botIds: ["nora", "tomas"] });
  for (const s of r.runtime.steps(debate.id)) r.store.patch("steps", s.id, { status: "completed", text: "Propuesta." });
  r.store.patch("missions", debate.id, { status: "completed", chosenBotIds: ["tomas"] });
  const inDebate = r.runtime.addMessage(debate.id, "Sigue con eso");
  await settle(r.runtime);
  assert.equal(r.store.get("messages", inDebate.id).routed, undefined);
  assert.equal(r.runtime.steps(debate.id).at(-1).botId, "tomas");
  assert.equal(r.calls.length, 0);

  const lone = await room(t, () => pick("nora"), { botIds: ["nora"] });
  const alone = await lone.send("¿Cuánto llevamos gastado?");
  assert.equal(alone.routed, undefined);
  assert.equal(lone.turns().at(-1).botId, "atlas");

  const busy = await room(t, () => pick("nora"));
  busy.store.patch("steps", busy.runtime.steps(busy.mission.id)[0].id, { status: "pending" });
  busy.store.patch("missions", busy.mission.id, { status: "paused" });
  const during = await busy.send("¿Cuánto llevamos gastado?");
  assert.equal(during.routed, undefined, "Atlas coordinates while the plan is not done");
  assert.equal(busy.calls.length + lone.calls.length, 0);
});

test("a bot that is switched off is never offered nor chosen", async (t) => {
  const r = await room(t, () => pick("iris"), { botIds: ["nora", "tomas", "iris"] });
  r.store.patch("bots", "iris", { enabled: false });
  const message = await r.send("¿Me hacéis un cartel?");
  assert.deepEqual(JSON.parse(r.calls[0].input[0].content).bots.map((b) => b.split(" · ")[0]), ["nora", "tomas"]);
  assert.deepEqual([message.routed.to, message.routed.by], [["atlas"], "atlas"]);
  // Nor by a rule: it wrote the quoted message, but it cannot answer now.
  r.said("iris", "El cartel irá en azul con el logo arriba a la izquierda.", new Date(Date.now() - 3_600_000).toISOString());
  for (const m of r.store.where("messages", "missionId", r.mission.id)) r.store.patch("messages", m.id, { at: new Date(Date.now() - 3_600_000).toISOString() });
  const quoted = await r.send("> El cartel irá en azul con el logo arriba\n¿y en verde?");
  assert.ok(!quoted.routed.to.includes("iris"));
  // Switched off while the model was thinking.
  const late = await room(t, () => { late.store.patch("bots", "tomas", { enabled: false }); return pick("tomas"); }, { botIds: ["nora", "tomas", "iris"] });
  const dropped = await late.send("¿Cuánto llevamos gastado?");
  assert.deepEqual([dropped.routed.to, dropped.routed.by], [["atlas"], "atlas"]);
});

test("the message is there at once; its turn is queued when the pick arrives, and later messages keep their order", async (t) => {
  let release = null;
  // The first pick is slow; the ones after it answer at once.
  const r = await room(t, () => (release ? pick("atlas") : new Promise((resolve) => { release = () => resolve(pick("tomas")); })));
  const first = r.runtime.addMessage(r.mission.id, "¿Cuánto llevamos gastado?");
  // Returned (and stored) before the model answers: nothing waits for the router.
  assert.equal(first.routing, true);
  assert.equal(r.store.get("messages", first.id).text, "¿Cuánto llevamos gastado?");
  assert.equal(r.turns().length, 0);
  // Two more arrive meanwhile: one for a named bot, one that names nobody.
  const second = r.runtime.addMessage(r.mission.id, "@Nora mira también el mercado");
  const third = r.runtime.addMessage(r.mission.id, "Y con IVA, por favor");
  assert.equal(r.turns().length, 0, "nothing jumps ahead of the message being routed");
  assert.equal(r.runtime.activity.get("atlas")?.verb ?? null, null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(r.runtime.activity.get("atlas")?.verb, "eligiendo quién responde");
  release();
  await settle(r.runtime);
  const turns = r.turns();
  assert.deepEqual(turns.map((s) => [s.botId, s.ackOn]), [["tomas", first.id], ["nora", second.id], ["atlas", third.id]].slice(0, turns.length));
  assert.equal(turns.length, 3);
  // Each turn waits for the ones before it: they are answered in the order they were written.
  assert.ok(turns[1].deps.includes(turns[0].key) && turns[2].deps.includes(turns[1].key));
  assert.deepEqual(r.store.get("messages", first.id).routed.to, ["tomas"]);
  assert.equal(r.store.get("messages", first.id).routing, false);
  assert.equal(r.runtime.activity.has("atlas"), false);
  const texts = r.store.where("messages", "missionId", r.mission.id).filter((m) => m.role === "user").map((m) => m.text);
  assert.deepEqual(texts.slice(-3), ["¿Cuánto llevamos gastado?", "@Nora mira también el mercado", "Y con IVA, por favor"]);
});

/** A room where Nora is at work: her first call does not end until it is cut. `route` answers the router. */
async function roomAtWork(t, route) {
  const r = await room(t);
  let blocked = false, started = null;
  const atWork = new Promise((resolve) => { started = resolve; });
  r.runtime.provider.respond = async (params) => {
    if (isRouter(params)) { r.calls.push(params); return route(params); }
    if (!blocked) {
      blocked = true;
      started();
      await new Promise((resolve, reject) => params.signal?.addEventListener("abort", () => reject(params.signal.reason), { once: true }));
    }
    return answer("Hecho.");
  };
  r.runtime.addMessage(r.mission.id, "@Nora investiga el mercado");
  await atWork;
  assert.ok(r.runtime.active.has(r.mission.id));
  return r;
}

test("«Interrumpe» does not wait for a model pick: Atlas answers now", async (t) => {
  const r = await roomAtWork(t, () => pick("tomas"));
  const urgent = r.runtime.addMessage(r.mission.id, "Dejad eso: ¿cuánto llevamos gastado?", [], { mode: "interrupt" });
  assert.deepEqual([urgent.routed.to, urgent.routed.by], [["atlas"], "atlas"]);
  assert.equal(r.calls.length, 0);
  assert.equal(r.turns().at(-1).botId, "atlas");
  assert.equal(r.turns().at(-1).deps.length, 0, "answered now, not after the work in course");
  await settle(r.runtime);
  assert.equal(r.store.get("missions", r.mission.id).status, "completed");
});

test("a stop word stops the work at once while a message is still being routed; its turn waits for «Continuar»", async (t) => {
  let release = null;
  const r = await roomAtWork(t, () => new Promise((resolve) => { release = () => resolve(pick("tomas")); }));
  // Steer mode (the default): the message reaches the room, the router is asked.
  const steer = r.runtime.addMessage(r.mission.id, "¿Cuánto llevamos gastado?");
  assert.equal(steer.routing, true);
  const stop = r.runtime.addMessage(r.mission.id, "para");
  assert.equal(stop.stop, true);
  for (let i = 0; i < 50 && !release; i++) await new Promise((resolve) => setImmediate(resolve));
  release();
  await settle(r.runtime);
  assert.equal(r.store.get("missions", r.mission.id).status, "paused");
  assert.deepEqual(r.store.get("messages", steer.id).routed.to, ["tomas"]);
  const turn = r.turns().find((s) => s.ackOn === steer.id);
  assert.deepEqual([turn.botId, turn.status], ["tomas", "pending"]);
});

