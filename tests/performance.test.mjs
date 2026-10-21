import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, outputs, settle } from "./fixtures/runtime-fixture.mjs";
import { AppTools, CURATED, LIMITS, directName, isAppToolName, slimAppResult, toFunction } from "../server/apptools.mjs";
import { ResponseSockets } from "../server/provider-ws.mjs";
import { record } from "../server/usage.mjs";

test("chats think «low», real work «medium»; the bot's profile always wins", async (t) => {
  const { runtime } = await fixture(t, async () => answer("ok"));
  const bot = { id: "nora", thinking: "equilibrado" };
  assert.equal(runtime.effortForStep(bot, { kind: "followup" }, {}), "low");
  assert.equal(runtime.effortForStep(bot, { kind: "solo" }, { conversation: true }), "low");
  assert.equal(runtime.effortForStep(bot, { kind: "solo" }, {}), "medium");
  assert.equal(runtime.effortForStep(bot, { kind: "work" }, {}), "medium");
  assert.equal(runtime.effortForStep(bot, { kind: "synthesis" }, {}), "medium");
  assert.equal(runtime.effortForStep({ ...bot, thinking: "profundo" }, { kind: "followup" }, {}), "high");
  assert.equal(runtime.effortForStep({ ...bot, thinking: "rapido" }, { kind: "work" }, {}), "low");
});

test("Atlas answers a chat with the middle family; a family chosen in its profile is kept", async (t) => {
  const { runtime } = await fixture(t, async () => answer("ok"));
  runtime.availableModels = () => [{ slug: "gpt-6-astra" }, { slug: "gpt-6.1-sol" }, { slug: "gpt-6-luna" }];
  const atlas = { id: "atlas", role: "Coordina el equipo" };
  assert.equal(runtime.modelForStep(atlas, { kind: "followup" }, {}, "x"), "gpt-6.1-sol");
  assert.equal(runtime.modelForStep(atlas, { kind: "plan" }, {}, "x"), "gpt-6.1-sol");
  assert.equal(runtime.modelForStep(atlas, { kind: "synthesis" }, {}, "x"), "gpt-6-astra");
  assert.equal(runtime.modelForStep({ ...atlas, modelFamily: "astra" }, { kind: "followup" }, {}, "x"), "gpt-6-astra");
});

test("a one-task plan starts on its own and its delivery is the answer (no synthesis)", async (t) => {
  const { store, runtime } = await fixture(t, async ({ input, tools }) => {
    if (tools.some((x) => x.name === "propose_plan")) {
      return outputs(input).length ? answer("En marcha") : call("propose_plan", { assignments: [{ botId: "nora", task: "Busca datos" }], summary: "Nora busca" }, "p1");
    }
    return answer("Aquí tienes los datos.");
  });
  const m = runtime.create({ prompt: "Datos del sector", mode: "equipo", botIds: ["nora"] });
  await runtime.launch(m.id);
  await settle(runtime);
  const mission = store.get("missions", m.id);
  assert.equal(store.list("approvals").find((a) => a.kind === "plan").status, "approved");
  assert.deepEqual(mission.steps, ["plan", "work-nora"]);
  assert.equal(runtime.steps(m.id).find((s) => s.key === "work-nora").final, true);
  assert.equal(mission.status, "completed");
});

const schema = (tool, toolkit, props = {}) => ({ tool, toolkit, name: tool, description: "Hace " + tool, input_schema: { type: "object", properties: props } });
function fakeConnections({ accounts, schemas }) {
  const requests = [];
  return {
    requests,
    async call(op, args) {
      if (op === "status") return { configured: true };
      if (op === "accounts") return { items: accounts, next_cursor: null };
      if (op === "describe") return schemas[args.tool] || null;
      return {};
    },
    async request(mission, step, call, args) { requests.push(args); return { ok: true }; },
  };
}

test("connected apps come as direct tools with their real schema, run through the reviewed path", async () => {
  const connections = fakeConnections({
    accounts: [{ id: "ca_1", toolkit: "googlecalendar", alias: "Calendar personal", status: "ACTIVE" }],
    schemas: { GOOGLECALENDAR_CREATE_EVENT: schema("GOOGLECALENDAR_CREATE_EVENT", "googlecalendar", { summary: { type: "string" } }) },
  });
  const tools = new AppTools(connections);
  await tools.refresh();
  const runtime = { connections, decorateConnectionApproval() {}, bot: () => ({}) };
  const list = tools.list({}, {}, runtime);
  assert.deepEqual(list.map((x) => x.name), ["googlecalendar_create_event"]);
  assert.ok(list[0].parameters.properties.summary && list[0].parameters.properties.account);
  assert.equal(list[0].capability, "apps");
  const result = await list[0].run({ summary: "Renovar" }, { mission: { id: "m" }, step: { id: "s", botId: "vera" }, call: { call_id: "c" }, signal: null, runtime });
  assert.equal(result.ok, true);
  assert.deepEqual(connections.requests[0], { tool: "GOOGLECALENDAR_CREATE_EVENT", account: "ca_1", arguments_json: JSON.stringify({ summary: "Renovar" }) });
});

