import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, outputs, settle } from "./fixtures/runtime-fixture.mjs";
import { trimHistory, compactHistory, TRIMMED, STUCK_ROUNDS, appsLabel } from "../server/runtime.mjs";
import { searchHistory } from "../server/tools.mjs";

const page = (text) => async (url) => ({ url, finalUrl: url, title: "Página", text, truncated: false, untrusted: true });
const isMain = (r) => !/^(Extrae|Resume el trabajo|Condensa)/.test(r.instructions) && !/# Encargo delegado/.test(r.instructions);

test("trimHistory and compactHistory keep call ids, the first message and the person's messages", () => {
  const big = JSON.stringify({ text: "x".repeat(3000) });
  const history = [{ role: "user", content: "Encargo" }];
  for (let i = 0; i < 6; i++) history.push({ type: "function_call", name: "web_fetch", call_id: "c" + i, arguments: "{}" }, { type: "function_call_output", call_id: "c" + i, output: big });
  history.push({ role: "user", content: "Nota de la persona: céntrate en Madrid" });
  assert.equal(trimHistory(history), history, "a short history is never rewritten (prompt cache)");
  const trimmed = trimHistory(history, { minSize: 0 });
  assert.notEqual(trimmed, history);
  const outs = trimmed.filter((x) => x.type === "function_call_output");
  assert.deepEqual(outs.map((o) => o.call_id), ["c0", "c1", "c2", "c3", "c4", "c5"]);
  assert.deepEqual(outs.map((o) => o.output === JSON.stringify(TRIMMED)), [true, true, false, false, false, false]);
  assert.equal(trimHistory(trimmed, { minSize: 0 }), trimmed, "idempotent");
  const compact = compactHistory([...history.slice(0, 5), { role: "user", content: "Prefiero euros" }, ...history.slice(5)], "## Objetivo\nX");
  assert.equal(compact[0].content, "Encargo");
  assert.ok(compact.some((x) => x.content === "Prefiero euros"));
  assert.ok(compact.some((x) => /^\[Resumen del trabajo/.test(x.content || "") && /## Objetivo/.test(x.content)));
  const ids = new Set(compact.filter((x) => x.type === "function_call").map((x) => x.call_id));
  assert.ok(compact.filter((x) => x.type === "function_call_output").every((x) => ids.has(x.call_id)), "no orphan outputs");
});

test("old tool outputs are trimmed before each call; a huge history is summarized and the step goes on", async (t) => {
  const mains = [], summaries = [];
  const { store, runtime } = await fixture(t, async (request) => {
    if (request.instructions.startsWith("Resume el trabajo")) {
      summaries.push(JSON.parse(request.input[0].content));
      return answer("## Objetivo\nComparar precios\n## Preferencias de la persona\n-\n## Hecho\nLeídas 4 páginas\n## En curso\n-\n## Bloqueado\n-\n## Decisiones\n-\n## Siguiente paso\nResumir");
    }
    mains.push(request.input);
    const n = outputs(request.input.filter((x) => x.type === "function_call_output" && !String(x.output).includes("recortado"))).length;
    const calls = request.input.filter((x) => x.type === "function_call").length;
    void n;
    const summarized = request.input.some((x) => /^\[Resumen/.test(x.content || ""));
    // One big page (trimmed later), then many short results that trimming cannot free:
    // only the summary makes room.
    if (calls === 0) return call("web_fetch", { url: "https://example.com/grande" }, "w0");
    if (!summarized && mains.length < 40)
      return { text: "", output: Array.from({ length: 20 }, (_, k) => ({ type: "function_call", name: "web_fetch", arguments: JSON.stringify({ url: "https://example.com/" + mains.length + "-" + k }), call_id: "w" + mains.length + "-" + k })) };
    if (mains.length > 45 || summarized) return answer("Precios comparados");
    return call("list_files", {}, "l" + mains.length);
  }, { web: async (url) => ({ url, finalUrl: url, title: "Página", text: url.endsWith("grande") ? "precio ".repeat(16000) : "precio ".repeat(100), truncated: false, untrusted: true }) });
  const m = runtime.create({ prompt: "Compara precios en cuatro webs" });
  await runtime.launch(m.id);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].encargo.startsWith("Compara precios"), true);
  const step = runtime.steps(m.id)[0];
  assert.equal(step.compacted, true);
  const after = mains.find((input) => input.some((x) => /^\[Resumen/.test(x.content || "")));
  assert.equal(after[0].content.startsWith("Compara precios"), true, "first message literal");
  assert.ok(JSON.stringify(after).length < 350000, "after summary: " + JSON.stringify(after).length);
  assert.ok(mains.some((input) => input.some((x) => x.type === "function_call_output" && x.call_id === "w0" && x.output === JSON.stringify(TRIMMED))), "the big page was trimmed, call_id kept");
  assert.equal(store.get("missions", m.id).status, "completed");
  assert.equal(store.get("missions", m.id).result, "Precios comparados");
  assert.ok(store.events(m.id).some((e) => e.type === "context_compacted"));
});

test("three identical failing calls stop the bot with a clear message; a message resumes it", async (t) => {
  let calls = 0;
  const { store, runtime } = await fixture(t, async ({ input }) => {
    if (input.some((x) => /La persona/.test(x.content || ""))) return answer("Vale, lo hago de otra forma");
    calls++;
    return call("read_file", { path: "no-existe.txt" }, "r" + calls);
  });
  const m = runtime.create({ prompt: "Lee el archivo" });
  await runtime.launch(m.id);
  assert.equal(calls, 3);
  assert.equal(store.get("missions", m.id).status, "waiting");
  const stop = store.list("messages").find((x) => x.missionId === m.id && x.stall === "loop");
  assert.match(stop.text, /Me he atascado: he intentado 3 veces lo mismo con «read_file»/);
  runtime.addMessage(m.id, "continúa");
  await settle(runtime);
  assert.equal(store.get("missions", m.id).status, "completed");
  assert.equal(store.get("missions", m.id).result, "Vale, lo hago de otra forma");
  assert.equal(runtime.steps(m.id).length, 1, "the same step resumes; no follow-up step");
});

test("no round limit: a long task keeps going until the bot finishes", async (t) => {
  let n = 0;
  const { store, runtime } = await fixture(t, async () => (n < 120 ? call("list_files", {}, "l" + n++) : answer("Hecho tras 120 pasos")));
  const m = runtime.create({ prompt: "Largo" });
  await runtime.launch(m.id);
  assert.equal(n, 120);
  const mission = store.get("missions", m.id);
  assert.equal(mission.status, "completed");
  assert.equal(mission.result, "Hecho tras 120 pasos");
  assert.ok(!store.list("messages").some((x) => x.missionId === m.id && x.stall));
});

test("when everything it tries fails for several rounds the bot stops; «continúa» resumes", async (t) => {
  let n = 0;
  const { store, runtime } = await fixture(t, async ({ input }) =>
    input.some((x) => /continúa/.test(x.content || "")) ? answer("Terminado tras continuar") : call("read_file", { path: "no-existe-" + n + ".txt" }, "r" + n++));
  const m = runtime.create({ prompt: "Lee archivos" });
  await runtime.launch(m.id);
  assert.equal(n, STUCK_ROUNDS);
  assert.equal(store.get("missions", m.id).status, "waiting");
  const stop = store.list("messages").find((x) => x.missionId === m.id && x.stall === "loop");
  assert.match(stop.text, /Me he atascado: llevo 5 intentos seguidos/);
  runtime.addMessage(m.id, "continúa");
  await settle(runtime);
  assert.equal(store.get("missions", m.id).result, "Terminado tras continuar");
  assert.equal(runtime.steps(m.id)[0].resumes, 1);
});

test("capabilities filter the offered tools; the extraTools hook adds computer tools only with 'ordenador'", async (t) => {
  const offered = [];
  let ran = null;
  const { store, runtime } = await fixture(t, async ({ tools, input }) => {
    offered.push(tools);
    const out = outputs(input);
    if (!out.length) return call("web_fetch", { url: "https://example.com" });
    if (out.length === 1 && tools.some((x) => x.name === "computer_screenshot")) return call("computer_screenshot", { region: "all" }, "cs");
    return answer("fin " + (out[0].error || "") + " " + (out[1]?.shot || ""));
  });
  runtime.extraTools = (bot, mission) => [{
    name: "computer_screenshot", description: "Captura la pantalla", strict: false,
    parameters: { type: "object", properties: { region: { type: "string" } } },
    run: async (args, ctx) => { ran = { args, bot: ctx.bot.id, mission: ctx.mission.id }; return { shot: "ok-" + args.region }; },
  }];
  store.patch("bots", "nora", { capabilities: { web: false, carpetas: false, apps: true, ordenador: false } });
  const a = runtime.create({ prompt: "Mira la web" });
  await runtime.launch(a.id);
  const names = offered[0].map((x) => x.name);
  assert.ok(!names.includes("web_fetch") && !names.includes("list_folder") && !names.includes("read_folder_file"));
  assert.ok(!names.includes("computer_screenshot"));
  assert.match(store.get("missions", a.id).result, /Herramienta no disponible/);

  offered.length = 0;
  store.patch("bots", "nora", { capabilities: { web: true, ordenador: true } });
  const b = runtime.create({ prompt: "Haz una captura" });
  await runtime.launch(b.id);
  const tool = offered[0].find((x) => x.name === "computer_screenshot");
  assert.ok(tool && tool.type === "function" && !("run" in tool), "definition without the runner");
  assert.deepEqual(ran, { args: { region: "all" }, bot: "nora", mission: b.id });
  assert.match(store.get("missions", b.id).result, /ok-all/);
  // Plan steps never get extra tools.
  assert.deepEqual(runtime.toolsForStep(store.get("missions", b.id), { kind: "plan" }, store.get("bots", "nora")).filter((x) => x.name === "computer_screenshot"), []);
  const step = runtime.steps(b.id)[0];
  const entry = step.activity.find((e) => e.callId === "cs");
  assert.equal(entry.tool, "computer_screenshot");
  assert.equal(entry.status, "done");
  assert.ok(entry.startedAt && entry.endedAt);
  assert.equal(appsLabel("apps_execute", { tool: "GMAIL_SEND_EMAIL" }), "Enviar correo");
  assert.equal(appsLabel("apps_execute", { tool: "GMAIL_FETCH_EMAILS" }), "Leer correos");
});

test("ask_bot tasks run in parallel with read-only tools and return each result", async (t) => {
  const delegated = [];
  let active = 0, peak = 0;
  const { store, runtime } = await fixture(t, async ({ instructions, input, tools }) => {
    if (/# Encargo delegado/.test(instructions)) {
      delegated.push({ who: /Eres (\S+),/.exec(instructions)?.[1], tools: tools.map((x) => x.name) });
      if (!outputs(input).length) {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return call("list_files", {}, "d" + delegated.length);
      }
      return answer("Parte hecha por " + /Eres (\S+),/.exec(instructions)?.[1]);
    }
    const out = outputs(input);
    if (!out.length) return call("ask_bot", { botId: "", question: "", tasks: [{ botId: "tomas", task: "Calcula el margen", context: "Ventas 100" }, { botId: "vera", task: "Redacta la intro", context: "" }] });
    return answer(out[0].results.map((r) => r.answer).join(" | "));
  });
  const m = runtime.create({ prompt: "Informe" });
  await runtime.launch(m.id);
  assert.equal(peak, 2, "both helpers worked at the same time");
  assert.match(store.get("missions", m.id).result, /Parte hecha por Tomás \| Parte hecha por Vera/);
  for (const d of delegated) {
    for (const banned of ["ask_user", "remember", "ask_bot", "apps_execute", "write_file", "create_deliverable", "propose_automation"]) assert.ok(!d.tools.includes(banned), banned);
    assert.ok(d.tools.includes("read_file"));
  }
  assert.deepEqual(runtime.thread(m.id).map((x) => x.from + ">" + x.to).sort(), ["nora>tomas", "nora>vera", "tomas>nora", "vera>nora"]);
});

test("ask_user sources must quote literally what web_fetch read in this mission", async (t) => {
  let errorSeen = null;
  const { store, runtime } = await fixture(t, async ({ input }) => {
    const out = outputs(input);
    if (!out.length) return call("web_fetch", { url: "https://tienda.example.com/plan" }, "w");
    if (out.length === 1) return call("ask_user", { question: "¿Qué plan?", options: ["Básico", "Pro"], blocks: 1, sources: [{ url: "https://tienda.example.com/plan", quote: "El plan Básico cuesta 9 € al mes" }, { url: "", quote: "" }] }, "bad");
    if (out.length === 2) {
      errorSeen = out[1].error;
      return call("ask_user", { question: "¿Qué plan?", options: ["Básico", "Pro"], blocks: 1, sources: [{ url: "https://tienda.example.com/plan#precios", quote: "El plan  Básico cuesta 10 € al mes" }, { url: "", quote: "" }] }, "good");
    }
    return answer("Elegido " + out[2].answer);
  }, { web: page("Precios.\nEl plan Básico cuesta 10 € al mes y el Pro 25 €.") });
  const m = runtime.create({ prompt: "Elige plan" });
  await runtime.launch(m.id);
  assert.match(errorSeen, /Opción 1: la cita no aparece literalmente/);
  const q = store.list("approvals").find((a) => a.kind === "question");
  assert.deepEqual(q.options[0].source, { url: "https://tienda.example.com/plan#precios", quote: "El plan  Básico cuesta 10 € al mes" });
  assert.equal(q.options[1].source, undefined);
  runtime.answer(q.id, { optionId: "o1" });
  await settle(runtime);
  assert.equal(store.get("missions", m.id).result, "Elegido Básico");
});

test("propose_automation only creates a suggestion, and is not offered inside automation runs", async (t) => {
  const offered = [];
  const { store, runtime } = await fixture(t, async ({ input, tools }) => {
    offered.push(tools.map((x) => x.name));
    const out = outputs(input);
    if (!out.length) return call("propose_automation", { name: "Resumen de los lunes", prompt: "Resume las ventas de la semana", botId: "", trigger: { type: "semana", config: { semDia: 1, semHora: "09:00" } }, reason: "Lo pides cada lunes" });
    return answer(out[0].message || out[0].error);
  });
  const m = runtime.create({ prompt: "Resume ventas" });
  await runtime.launch(m.id);
  assert.equal(store.list("automations").length, 0);
  const [s] = store.list("suggestions");
  assert.equal(s.kind, "automation");
  assert.equal(s.botId, "nora");
  assert.equal(s.payload.trigger.type, "semana");
  assert.match(s.payload.trigger.sentence, /lunes a las 09:00/);
  assert.match(s.text, /Nora propone automatizar «Resumen de los lunes»/);
  assert.match(store.get("missions", m.id).result, /sugerencia/);
  offered.length = 0;
  const auto = runtime.create({ prompt: "Resume ventas", automationId: "a1" });
  await runtime.launch(auto.id);
  assert.ok(!offered[0].includes("propose_automation"));
  assert.match(store.get("missions", auto.id).result || "", /no disponible/i);
});

test("search_history: automation runs rank last and {missionId, around} reads more context", async (t) => {
  const { store, runtime } = await fixture(t, async ({ input }) => answer("Respuesta sobre el presupuesto de marketing " + input.length));
  const auto = runtime.create({ prompt: "Presupuesto de marketing semanal", automationId: "a1" });
  await runtime.launch(auto.id);
  const normal = runtime.create({ prompt: "Presupuesto de marketing del trimestre", conversation: true });
  await runtime.launch(normal.id);
  for (const text of ["¿Y el de ventas?", "Gracias por el presupuesto"]) {
    runtime.addMessage(normal.id, text);
    await settle(runtime);
  }
  const hits = searchHistory(store, "presupuesto marketing");
  assert.equal(hits[0].missionId, normal.id);
  assert.equal(hits.at(-1).automation, true);
  const m = runtime.create({ prompt: "otra cosa" });
  const step = runtime.steps(m.id)[0];
  const ctx = await runtime.tool(store.get("missions", m.id), step, { name: "search_history", arguments: JSON.stringify({ query: "", missionId: normal.id, around: hits[0].messageId }), call_id: "s" }, new AbortController().signal, "fixture");
  assert.equal(ctx.missionId, normal.id);
  assert.ok(ctx.messages.length >= 4);
  assert.ok(ctx.messages.some((x) => x.messageId === hits[0].messageId));
  assert.ok(ctx.messages.some((x) => x.who === "persona" && /ventas/.test(x.text)));
});

test("trimming happens in bursts, not every round, so the history prefix stays cacheable", () => {
  const page = JSON.stringify({ text: "x".repeat(20000) });
  let history = [{ role: "user", content: "Encargo" }];
  const rewrites = [];
  for (let round = 0; round < 30; round++) {
    history.push({ type: "function_call", name: "web_fetch", call_id: "c" + round, arguments: "{}" }, { type: "function_call_output", call_id: "c" + round, output: page });
    const next = trimHistory(history);
    if (next !== history) rewrites.push(round);
    history = next;
  }
  assert.ok(rewrites.length > 0 && rewrites.length <= 8, "trimmed in a few bursts: " + rewrites.join(","));
  const outs = history.filter((x) => x.type === "function_call_output");
  assert.notEqual(outs.at(-1).output, JSON.stringify(TRIMMED), "the latest result stays whole");
});
