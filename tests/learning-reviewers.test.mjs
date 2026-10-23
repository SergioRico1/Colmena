import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, outputs } from "./fixtures/runtime-fixture.mjs";
import { importSkill, activateSkill } from "../server/skills.mjs";
import { combineReflections, REVIEWERS } from "../server/learning.mjs";

const SKILL = "---\nname: informe-ventas\ndescription: Úsala cuando haya que preparar el informe de ventas\n---\n## Pasos\n1. Lee los datos.\n2. Redacta.\n## Comprobacion\nCifras cuadran.\n";
const NONE = { action: "none", skillId: null, edits: [], name: "", description: "", content: "", por: [] };
const base = (over = {}) => ({ decision: "cambiar", motivo: "", memory: [], memories: [], skill: NONE, soul: null, ...over });

/** The work reviewer answers `work(payload)`, the subject reviewer `subject(payload)`. */
async function setup(t, { work, subject }) {
  const calls = [];
  let skillId = null;
  const env = await fixture(t, async (request) => {
    if (request.instructions.startsWith("Extrae")) {
      const payload = JSON.parse(request.input[0].content);
      calls.push({ model: request.model, revisor: payload.revisor, instructions: request.instructions });
      const reply = (payload.revisor === "trabajo" ? work : subject)(payload, skillId);
      if (reply instanceof Error) throw reply;
      return answer(JSON.stringify(reply));
    }
    const done = outputs(request.input).length;
    if (done === 0 && skillId) return call("read_skill", { id: skillId }, "rs");
    return done < 5 ? call("list_files", {}, "c" + done) : answer("Informe listo");
  });
  env.store.patch("settings", "main", { learning: true });
  env.runtime.provider.session = { models: [{ slug: "fixture-mini", utility: true }] };
  skillId = activateSkill(env.store, importSkill(env.store, { content: SKILL, botId: "nora" }).id, "active").id;
  const run = async () => {
    const m = env.runtime.create({ prompt: "Prepara el informe de ventas: una página y en euros", mode: "solo", botIds: ["nora"] });
    await env.runtime.launch(m.id);
    return env.store.get("missions", m.id);
  };
  return { ...env, calls, run, skillId: () => skillId };
}

test("two reviewers on the cheap model: one on how the bot works, one on the subject; their answers combine", async (t) => {
  const { store, calls, run, skillId } = await setup(t, {
    work: (p, id) => base({
      memory: [{ action: "add", target: "bot", text: "Las ventas se leen de la hoja de pedidos antes de redactar", old: "", tipo: "procedimiento", por: ["m1"] }],
      skill: { ...NONE, action: "patch", skillId: id, edits: [{ old: "1. Lee los datos.", new: "1. Lee los datos con list_files y comprueba que están todos." }], por: ["r1"] },
      soul: { proposal: "Soy más metódica.", reason: "Lo pidió", por: ["m1"] },
    }),
    subject: (p, id) => base({
      memory: [{ action: "add", target: "persona", text: "Prefiere el informe de ventas en una página y en euros", old: "", tipo: "hecho", por: ["m1"] }],
      skill: { ...NONE, action: "patch", skillId: id, edits: [{ old: "Cifras cuadran.", new: "Cifras cuadran y van en euros; el informe cabe en una página." }], por: ["m1"] },
    }),
  });
  const m = await run();
  const reviews = calls.filter((c) => c.revisor);
  assert.deepEqual(reviews.map((c) => c.revisor).sort(), ["tema", "trabajo"]);
  assert.ok(reviews.every((c) => c.model === "fixture-mini"), "the cheap model");
  assert.match(reviews.find((c) => c.revisor === "trabajo").instructions, /TU PARTE: COMO TRABAJA/);
  assert.match(reviews.find((c) => c.revisor === "tema").instructions, /LO QUE SABE UN PROFESIONAL DEL TEMA/);
  // Both patches to the same skill become one new version with both edits.
  const v2 = store.list("skills").filter((s) => s.previous === skillId());
  assert.equal(v2.length, 1);
  assert.match(v2[0].content, /comprueba que están todos/);
  assert.match(v2[0].content, /van en euros; el informe cabe en una página/);
  // Memories of both, each with its kind; the SOUL only from the subject reviewer (none here).
  const learned = store.list("memories").filter((x) => x.missionId === m.id);
  assert.deepEqual(learned.map((x) => x.nature).sort(), ["hecho", "procedimiento"]);
  assert.equal(store.list("approvals").filter((a) => a.kind === "soul").length, 0);
});

test("if one reviewer fails, the other one's answer is used; if both keep, nothing changes", async (t) => {
  const { store, run } = await setup(t, {
    work: () => Error("provider down"),
    subject: () => base({ memory: [{ action: "add", target: "persona", text: "Prefiere el informe de ventas en euros", old: "", por: ["m1"] }] }),
  });
  const m = await run();
  assert.equal(m.learningStatus, "completed");
  assert.equal(store.list("memories").filter((x) => x.missionId === m.id).length, 1);
});

test("combineReflections: keep only when every answer keeps; memories without repeats; at most two skill actions", () => {
  const keep = { ...base(), decision: "mantener", motivo: "Nada nuevo." };
  assert.equal(combineReflections([keep, keep]).decision, "mantener");
  assert.equal(combineReflections([keep, null]).motivo, "Nada nuevo.");
  const mem = { action: "add", target: "persona", text: "Prefiere euros", old: "", por: [], tipo: "hecho" };
  const both = combineReflections([
    base({ memory: [mem], skill: { ...NONE, action: "create", name: "a", content: "x", por: ["m1"] } }),
    base({ memory: [{ ...mem, text: "prefiere EUROS" }], skill: { ...NONE, action: "create", name: "b", content: "y", por: ["m2"] }, soul: { proposal: "Soy directa.", reason: "r", por: ["m1"] } }),
  ]);
  assert.equal(both.decision, "cambiar");
  assert.equal(both.memory.length, 1);
  assert.deepEqual(both.skills.map((s) => s.name), ["a", "b"]);
  assert.equal(both.soul.proposal, "Soy directa.", "the SOUL comes from the subject reviewer");
  assert.deepEqual(Object.keys(REVIEWERS), ["trabajo", "tema"]);
});
