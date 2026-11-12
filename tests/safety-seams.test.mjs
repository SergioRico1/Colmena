import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, settle, outputs } from "./fixtures/runtime-fixture.mjs";
import { makeOrigin, worksFromOutside } from "../server/origin.mjs";
import { wrapExternal } from "../server/external-content.mjs";
import { attachWikiTools } from "../server/wiki-tools.mjs";
import { attachBlockTools, blockByKey } from "../server/blocks.mjs";
import { createPage, getPage, resolvePage } from "../server/wiki.mjs";

// Bugs found at the seams between features. What they share: text that is not the person's own
// typed message never counts as the person's words, and outside content (a trigger's payload
// included) keeps its mark through every hop.

const PAYLOAD = "Pedido 4471 de Ferretería Lozano: 12 taladros percutores.";
const trigger = (id = "r-mail", instruction = "Atiende los pedidos que lleguen") => makeOrigin({ type: "trigger", id, signature: id + ":x", instruction });
const eventText = (rule = "Pedidos") => "\n\nQué lo ha puesto en marcha:\n" + wrapExternal(JSON.stringify({ tipo: "correo", resumen: PAYLOAD }), { source: "email", label: rule });
const remember = (text, id = "m1") => call("remember", { operations: [{ action: "add", target: "persona", text, old: "" }] }, id);
const write = (args, id = "w1") => call("wiki_write", { section: "", revision: 0, ...args }, id);
const kpi = (value) => ({ type: "kpi", label: "Pedidos", value });

/** A runtime with the note and block tools and a scripted model: each call takes the next reply. */
async function scripted(t, options) {
  const queue = [], seen = [];
  const f = await fixture(t, async ({ input, tools }) => {
    // Side jobs (titles, narration, the router) carry no tools: they never take a scripted reply.
    if (!tools?.length) return answer("Vale.");
    seen.push(outputs(input));
    const next = queue.shift();
    return typeof next === "function" ? next(input) : next ?? answer("Hecho.");
  }, options);
  attachWikiTools(f.runtime);
  attachBlockTools(f.runtime);
  return { ...f, queue, seen };
}
/** What Scheduler#fire does for a new conversation per run: the mission and its first message carry the origin. */
function fired(store, runtime, origin, prompt = "Atiende los pedidos que lleguen") {
  const mission = runtime.create({ prompt: prompt + eventText(), title: "Pedidos", mode: "solo", botIds: ["nora"], automationId: origin.id, safety: "preguntar" });
  store.patch("missions", mission.id, { origin });
  const first = store.where("messages", "missionId", mission.id).find((m) => m.role === "user");
  store.patch("messages", first.id, { automationId: origin.id, origin });
  return store.get("missions", mission.id);
}
/** What Scheduler#fire does for «misma»/«sala»: the rule's message in the room, stamped with where it comes from. */
function delivered(store, runtime, room, origin, text = "Rutina «Pedidos»: Atiende los pedidos que lleguen" + eventText()) {
  const message = runtime.addMessage(room.id, text, [], { route: false });
  store.patch("messages", message.id, { automationId: origin.id, origin });
  return message;
}

test("what a trigger's payload makes a bot write keeps the outside mark: notes and memory, in its own run and in a room", async (t) => {
  const { store, runtime, queue } = await scripted(t);
  store.patch("bots", "nora", { autonomy: "avisa" });
  // A run of its own: the mail travels inside the request text, no tool read it.
  const run = fired(store, runtime, trigger());
  queue.push(write({ page: "Pedidos de Lozano", action: "create", content: PAYLOAD }), remember("Ferretería Lozano pide taladros percutores cada mes."));
  await runtime.launch(run.id);
  await settle(runtime);
  const note = getPage(store, resolvePage(store, "Pedidos de Lozano").page.id);
  assert.ok(note.external, "the note is marked as outside content");
  const memory = store.list("memories").find((m) => /Lozano/.test(m.text));
  assert.deepEqual([memory.origin, memory.review], ["externo", true], "the memory waits for review as outside content");

  // The same rule delivering into a room: the turn that answers its message.
  const room = runtime.create({ prompt: "Sala de pedidos", mode: "solo", botIds: ["nora"], conversation: true });
  await runtime.launch(room.id);
  await settle(runtime);
  queue.push(write({ page: "Pedidos en sala", action: "create", content: PAYLOAD }, "w2"), remember("Los taladros percutores de Lozano llegan por correo.", "m2"));
  delivered(store, runtime, room, trigger());
  await settle(runtime);
  assert.ok(getPage(store, resolvePage(store, "Pedidos en sala").page.id).external);
  assert.equal(store.list("memories").find((m) => /llegan por correo/.test(m.text)).origin, "externo");

  // The person's own message in that room, afterwards, is theirs: no mark.
  queue.push(write({ page: "Mi nota", action: "create", content: "Llamar al gestor el lunes." }, "w3"));
  runtime.addMessage(room.id, "Apunta en las notas: llamar al gestor el lunes");
  await settle(runtime);
  assert.equal(getPage(store, resolvePage(store, "Mi nota").page.id).external ?? null, null);
});

