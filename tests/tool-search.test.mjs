import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, outputs, settle } from "./fixtures/runtime-fixture.mjs";
import { toolsFor } from "../server/tools.mjs";
import { computerToolDefs } from "../server/computer/tools.mjs";
import { projectToolDefs } from "../server/projects/tools.mjs";
import { toFunction } from "../server/apptools.mjs";
import { toolCalls, toolDigest } from "../server/state.mjs";
import { CORE_TOOLS, TOOL_SEARCH, FIND_TOOLS, USE_TOOL, rankTools, findTools, resolveToolUse, splitTools, toolsNote, paramSummary, schemaProblems } from "../server/tool-search.mjs";

// The definitions a bot with everything gets: built-ins, computer, projects and a few app tools.
const appTool = (slug, description) => {
  const def = toFunction({ tool: slug, toolkit: slug.split("_")[0].toLowerCase(), description, input_schema: { type: "object", properties: { query: { type: "string" } } } }, [{ id: "ca_1", alias: "trabajo" }]);
  return { name: def.name, description: def.description, parameters: def.parameters, capability: "apps" };
};
const EVERYTHING = [
  ...toolsFor("solo", { connections: true, images: true }),
  ...computerToolDefs({ id: "nora" }, { available: true, settings: {} }),
  ...projectToolDefs(),
  appTool("GMAIL_FETCH_EMAILS", "Fetches a list of email messages from a Gmail account, with filters and pagination."),
  appTool("GMAIL_SEND_EMAIL", "Sends an email via Gmail API using the authenticated user's Google profile display name."),
  appTool("GOOGLECALENDAR_CREATE_EVENT", "Create a Google Calendar event using start_datetime plus duration fields."),
  appTool("GOOGLECALENDAR_EVENTS_LIST", "Returns events on the specified calendar."),
  appTool("GOOGLESHEETS_BATCH_GET", "Retrieves data from specified cell ranges in a Google Spreadsheet."),
  appTool("NOTION_SEARCH_NOTION_PAGE", "Searches Notion pages and databases by title."),
];
const top = (query, n = 1) => rankTools(query, EVERYTHING, { limit: n }).map((x) => x.tool.name);

test("the ranking finds the right tool for Spanish and English queries, with or without accents", () => {
  const cases = [
    ["captura de pantalla", "browser_screenshot"], ["take a screenshot", "browser_screenshot"],
    ["hoja de cálculo con fórmulas", "create_spreadsheet"], ["excel spreadsheet with formulas", "create_spreadsheet"],
    ["presentación con diapositivas", "create_presentation"], ["presentacion", "create_presentation"], ["slides deck", "create_presentation"],
    ["rellenar un formulario PDF", "fill_pdf"], ["fill a pdf form", "fill_pdf"],
    ["instalar las dependencias del proyecto", "project_run"], ["install project dependencies", "project_run"],
    ["crear un evento en el calendario", "googlecalendar_create_event"], ["create calendar event", "googlecalendar_create_event"],
    ["descargar un archivo de la web", "browser_download"],
  ];
  for (const [query, name] of cases) assert.equal(top(query)[0], name, query + " → " + top(query, 3).join(", "));
  // Sending mail: the direct tool is among the first, in both languages.
  assert.ok(top("enviar un correo", 3).includes("gmail_send_email"), top("enviar un correo", 3).join(", "));
  assert.ok(top("send an email", 3).includes("gmail_send_email"), top("send an email", 3).join(", "));
  // A tool's own name always wins; nonsense finds nothing.
  assert.equal(top("project_edit")[0], "project_edit");
  assert.deepEqual(top("zzzz qqqq"), []);
});

