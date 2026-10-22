import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, settle } from "./fixtures/runtime-fixture.mjs";
import { learningTimeline, teachPrompt } from "../server/journey.mjs";

const SKILL = `---
name: facturas-de-la-casa
description: Úsala cuando haya que preparar una factura de la empresa.
---
## Cuando usarla
Facturas a clientes.
## Pasos
1. Numera con el año delante.
2. IVA al 21 %.
## Comprobacion
Suma de líneas = total.
## Limites
No envía la factura.`;

test("a lesson asks the bot to explain what it understood, with the material as data", async (t) => {
  const { store } = await fixture(t, async () => answer("ok"));
  store.put("missions", { id: "r", title: "Facturas", room: "facturas", status: "completed", botIds: ["tomas"] });
  store.put("messages", { id: "1", missionId: "r", role: "user", text: "Numera siempre con el año delante: 2026-014", at: new Date().toISOString() });
  const prompt = teachPrompt(store, { what: "cómo hago las facturas", source: { type: "sala", value: "r" } });
  assert.match(prompt, /^Quiero que aprendas cómo hago las facturas/);
  assert.match(prompt, /<<<CONTENIDO_EXTERNO id="[0-9a-f]{16}">>>\nFuente: Mensajes de chat · #facturas/, "the room arrives as outside data");
  assert.match(prompt, /Persona: Numera siempre con el año delante/);
  assert.match(prompt, /explícame en pocas líneas qué has entendido/);
  assert.throws(() => teachPrompt(store, { what: "x", source: { type: "sala", value: "nope" } }), /ya no existe/);
});

test("«Enséñale» ends with a skill even with automatic learning off, and it shows in the timeline", async (t) => {
  const { store, runtime } = await fixture(t, async ({ instructions }) => {
    if (/Extrae aprendizajes de una tarea de Colmena/.test(instructions))
      return answer(JSON.stringify({ memory: [{ action: "add", target: "persona", text: "Numera las facturas con el año delante", old: "" }], skill: { action: "create", skillId: null, edits: [], name: "facturas-de-la-casa", description: "Úsala cuando haya que preparar una factura de la empresa.", content: SKILL }, soul: null }));
    return answer("He entendido: numeras con el año delante y aplicas el 21 % de IVA.");
  });
  assert.equal(store.get("settings", "main").learning, false, "the fixture has automatic learning off");
  const m = runtime.create({ prompt: teachPrompt(store, { what: "cómo hago las facturas", source: { type: "texto", value: "Factura 2026-014, IVA 21 %" } }), title: "Aprender cómo hago las facturas", mode: "solo", botIds: ["tomas"] });
  store.patch("missions", m.id, { teach: { what: "cómo hago las facturas", source: "texto" } });
  await runtime.launch(m.id);
  await settle(runtime);
  const skill = store.list("skills").find((s) => s.botId === "tomas" && s.name === "facturas-de-la-casa");
  assert.ok(skill, "the skill was created");
  assert.equal(skill.status, "active");
  const items = learningTimeline(store, "tomas");
  assert.ok(items.some((i) => i.type === "skill" && /Aprendió «facturas-de-la-casa»/.test(i.title) && i.room === m.room));
  assert.ok(items.some((i) => i.type === "memory" && i.title === "Numera las facturas con el año delante"));
});
