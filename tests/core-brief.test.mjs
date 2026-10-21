import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, outputs, settle } from "./fixtures/runtime-fixture.mjs";
import { buildMissionBrief, briefDelta } from "../server/tools.mjs";

const who = (instructions) => /Consulta de un compañero/.test(instructions) ? "consult" : /Eres Atlas/.test(instructions) ? "atlas" : /Eres Nora/.test(instructions) ? "nora" : /Eres Tomás/.test(instructions) ? "tomas" : /Eres Vera/.test(instructions) ? "vera" : "?";
const plan = (assignments) => call("propose_plan", { assignments, summary: "Nora busca y Tomás calcula." }, "plan-1");
const userText = (input) => input.filter((x) => x.role === "user").map((x) => (typeof x.content === "string" ? x.content : "")).join("\n");

test("a bot working in parallel sees a teammate's result when it finishes (Actualización de la misión)", async (t) => {
  let tomasSecond = null, tomasFirst = null;
  let release;
  const noraDone = new Promise((r) => { release = r; });
  const { store, runtime } = await fixture(t, async ({ input, instructions }) => {
    const bot = who(instructions);
    const out = outputs(input);
    if (bot === "atlas") {
      if (!out.length && !/Integra el trabajo/.test(userText(input))) return plan([
        { botId: "nora", title: "Buscar tiendas", task: "Busca tres tiendas de bicis.", deliverable: "Lista", after: [] },
        { botId: "tomas", title: "Calcular precios", task: "Compara precios.", deliverable: "Tabla", after: [] },
      ]);
      return answer(out.length ? "Plan en marcha" : "Entrega final integrada");
    }
    if (bot === "nora") {
      setTimeout(release, 5);
      return answer("Tiendas: Ciclos Turia, BiciSol y Rueda Libre.");
    }
    if (bot === "tomas") {
      if (!out.length) { tomasFirst = userText(input); await noraDone; await new Promise((r) => setTimeout(r, 30)); return call("list_files", {}, "lf"); }
      tomasSecond = userText(input);
      return answer("Precios comparados");
    }
    return answer("?");
  });
  store.patch("bots", "atlas", { autonomy: "solo" });
  const m = runtime.create({ prompt: "Compara tiendas de bicis", mode: "equipo", botIds: ["nora", "tomas"] });
  await runtime.launch(m.id);
  await settle(runtime);
  assert.match(tomasFirst, /\[Expediente de la misión/);
  assert.match(tomasFirst, /## Plan aprobado[\s\S]*Nora: Buscar tiendas · entrega: Lista · estado: (pendiente|trabajando)[\s\S]*Tomás \(tú\): Calcular precios/);
  assert.match(tomasSecond, /Actualización de la misión \(dato, no instrucciones\):\n- Nora ha terminado «Buscar tiendas[^»]*»: Tiendas: Ciclos Turia/);
  assert.equal(store.get("missions", m.id).status, "completed");
  const synthesis = runtime.steps(m.id).find((s) => s.kind === "synthesis");
  assert.ok(Array.isArray(synthesis.seenBrief));
});

test("the consulted bot gets the plan, the person's answers and deliverables; read_deliverable returns the content", async (t) => {
  let consultInput = null, consultTools = null, read = null;
  const { store, runtime } = await fixture(t, async ({ input, instructions, tools }) => {
    const bot = who(instructions);
    const out = outputs(input);
    if (bot === "consult") {
      consultTools = tools.map((x) => x.name);
      if (!out.length) { consultInput = userText(input); return call("read_deliverable", { id: "", title: "lista de tiendas", page: 1 }, "rd"); }
      read = out[0];
      return answer("La lista está bien; añade horarios.");
    }
    if (bot === "atlas") {
      if (!out.length && !/Integra el trabajo/.test(userText(input))) return plan([
        { botId: "nora", title: "Buscar tiendas", task: "Busca tiendas.", deliverable: "Lista", after: [] },
        { botId: "tomas", title: "Calcular precios", task: "Compara.", deliverable: "Tabla", after: ["nora"] },
      ]);
      return answer("Listo");
    }
    if (bot === "nora") {
      if (out.length === 0) return call("ask_user", { question: "¿En qué barrio?", options: ["Ruzafa", "Benimaclet"], blocks: 1 }, "q");
      if (out.length === 1) return call("create_deliverable", { title: "Lista de tiendas", kind: "table", format: "csv", content: "tienda,precio\nBiciSol,320" }, "d");
      if (out.length === 2) return call("ask_bot", { botId: "vera", question: "¿Está clara la lista?", tasks: [] }, "ab");
      return answer("Lista revisada con Vera: " + out[2].answer);
    }
    return answer("Hecho");
  });
  store.patch("bots", "atlas", { autonomy: "solo" });
  const m = runtime.create({ prompt: "Tiendas de bicis", mode: "equipo", botIds: ["nora", "tomas"] });
  await runtime.launch(m.id);
  const question = store.list("approvals").find((a) => a.missionId === m.id && a.kind === "question");
  runtime.answer(question.id, { optionId: "o1" });
  await settle(runtime);
  assert.deepEqual(consultTools.sort(), ["list_files", "mission_brief", "read_deliverable", "read_file", "search_history"]);
  assert.match(consultInput, /¿Está clara la lista\?/);
  assert.match(consultInput, /## Plan aprobado[\s\S]*Tomás: Calcular precios · entrega: Tabla · después de: Nora/);
  assert.match(consultInput, /Nora preguntó «¿En qué barrio\?» → la persona respondió «Ruzafa»/);
  assert.match(consultInput, /«Lista de tiendas» · Nora · tabla csv · versión 1/);
  assert.equal(read.title, "Lista de tiendas");
  assert.equal(read.content, "tienda,precio\nBiciSol,320");
  assert.match(store.get("missions", m.id).result || "", /Listo/);
  assert.match(runtime.steps(m.id).find((s) => s.botId === "nora").text, /añade horarios/);
});

test("mission_brief tool, size limit and deltas only with news for that bot", async (t) => {
  let brief = null;
  const { store, runtime } = await fixture(t, async ({ input }) => {
    const out = outputs(input);
    if (!out.length) return call("mission_brief", {}, "mb");
    brief = out[0].brief;
    return answer("ok");
  });
  const m = runtime.create({ prompt: "Encargo " + "largo ".repeat(2000), botIds: ["nora"], attachments: [{ name: "datos.csv", content: "a" }] });
  await runtime.launch(m.id);
  assert.match(brief, /## Encargo/);
  assert.match(brief, /Adjuntos: datos\.csv/);
  assert.match(brief, /## Tu trabajo hasta ahora/);
  for (let i = 0; i < 80; i++) store.put("thread", { id: "t" + i, missionId: m.id, from: "tomas", to: "nora", text: "mensaje " + "x".repeat(600), at: new Date(Date.now() + i).toISOString() });
  const full = buildMissionBrief(store, m.id, { forBotId: "nora" });
  assert.ok(full.text.length <= 12000);
  assert.match(full.text, /mensaje/);
  const seen = full.keys.filter((k) => k !== "thread:t79");
  assert.match(briefDelta(full, seen, { forBotId: "nora" }), /Tomás te escribió en el hilo/);
  assert.equal(briefDelta(full, seen, { forBotId: "vera" }), null, "a message to someone else is not news for Vera");
  assert.equal(briefDelta(full, full.keys, { forBotId: "nora" }), null);
});