test("with two accounts of an app the direct tool asks which one", async () => {
  const connections = fakeConnections({
    accounts: [{ id: "a1", toolkit: "gmail", alias: "Gmail personal", status: "ACTIVE" }, { id: "a2", toolkit: "gmail", alias: "Gmail trabajo", status: "ACTIVE" }],
    schemas: { GMAIL_FETCH_EMAILS: schema("GMAIL_FETCH_EMAILS", "gmail") },
  });
  const tools = new AppTools(connections);
  await tools.refresh();
  const [fetch] = tools.list({}, {}, { connections });
  assert.deepEqual(fetch.parameters.properties.account.enum, ["a1", "a2"]);
  assert.ok(fetch.parameters.required.includes("account"));
  const out = await fetch.run({}, { mission: {}, step: { id: "s" }, call: { call_id: "c" }, runtime: { connections } });
  assert.match(out.error, /varias cuentas/);
});

test("direct tool names are valid function names and the catalogue stays small", () => {
  for (const slugs of Object.values(CURATED)) for (const slug of slugs) assert.match(directName(slug), /^[a-z0-9_]{1,64}$/);
  assert.ok(LIMITS.tools <= 20 && LIMITS.schemaChars <= 45000);
  assert.equal(toFunction({ tool: "GMAIL_FETCH_EMAILS", toolkit: "gmail" }, [{ id: "a", alias: "x" }]).name, "gmail_fetch_emails");
  assert.ok(isAppToolName("gmail_fetch_emails") && isAppToolName("apps_execute") && !isAppToolName("web_fetch"));
});

test("an app's long answer reaches the model slim: HTML as text, lists capped", () => {
  const html = "<html><style>p{}</style><body><p>Hola&nbsp;Marina</p>" + "<b>x</b>".repeat(5000) + "</body></html>";
  const result = { ok: true, data: { messages: Array.from({ length: 50 }, (_, i) => ({ id: "m" + i, messageText: html, payload: { raw: "z".repeat(5000) } })) } };
  const slim = slimAppResult(result);
  const text = JSON.stringify(slim);
  assert.ok(text.length <= 16500, String(text.length));
  assert.match(text, /Hola Marina/);
  assert.doesNotMatch(text, /<style>|payload/);
  assert.equal(slimAppResult({ ok: true, data: { a: 1 } }).data.a, 1);
});

test("each call records how long the first word took, what it was for and its tools", async (t) => {
  const { store } = await fixture(t, async () => answer("ok"));
  const entry = record(store, { missionId: "m", botId: "b", tokens: { input_tokens: 10, output_tokens: 2 }, ms: 1200, timing: { firstEventMs: 180, firstTokenMs: 640 }, purpose: "step", tools: 27 });
  assert.equal(entry.firstTokenMs, 640);
  assert.equal(entry.firstEventMs, 180);
  assert.equal(entry.purpose, "step");
  assert.equal(entry.tools, 27);
});

test("warming opens the socket once and reuses it for the first round", async () => {
  let opened = 0;
  class FakeSocket {
    constructor() { opened++; this.readyState = 0; this.listeners = {}; setTimeout(() => { this.readyState = 1; this.emit("open"); }, 1); }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
    emit(type, e) { for (const fn of this.listeners[type] || []) fn(e); }
    close() { this.readyState = 3; }
  }
  const sockets = new ResponseSockets({ WebSocketImpl: FakeSocket });
  assert.equal(await sockets.warm("k", {}), true);
  assert.equal(await sockets.warm("k", {}), true);
  assert.equal(opened, 1);
  sockets.closeAll();
});

test("every connected app gets its first tools before any app gets a third one", async () => {
  const big = (tool) => schema(tool, tool.split("_")[0].toLowerCase(), { blob: { type: "string", description: "x".repeat(200) } });
  const connections = fakeConnections({
    accounts: [{ id: "g", toolkit: "gmail", alias: "Gmail", status: "ACTIVE" }, { id: "c", toolkit: "googlecalendar", alias: "Calendar", status: "ACTIVE" }],
    schemas: Object.fromEntries([...CURATED.gmail, ...CURATED.googlecalendar].map((t) => [t, big(t)])),
  });
  const tools = new AppTools(connections);
  await tools.refresh();
  const names = tools.list({}, {}, { connections }).map((x) => x.name);
  assert.deepEqual(names.slice(0, 4), ["gmail_fetch_emails", "googlecalendar_events_list_all_calendars", "gmail_fetch_message_by_message_id", "googlecalendar_find_free_slots"]);
});

test("a read asks for 50 at most, and one too big or too slow is repeated smaller", async () => {
  const connections = fakeConnections({
    accounts: [{ id: "g", toolkit: "gmail", alias: "Gmail", status: "ACTIVE" }],
    schemas: { GMAIL_FETCH_EMAILS: schema("GMAIL_FETCH_EMAILS", "gmail") },
  });
  connections.request = async (m, s, c, args) => { connections.requests.push(JSON.parse(args.arguments_json)); return { ok: false, error: "Respuesta de el servicio de conexiones demasiado grande. Acota la consulta." }; };
  const retried = [];
  connections.readNow = async (m, s, args) => { retried.push(JSON.parse(args.arguments_json)); return { ok: true, data: { messages: [] } }; };
  const tools = new AppTools(connections);
  await tools.refresh();
  const fetch = tools.list({}, {}, { connections }).find((x) => x.name === "gmail_fetch_emails");
  const out = await fetch.run({ query: "x", max_results: 500, include_payload: true, verbose: true }, { mission: {}, step: { id: "s" }, call: { call_id: "c" }, runtime: { connections } });
  assert.equal(connections.requests[0].max_results, 50);
  assert.deepEqual([retried[0].max_results, retried[0].include_payload, retried[0].verbose], [25, false, false]);
  assert.equal(out.ok, true);
  assert.match(out.nota, /repetido/);
});
