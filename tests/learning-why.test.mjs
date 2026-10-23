import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, outputs, settle } from "./fixtures/runtime-fixture.mjs";
import { evidenceOf, whyOf } from "../server/learning.mjs";

const EMPTY = { memory: [], skill: { action: "none", skillId: null, edits: [], name: "", description: "", content: "" }, soul: null };
const SKILL = "---\nname: informe-ventas\ndescription: Úsala cuando haya que preparar el informe de ventas\n---\n## Pasos\n1. Lee los datos con `list_files`.\n2. Redacta en una página.\n";

async function setup(t, reflect) {
  const seen = [];
  const env = await fixture(t, async (request) => {
    if (request.instructions.startsWith("Extrae")) {
      const payload = JSON.parse(request.input[0].content);
      seen.push(payload);
      return answer(JSON.stringify(reflect(payload)));
    }
    const done = outputs(request.input).length;
    return done < 5 ? call("list_files", {}, "c" + done) : answer("Informe listo");
  });
  env.store.patch("settings", "main", { learning: true });
  return { ...env, seen };
}

test("the review gets evidence with short ids; a cited message becomes the «por qué» of the memory and its notice", async (t) => {
  const { store, runtime, seen } = await setup(t, () => ({
    ...EMPTY,
    memory: [
      { action: "add", target: "persona", text: "Prefiere los informes en una sola página", old: "", por: ["m2", "x9"] },
      { action: "add", target: "persona", text: "Vive en Valencia", old: "", por: ["m7"] },
    ],
  }));
  const m = runtime.create({ prompt: "Prepara el informe de ventas", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  runtime.addMessage(m.id, "Demasiado largo: lo quiero en una página");
  await settle(runtime);
  const payload = seen.at(-1);
  assert.deepEqual(payload.evidencias.filter((e) => e.tipo === "mensaje").map((e) => [e.id, e.texto]), [["m1", "Prepara el informe de ventas"], ["m2", "Demasiado largo: lo quiero en una página"]]);
  assert.ok(payload.evidencias.some((e) => e.id === "r1" && e.tipo === "recibo" && /list_files funcionó/.test(e.texto)));
  const memory = store.list("memories").find((x) => /una sola página/.test(x.text));
  assert.equal(memory.why.length, 1, "invented ids are dropped");
  assert.equal(memory.why[0].type, "mensaje");
  assert.ok(store.get("messages", memory.why[0].id), "the cited id is a real message");
  assert.equal(memory.why[0].quote, "Demasiado largo: lo quiero en una página");
  assert.ok(!store.list("memories").some((x) => /Valencia/.test(x.text)), "nothing justifies it: not saved");
  assert.match(store.get("missions", m.id).learning.notes.join(" "), /no cita de dónde sale/);
  const notice = store.list("messages").find((x) => x.kind === "learned" && x.learned?.type === "memory");
  assert.match(notice.text, /^Aprendido: «Prefiere los informes en una sola página» · por revisar$/);
  assert.equal(notice.learned.why[0].quote, "Demasiado largo: lo quiero en una página");
});

test("a skill falls back to the task as its «por qué»; a SOUL change needs the person's own words", async (t) => {
  const { store, runtime } = await setup(t, () => ({
    ...EMPTY,
    skill: { action: "create", skillId: null, edits: [], name: "informe-ventas", description: "Úsala cuando haya que preparar el informe de ventas", content: SKILL, por: ["r2"] },
    soul: { proposal: "Me gusta ir al grano con tablas.", reason: "Funciona mejor", por: ["r1"] },
  }));
  const m = runtime.create({ prompt: "Prepara el informe de ventas", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  const skill = store.list("skills").find((s) => s.origin === "learned");
  assert.equal(skill.why[0].type, "recibo");
  const notice = store.list("messages").find((x) => x.kind === "learned" && x.learned?.type === "skill");
  assert.equal(notice.learned.why[0].type, "recibo");
  assert.equal(store.list("approvals").filter((a) => a.kind === "soul").length, 0, "a tool receipt never justifies a change of character");
  assert.match(store.get("missions", m.id).learning.notes.join(" "), /no cita palabras de la persona/);
});

test("whyOf: cited ids must exist; otherwise the evidence that covers the learned text; else nothing", async (t) => {
  const { store } = await setup(t, () => EMPTY);
  store.put("missions", { id: "w", title: "x", prompt: "x", botIds: ["nora"], status: "completed" });
  store.put("messages", { id: "msg1", missionId: "w", role: "user", text: "Trabajamos siempre en euros, nunca en dólares" });
  const evidence = evidenceOf(store, store.get("missions", "w"), {});
  assert.deepEqual(whyOf(store, evidence, ["m1"]).map((w) => w.id), ["msg1"]);
  assert.deepEqual(whyOf(store, evidence, ["m9"], { text: "Trabaja en euros, no en dólares" }).map((w) => [w.id, w.auto]), [["msg1", true]]);
  assert.deepEqual(whyOf(store, evidence, [], { text: "Tiene un perro" }), []);
  store.remove("messages", "msg1");
  assert.deepEqual(whyOf(store, evidence, ["m1"]), [], "an id that no longer exists is not a reason");
});

test("what a bot saves with remember cites the person's words of that mission", async (t) => {
  let round = 0;
  const { store, runtime } = await fixture(t, async () => {
    round += 1;
    return round === 1 ? call("remember", { operations: [{ action: "add", target: "persona", text: "Prefiere reuniones por la mañana", old: "" }] }, "r1") : answer("Apuntado.");
  });
  const m = runtime.create({ prompt: "Apunta que prefiero las reuniones por la mañana", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  const memory = store.list("memories").find((x) => /mañana/.test(x.text));
  assert.equal(memory.why[0].quote, "Apunta que prefiero las reuniones por la mañana");
  const notice = store.list("messages").find((x) => x.missionId === m.id && x.kind === "learned");
  assert.equal(notice.learned.why[0].type, "mensaje");
});
