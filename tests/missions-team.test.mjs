// Missions as a team: the greedy step scheduler (a part starts as soon as its own
// dependencies are done, a failed part fails alone), structured results between bots
// (outputSchema), Atlas' notes to a teammate at work (message_bot) and write-overlap notes.
import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, outputs, settle } from "./fixtures/runtime-fixture.mjs";
import { parseOutputSchema, validateOutput, extractJson, checkStructured } from "../server/structured.mjs";
import { inferScopes, normalizeScope, scopesOverlap, scopeOfCall, overlapping } from "../server/writescopes.mjs";

const who = (instructions) => /Eres (\S+),/.exec(instructions)?.[1];
const SCHEMA = JSON.stringify({ type: "object", properties: { tiendas: { type: "array", items: { type: "string" }, minItems: 1 } }, required: ["tiendas"], additionalProperties: false });
/** Atlas proposes `assignments` once; work steps run `work(name, request)`; the synthesis answers. */
const team = (assignments, work) => async (request) => {
  const { tools, input, instructions } = request;
  if (tools.some((x) => x.name === "propose_plan"))
    return outputs(input).length ? answer("Plan en marcha") : call("propose_plan", { assignments, summary: "Reparto de prueba" }, "plan-1");
  if (/Integra el trabajo del equipo/.test(JSON.stringify(input[0])) && who(instructions) === "Atlas") return answer("Síntesis final");
  return work(who(instructions), request);
};

test("greedy scheduler: a part starts as soon as its own dependency is done, not when the wave ends", async (t) => {
  const order = [];
  let veraStarted, noraMayFinish = new Promise((r) => { veraStarted = r; });
  const { store, runtime } = await fixture(t, team(
    [{ botId: "nora", task: "Tarea lenta" }, { botId: "tomas", task: "Tarea rápida" }, { botId: "vera", task: "Tarea tras Tomás", after: ["tomas"] }],
    async (name) => {
      order.push(name + ":start");
      if (name === "Vera") veraStarted();
      // Nora finishes only once Vera has started (a wave scheduler would wait forever here).
      if (name === "Nora") await Promise.race([noraMayFinish, new Promise((r) => setTimeout(r, 3000))]);
      order.push(name + ":end");
      return answer("Hecho por " + name);
    },
  ));
  const m = runtime.create({ prompt: "Estudio", mode: "equipo", botIds: ["nora", "tomas", "vera"] });
  await runtime.launch(m.id);
  await settle(runtime);
  assert.equal(store.get("missions", m.id).status, "completed");
  assert.ok(order.indexOf("Vera:start") < order.indexOf("Nora:end"), "Vera started while Nora was still working: " + order.join(", "));
});

test("a failed part fails alone: independent work finishes, its dependents wait, the mission ends partial", async (t) => {
  let noraFails = true;
  const ran = [];
  const { store, runtime } = await fixture(t, team(
    [{ botId: "nora", task: "Busca datos" }, { botId: "tomas", task: "Calcula" }, { botId: "vera", task: "Redacta con los datos", after: ["nora"] }],
    async (name) => {
      ran.push(name);
      if (name === "Nora" && noraFails) throw Error("La fuente no responde");
      return answer("Hecho por " + name);
    },
  ));
  const m = runtime.create({ prompt: "Informe", mode: "equipo", botIds: ["nora", "tomas", "vera"] });
  await runtime.launch(m.id);
  await settle(runtime);
  let mission = store.get("missions", m.id);
  const step = (key) => runtime.steps(m.id).find((s) => s.key === key);
  assert.equal(mission.status, "blocked");
  assert.match(mission.error, /Parte del trabajo ha fallado: Nora .*La fuente no responde/);
  assert.match(mission.error, /Lo demás está hecho \(Tomás\)/);
  assert.match(mission.error, /Continuar/);
  assert.deepEqual(mission.partial.failed.map((f) => f.botId), ["nora"]);
  assert.equal(step("work-nora").status, "failed");
  assert.match(step("work-nora").error, /La fuente no responde/);
  assert.equal(step("work-tomas").status, "completed");
  assert.equal(step("work-vera").status, "pending", "Vera needs Nora: she never started");
  assert.equal(runtime.history(step("work-vera")), null);
  assert.ok(!ran.includes("Vera"));
  const events = store.events(m.id).map((e) => e.type);
  assert.ok(events.includes("step_failed") && events.includes("partial"));
  assert.ok(!events.includes("error"));

  // «Continuar»: only what failed runs again; what was done stays.
  noraFails = false;
  ran.length = 0;
  await runtime.resume(m.id);
  await settle(runtime);
  mission = store.get("missions", m.id);
  assert.equal(mission.status, "completed");
  assert.equal(mission.partial, null);
  assert.deepEqual(ran.sort(), ["Nora", "Vera"]);
  assert.equal(mission.result, "Síntesis final");
});

