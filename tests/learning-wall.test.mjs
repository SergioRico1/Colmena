import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, outputs, settle } from "./fixtures/runtime-fixture.mjs";
import { importSkill, activateSkill } from "../server/skills.mjs";
import { assertNoApprovalSignals, proposeSoulChange, learnFromMission } from "../server/learning.mjs";
import { togglePersonReaction } from "../server/reactions.mjs";
import { observeMission } from "../server/verdicts.mjs";

const SKILL = "---\nname: informe-ventas\ndescription: Úsala cuando haya que preparar el informe de ventas\n---\n## Pasos\n1. Lee los datos.\n2. Redacta.\n";
const EMPTY = { decision: "mantener", motivo: "Nada.", memory: [], skill: { action: "none", skillId: null, edits: [], name: "", description: "", content: "" }, soul: null };

test("the review never sees the person's approvals, ratings or reactions, nor the verdicts they feed", async (t) => {
  const payloads = [];
  let skillId;
  const { store, runtime } = await fixture(t, async (request) => {
    if (request.instructions.startsWith("Extrae")) {
      payloads.push(request.input[0].content);
      return answer(JSON.stringify(EMPTY));
    }
    const done = outputs(request.input).length;
    if (done === 0) return call("read_skill", { id: skillId }, "rs");
    return done < 5 ? call("list_files", {}, "c" + done) : answer("Informe listo");
  });
  store.patch("settings", "main", { learning: true });
  skillId = activateSkill(store, importSkill(store, { content: SKILL, botId: "nora", origin: "learned" }).id, "active").id;
  const m = runtime.create({ prompt: "Prepara el informe de ventas", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  // The person reacts 👍 to the answer, approves an action and a verdict exists for the skill.
  const reply = store.list("messages").find((x) => x.missionId === m.id && x.role === "assistant");
  togglePersonReaction(store, reply.id, "👍");
  store.put("approvals", { id: "ok1", missionId: m.id, botId: "nora", kind: "write", title: "Crear «a.md»", status: "executed", decidedBy: "tú", resolution: "Aprobado" });
  observeMission(store, m.id);
  assert.ok(store.get("skills", skillId).verdict, "the reaction and approval were measured");
  runtime.addMessage(m.id, "No, demasiado largo");
  await settle(runtime);
  assert.ok(payloads.length >= 2);
  for (const raw of payloads) {
    assert.doesNotMatch(raw, /👍|reaction|reacci|verdict|veredicto|confianza (?:baja|media|alta)|"approved"|aprobad/i);
    assert.doesNotThrow(() => assertNoApprovalSignals(JSON.parse(raw)));
  }
});

test("the tripwire fires if a measurement or an approval would reach the review", async (t) => {
  assert.throws(() => assertNoApprovalSignals({ habilidades: [{ id: "s", verdict: { value: "ayudo" } }] }), /Muro de aprobaciones: .*«verdict»/);
  assert.throws(() => assertNoApprovalSignals({ mensajes: ["La persona reaccionó con 👍 a tu mensaje"] }), /Muro de aprobaciones/);
  assert.throws(() => assertNoApprovalSignals({ nota: "Ayudó · confianza media" }), /Muro de aprobaciones/);
  assert.throws(() => assertNoApprovalSignals({ x: [{ reactions: [] }] }), /«reactions»/);
  assert.deepEqual(assertNoApprovalSignals({ rechazos: [{ accion: "Enviar «Resumen»", motivo: "Solo a dirección" }] }).rechazos.length, 1, "the reason of a stop is content, not a rating");
  // A leak stops the review: nothing is learned from it.
  const { store } = await fixture(t, async () => answer(JSON.stringify(EMPTY)));
  store.patch("settings", "main", { learning: true });
  store.put("missions", { id: "w", title: "x", prompt: "Resumen: Ayudó · confianza alta", mode: "solo", botIds: ["nora"], status: "completed" });
  await assert.rejects(learnFromMission({ store, missionId: "w", model: "fixture", infer: async () => ({ text: JSON.stringify(EMPTY) }), force: true }), /Muro de aprobaciones/);
});

test("a SOUL change justified by approvals or reactions is never proposed", async (t) => {
  const { store } = await fixture(t, async () => answer("ok"));
  const bot = store.get("bots", "nora");
  assert.equal(proposeSoulChange(store, { bot, missionId: null, proposal: "Seré más breve, que es lo que le gustó.", reason: "Reaccionó con 👍 a las respuestas cortas" }), null);
  assert.equal(proposeSoulChange(store, { bot, missionId: null, proposal: "Haré lo que la persona aprobó la última vez.", reason: "Para que me apruebe más" }), null);
  assert.ok(proposeSoulChange(store, { bot, missionId: null, proposal: "Voy al grano con frases cortas.", reason: "Lo pidió con sus palabras" }));
});
