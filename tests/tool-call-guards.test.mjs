// A tool call is checked against the step's real tool list before anything else is done with it,
// and the helpers that describe a call (activity verb, detail, write scope) never fail on what a
// model sends as arguments: missing, null, arrays, numbers, objects where text was expected.
import test from "node:test";
import assert from "node:assert/strict";
import { answer, fixture, settle } from "./fixtures/runtime-fixture.mjs";
import { ask, friends, rule, sharedRoom, until, world } from "./fixtures/people-world.mjs";
import { schemas, CONNECTION_TOOLS, verbFor } from "../server/tools.mjs";
import { scopeOfCall } from "../server/writescopes.mjs";
import { appsLabel } from "../server/runtime/helpers.mjs";

// Every tool name the server knows: built-ins, the connected apps' tools and what index.mjs adds.
const EXTRA = [
  "mcp_call", "mcp_tools", "request_secret", "api_request", "run_command", "open_file", "browser_open", "browser_read", "browser_screenshot",
  "browser_act", "browser_fill", "browser_submit", "browser_download", "browser_sign_in", "open_app", "desktop_windows", "desktop_open", "desktop_look",
  "desktop_do", "project_create", "project_files", "project_write", "project_edit", "project_delete", "project_run", "project_server", "project_preview",
  "wiki_search", "wiki_read", "wiki_write", "block_read", "block_post", "ask_peer_bot", "ask_room", "gmail_fetch_emails", "gmail_send_email",
  "slack_send_message", "find_tools", "use_tool", "skill_view", "skills_list", "__proto__", "constructor", "toString",
];
const NAMES = [...new Set([...Object.keys(schemas), ...CONNECTION_TOOLS.map((t) => t.name), ...EXTRA])];
// Arguments a model may send: none, null, wrong types everywhere a helper looks.
const WRONG = { path: 5, url: { href: "x" }, botId: ["atlas"], server: { id: 1 }, title: 7, kind: { code: 1 }, action: "__proto__", tool: 12, query: null, page: "2", position: {}, app: [], project: {}, name: 3 };
const VARIANTS = [undefined, "{}", "null", "[]", "5", "\"texto\"", "{no es json", JSON.stringify(WRONG)];

test("the helpers that describe a call never fail and always give text, for every tool and any arguments", async (t) => {
  const { store, runtime } = await fixture(t, async () => answer("Hecho."));
  // With MCP servers known, the detail of mcp_call looks one up (it bound `undefined` to SQLite before).
  runtime.mcp = { store };
  const mission = runtime.create({ prompt: "Hola", mode: "solo", botIds: ["vera"], conversation: true });
  await runtime.launch(mission.id);
  await settle(runtime);
  const step = store.where("steps", "missionId", mission.id).at(-1);
  for (const name of NAMES)
    for (const raw of VARIANTS) {
      let args;
      try { args = raw === undefined ? undefined : JSON.parse(raw); } catch { args = raw; }
      const what = name + " with " + String(raw);
      assert.equal(typeof verbFor(name, args), "string", what);
      assert.equal(typeof runtime.activityDetail(name, args), "string", what);
      assert.equal(typeof scopeOfCall(name, args ?? {}), "string", what);
      assert.equal(typeof appsLabel(name, args ?? {}), "string", what);
      runtime.toolActivity(step.id, { name, call_id: "a-" + name + "-" + String(raw) }, args, "running");
    }
  assert.ok(store.get("steps", step.id).activity.every((e) => typeof e.detail === "string" && typeof e.verb === "string"));
  assert.equal(store.get("bots", undefined), null, "a missing id names no record");
  assert.equal(store.get("bots", { id: "vera" }), null);
});

test("every tool × wrong arguments in a step: each call gets an error result (or its real one) and the turn never fails", async (t) => {
  const [sergio, marta] = await world(t, ["Sergio Rico", "Marta Ruiz"]);
  await friends(sergio, marta);
  const room = await sharedRoom(sergio, marta);
  rule(sergio, marta, "siempre");
  sergio.store.patch("settings", "main", { peerErrandTools: { web: true, carpetas: false, apps: false, ordenador: false } });
  sergio.runtime.mcp = { store: sergio.store };
  // index.mjs adds MCP to bots with «apps»: here it is offered to the owner's own turns.
  const ran = [];
  sergio.runtime.extraTools = () => [{ name: "mcp_call", description: "MCP", capability: "apps", parameters: { type: "object", properties: {}, additionalProperties: true }, run: async () => { ran.push("mcp_call"); return { error: "Falta el servidor." }; } }];
  const batch = (prefix) => ({
    text: "",
    output: NAMES.flatMap((name) => ["{}", "null", "[]", "{no es json", JSON.stringify(WRONG)].map((args, i) => ({ type: "function_call", name, arguments: args, call_id: prefix + "-" + i + "-" + name }))),
  });
  const turn = async (start, prefix, text) => {
    let round = 0;
    sergio.reply = () => (++round === 1 ? batch(prefix) : answer(text));
    await start();
    const step = await until(() => {
      const last = sergio.store.where("steps", "missionId", sergio.rooms.must(room.id).missionId || "").at(-1);
      return last && ["completed", "failed", "waiting"].includes(last.status) && sergio.store.where("messages", "missionId", last.missionId).some((m) => m.stepId === last.id && m.text === text) ? last : null;
    }, prefix + ": the turn answers", 30000);
    await settle(sergio.runtime);
    assert.equal(step.status, "completed", prefix + ": the turn ends");
    const outputs = sergio.runtime.history(step).filter((x) => x.type === "function_call_output");
    assert.equal(outputs.length, batch(prefix).output.length, prefix + ": every call is answered");
    return { step, outputs: new Map(outputs.map((x) => [x.call_id, String(x.output)])) };
  };
  // Another person's request: everything outside the allow-list is refused as such, mcp_call {} included.
  const theirs = await turn(() => ask(marta, room, sergio, "@Vera prueba"), "r", "Para Marta.");
  for (const [id, output] of theirs.outputs) {
    const name = id.split("-").slice(2).join("-");
    if (!["web_fetch", "ask_room", "ask_user", "create_deliverable", "create_document", "create_spreadsheet", "create_presentation", "create_image", "read_deliverable", "read_file", "use_tool", "find_tools"].includes(name))
      assert.match(output, /Herramienta no disponible/, id);
    else assert.match(output, /"error"/, id);
  }
  assert.deepEqual(ran, [], "nothing outside the list ran");
  assert.ok(!(theirs.step.activity || []).some((e) => e.tool === "mcp_call"), "a refused call leaves no activity line");
  // The owner's own turn: mcp_call is his and runs; nothing fails the turn either.
  const mine = await turn(() => sergio.rooms.send(sergio.rooms.must(room.id).id, { text: "@Vera prueba tú" }), "o", "Para Sergio.");
  for (const [id, output] of mine.outputs) assert.ok(output.length > 0, id);
  assert.ok(ran.length > 0, "his mcp_call ran");
});