test("a single failing step still fails the mission with its own error", async (t) => {
  const { store, runtime } = await fixture(t, async () => { throw Error("Algo se rompió"); });
  const m = runtime.create({ prompt: "Hola" });
  await runtime.launch(m.id);
  const mission = store.get("missions", m.id);
  assert.equal(mission.status, "blocked");
  assert.equal(mission.error, "Algo se rompió");
  assert.ok(store.events(m.id).some((e) => e.type === "error"));
  assert.equal(runtime.steps(m.id)[0].status, "failed");
});

test("an approval given while others work starts its step at once (the scheduler is woken)", async (t) => {
  let release;
  const slow = new Promise((r) => { release = r; });
  let approvedRan = false;
  const { store, runtime } = await fixture(t, team(
    [{ botId: "nora", task: "Escribe el archivo" }, { botId: "tomas", task: "Tarea larga" }],
    async (name, { input }) => {
      if (name === "Nora") {
        const out = outputs(input);
        if (!out.length) return call("write_file", { path: "nota.txt", content: "hola" }, "w1");
        approvedRan = true;
        return answer("Archivo listo");
      }
      await slow;
      return answer("Larga hecha");
    },
  ));
  store.patch("bots", "nora", { autonomy: "sugiere" });
  const m = runtime.create({ prompt: "Dos cosas", mode: "equipo", botIds: ["nora", "tomas"] });
  runtime.launch(m.id);
  let approval;
  for (let i = 0; i < 200 && !approval; i++) {
    await new Promise((r) => setTimeout(r, 10));
    approval = store.list("approvals").find((a) => a.tool === "write_file" && a.status === "pending");
  }
  assert.ok(approval, "Nora asks before writing");
  runtime.approve(approval.id, "approved");
  for (let i = 0; i < 200 && !approvedRan; i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(approvedRan, "Nora went on while Tomás still worked");
  release();
  await settle(runtime);
  assert.equal(store.get("missions", m.id).status, "completed");
});

test("outputSchema: the subset, validation and extracting the JSON of an answer", () => {
  assert.equal(parseOutputSchema("").schema, null);
  assert.match(parseOutputSchema("{nope").error, /no es JSON/);
  assert.match(parseOutputSchema(JSON.stringify({ type: "object", patternProperties: {} })).error, /patternProperties/);
  assert.match(parseOutputSchema(JSON.stringify({ type: "object", required: ["x"] })).error, /required/);
  const { schema } = parseOutputSchema(SCHEMA);
  assert.deepEqual(validateOutput(schema, { tiendas: ["A"] }), []);
  assert.match(validateOutput(schema, { tiendas: [] })[0], /al menos 1/);
  assert.match(validateOutput(schema, { tiendas: ["A"], extra: 1 })[0], /extra/);
  assert.match(validateOutput(schema, { lista: [] }).join(" "), /falta «tiendas»/);
  assert.match(validateOutput({ type: "integer" }, 2.5)[0], /integer/);
  assert.deepEqual(validateOutput({ oneOf: [{ type: "string" }, { type: "number" }] }, 3), []);
  assert.deepEqual(extractJson('Aquí va:\n```json\n{"a":1}\n```').value, { a: 1 });
  assert.equal(extractJson('Aquí va:\n```json\n{"a":1}\n```').prose, "Aquí va:");
  assert.deepEqual(extractJson('Resultado: {"a": [1, 2]} y ya').value, { a: [1, 2] });
  assert.equal(checkStructured(schema, "sin datos").ok, false);
});

test("ask_bot tasks with outputSchema: invalid JSON gets one repair, then the caller receives the data", async (t) => {
  let repairs = 0, atlasSaw = null;
  const { runtime } = await fixture(t, async ({ instructions, input }) => {
    if (/# Encargo delegado/.test(instructions)) {
      if (JSON.stringify(input).includes("no cumple el formato pedido")) { repairs++; return answer('{"tiendas":["Tienda A","Tienda B"]}'); }
      assert.match(JSON.stringify(input[0]), /JSON Schema/);
      return answer("Encontré la Tienda A y la Tienda B.");
    }
    const out = outputs(input);
    if (!out.length) return call("ask_bot", { botId: "", question: "", tasks: [{ botId: "tomas", task: "Lista las tiendas", context: "", outputSchema: SCHEMA }] }, "d1");
    atlasSaw = out[0];
    return answer("Listo.");
  });
  const m = runtime.create({ prompt: "Tiendas", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  assert.equal(repairs, 1);
  assert.deepEqual(atlasSaw.results[0].data, { tiendas: ["Tienda A", "Tienda B"] });
  assert.equal(atlasSaw.results[0].error, undefined);
});

test("ask_bot tasks: a helper that never matches the schema, or a bad schema, comes back as an error", async (t) => {
  let atlasSaw = null;
  const { runtime } = await fixture(t, async ({ instructions, input }) => {
    if (/# Encargo delegado/.test(instructions)) return answer("No sé hacer JSON.");
    const out = outputs(input);
    if (!out.length) return call("ask_bot", { botId: "", question: "", tasks: [
      { botId: "tomas", task: "Lista las tiendas", context: "", outputSchema: SCHEMA },
      { botId: "vera", task: "Otra lista", context: "", outputSchema: '{"type":"object","patternProperties":{}}' },
    ] }, "d1");
    atlasSaw = out[0];
    return answer("Listo.");
  });
  const m = runtime.create({ prompt: "Tiendas", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  assert.match(atlasSaw.results[0].error, /Tomás no devolvió los datos con el formato pedido/);
  assert.match(atlasSaw.results[1].error, /outputSchema no válido/);
});

test("plan parts with outputSchema deliver data: checked, repaired once, passed on to the synthesis", async (t) => {
  let synthesisInput = null, noraRounds = 0;
  const { store, runtime } = await fixture(t, async (request) => {
    const { input, instructions } = request;
    if (who(instructions) === "Atlas" && /Integra el trabajo del equipo/.test(JSON.stringify(input[0]))) { synthesisInput = String(input[0].content); return answer("Síntesis"); }
    return team([{ botId: "nora", title: "Listar tiendas", task: "Lista las tiendas", deliverable: "Lista de tiendas", outputSchema: SCHEMA }, { botId: "tomas", task: "Calcula" }], async (name) => {
      if (name !== "Nora") return answer("Cálculo hecho");
      noraRounds++;
      return noraRounds === 1 ? answer("Son la Tienda A y la B.") : answer('Aquí están:\n```json\n{"tiendas":["A","B"]}\n```');
    })(request);
  });
  const m = runtime.create({ prompt: "Tiendas", mode: "equipo", botIds: ["nora", "tomas"] });
  await runtime.launch(m.id);
  await settle(runtime);
  assert.equal(store.get("missions", m.id).status, "completed", store.get("missions", m.id).error);
  const nora = runtime.steps(m.id).find((s) => s.key === "work-nora");
  assert.deepEqual(nora.outputSchema.required, ["tiendas"]);
  assert.deepEqual(nora.data, { tiendas: ["A", "B"] });
  assert.equal(noraRounds, 2);
  assert.match(synthesisInput, /"data":\{"tiendas":\["A","B"\]\}/);
  const said = store.list("messages").find((x) => x.stepId === nora.id && x.kind === "message");
  assert.match(said.text, /^Aquí están:\n\n```json/);
});

test("a plan part that never matches its schema fails alone with a clear reason", async (t) => {
  const { store, runtime } = await fixture(t, team(
    [{ botId: "nora", task: "Lista las tiendas", deliverable: "Lista", outputSchema: SCHEMA }, { botId: "tomas", task: "Calcula" }],
    async (name) => answer(name === "Nora" ? "Solo texto, sin JSON." : "Cálculo hecho"),
  ));
  const m = runtime.create({ prompt: "Tiendas", mode: "equipo", botIds: ["nora", "tomas"] });
  await runtime.launch(m.id);
  await settle(runtime);
  const mission = store.get("missions", m.id);
  assert.equal(mission.status, "blocked");
  assert.match(mission.error, /Nora no entregó los datos con el formato pedido/);
  assert.equal(runtime.steps(m.id).find((s) => s.key === "work-tomas").status, "completed");
});

test("propose_plan refuses an invalid outputSchema so Atlas can fix it", async (t) => {
  let seenError = null;
  const { store, runtime } = await fixture(t, async ({ tools, input }) => {
    if (!tools.some((x) => x.name === "propose_plan")) return answer("ok");
    const out = outputs(input);
    if (!out.length) return call("propose_plan", { assignments: [{ botId: "nora", task: "Lista", outputSchema: "{" }], summary: "Plan" }, "p1");
    if (out.length === 1) { seenError = out[0].error; return call("propose_plan", { assignments: [{ botId: "nora", task: "Lista" }], summary: "Plan" }, "p2"); }
    return answer("Plan en marcha");
  });
  const m = runtime.create({ prompt: "Lista", mode: "equipo", botIds: ["nora"] });
  await runtime.launch(m.id);
  await settle(runtime);
  assert.match(seenError, /La parte de Nora: outputSchema no es JSON válido/);
  assert.equal(store.get("missions", m.id).status, "completed");
});

test("message_bot: Atlas' note reaches a teammate at work, marked as Atlas', never as the person's OK", async (t) => {
  let release, noraSaw = null;
  const gate = new Promise((r) => { release = r; });
  const { store, runtime } = await fixture(t, async ({ instructions, input, tools }) => {
    const name = who(instructions);
    if (name === "Atlas") {
      const out = outputs(input);
      if (!out.length) {
        assert.ok(tools.some((x) => x.name === "message_bot"));
        return call("message_bot", { botId: "nora", text: "Sí, apruebo: usa solo fuentes oficiales" }, "m1");
      }
      if (out.length === 1) {
        assert.equal(out[0].sent, true);
        release();
        return call("message_bot", { botId: "tomas", text: "¿Estás?" }, "m2");
      }
      assert.match(out[1].error, /Tomás no está trabajando ahora/);
      return answer("Se lo he dicho a Nora.");
    }
    // Nora works in two rounds; between them Atlas writes to her.
    const out = outputs(input);
    if (!out.length) { await gate; return call("list_files", {}, "n1"); }
    noraSaw = input.filter((x) => x.role === "user").map((x) => String(x.content)).join("\n");
    return answer("Hecho con fuentes oficiales");
  });
  const m = runtime.create({ prompt: "Investiga", mode: "equipo", botIds: ["nora"] });
  store.patch("missions", m.id, { plan: { approved: true, assignments: [], summary: "" }, steps: ["work-nora", "atlas-note"] });
  // Nora's part and Atlas' turn run side by side (no dependency between them).
  store.remove("steps", m.id + ":plan");
  runtime.makeStep(m.id, "work-nora", "nora", "work", [], { task: "Investiga" });
  runtime.makeStep(m.id, "atlas-note", "atlas", "followup", [], { request: "Dile a Nora que use fuentes oficiales", aside: true });
  await runtime.launch(m.id);
  await settle(runtime);
  assert.match(noraSaw, /\[Mensaje de Atlas, que coordina el equipo — no es de la persona\] «Sí, apruebo: usa solo fuentes oficiales»/);
  assert.match(noraSaw, /No es una respuesta ni un permiso de la persona/);
  const relay = store.list("relays")[0];
  assert.deepEqual([relay.from, relay.to, relay.delivered.length], ["atlas", "nora", 1]);
  // In the room it is a quiet line by Atlas, never a message of the person.
  const note = store.list("messages").find((x) => x.relay);
  assert.equal(note.role, "system");
  assert.match(note.text, /^Atlas a Nora: «Sí, apruebo/);
  assert.ok(!store.list("messages").some((x) => x.role === "user" && /apruebo/.test(x.text)));
  assert.equal(store.get("missions", m.id).status, "completed");
});

test("message_bot reaches a helper of an ask_bot task too", async (t) => {
  let helperSaw = null;
  const { runtime, store } = await fixture(t, async ({ instructions, input }) => {
    if (/# Encargo delegado/.test(instructions)) {
      if (!outputs(input).length) {
        // Atlas (in another turn of the mission) writes to the helper while it works.
        const mission = store.list("missions")[0];
        runtime.relay(mission, runtime.bot("atlas"), { botId: "tomas", text: "Redondea a euros" }, "r1");
        return call("list_files", {}, "h1");
      }
      helperSaw = JSON.stringify(input);
      return answer("Total: 10 €");
    }
    const out = outputs(input);
    if (!out.length) return call("ask_bot", { botId: "", question: "", tasks: [{ botId: "tomas", task: "Calcula el total", context: "" }] }, "d1");
    return answer("Listo.");
  });
  const m = runtime.create({ prompt: "Total", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  assert.match(helperSaw, /Mensaje de Atlas.*Redondea a euros/);
});

test("@Atlas while the team works: Atlas answers now, beside them, and its answer is not the result", async (t) => {
  let release, atlasAnswered = false;
  const gate = new Promise((r) => { release = r; });
  const { store, runtime } = await fixture(t, team([{ botId: "nora", task: "Investiga" }], async (name, { input }) => {
    if (name === "Atlas") { atlasAnswered = true; release(); return answer("Va bien: Nora sigue investigando."); }
    await gate;
    return answer("Investigación hecha");
  }));
  const m = runtime.create({ prompt: "Estudio", mode: "equipo", botIds: ["nora", "tomas"] });
  runtime.launch(m.id);
  for (let i = 0; i < 200 && runtime.steps(m.id).find((s) => s.key === "work-nora")?.status !== "running"; i++) await new Promise((r) => setTimeout(r, 10));
  runtime.addMessage(m.id, "@Atlas ¿cómo va?");
  for (let i = 0; i < 300 && !atlasAnswered; i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(atlasAnswered, "Atlas answered while Nora still worked");
  await settle(runtime);
  const mission = store.get("missions", m.id);
  assert.equal(mission.status, "completed");
  assert.equal(mission.result, "Investigación hecha");
});

test("write scopes: normalized prefixes, overlap on whole components, inferred from tasks and calls", () => {
  assert.equal(normalizeScope("./Proyectos\\Tienda/"), "proyectos/tienda");
  assert.equal(normalizeScope("../fuera"), "");
  assert.ok(scopesOverlap("proyectos/tienda", "proyectos/tienda/src/app.jsx"));
  assert.ok(!scopesOverlap("proyectos/tienda", "proyectos/tienda2"));
  assert.deepEqual(inferScopes("Escribe «informe.md» y edita proyectos/tienda/src/App.jsx; y/o 24/7"), ["informe.md", "proyectos/tienda/src/app.jsx"]);
  assert.equal(scopeOfCall("project_write", { project: "Mi Tienda", path: "src/a.js" }), "proyectos/mi-tienda/src/a.js");
  assert.equal(scopeOfCall("read_file", { path: "x.md" }), "");
  assert.deepEqual(overlapping(["proyectos/tienda"], ["proyectos/tienda/src/a.js", "otro.md"]), ["proyectos/tienda/src/a.js"]);
});

test("two parts at once that write the same folder: the later one gets an advisory note", async (t) => {
  const seen = {};
  const { store, runtime } = await fixture(t, team(
    [
      { botId: "nora", task: "Crea la web", writes: ["proyectos/tienda/"] },
      { botId: "vera", task: "Escribe los textos en proyectos/tienda/textos.md" },
      { botId: "tomas", task: "Calcula los precios", writes: ["precios.csv"] },
    ],
    async (name, { input }) => {
      seen[name] = input.filter((x) => x.role === "user").map((x) => String(x.content)).join("\n");
      await new Promise((r) => setTimeout(r, 20));
      return answer("Hecho por " + name);
    },
  ));
  const m = runtime.create({ prompt: "Tienda", mode: "equipo", botIds: ["nora", "vera", "tomas"] });
  await runtime.launch(m.id);
  await settle(runtime);
  assert.equal(store.get("missions", m.id).status, "completed");
  assert.match(seen.Vera, /\[Colmena\] Aviso: Nora trabaja a la vez que tú y también puede escribir en «proyectos\/tienda\/textos\.md»/);
  assert.ok(!/Aviso:/.test(seen.Nora), "the first one is not warned");
  assert.ok(!/Aviso:/.test(seen.Tomás), "no overlap, no note");
  const vera = runtime.steps(m.id).find((s) => s.key === "work-vera");
  assert.deepEqual(vera.overlap.with, [m.id + ":work-nora"]);
  assert.ok(store.events(m.id).some((e) => e.type === "write_overlap"));
});

test("writing the same file at run time also notes the overlap (once per pair)", async (t) => {
  const seen = [];
  // Nora writes first and is still at work when Vera writes the same file.
  let noraWrote, veraWrote;
  const afterNora = new Promise((r) => { noraWrote = r; }), afterVera = new Promise((r) => { veraWrote = r; });
  const { runtime, store } = await fixture(t, team(
    [{ botId: "nora", task: "Primera parte" }, { botId: "vera", task: "Segunda parte" }],
    async (name, { input }) => {
      const out = outputs(input);
      if (name === "Nora") {
        if (!out.length) return call("write_file", { path: "comun.md", content: "Nora" }, "n1");
        noraWrote();
        await afterVera;
        return answer("Nora hecho");
      }
      if (!out.length) { await afterNora; return call("write_file", { path: "comun.md", content: "Vera" }, "v1"); }
      seen.push(input.filter((x) => x.role === "user").map((x) => String(x.content)).join("\n"));
      veraWrote();
      return answer("Vera hecho");
    },
  ));
  const m = runtime.create({ prompt: "Dos partes", mode: "equipo", botIds: ["nora", "vera"] });
  await runtime.launch(m.id);
  await settle(runtime);
  assert.equal(store.get("missions", m.id).status, "completed");
  const notes = seen.join("\n").match(/Aviso: Nora trabaja a la vez que tú y también puede escribir en «comun\.md»/g) || [];
  assert.equal(notes.length, 1, "noted once");
  assert.deepEqual(runtime.steps(m.id).find((s) => s.key === "work-vera").wrote, ["comun.md"]);
});
