import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, outputs } from "./fixtures/runtime-fixture.mjs";
import { importSkill, activateSkill } from "../server/skills.mjs";
import { checkSkill, checkSoul, unknownTools } from "../server/skill-checks.mjs";
import { proposeSoulChange } from "../server/learning.mjs";

const skill = ({ name = "informe-ventas", description = "Úsala cuando haya que preparar el informe de ventas", body = "## Pasos\n1. Lee los datos con `read_file`.\n2. Guarda el informe con `create_deliverable`.\n" } = {}) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;
const EMPTY = { memory: [], skill: { action: "none", skillId: null, edits: [], name: "", description: "", content: "" }, soul: null };

/** Five tool calls (a complex mission), then the review answers `reflect`. */
async function setup(t, reflect, { autonomy = null, prompt = "Prepara el informe de ventas" } = {}) {
  const env = await fixture(t, async (request) => {
    if (request.instructions.startsWith("Extrae")) return answer(JSON.stringify(reflect));
    const done = outputs(request.input).length;
    return done < 5 ? call("list_files", {}, "c" + done) : answer("Terminado");
  });
  env.store.patch("settings", "main", { learning: true });
  if (autonomy) env.store.patch("bots", "nora", { autonomy });
  const run = async () => {
    const m = env.runtime.create({ prompt, mode: "solo", botIds: ["nora"] });
    await env.runtime.launch(m.id);
    return env.store.get("missions", m.id);
  };
  return { ...env, run };
}

test("checkSkill lists every problem: format, «Úsala cuando…», tools, size, secrets", async (t) => {
  const { store } = await fixture(t, async () => answer("ok"));
  assert.deepEqual(checkSkill(store, skill()).problems, []);
  assert.match(checkSkill(store, "# Informe\n\n1. Haz el informe.\n2. Guárdalo.").problems.join(" "), /Falta la cabecera YAML/);
  assert.match(checkSkill(store, skill({ description: "Prepara el informe" })).problems.join(" "), /empezar por «Úsala cuando…»/);
  assert.match(checkSkill(store, skill({ body: "1. Envíalo con `send_whatsapp_now`.\n2. Lee con `gmail_fetch_emails`.\n" })).problems.join(" "), /herramientas que no existen: send_whatsapp_now\./);
  assert.deepEqual(unknownTools("Usa `read_skill`, `apps_execute`, googlecalendar_events_list() y `metadata.colmena.bot`."), []);
  assert.match(checkSkill(store, skill({ body: "1. Paso.\n" + "x".repeat(8100) })).problems.join(" "), /como mucho 8000/);
  assert.match(checkSkill(store, skill({ body: "1. Entra con la clave: hunter2\n" })).problems.join(" "), /datos sensibles/);
  assert.match(checkSkill(store, skill({ body: "No hay pasos." })).problems.join(" "), /No tiene pasos numerados/);
  // A skill that says the same as another one is a duplicate (never its own versions).
  const existing = activateSkill(store, importSkill(store, { content: skill(), botId: "nora" }).id, "active");
  const twin = checkSkill(store, skill({ name: "preparar-informe-ventas" }), { botId: "nora" });
  assert.equal(twin.duplicateOf.id, existing.id);
  assert.equal(twin.ok, false);
  assert.equal(checkSkill(store, skill({ body: "## Pasos\n1. Otro paso.\n" }), { botId: "nora", lineage: [existing.id] }).duplicateOf, null);
  assert.deepEqual(checkSoul("# SOUL\nSoy Nora, cercana y directa."), []);
  assert.match(checkSoul("# SOUL\nSoy Nora. Mi contraseña: hunter2").join(" "), /datos sensibles/);
});

test("a learned skill that fails the checks is not activated; the review says why", async (t) => {
  const { store, run } = await setup(t, { ...EMPTY, skill: { action: "create", skillId: null, edits: [], name: "informe-ventas", description: "Prepara el informe", content: skill({ description: "Prepara el informe" }) } });
  const m = await run();
  assert.equal(store.list("skills").filter((s) => s.origin === "learned").length, 0);
  assert.match(m.learning.notes.join(" "), /Habilidad descartada: .*Úsala cuando/);
});

test("a skill that repeats another becomes a merge proposal; approving it makes it the next version", async (t) => {
  const { store, runtime, run } = await setup(t, { ...EMPTY, skill: { action: "create", skillId: null, edits: [], name: "preparar-informe-ventas", description: "Úsala cuando haya que preparar el informe de ventas", content: skill({ name: "preparar-informe-ventas", body: "## Pasos\n1. Lee los datos con `read_file`.\n2. Comprueba los totales.\n3. Guarda el informe con `create_deliverable`.\n" }) } });
  const existing = activateSkill(store, importSkill(store, { content: skill(), botId: "nora" }).id, "active");
  const m = await run();
  const merged = store.list("skills").find((s) => s.previous === existing.id);
  assert.equal(merged.status, "pending", "nothing is activated: it waits for you");
  assert.equal(merged.name, "informe-ventas");
  const approval = store.get("approvals", "skill:" + merged.id);
  assert.equal(approval.title, "¿Fusionar «preparar-informe-ventas» con «informe-ventas»?");
  assert.match(m.learning.notes.join(" "), /propuesta para fusionarlas/);
  runtime.approve(approval.id, "approved");
  assert.equal(store.get("skills", merged.id).status, "active");
  assert.equal(store.get("skills", existing.id).status, "disabled");
});

test("a bot set to «Solo sugiere» proposes what it learned instead of using it", async (t) => {
  const { store, run } = await setup(t, { ...EMPTY, skill: { action: "create", skillId: null, edits: [], name: "informe-ventas", description: "Úsala cuando haya que preparar el informe de ventas", content: skill() } }, { autonomy: "sugiere" });
  await run();
  const learned = store.list("skills").find((s) => s.origin === "learned");
  assert.equal(learned.status, "pending");
  assert.equal(store.get("approvals", "skill:" + learned.id).status, "pending");
  assert.equal(store.list("messages").filter((x) => x.kind === "learned").length, 0, "no «Aprendido» notice: nothing changed yet");
});

test("a SOUL proposal with secrets never reaches the person", async (t) => {
  const { store } = await fixture(t, async () => answer("ok"));
  assert.equal(proposeSoulChange(store, { bot: store.get("bots", "nora"), missionId: null, proposal: "Mi clave: hunter2 para entrar en todo.", reason: "x" }), null);
  assert.ok(proposeSoulChange(store, { bot: store.get("bots", "nora"), missionId: null, proposal: "Prefiero ir al grano con frases cortas.", reason: "x" }));
});