test("a memory saved after reading a note marked as outside content is outside content too", async (t) => {
  const { store, runtime, queue } = await scripted(t);
  createPage(store, { title: "Tarifas", body: "La gestoría Ruiz cobra 900 € al mes." }, { external: { by: { kind: "bot", botId: "vera" }, at: new Date().toISOString(), label: "Copiado de una web" } });
  const m = runtime.create({ prompt: "Mira qué tenemos apuntado de tarifas", mode: "solo", botIds: ["nora"] });
  queue.push(call("wiki_read", { page: "Tarifas", part: 1 }, "r1"), remember("La gestoría Ruiz cobra 900 € al mes."));
  await runtime.launch(m.id);
  await settle(runtime);
  const memory = store.list("memories").find((x) => /Ruiz/.test(x.text));
  assert.deepEqual([memory.origin, memory.review], ["externo", true]);
});

test("worksFromOutside goes by the message the step answers, not by the room's last one", async (t) => {
  const { store } = await fixture(t, async () => answer("x"));
  store.put("missions", { id: "room", title: "Sala", prompt: "Sala", mode: "solo", botIds: ["nora"], status: "running", createdAt: new Date().toISOString() });
  store.put("messages", { id: "auto", missionId: "room", role: "user", text: "Rutina", at: "2026-11-12T08:00:00.000Z", origin: trigger() });
  store.put("messages", { id: "mine", missionId: "room", role: "user", text: "Hola", at: "2026-11-12T08:00:05.000Z" });
  store.put("messages", { id: "timed", missionId: "room", role: "user", text: "Rutina de las 8", at: "2026-11-12T08:00:06.000Z", origin: makeOrigin({ type: "automation", id: "r-hora" }) });
  const room = store.get("missions", "room");
  assert.equal(worksFromOutside(store, room, { id: "s1", ackOn: "auto" }), true);
  assert.equal(worksFromOutside(store, room, { id: "s2", ackOn: "mine" }), false);
  assert.equal(worksFromOutside(store, room, { id: "s3", ackOn: "mine", ackExtra: ["auto"] }), true, "a turn that answers both");
  assert.equal(worksFromOutside(store, room, { id: "s4", ackOn: "timed" }), false, "a routine on a schedule brings nothing from outside");
  assert.equal(worksFromOutside(store, room, { id: "s5", ackOn: "mine", wikiOutside: true }), true);
  assert.equal(worksFromOutside(store, { ...room, origin: makeOrigin({ type: "watch", id: "nora" }) }, { id: "s6" }), true);
  assert.equal(worksFromOutside(store, room, { id: "s7", history: [{ type: "function_call", name: "web_fetch" }] }), true);
});

test("a block posted from a trigger's turn stays outside content and off the panel when the person writes mid-run", async (t) => {
  const { store, runtime, queue } = await scripted(t);
  store.put("automations", { id: "r-mail", name: "Pedidos", botId: "nora", prompt: "Atiende los pedidos", enabled: true, trigger: { type: "correo", config: {} }, createdAt: new Date().toISOString() });
  const room = runtime.create({ prompt: "Sala de pedidos", mode: "solo", botIds: ["nora"], conversation: true });
  await runtime.launch(room.id);
  await settle(runtime);
  const post = () => call("block_post", { key: "pedidos", title: "Pedidos de hoy", where: "panel", spec: { ...kpi(3), url: "https://malo.test/" } }, "b" + Math.random());
  let wrote = false;
  const reply = (input) => {
    // The person writes while the routine's turn works: theirs is now the room's last message.
    if (!wrote) { wrote = true; store.put("messages", { id: "mid-run", missionId: room.id, role: "user", kind: "message", text: "¿Cómo va?", attachments: [], at: new Date().toISOString(), deliver: "after" }); }
    return outputs(input).some((o) => o.saved) ? answer("Listo.") : post();
  };
  queue.push(reply, reply, reply);
  delivered(store, runtime, room, trigger());
  await settle(runtime);
  const block = blockByKey(store, "pedidos");
  assert.ok(block, "the block was posted");
  assert.deepEqual([block.outside, block.pinned, block.spec.url, block.automationId], [true, false, undefined, "r-mail"]);
});