test("find_tools gives name, one line and parameters, the best match whole, and points to the other searches", () => {
  const split = splitTools(EVERYTHING);
  const out = findTools("hoja de cálculo", EVERYTHING, { listed: split.listed });
  assert.equal(out.tools[0].name, "create_spreadsheet");
  assert.ok(out.tools[0].description.length <= 220);
  assert.match(out.tools[0].parameters, /title \(texto\)\*.*sheets \(lista de objeto/);
  assert.match(out.tools[0].use, /use_tool\(\{name: "create_spreadsheet"/);
  assert.equal(out.tools[0].schema.properties.sheets.type, "array", "the best match carries its real schema");
  assert.match(out.tools[0].full_description, /fórmulas reales/);
  assert.ok(out.tools.length <= TOOL_SEARCH.results);
  assert.ok(JSON.stringify(out).length < 16000, "a search stays small");
  assert.match(out.notice, /apps_search/);
  // A tool that is already listed says so and does not repeat its schema.
  const listed = findTools("leer un archivo de la misión", EVERYTHING, { listed: split.listed }).tools.find((x) => x.name === "read_file");
  assert.match(listed.use, /llámala directamente/);
  assert.equal(listed.schema, undefined);
  const none = findTools("zzzz", EVERYTHING, { listed: split.listed });
  assert.deepEqual(none.tools, []);
  assert.match(none.message, /Ninguna de tus herramientas/);
  // The two tools never find themselves.
  assert.ok(!findTools("find_tools use_tool", split.listed).tools.some((x) => [FIND_TOOLS, USE_TOOL].includes(x.name)));
});

test("below the threshold, or switched off, the list is exactly the same", () => {
  const few = toolsFor("solo", { connections: true });
  assert.ok(few.length <= TOOL_SEARCH.threshold);
  const same = splitTools(few);
  assert.equal(same.listed, few, "the very same list");
  assert.equal(same.active, false);
  assert.equal(toolsNote(same.deferred), "");
  const off = splitTools(EVERYTHING, { enabled: false });
  assert.equal(off.listed, EVERYTHING);
  assert.equal(off.active, false);
  // Many tools, but almost all of them core: two more tools would not pay for themselves.
  const core = [...few, ...Array.from({ length: 12 }, (_, i) => ({ name: "extra_" + i, description: "x", parameters: { type: "object", properties: {} } }))];
  assert.equal(splitTools(core, { promoted: core.map((x) => x.name) }).active, false);
});

test("with many tools the core stays listed, the rest goes behind find_tools and use_tool, and the prompt says so", () => {
  const split = splitTools(EVERYTHING);
  assert.equal(split.active, true);
  const names = split.listed.map((x) => x.name);
  for (const n of ["ask_user", "remember", "read_file", "write_file", "create_deliverable", "ask_bot", "web_fetch", "apps_execute", "apps_search", "run_command"]) assert.ok(names.includes(n), n + " stays listed");
  for (const n of ["browser_open", "browser_submit", "project_write", "create_spreadsheet", "fill_pdf"]) assert.ok(!names.includes(n) && split.deferred.some((x) => x.name === n), n + " is found on demand");
  assert.deepEqual(names.slice(-2), [FIND_TOOLS, USE_TOOL]);
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.filter((n) => /^(gmail|googlecalendar|googlesheets|notion)_/.test(n)).length, TOOL_SEARCH.directApps, "the most used app tools stay at hand");
  assert.ok(JSON.stringify(split.listed).length < JSON.stringify(EVERYTHING).length / 2, "the definitions are less than half");
  // Listed + deferred is everything the bot had: nothing is lost, nothing is added but the two tools.
  assert.deepEqual([...names.slice(0, -2), ...split.deferred.map((x) => x.name)].sort(), EVERYTHING.map((x) => x.name).sort());
  for (const tool of split.listed) assert.ok(CORE_TOOLS.has(tool.name) || /^(gmail|google|notion)/.test(tool.name) || [FIND_TOOLS, USE_TOOL].includes(tool.name), tool.name);
  const note = toolsNote(split.deferred, { apps: true });
  assert.match(note, /# Más herramientas/);
  assert.match(note, /browser_open.*find_tools.*use_tool/s);
  assert.match(note, /apps_search, no con find_tools/);
  // What it used before is listed directly (within the cap), in the same order as always.
  const again = splitTools(EVERYTHING, { promoted: ["browser_open", "project_write"] });
  assert.ok(again.listed.some((x) => x.name === "browser_open") && again.listed.some((x) => x.name === "project_write"));
  assert.ok(!again.deferred.some((x) => x.name === "browser_open"));
  // find_tools is strict like every other definition; use_tool takes any object and checks it itself.
  const find = split.listed.at(-2);
  assert.equal(find.strict, true);
  assert.deepEqual(find.parameters.required, Object.keys(find.parameters.properties));
  assert.equal(find.parameters.additionalProperties, false);
});

test("use_tool resolves only the bot's own tools and checks the arguments against the real schema, with errors it can fix", () => {
  const ok = resolveToolUse(JSON.stringify({ name: "browser_open", arguments: { url: "https://example.com" } }), EVERYTHING);
  assert.equal(ok.name, "browser_open");
  assert.deepEqual(JSON.parse(ok.arguments), { url: "https://example.com" });
  // Arguments written as text are read once.
  assert.equal(resolveToolUse({ name: "browser_open", arguments: "{\"url\":\"https://example.com\"}" }, EVERYTHING).name, "browser_open");
  // Not one of its tools (here: a bot without the computer).
  const mine = toolsFor("solo", {});
  const outside = resolveToolUse({ name: "browser_open", arguments: { url: "https://example.com" } }, mine);
  assert.match(outside.error, /«browser_open» no es una de tus herramientas/);
  assert.match(resolveToolUse({ name: "browser_opn", arguments: {} }, EVERYTHING).error, /¿.*browser_open.*\?.*find_tools/);
  // It cannot wrap itself, nor find_tools.
  assert.match(resolveToolUse({ name: USE_TOOL, arguments: { name: "browser_open", arguments: {} } }, splitTools(EVERYTHING).listed).error, /no es una de tus herramientas/);
  assert.match(resolveToolUse({ name: FIND_TOOLS, arguments: { query: "x" } }, splitTools(EVERYTHING).listed).error, /no es una de tus herramientas/);
  // Readable schema errors: what is missing, what has the wrong type, what does not exist.
  const bad = resolveToolUse({ name: "browser_act", arguments: { kind: "pulsar", ref: 7, extra: true } }, EVERYTHING).error;
  assert.match(bad, /Argumentos no válidos para browser_act/);
  assert.match(bad, /text: falta/);
  assert.match(bad, /kind: tiene que ser uno de "click", "escribir"/);
  assert.match(bad, /ref: tiene que ser un texto y es un número entero/);
  assert.match(bad, /extra: no existe en esta herramienta/);
  assert.match(bad, /Sus parámetros: kind \(click\|escribir\|.*\)\*, ref \(texto\)\*, text \(texto\)\*/);
  assert.match(resolveToolUse({ name: "browser_fill", arguments: { fields: [{ ref: "e1" }] } }, EVERYTHING).error, /fields\[0\]\.value: falta/);
  assert.match(resolveToolUse("{not json", EVERYTHING).error, /no son un JSON válido/);
  assert.match(resolveToolUse({ arguments: {} }, EVERYTHING).error, /falta «name»/);
  assert.match(resolveToolUse({ name: "browser_open", arguments: [1] }, EVERYTHING).error, /tiene que ser un objeto/);
  // Types written as a list, nulls and free-form objects (as the real definitions use them).
  assert.deepEqual(schemaProblems({ type: ["string", "null"] }, null), []);
  assert.deepEqual(schemaProblems({ type: "object", properties: { values: { type: "object", additionalProperties: { type: ["string", "boolean", "number"] } } } }, { values: { a: "x", b: true } }), []);
  assert.match(schemaProblems({ type: "object", properties: { values: { type: "object", additionalProperties: { type: "string" } } } }, { values: { a: 1 } })[0], /values\.a: tiene que ser un texto/);
  assert.equal(paramSummary({ type: "object", properties: {} }), "sin parámetros");
});

// ---- through the runtime: the same execution path as a direct call ------------------------
const filler = Array.from({ length: 30 }, (_, i) => ({
  name: "filler_tool_" + i, description: "Herramienta de relleno número " + i + ".", strict: true, capability: "ordenador",
  parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  run: async () => ({ ok: true }),
}));
/** A red line as the real ones are written: an approval of its own, nothing done before the OK. */
const invoiceTool = (log) => ({
  name: "send_invoice", description: "Envía una factura por correo al cliente (sale de Colmena).", strict: true, capability: "ordenador",
  parameters: { type: "object", properties: { client: { type: "string" }, amount: { type: "number" } }, required: ["client", "amount"], additionalProperties: false },
  run: async (args, { mission, step, bot, call: c, runtime }) => {
    const approvalId = step.id + ":" + c.call_id;
    const a = runtime.store.get("approvals", approvalId);
    if (!a) {
      runtime.store.put("approvals", {
        id: approvalId, missionId: mission.id, botId: bot.id, stepId: step.id, callId: c.call_id, tool: "send_invoice", args, kind: "permission", scope: null,
        title: "Enviar factura a " + args.client, summary: bot.name + " quiere enviar una factura de " + args.amount + " € a " + args.client + ".",
        context: runtime.approvalContext(mission, bot), blocks: 1, options: [], email: null, canAlways: false, redLine: true, external: true, status: "pending", createdAt: new Date().toISOString(),
      });
      return { waiting: true };
    }
    if (a.status === "pending") return { waiting: true };
    if (a.status === "executed") return a.result;
    if (a.status !== "approved") return { error: "La persona no lo aprobó." };
    log.push(args);
    const result = { sent: true, to: args.client };
    runtime.store.patch("approvals", approvalId, { status: "executed", result });
    return result;
  },
});
const ARGS = { client: "Lumbre Home", amount: 120.5 };
const approvalShape = (a) => ({ tool: a.tool, args: a.args, redLine: a.redLine, canAlways: a.canAlways, status: a.status, title: a.title, summary: a.summary, kind: a.kind });

async function runInvoice(t, first) {
  const log = [], seenTools = [];
  let round = 0, results = [];
  const { store, runtime } = await fixture(t, async ({ input, tools, instructions }) => {
    round += 1;
    seenTools.push({ names: tools.map((x) => x.name), instructions });
    if (round === 1) return first;
    results = outputs(input);
    return answer("Enviada.");
  });
  runtime.extraTools = () => [...filler, invoiceTool(log)];
  const m = runtime.create({ prompt: "Envía la factura a Lumbre Home", mode: "solo", botIds: ["bruno"] });
  await runtime.launch(m.id);
  await settle(runtime);
  return { store, runtime, m, log, seenTools, results: () => results };
}

test("a red-line tool reached through use_tool asks exactly as the direct call, and its receipt and card are the real tool's", async (t) => {
  const direct = await runInvoice(t, call("send_invoice", ARGS, "c1"));
  const wrapped = await runInvoice(t, call(USE_TOOL, { name: "send_invoice", arguments: ARGS }, "c1"));
  // The model only sees the core list, and its prompt names what else there is.
  const shown = wrapped.seenTools[0];
  assert.ok(shown.names.includes(FIND_TOOLS) && shown.names.includes(USE_TOOL));
  assert.ok(!shown.names.includes("send_invoice"), "the long tail is not listed");
  assert.match(shown.instructions, /# Más herramientas[\s\S]*send_invoice/);
  for (const run of [direct, wrapped]) {
    const a = run.store.list("approvals").find((x) => x.missionId === run.m.id);
    assert.equal(a.status, "pending", "the red line waits for the person");
    assert.deepEqual(run.log, [], "nothing left before the OK");
    assert.equal(run.store.get("missions", run.m.id).status, "waiting");
  }
  const [da, wa] = [direct, wrapped].map((run) => run.store.list("approvals").find((x) => x.missionId === run.m.id));
  assert.deepEqual(approvalShape(wa), approvalShape(da), "the same approval, word for word");
  assert.equal(wa.callId, "c1");
  // While it waits, the room shows the real tool with its real arguments.
  const waitingStep = wrapped.runtime.liveStep(wrapped.runtime.steps(wrapped.m.id)[0].id);
  assert.deepEqual(waitingStep.pending.map((c) => [c.name, JSON.parse(c.arguments)]), [["send_invoice", ARGS]]);
  const card = toolCalls(waitingStep, { receipt: (callId) => wrapped.store.get("receipts", waitingStep.id + ":" + callId) })[0];
  assert.equal(card.name, "send_invoice");
  assert.equal(card.status, "waiting");
  for (const run of [direct, wrapped]) {
    run.runtime.approve(run.store.list("approvals").find((x) => x.missionId === run.m.id).id, "approved");
    await settle(run.runtime);
    assert.deepEqual(run.log, [ARGS], "sent once, after the OK");
    assert.deepEqual(run.results().at(-1), { sent: true, to: "Lumbre Home" });
    assert.equal(run.store.get("missions", run.m.id).status, "completed");
  }
  // Receipts and the conversation: the same records as the direct call.
  const receiptOf = (run) => { const s = run.runtime.steps(run.m.id)[0]; const r = run.store.get("receipts", s.id + ":c1"); return { tool: r.tool, status: r.status, result: r.result }; };
  assert.deepEqual(receiptOf(wrapped), receiptOf(direct));
  assert.equal(receiptOf(wrapped).tool, "send_invoice");
  const step = wrapped.runtime.liveStep(wrapped.runtime.steps(wrapped.m.id)[0].id);
  const stored = step.history.find((x) => x.type === "function_call");
  assert.equal(stored.name, "send_invoice");
  assert.deepEqual(JSON.parse(stored.arguments), ARGS);
  assert.deepEqual(toolDigest(step.history).map((e) => e.view.name), ["send_invoice"]);
  assert.deepEqual(step.cards.map((e) => e.view.name), ["send_invoice"], "the card kept with the step is the real tool's");
  assert.deepEqual(step.usedTools, ["send_invoice"]);
  // The list did not change inside the step (the cached prefix is the same every round).
  assert.deepEqual(wrapped.seenTools.at(-1).names, wrapped.seenTools[0].names);
  assert.equal(wrapped.seenTools.at(-1).instructions, wrapped.seenTools[0].instructions);
});

test("a bot cannot use_tool what it could not call directly, and bad arguments never run", async (t) => {
  const log = [];
  let round = 0, results = [];
  const { store, runtime } = await fixture(t, async ({ input, tools }) => {
    round += 1;
    if (round === 1) {
      assert.ok(tools.some((x) => x.name === USE_TOOL));
      assert.ok(!tools.some((x) => x.name === "send_invoice"));
      return {
        text: "",
        output: [
          // Outside its tools: the computer is off for this bot, so send_invoice is not its own.
          { type: "function_call", name: USE_TOOL, arguments: JSON.stringify({ name: "send_invoice", arguments: ARGS }), call_id: "u1" },
          // Its own tool, wrong arguments.
          { type: "function_call", name: USE_TOOL, arguments: JSON.stringify({ name: "googlecalendar_create_event", arguments: { summary: 5, nope: 1 } }), call_id: "u2" },
          { type: "function_call", name: FIND_TOOLS, arguments: JSON.stringify({ query: "crear un evento en el calendario" }), call_id: "u3" },
          // The direct call of something outside its tools is refused as always.
          { type: "function_call", name: "send_invoice", arguments: JSON.stringify(ARGS), call_id: "u4" },
        ],
      };
    }
    results = outputs(input);
    return answer("No puedo.");
  });
  const calendar = { name: "googlecalendar_create_event", description: "Create a Google Calendar event.", capability: "apps", parameters: { type: "object", properties: { summary: { type: "string" }, start: { type: "string" } }, required: ["summary"], additionalProperties: false }, run: async (a) => { log.push(a); return { ok: true }; } };
  const more = Array.from({ length: 30 }, (_, i) => ({ ...filler[i], name: "googlesheets_filler_" + i, capability: "apps" }));
  runtime.extraTools = () => [...more, calendar, invoiceTool(log)];
  store.patch("bots", "bruno", { capabilities: { web: true, carpetas: true, apps: true, ordenador: false } });
  const m = runtime.create({ prompt: "Envía la factura", mode: "solo", botIds: ["bruno"] });
  await runtime.launch(m.id);
  await settle(runtime);
  assert.deepEqual(log, [], "nothing ran");
  assert.equal(store.list("approvals").filter((x) => x.missionId === m.id).length, 0, "and nothing was asked");
  const [outside, bad, found, direct] = results;
  assert.match(outside.error, /«send_invoice» no es una de tus herramientas/);
  assert.match(bad.error, /Argumentos no válidos para googlecalendar_create_event — summary: tiene que ser un texto y es un número entero; nope: no existe en esta herramienta/);
  assert.equal(found.tools[0].name, "googlecalendar_create_event");
  assert.ok(!found.tools.some((x) => x.name === "send_invoice"), "find_tools only sees its own tools");
  assert.equal(direct.error, "Herramienta no disponible.");
  // The cards name the tool each refused call was aiming at, with the reason.
  const step = runtime.liveStep(runtime.steps(m.id)[0].id);
  const cards = toolCalls(step, { receipt: (callId) => store.get("receipts", step.id + ":" + callId) });
  assert.deepEqual(cards.map((c) => [c.name, c.status]), [["send_invoice", "error"], ["googlecalendar_create_event", "error"], [FIND_TOOLS, "done"], ["send_invoice", "error"]]);
  assert.equal(cards[1].card.type, "app");
  assert.deepEqual(cards[2].card, { type: "search", query: "crear un evento en el calendario", count: found.tools.length });
  assert.equal(step.usedTools, undefined, "a refused call promotes nothing");
});

test("a built-in reached through use_tool runs like the direct call, and what a bot used is listed in its next steps", async (t) => {
  let round = 0, results = [];
  const { store, runtime } = await fixture(t, async ({ input }) => {
    round += 1;
    if (round === 1) return call(USE_TOOL, { name: "propose_soul_change", arguments: { proposal: "Responder siempre con una tabla al final.", reason: "La persona lo pidió así." } }, "s1");
    results = outputs(input);
    return answer("Propuesto.");
  });
  runtime.extraTools = () => filler;
  const m = runtime.create({ prompt: "Cambia tu forma de responder", mode: "solo", botIds: ["bruno"] });
  await runtime.launch(m.id);
  await settle(runtime);
  assert.equal(results[0].proposed, true);
  const first = runtime.steps(m.id)[0];
  assert.equal(store.get("receipts", first.id + ":s1").tool, "propose_soul_change");
  assert.deepEqual(first.usedTools, ["propose_soul_change"]);
  assert.deepEqual(first.promotedTools, [], "nothing used before its first step");
  // Its next step in the mission lists that tool directly; another bot's does not.
  const bot = store.get("bots", "bruno");
  const next = { id: m.id + ":next", missionId: m.id, botId: "bruno", kind: "followup" };
  assert.deepEqual(runtime.toolsUsedBefore(next), ["propose_soul_change"]);
  const listed = runtime.listedTools(m, { ...next, promotedTools: runtime.toolsUsedBefore(next) }, bot).map((x) => x.name);
  assert.ok(listed.includes("propose_soul_change"));
  assert.ok(!runtime.listedTools(m, next, bot).map((x) => x.name).includes("propose_soul_change"));
  assert.deepEqual(runtime.toolsUsedBefore({ ...next, botId: "nora" }), []);
  // The latest ones, within the cap.
  store.patch("steps", first.id, { usedTools: filler.slice(0, 12).map((x) => x.name) });
  const kept = runtime.toolsUsedBefore(next);
  assert.equal(kept.length, TOOL_SEARCH.promoted);
  assert.ok(kept.includes("filler_tool_11") && !kept.includes("filler_tool_0"));
  // Ajustes: switched off, everything is listed again and the two tools do not exist.
  store.patch("settings", "main", { toolSearch: false });
  const all = runtime.toolsForStep(m, next, bot);
  assert.equal(runtime.listedTools(m, next, bot, all), all);
  assert.equal(runtime.toolsNote(all, all), "");
  const refused = await runtime.tool(m, { ...first, kind: "solo" }, { name: FIND_TOOLS, arguments: JSON.stringify({ query: "x" }), call_id: "z" }, new AbortController().signal, "fixture");
  assert.equal(refused.error, "Herramienta no disponible.");
});
