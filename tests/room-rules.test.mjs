// The rules of a turn that answers another person (server/request-turn.mjs, server/room-work.mjs,
// docs/PEOPLE.md › «Bots trabajando en salas compartidas»): real Colmenas over a local mailbox,
// each with a scripted model (tests/fixtures/people-world.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { answer, call, settle } from "./fixtures/runtime-fixture.mjs";
import { addr, ask, asks, botAnswer, card, friends, lines, pause, peerRows, rule, sharedRoom, until, world } from "./fixtures/people-world.mjs";
import { ROOM_WORK } from "../server/room-work.mjs";
import { REQUEST_ALWAYS, REQUEST_BY_CAPABILITY, requestCapability, requestToolAllowed } from "../server/request-turn.mjs";
import { canCreateImages } from "../server/images.mjs";
import { createPage } from "../server/wiki.mjs";
import { categoryOf } from "../server/connections.mjs";
import { appToolNames } from "../server/apptools.mjs";
import { computerExtraTools } from "../server/computer/wire.mjs";
import { writeSoul } from "../server/soul.mjs";
import { sharedInstructions } from "../server/peers/bots.mjs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const sorted = (list) => [...list].sort();
const signal = () => new AbortController().signal;
const many = (calls) => ({ text: "", output: calls.map(([name, args], i) => ({ type: "function_call", name, arguments: JSON.stringify(args), call_id: "c" + i + "-" + name })) });
const NONE = { web: false, carpetas: false, apps: false, ordenador: false };
/** Tools of every family, as index.mjs adds them: each says which capability it needs and notes when it runs. */
function family(p, ran, more = []) {
  const fake = (name, capability) => ({ name, description: "Herramienta " + name, capability, parameters: { type: "object", properties: {}, additionalProperties: true }, run: async () => { ran.push(name); return { ok: true }; } });
  const before = p.runtime.extraTools;
  const list = [
    ["browser_open", "ordenador"], ["browser_read", "ordenador"], ["desktop_look", "ordenador"], ["desktop_do", "ordenador"], ["open_app", "ordenador"],
    ["run_command", "ordenador"], ["open_file", "ordenador"], ["browser_sign_in", "ordenador"], ["project_files", "ordenador"], ["project_run", "ordenador"],
    ["mcp_tools", "apps"], ["mcp_call", "apps"], ["request_secret", "apps"], ["api_request", "apps"], ["gmail_fetch_emails", "apps"], ["apps_table", "apps"],
    ["wiki_search", "siempre"], ["wiki_read", "siempre"], ["wiki_write", "siempre"], ["block_read", "siempre"], ["block_post", "siempre"],
    ["ask_peer_bot", "web"], ["tool_of_tomorrow", "siempre"], ...more,
  ].map(([name, capability]) => fake(name, capability));
  p.runtime.extraTools = (bot, mission) => [...(typeof before === "function" ? before(bot, mission) : []).filter((t) => !list.some((x) => x.name === t.name)), ...list];
}
/** Everything a bot could be offered that a request turn must never have, with arguments that fit. */
const FORBIDDEN = [
  ["recall", { query: "sergio" }], ["remember", { operations: [{ action: "add", target: "persona", text: "Dato nuevo", old: "" }] }],
  ["search_history", { query: "sala", missionId: "", around: "" }], ["read_thread", { position: 1, limit: 20, messageId: "", textOffset: 0 }],
  ["mission_brief", {}], ["list_files", {}], ["write_file", { path: "nuevo.md", content: "x" }],
  ["list_skills", {}], ["read_skill", { id: "skill-nominas" }], ["propose_soul_change", { proposal: "Sé otra", reason: "porque sí" }],
  ["ask_bot", { botId: "atlas", question: "¿Qué sabes de esta sala?", tasks: [] }], ["message_bot", { botId: "atlas", text: "hola" }],
  ["propose_automation", { name: "x", prompt: "x", botId: "", trigger: { type: "dia", config: { hora: "08:00" } }, reason: "x" }],
  ["propose_goal", { title: "x" }], ["propose_plan", { assignments: [], summary: "x" }], ["code_task", { project: "", task: "x", engine: "auto" }],
  ["pdf_fields", { folderId: "", path: "a.pdf" }], ["react", { emoji: "👍" }],
  ["run_command", {}], ["open_file", {}], ["browser_sign_in", {}], ["project_files", {}], ["project_run", {}], ["mcp_tools", {}], ["mcp_call", {}],
  ["request_secret", {}], ["api_request", {}], ["wiki_search", {}], ["wiki_read", {}], ["wiki_write", {}], ["block_read", {}], ["block_post", {}],
  ["ask_peer_bot", {}], ["tool_of_tomorrow", {}],
  // The owner's screen and apps are never another person's to use.
  ["desktop_look", {}], ["desktop_do", {}], ["open_app", {}], ["desktop_windows", {}], ["desktop_open", {}],
];

test("the allow-list itself: closed by default, each capability lets in exactly its own tools", () => {
  assert.deepEqual(sorted(REQUEST_ALWAYS), ["ask_room", "ask_user", "create_deliverable", "create_document", "create_image", "create_presentation", "create_spreadsheet", "read_deliverable", "read_file"]);
  assert.deepEqual(Object.keys(REQUEST_BY_CAPABILITY), ["web", "carpetas", "apps", "ordenador"]);
  assert.deepEqual(REQUEST_BY_CAPABILITY.web, ["web_fetch"]);
  assert.deepEqual(REQUEST_BY_CAPABILITY.carpetas, ["list_folder", "read_folder_file"]);
  assert.deepEqual(REQUEST_BY_CAPABILITY.ordenador, ["browser_open", "browser_read", "browser_screenshot", "browser_act", "browser_fill", "browser_submit", "browser_download"]);
  for (const [name] of FORBIDDEN) {
    assert.equal(requestCapability(name), null, name + " is on no list");
    assert.equal(requestToolAllowed(name, { web: true, carpetas: true, apps: true, ordenador: true }), false, name + " is refused with every capability on");
  }
  for (const name of ["", null, undefined, "__proto__", "constructor", "toString"]) assert.equal(requestToolAllowed(name, { web: true, carpetas: true, apps: true, ordenador: true }), false);
  assert.equal(requestToolAllowed("web_fetch", NONE), false);
  assert.equal(requestToolAllowed("gmail_send_email", { ...NONE, apps: true }), true, "a direct tool of a connected app follows «apps»");
  assert.equal(requestToolAllowed("gmail_send_email", { ...NONE, web: true, carpetas: true, ordenador: true }), false);
  assert.equal(requestToolAllowed("browser_open", { ...NONE, apps: "yes" }), false, "only a real true counts");
  // An app tool is one of the registry, not anything whose name starts like one.
  for (const name of ["gmail_read_everything", "slack_export_workspace", "notion_", "outlook_x", "googledrive_delete_all", "apps_executes", "GMAIL_SEND_EMAIL"])
    assert.equal(requestToolAllowed(name, { web: true, carpetas: true, apps: true, ordenador: true }), false, name + " is no real app tool");
  for (const name of appToolNames()) assert.equal(requestToolAllowed(name, { ...NONE, apps: true }), true, name);
});

test("a request turn is offered exactly the allow-list for each capability, and anything else refuses, called directly or through use_tool", async (t) => {
  const [sergio, marta] = await world(t, ["Sergio Rico", "Marta Ruiz"], { app: ["Sergio Rico"] });
  await friends(sergio, marta);
  const room = await sharedRoom(sergio, marta);
  rule(sergio, marta, "siempre");
  const ran = [];
  family(sergio, ran);
  const vera = sergio.store.get("bots", "vera");
  const always = sorted(REQUEST_ALWAYS.filter((n) => n !== "create_image" || canCreateImages(vera)));
  const expected = {
    none: always,
    web: sorted([...always, "web_fetch"]),
    carpetas: sorted([...always, "list_folder", "read_folder_file"]),
    apps: sorted([...always, "apps_accounts", "apps_describe", "apps_execute", "apps_search", "apps_table", "gmail_fetch_emails"]),
    ordenador: sorted([...always, "browser_open", "browser_read"]),
  };
  const steps = {};
  for (const [i, key] of Object.keys(expected).entries()) {
    sergio.store.patch("settings", "main", { peerErrandTools: { ...NONE, ...(key === "none" ? {} : { [key]: true }) } });
    sergio.reply = () => answer("Hecho " + key + ".");
    await ask(marta, room, sergio, "@Vera petición " + i);
    await botAnswer(marta, room, "Hecho " + key + ".");
    await settle(sergio.runtime);
    const turn = sergio.calls.at(-1);
    assert.deepEqual(sorted(turn.tools.map((x) => x.name)), expected[key], "what the model is offered with «" + key + "»");
    assert.equal(!!turn.webSearch, key === "web" && !!turn.webSearch, "hosted web search only with «web»");
    steps[key] = sergio.store.where("steps", "missionId", room.missionId).at(-1);
    assert.ok(steps[key].roomAsk && steps[key].capabilities);
  }
  // Called all the same: every tool outside the list refuses and does nothing, with any capability set.
  const mission = sergio.store.get("missions", room.missionId);
  const memories = sergio.store.list("memories").length, files = sergio.store.list("artifacts").length;
  for (const key of ["none", "apps", "ordenador"]) {
    const step = sergio.runtime.liveStep(steps[key].id);
    for (const [name, args] of FORBIDDEN) {
      const direct = await sergio.runtime.tool(mission, step, { type: "function_call", name, arguments: JSON.stringify(args), call_id: "d-" + key + "-" + name }, signal());
      assert.match(String(direct?.error), /Herramienta no disponible/, name + " called directly with «" + key + "»");
      const wrapped = await sergio.runtime.tool(mission, step, { type: "function_call", name: "use_tool", arguments: JSON.stringify({ name, arguments: args }), call_id: "u-" + key + "-" + name }, signal());
      assert.ok(wrapped?.error, name + " through use_tool with «" + key + "»");
      const found = await sergio.runtime.tool(mission, step, { type: "function_call", name: "find_tools", arguments: JSON.stringify({ query: name }), call_id: "f-" + key + "-" + name }, signal());
      assert.ok(found?.error || !(found.tools || []).some((x) => x.name === name), name + " is not found either");
    }
  }
  // A tool of a capability that is off refuses too.
  for (const [name, args] of [["web_fetch", { url: "https://ejemplo.example/" }], ["list_folder", { folderId: "", path: "" }], ["browser_open", {}], ["gmail_fetch_emails", {}], ["apps_search", { query: "correo" }]])
    assert.match(String((await sergio.runtime.tool(mission, sergio.runtime.liveStep(steps.none.id), { type: "function_call", name, arguments: JSON.stringify(args), call_id: "n-" + name }, signal()))?.error), /Herramienta no disponible/, name);
  assert.deepEqual(ran, [], "none of them ran");
  assert.deepEqual([sergio.store.list("memories").length, sergio.store.list("artifacts").length, sergio.store.list("suggestions").length], [memories, files, 0]);
  // With enough tools for «tools on demand» the search and use_tool read the same list.
  family(sergio, ran, appToolNames().filter((n) => n !== "apps_execute" && n !== "gmail_fetch_emails").map((n) => [n, "apps"]));
  sergio.store.patch("settings", "main", { peerErrandTools: { ...NONE, apps: true } });
  sergio.reply = () => answer("Con muchas.");
  await ask(marta, room, sergio, "@Vera una más");
  await botAnswer(marta, room, "Con muchas.");
  await settle(sergio.runtime);
  const big = sergio.runtime.liveStep(sergio.store.where("steps", "missionId", room.missionId).at(-1).id);
  assert.ok(sergio.calls.at(-1).tools.some((x) => x.name === "use_tool"), "tools on demand is on in this turn");
  for (const [name, args] of FORBIDDEN) {
    const wrapped = await sergio.runtime.tool(mission, big, { type: "function_call", name: "use_tool", arguments: JSON.stringify({ name, arguments: args }), call_id: "b-" + name }, signal());
    assert.match(String(wrapped?.error), /no es una de tus herramientas/, name);
    const found = await sergio.runtime.tool(mission, big, { type: "function_call", name: "find_tools", arguments: JSON.stringify({ query: name.replace(/_/g, " ") }), call_id: "bf-" + name }, signal());
    assert.ok(!(found.tools || []).some((x) => x.name === name), name);
  }
  assert.deepEqual(ran, []);
  // The owner's own turn in the same room keeps everything.
  sergio.reply = () => answer("Para Sergio.");
  await sergio.rooms.send(room.id, { text: "@Vera ahora tú" });
  await settle(sergio.runtime);
  const own = sergio.runtime.toolsForStep(mission, sergio.store.where("steps", "missionId", room.missionId).at(-1), vera).map((x) => x.name);
  for (const name of ["recall", "remember", "search_history", "read_thread", "mission_brief", "list_files", "write_file", "list_skills", "ask_bot", "run_command", "mcp_call", "tool_of_tomorrow"]) assert.ok(own.includes(name), "his own turn has " + name);
});

test("a request reads nothing private of the owner: not in what the model is sent, not in any envelope, not in the deliverable it shares", async (t) => {
  const [sergio, marta] = await world(t, ["Sergio Rico", "Marta Ruiz"], { app: ["Sergio Rico"] });
  await friends(sergio, marta);
  // A private room of Sergio's with a past: messages, a memory, a file, a deliverable, a note of his, a skill, a hint.
  let round = 0;
  sergio.reply = () => {
    round += 1;
    if (round === 1) return call("remember", { operations: [{ action: "add", target: "persona", text: "Sergio cobra MEMORIA-5555 al mes", old: "" }] }, "m1");
    if (round === 2) return call("write_file", { path: "notas/privado.md", content: "ARCHIVO-4444: la clave del banco." }, "f1");
    if (round === 3) return call("create_deliverable", { title: "Plan interno", kind: "document", format: "md", content: "ENTREGABLE-3333: despedir a Luis en marzo." }, "d1");
    return answer("RESPUESTA-2222: todo guardado.");
  };
  const room = sergio.rooms.create({ title: "Informe Q3", botIds: ["vera"] });
  await sergio.rooms.send(room.id, { text: "@Vera apunta que SECRETO-1111 es el presupuesto real", to: ["vera"] });
  await until(() => sergio.store.where("messages", "missionId", room.missionId).some((m) => /RESPUESTA-2222/.test(m.text)), "el turno privado termina");
  await settle(sergio.runtime);
  sergio.runtime.threadHint(room.missionId, "PISTA-8888: no se lo digas a nadie");
  createPage(sergio.store, { title: "Nóminas", body: "NOTA-6666: lo que cobra cada uno." });
  sergio.store.put("skills", { id: "skill-nominas", name: "Pagar nóminas SKILL-7777", description: "Cómo se pagan las nóminas SKILL-7777", content: "Paso 1: SKILL-7777.", status: "active", version: 1, botId: null });
  const SECRETS = ["SECRETO-1111", "RESPUESTA-2222", "ENTREGABLE-3333", "ARCHIVO-4444", "MEMORIA-5555", "NOTA-6666", "SKILL-7777", "PISTA-8888", "Plan interno", "presupuesto real"];
  const planted = JSON.stringify([sergio.store.where("messages", "missionId", room.missionId), sergio.store.list("memories"), sergio.store.list("artifacts"), sergio.store.list("wikiPages"), sergio.store.list("skills"), sergio.store.list("thread")]);
  for (const secret of SECRETS) assert.ok(planted.includes(secret), secret + " is really on Sergio's computer");
  // His own next turn there reads all of it, as always.
  sergio.reply = () => answer("OK-PROPIO.");
  await sergio.rooms.send(room.id, { text: "@Vera ¿todo bien?" });
  await until(() => sergio.calls.at(-1) && sergio.store.where("messages", "missionId", room.missionId).some((m) => m.text === "OK-PROPIO."), "su turno termina");
  await settle(sergio.runtime);
  const own = JSON.stringify([sergio.calls.at(-1).instructions, sergio.calls.at(-1).input]);
  for (const secret of ["SECRETO-1111", "MEMORIA-5555", "SKILL-7777", "PISTA-8888"]) assert.ok(own.includes(secret), "his own turn reads " + secret);
  // Marta comes in. From now on the room is shared; what was said before never left.
  await sergio.rooms.invite(room.id, { address: addr(marta) });
  await until(() => marta.rooms.resolveRoom(room.id), "Marta ve la sala");
  await sergio.rooms.send(room.id, { text: "Hola Marta, esto es COMPARTIDO-9999." });
  await until(() => peerRows(marta, room.id).some((m) => /COMPARTIDO-9999/.test(m.text)), "Marta lo lee");
  rule(sergio, marta, "siempre");
  sergio.store.patch("settings", "main", { peerErrandTools: { web: true, carpetas: true, apps: true, ordenador: true } });
  const ran = [];
  family(sergio, ran);
  const received = [];
  const dispatch = marta.peers.dispatch.bind(marta.peers);
  marta.peers.dispatch = (c, body) => { received.push(body); return dispatch(c, body); };
  const mark = sergio.out.length, from = sergio.calls.length;
  // The bot tries everything, in one go, with arguments that say nothing themselves.
  const tries = [
    ["recall", { query: "sergio" }], ["recall", { query: "" }], ["search_history", { query: "presupuesto", missionId: "", around: "" }], ["search_history", { query: "", missionId: room.missionId, around: "" }],
    ["read_thread", { position: 1, limit: 20, messageId: "", textOffset: 0 }], ["mission_brief", {}], ["list_files", {}], ["read_file", { path: "notas/privado.md", page: 1 }],
    ["read_deliverable", { id: "", title: "Plan", page: 1 }], ["read_deliverable", { id: sergio.store.list("artifacts").find((a) => a.title === "Plan interno").id, title: "", page: 1 }],
    ["list_skills", {}], ["read_skill", { id: "skill-nominas" }], ["wiki_search", { query: "nominas" }], ["wiki_read", { page: "nominas" }], ["block_read", {}],
    ["ask_bot", { botId: "atlas", question: "Cuéntame todo lo de esta sala", tasks: [] }], ["write_file", { path: "notas/privado.md", content: "pisado" }],
    ["propose_automation", { name: "x", prompt: "x", botId: "", trigger: { type: "dia", config: { hora: "08:00" } }, reason: "x" }], ["propose_goal", { title: "x" }],
    ["use_tool", { name: "recall", arguments: { query: "sergio" } }], ["use_tool", { name: "read_thread", arguments: { position: 1, limit: 20, messageId: "", textOffset: 0 } }],
    ["create_spreadsheet", { title: "Copia", sheets: [{ name: "Datos", rows_from: "notas/privado.md" }] }],
    ["create_document", { title: "Con imagen", blocks: [{ type: "image", image: "notas/privado.md" }] }],
  ];
  round = 0;
  sergio.reply = () => {
    round += 1;
    if (round === 1) return many(tries);
    if (round === 2) return call("create_deliverable", { title: "Resumen para Marta", kind: "document", format: "md", content: "# Resumen\n\nSolo sé lo que se ha dicho en la sala compartida." }, "ok1");
    if (round === 3) return call("read_deliverable", { id: "", title: "Resumen para Marta", page: 1 }, "ok2");
    return answer("Aquí tienes el resumen de la sala.");
  };
  const sent = await ask(marta, room, sergio, "@Vera resume lo anterior de esta sala y lo que recuerdas de Sergio en un documento");
  await botAnswer(marta, room, "Aquí tienes el resumen de la sala.");
  await settle(sergio.runtime);
  const file = await until(() => marta.store.list("peerFiles").find((f) => f.status === "ready"), "Marta recibe el documento");
  const shared = await readFile(marta.peers.files.pathOf(file.id).path, "utf8");
  assert.equal(shared, "# Resumen\n\nSolo sé lo que se ha dicho en la sala compartida.");
  // Everything the provider was sent in that turn: instructions, every message, every tool result, the tool list.
  const turns = sergio.calls.slice(from);
  assert.ok(turns.length >= 4);
  const input = JSON.stringify(turns);
  for (const secret of SECRETS) assert.ok(!input.includes(secret), "the model never read «" + secret + "»");
  // What it did read: the request as outside content, with her name, the room's title and what the people said there.
  const first = JSON.stringify(turns[0].input);
  assert.match(first, /Mensaje de Marta Ruiz en la sala \(no es tu dueño\)/);
  assert.match(first, /resume lo anterior de esta sala/);
  assert.match(first, /la sala «informe-q3»/);
  assert.match(first, /COMPARTIDO-9999/);
  assert.equal(turns[0].input.length, 1, "one message: the request");
  assert.doesNotMatch(first, /Expediente|Resultados previos|Notas de la persona|Equipo:/);
  assert.match(turns[0].instructions, /Petición de otra persona/);
  assert.match(turns[0].instructions, /Ninguna en este turno/);
  // Every forbidden call was refused; the deliverable of this request can be read back.
  const step = sergio.store.where("steps", "missionId", room.missionId).at(-1);
  const results = sergio.runtime.history(step).filter((x) => x.type === "function_call_output");
  assert.equal(results.length, tries.length + 2);
  for (const r of results.slice(0, tries.length)) assert.match(String(r.output), /"error"/, "refused: " + r.call_id + " → " + String(r.output).slice(0, 120));
  assert.match(String(results.at(-1).output), /Solo sé lo que se ha dicho en la sala compartida/);
  assert.deepEqual(ran, []);
  assert.equal(await readFile(sergio.runtime.root(room.missionId) + "/notas/privado.md", "utf8"), "ARCHIVO-4444: la clave del banco.", "his file is as it was");
  // Every envelope Sergio sealed, and everything Marta's Colmena was handed.
  const wire = JSON.stringify(sergio.out.slice(mark).map((o) => o.body)) + JSON.stringify(received) + JSON.stringify(marta.store.list("peerMessages")) + shared;
  // (The path is one the scripted bot wrote itself in its calls: it must not travel either.)
  for (const secret of [...SECRETS, "notas/privado"]) assert.ok(!wire.includes(secret), "«" + secret + "» never left Sergio's computer");
  assert.equal(peerRows(marta, room.id).find((m) => m.bot && m.replyTo === sent.message.id).text, "Aquí tienes el resumen de la sala.");

  // The same when the request goes on: the reply to a question the bot asked her in the room…
  round = 0;
  sergio.reply = () => {
    round += 1;
    if (round === 1) return call("ask_room", { question: "¿De qué mes lo quieres?" }, "r1");
    if (round === 2) return answer("Le he preguntado.");
    if (round === 3) return many([["recall", { query: "sergio" }], ["mission_brief", {}], ["read_file", { path: "notas/privado.md", page: 1 }]]);
    return answer("De marzo, entonces.");
  };
  const more = sergio.calls.length;
  await ask(marta, room, sergio, "@Vera dame los datos");
  await botAnswer(marta, room, "¿De qué mes lo quieres?");
  await settle(sergio.runtime);
  await marta.rooms.send(room.id, { text: "De marzo" });
  await botAnswer(marta, room, "De marzo, entonces.");
  await settle(sergio.runtime);
  const followed = sergio.calls.slice(more);
  for (const secret of SECRETS) assert.ok(!JSON.stringify(followed).includes(secret), "nor in the turn of her reply: «" + secret + "»");
  assert.match(JSON.stringify(followed.at(-1).input), /Marta contesta a lo que le preguntaste en la sala/);
  const last = sergio.store.where("steps", "missionId", room.missionId).at(-1);
  for (const r of sergio.runtime.history(last).filter((x) => x.type === "function_call_output")) assert.match(String(r.output), /"error"/);
  assert.deepEqual(sorted(followed.at(-1).tools.map((x) => x.name)), sorted(turns[0].tools.map((x) => x.name)), "the same tools as the request");

  // …and when the owner answers late a question the bot asked him (ask_user) in that turn.
  round = 0;
  sergio.reply = ({ input }) => {
    round += 1;
    if (round === 1) return call("ask_user", { question: "¿Le doy el dato a Marta?", options: ["Sí", "No"] }, "q1");
    return answer(/Sí, dáselo/.test(JSON.stringify(input)) ? "Dato dado." : "Sigo sin el dato.");
  };
  const late = sergio.calls.length;
  await ask(marta, room, sergio, "@Vera ¿y el dato?");
  const question = await until(() => sergio.store.list("approvals").find((a) => a.tool === "ask_user" && a.status === "pending"), "la pregunta de Vera");
  sergio.store.patch("approvals", question.id, { timedOut: true });
  sergio.runtime.answer(question.id, { text: "Sí, dáselo" });
  await botAnswer(marta, room, "Dato dado.");
  await settle(sergio.runtime);
  for (const secret of SECRETS) assert.ok(!JSON.stringify(sergio.calls.slice(late)).includes(secret), "nor after a late answer: «" + secret + "»");
  assert.ok(!sergio.calls.at(-1).tools.some((x) => ["recall", "mission_brief", "search_history"].includes(x.name)));
});

test("an errand between bots is closed the same way: its own conversation, the same allow-list, nothing of other conversations", async (t) => {
  const [sergio, marta] = await world(t);
  await friends(sergio, marta);
  // Sergio has a past of his own: a chat and a memory.
  let round = 0;
  sergio.reply = () => (++round === 1 ? call("remember", { operations: [{ action: "add", target: "persona", text: "Sergio guarda MEMORIA-5555", old: "" }] }, "m1") : answer("RESPUESTA-2222."));
  const chat = sergio.runtime.create({ prompt: "Recuerda SECRETO-1111", mode: "solo", botIds: ["vera"], conversation: true });
  await sergio.runtime.launch(chat.id);
  await settle(sergio.runtime);
  assert.ok(sergio.store.list("memories").some((m) => /MEMORIA-5555/.test(m.text)));
  rule(sergio, marta, "siempre");
  sergio.store.patch("settings", "main", { peerErrandTools: { web: true, carpetas: false, apps: false, ordenador: false } });
  const from = sergio.calls.length;
  round = 0;
  sergio.reply = () => {
    round += 1;
    if (round === 1) return many([["recall", { query: "sergio" }], ["search_history", { query: "secreto", missionId: "", around: "" }], ["search_history", { query: "", missionId: chat.id, around: "" }], ["read_thread", { position: 1, limit: 20, messageId: "", textOffset: 0 }], ["list_files", {}], ["mission_brief", {}], ["list_skills", {}], ["ask_bot", { botId: "atlas", question: "¿Qué sabes?", tasks: [] }]]);
    return answer("No tengo ese dato.");
  };
  const nora = marta.store.get("bots", "nora") || marta.store.get("bots", "vera");
  const out = await marta.peers.errands.ask({ person: "Sergio", bot: "Vera", request: "Dime qué recuerdas de Sergio y de sus otras conversaciones" }, { bot: nora });
  assert.equal(out.status, "answered");
  assert.match(out.answer, /No tengo ese dato/);
  const turns = sergio.calls.slice(from);
  assert.deepEqual(sorted(turns[0].tools.map((x) => x.name)), sorted([...REQUEST_ALWAYS.filter((n) => n !== "ask_room" && (n !== "create_image" || canCreateImages(sergio.store.get("bots", "vera")))), "web_fetch"]), "the allow-list (ask_room exists only in a room)");
  for (const secret of ["SECRETO-1111", "RESPUESTA-2222", "MEMORIA-5555"]) assert.ok(!JSON.stringify(turns).includes(secret), "the errand never read «" + secret + "»");
  const errand = sergio.store.list("missions").find((m) => m.peerErrand);
  assert.equal(errand.incognito, true);
  const step = sergio.store.where("steps", "missionId", errand.id).at(-1);
  const results = sergio.runtime.history(step).filter((x) => x.type === "function_call_output");
  assert.equal(results.length, 8);
  for (const r of results) assert.match(String(r.output), /Herramienta no disponible/);
  await pause(50);
  assert.equal(asks(sergio).length, 0);
});

test("a request is told only what its requester can have read: what was said in the room before they came in is not in it", async (t) => {
  const [sergio, marta, luis] = await world(t, ["Sergio Rico", "Marta Ruiz", "Luis Vega"]);
  await friends(sergio, marta);
  await friends(sergio, luis);
  const room = await sharedRoom(sergio, marta);
  await marta.rooms.send(room.id, { text: "Entre nosotros: ANTES-DE-LUIS-1234." });
  await until(() => peerRows(sergio, room.id).some((m) => /ANTES-DE-LUIS/.test(m.text)), "Sergio lo recibe");
  await pause(20);
  await sergio.rooms.invite(room.id, { address: addr(luis) });
  await until(() => luis.rooms.resolveRoom(room.id), "Luis ve la sala");
  await pause(20);
  await marta.rooms.send(room.id, { text: "Bienvenido Luis: DESPUES-5678." });
  await until(() => peerRows(sergio, room.id).some((m) => /DESPUES-5678/.test(m.text)) && peerRows(luis, room.id).some((m) => /DESPUES-5678/.test(m.text)), "todos lo reciben");
  assert.ok(!peerRows(luis, room.id).some((m) => /ANTES-DE-LUIS/.test(m.text)), "Luis never got what was said before him");
  rule(sergio, luis, "siempre");
  rule(sergio, marta, "siempre");
  sergio.reply = () => answer("Para Luis.");
  await ask(luis, room, sergio, "@Vera resume lo que se ha dicho aquí");
  await botAnswer(luis, room, "Para Luis.");
  await settle(sergio.runtime);
  const his = JSON.stringify(sergio.calls.at(-1).input);
  assert.match(his, /DESPUES-5678/);
  assert.doesNotMatch(his, /ANTES-DE-LUIS/);
  // Marta was there: her request is told both.
  sergio.reply = () => answer("Para Marta.");
  await ask(marta, room, sergio, "@Vera resume lo que se ha dicho aquí");
  await botAnswer(marta, room, "Para Marta.");
  await settle(sergio.runtime);
  const hers = JSON.stringify(sergio.calls.at(-1).input);
  assert.match(hers, /DESPUES-5678/);
  assert.match(hers, /ANTES-DE-LUIS-1234/);
});

test("in a request turn every change in an app asks the owner: no standing rule, no «may write», no «this mission made it»; reads follow «apps»", async (t) => {
  const [sergio, marta] = await world(t);
  await friends(sergio, marta);
  const room = await sharedRoom(sergio, marta);
  rule(sergio, marta, "siempre");
  sergio.store.patch("settings", "main", { peerErrandTools: { web: false, carpetas: false, apps: true, ordenador: false } });
  sergio.store.put("connectionGrants", { id: "grant-read", active: true });
  // «Qué app usa cada bot»: Vera may write in Sergio's mail.
  sergio.store.patch("bots", "vera", { tools: { ...(sergio.store.get("bots", "vera").tools || {}), [categoryOf({ toolkit: "gmail", tool: "GMAIL_CREATE_EMAIL_DRAFT" })]: "escribe" } });
  const app = (tool, args, id) => ({ type: "function_call", name: "apps_execute", arguments: JSON.stringify({ tool, account: "acc", arguments_json: JSON.stringify(args) }), call_id: id });
  // Sergio's own turn in the room: his bot may write in his mail, so a draft is made without asking.
  // (Each turn is held half-way, so the calls below are made while it runs.)
  const held = async (start, text) => {
    let release = null;
    // (Let go by itself after a while: a failed assertion must not leave the turn open.)
    sergio.reply = () => new Promise((r) => { release = () => r(answer(text)); setTimeout(release, 15000).unref(); });
    await start();
    await until(() => release, "el turno está en marcha");
    return { step: sergio.runtime.liveStep(sergio.store.where("steps", "missionId", sergio.rooms.must(room.id).missionId).at(-1).id), end: async () => { release(); await botAnswer(marta, room, text); await settle(sergio.runtime); } };
  };
  const mine = await held(() => sergio.rooms.send(room.id, { text: "@Vera prepara un borrador" }), "Para Sergio.");
  const mission = sergio.store.get("missions", room.missionId), own = mine.step;
  const made = await sergio.runtime.tool(mission, own, app("GMAIL_CREATE_EMAIL_DRAFT", { recipient_email: "ana@lumbre.es", subject: "Hola", body: "Borrador." }, "own-draft"), signal());
  assert.equal(made.ok, true, JSON.stringify(made));
  assert.deepEqual(sergio.effects, ["p-GMAIL_CREATE_EMAIL_DRAFT"]);
  // …and undoing what this very mission made runs without asking, in a turn of his.
  const undone = await sergio.runtime.tool(mission, own, app("GMAIL_DELETE_DRAFT", { draft_id: "done" }, "own-delete"), signal());
  assert.equal(undone.ok, true);
  assert.equal(sergio.store.get("approvals", own.id + ":own-delete").decidedBy, "colmena");
  // A standing rule for that change, too.
  sergio.store.put("connectionGrants", { id: "write:vera:acc:GMAIL_CREATE_EMAIL_DRAFT", active: true });
  await mine.end();
  sergio.effects.length = 0;
  // Marta's request, under «Siempre».
  const hers = await held(() => ask(marta, room, sergio, "@Vera prepara otro borrador y borra el de antes"), "Para Marta.");
  const theirs = hers.step;
  assert.ok(theirs.roomAsk);
  // A read runs: Sergio allows apps for other people's requests and reading his mail never asked.
  const read = await sergio.runtime.tool(mission, theirs, app("GMAIL_FETCH_EMAILS", { query: "informe" }, "their-read"), signal());
  assert.equal(read.ok, true);
  assert.deepEqual(sergio.effects, ["p-GMAIL_FETCH_EMAILS"]);
  // A draft (he may write, and has a standing rule), a delete of what the mission made, a send: each waits for him.
  for (const [id, tool, args, kind] of [
    ["their-draft", "GMAIL_CREATE_EMAIL_DRAFT", { recipient_email: "ana@lumbre.es", subject: "Hola", body: "Otro." }, "write"],
    ["their-delete", "GMAIL_DELETE_DRAFT", { draft_id: "done" }, "write"],
    ["their-send", "GMAIL_SEND_EMAIL", { recipient_email: "ana@lumbre.es", subject: "Hola", body: "Va." }, "send"],
  ]) {
    assert.deepEqual(await sergio.runtime.tool(mission, theirs, app(tool, args, id), signal()), { waiting: true }, tool);
    const a = sergio.store.get("approvals", theirs.id + ":" + id);
    assert.deepEqual([a.status, a.kind, a.decidedBy ?? null, a.autoSendAt ?? null], ["pending", kind, null, null], tool);
  }
  assert.deepEqual(sergio.effects, ["p-GMAIL_FETCH_EMAILS"], "nothing changed in Sergio's mail");
  // His OK is what makes it happen.
  const approval = sergio.store.get("approvals", theirs.id + ":their-draft");
  assert.equal(approval.missionId, room.missionId);
  for (const id of ["their-draft", "their-delete", "their-send"]) await sergio.connections.decide(theirs.id + ":" + id, { decision: "denied" });
  await hers.end();
  // With «apps» off for other people's requests not even a read is offered.
  sergio.store.patch("settings", "main", { peerErrandTools: { web: true, carpetas: false, apps: false, ordenador: false } });
  const closed = await held(() => ask(marta, room, sergio, "@Vera lee mi correo"), "Sin apps.");
  assert.match(String((await sergio.runtime.tool(mission, closed.step, app("GMAIL_FETCH_EMAILS", { query: "x" }, "closed-read"), signal())).error), /Herramienta no disponible/);
  await closed.end();
  assert.deepEqual(sergio.effects, ["p-GMAIL_FETCH_EMAILS"]);
});

/** `who` asks and `owner`'s Colmena has had the message and done whatever it does with it. */
async function asked(who, room, owner, text) {
  const sent = await ask(who, room, owner, text);
  await until(() => peerRows(owner, room.id).some((m) => m.id === sent.message.id), owner.name + " recibe «" + text + "»");
  await owner.bots.idle();
  await settle(owner.runtime);
  return sent;
}

test("request limits: per person over all rooms, per day, for everybody, and cards waiting; kept across a restart", async (t) => {
  const people = await world(t);
  let [sergio] = people;
  const marta = people[1];
  await friends(sergio, marta);
  assert.deepEqual([ROOM_WORK.perHour, ROOM_WORK.personHour, ROOM_WORK.personDay, ROOM_WORK.allHour, ROOM_WORK.open, ROOM_WORK.questions, ROOM_WORK.replies], [6, 12, 40, 30, 5, 3, 3]);
  const a = await sharedRoom(sergio, marta, "Ventas"), b = await sharedRoom(sergio, marta, "Compras"), c = await sharedRoom(sergio, marta, "Legal");
  rule(sergio, marta, "siempre");
  sergio.reply = () => answer("Hecho.");
  // Six in one room, six in another: twelve in the hour. The thirteenth, in a third room, is not taken.
  for (const room of [a, b]) for (let i = 1; i <= 6; i++) await asked(marta, room, sergio, "@Vera petición " + i);
  assert.deepEqual([asks(sergio).length, sergio.calls.length], [12, 12]);
  assert.equal(sergio.rooms.work.overLimit(sergio.store.get("peerShares", c.id), addr(marta)), "person");
  await asked(marta, c, sergio, "@Vera una más en otra sala");
  assert.deepEqual([asks(sergio).length, sergio.calls.length], [12, 12], "over the hourly limit of one person");
  await until(() => lines(marta, c).includes("Vera no atiende más peticiones por ahora"), "Marta lee el límite");
  // Colmena is closed and opened again: the count is still there.
  sergio = await people.reopen(sergio);
  await until(() => marta.peers.online(addr(sergio)) || sergio.peers.relayStatus.status === "online", "Sergio vuelve");
  sergio.reply = () => answer("Hecho.");
  await asked(marta, c, sergio, "@Vera ¿y después de reiniciar?");
  assert.deepEqual([asks(sergio).length, sergio.calls.length], [12, 0], "a restart does not give the hour back");
  // An hour later she may ask again…
  sergio.skew = 3600000 + 1000;
  await asked(marta, c, sergio, "@Vera una hora después");
  assert.deepEqual([asks(sergio).length, sergio.calls.length], [13, 1]);
  // …until the day's limit: forty in twenty-four hours, over all rooms.
  const at = new Date().toISOString(), clock = sergio.peers.clock();
  for (let i = 0; i < 27; i++) sergio.store.put("roomAsks", { id: "old-" + i, roomId: a.id, shareId: i % 2 ? a.id : b.id, from: addr(marta), fromName: "Marta Ruiz", botId: "vera", peerId: "peer-old-" + i, text: "antes", rule: "siempre", state: "done", at, t: clock - 5 * 3600000 });
  assert.equal(sergio.rooms.work.overLimit(sergio.store.get("peerShares", c.id), addr(marta)), "person");
  await asked(marta, c, sergio, "@Vera la cuarenta y uno");
  assert.deepEqual([asks(sergio).length, sergio.calls.length], [40, 1], "over the daily limit of one person");
  // Everybody together: thirty an hour, whoever asks.
  sergio.skew += 25 * 3600000;
  assert.equal(sergio.rooms.work.overLimit(sergio.store.get("peerShares", c.id), addr(marta)), null);
  const now2 = sergio.peers.clock();
  for (let i = 0; i < 30; i++) sergio.store.put("roomAsks", { id: "all-" + i, roomId: "otra", shareId: "otra-" + (i % 7), from: "A".repeat(42) + (i % 6), fromName: "Otra persona", botId: "vera", peerId: "peer-all-" + i, text: "de otros", rule: "siempre", state: "done", at, t: now2 - 60000 });
  assert.equal(sergio.rooms.work.overLimit(sergio.store.get("peerShares", c.id), addr(marta)), "all");
  await asked(marta, c, sergio, "@Vera cuando ya hay treinta");
  assert.deepEqual([asks(sergio).length, sergio.calls.length], [70, 1], "over the hourly limit of everybody");
});

test("request limits: at most five cards of one person wait for the owner, and a reply to ask_room starts a few turns at most", async (t) => {
  const [sergio, marta] = await world(t);
  await friends(sergio, marta);
  const a = await sharedRoom(sergio, marta, "Ventas"), b = await sharedRoom(sergio, marta, "Compras");
  // «Pregúntame»: five cards wait (three in one room, two in another); the sixth is not taken.
  for (const [room, n] of [[a, 3], [b, 2]]) for (let i = 1; i <= n; i++) await asked(marta, room, sergio, "@Vera petición " + i);
  assert.equal(sergio.store.list("approvals").filter((x) => x.roomRequest && x.status === "pending").length, 5);
  await asked(marta, b, sergio, "@Vera la sexta");
  assert.deepEqual([asks(sergio).length, sergio.store.list("approvals").filter((x) => x.roomRequest && x.status === "pending").length, sergio.calls.length], [5, 5, 0]);
  // Once he answers some, she may ask again.
  for (const x of sergio.store.list("approvals").filter((y) => y.roomRequest && y.status === "pending").slice(0, 2)) sergio.runtime.answer(x.id, { optionId: "later" });
  await until(() => asks(sergio).filter((x) => x.state === "asked").length === 3, "dos decididas");
  await asked(marta, b, sergio, "@Vera ahora sí");
  assert.equal(asks(sergio).length, 6);
  // A request that already had its answers to ask_room: one more message of hers starts nothing.
  rule(sergio, marta, "siempre");
  let round = 0;
  sergio.reply = () => (++round === 1 ? call("ask_room", { question: "¿De qué mes?" }, "r1") : answer("Vale."));
  const before = asks(sergio).length;
  await asked(marta, a, sergio, "@Vera dame las ventas");
  await botAnswer(marta, a, "¿De qué mes?");
  await settle(sergio.runtime);
  const request = asks(sergio).at(-1);
  assert.ok(request.question);
  sergio.store.patch("roomAsks", request.id, { replies: ROOM_WORK.replies });
  const calls = sergio.calls.length;
  await marta.rooms.send(a.id, { text: "De marzo" });
  await until(() => peerRows(sergio, a.id).some((m) => m.text === "De marzo"), "Sergio lo recibe");
  await sergio.bots.idle();
  await settle(sergio.runtime);
  assert.deepEqual([sergio.calls.length, asks(sergio).length, sergio.store.get("roomAsks", request.id).question], [calls, before + 1, null]);
});

test("a room somebody else made, where you have done nothing yet: a request there asks you even with «Siempre»", async (t) => {
  const [sergio, marta] = await world(t);
  await friends(sergio, marta);
  rule(sergio, marta, "siempre");
  // Marta makes a room with Sergio in it. Nobody accepts a room: he is simply there.
  const room = marta.rooms.create({ title: "Idea de Marta", people: [addr(sergio)] });
  await until(() => sergio.rooms.resolveRoom(room.id), "Sergio ve la sala");
  const share = () => sergio.store.get("peerShares", room.id);
  assert.equal(sergio.rooms.work.takesPart(share()), false);
  sergio.reply = () => answer("Hecho en la sala de Marta.");
  await asked(marta, room, sergio, "@Vera busca esto");
  const first = await until(() => card(sergio), "la tarjeta de Sergio");
  assert.deepEqual([sergio.calls.length, asks(sergio)[0].rule, asks(sergio)[0].held, first.status], [0, "pregunta", true, "pending"]);
  assert.equal(sergio.peers.contact(addr(marta)).asks.encargos, "siempre", "his rule for her is untouched");
  // He says yes by hand: from then on he takes part in that room, and his rule applies there.
  sergio.runtime.answer(first.id, { optionId: "go" });
  await botAnswer(marta, room, "Hecho en la sala de Marta.");
  await settle(sergio.runtime);
  assert.equal(sergio.rooms.work.takesPart(share()), true);
  sergio.reply = () => answer("Otra vez.");
  await asked(marta, room, sergio, "@Vera otra");
  await botAnswer(marta, room, "Otra vez.");
  assert.equal(card(sergio), undefined);
  // Writing in a room is taking part in it too.
  const other = marta.rooms.create({ title: "Otra de Marta", people: [addr(sergio)] });
  await until(() => sergio.rooms.resolveRoom(other.id), "Sergio ve la otra sala");
  await sergio.rooms.send(other.id, { text: "Aquí estoy." });
  assert.equal(sergio.rooms.work.takesPart(sergio.store.get("peerShares", other.id)), true);
  sergio.reply = () => answer("En la otra.");
  await asked(marta, other, sergio, "@Vera aquí también");
  await botAnswer(marta, other, "En la otra.");
  assert.equal(card(sergio), undefined);
  // In a room of his own it never asked.
  assert.equal(sergio.rooms.work.takesPart(sergio.store.get("peerShares", (await sharedRoom(sergio, marta)).id)), true);
});

test("over the limit: «no atiende más peticiones» is said once per person, room and hour, and only to whoever asked", async (t) => {
  const people = await world(t, ["Sergio Rico", "Marta Ruiz", "Luis Vega"]);
  let [sergio] = people;
  const [, marta, luis] = people;
  await friends(sergio, marta);
  await friends(sergio, luis);
  const room = await sharedRoom(sergio, [marta, luis]);
  rule(sergio, marta, "siempre");
  const full = (p, n = ROOM_WORK.perHour, tag = "x") => { for (let i = 0; i < n; i++) p.store.put("roomAsks", { id: tag + "-" + i, roomId: room.id, shareId: room.id, from: addr(marta), fromName: "Marta Ruiz", botId: "vera", peerId: "peer-" + tag + "-" + i, text: "antes", rule: "siempre", state: "done", at: new Date().toISOString(), t: p.peers.clock() }); };
  const throttles = (p) => p.out.filter((o) => o.body.type === "room.status" && o.body.state === "throttled");
  full(sergio);
  for (let i = 1; i <= 4; i++) await asked(marta, room, sergio, "@Vera de más " + i);
  assert.deepEqual([sergio.calls.length, asks(sergio).length], [0, ROOM_WORK.perHour], "none was taken");
  // One status, to Marta and nobody else.
  assert.deepEqual(throttles(sergio).map((o) => o.to), [addr(marta)]);
  await until(() => lines(marta, room).includes("Vera no atiende más peticiones por ahora"), "Marta lo lee");
  await pause(300);
  assert.deepEqual(lines(marta, room), ["Vera no atiende más peticiones por ahora"], "once");
  assert.deepEqual([lines(luis, room), luis.store.list("roomStatus").length, luis.store.list("roomLines").length], [[], 0, 0], "Luis is told nothing");
  assert.deepEqual(lines(sergio, room), ["Vera no atiende más peticiones por ahora"], "and Sergio sees it once on his side");
  // Not again after a restart in the same hour.
  sergio = await people.reopen(sergio);
  await asked(marta, room, sergio, "@Vera tras reiniciar");
  assert.deepEqual([throttles(sergio).length, sergio.calls.length], [0, 0]);
  // In another hour, over the limit again: said again, once.
  sergio.skew = ROOM_WORK.throttledMs + 60000;
  full(sergio, ROOM_WORK.perHour, "y");
  for (let i = 1; i <= 2; i++) await asked(marta, room, sergio, "@Vera otra hora " + i);
  assert.deepEqual(throttles(sergio).map((o) => o.to), [addr(marta)]);
  assert.equal(sergio.calls.length, 0);
});

test("a request's deliverable of any kind reaches the requester (code and data as text); one that cannot travel tells the owner in the room, once", async (t) => {
  const [sergio, marta] = await world(t);
  await friends(sergio, marta);
  const room = await sharedRoom(sergio, marta);
  rule(sergio, marta, "siempre");
  let round = 0;
  sergio.reply = () => {
    round += 1;
    if (round === 1) return call("create_deliverable", { title: "archivo.py", kind: "code", format: "py", content: "print('hola')\n" }, "d1");
    if (round === 2) return call("create_deliverable", { title: "Datos", kind: "table", format: "json", content: "{\"a\": 1}" }, "d2");
    return answer("Aquí tienes el código.");
  };
  await ask(marta, room, sergio, "@Vera hazme un script en Python");
  await botAnswer(marta, room, "Aquí tienes el código.");
  const got = await until(() => { const ready = marta.store.list("peerFiles").filter((f) => f.status === "ready"); return ready.length === 2 ? ready : null; }, "Marta recibe los dos archivos");
  assert.deepEqual(got.map((f) => f.name).sort(), ["Datos.json.txt", "archivo.py.txt"]);
  const code = got.find((f) => f.name === "archivo.py.txt");
  assert.equal(await readFile(marta.peers.files.pathOf(code.id).path, "utf8"), "print('hola')\n");
  assert.equal(code.mime, "text/plain", "it is shown as text and never runs");
  // One that cannot travel (here: gone before it is sent) is said to Sergio, in the room, once.
  const logged = [];
  sergio.rooms.work.log = (m) => logged.push(m);
  sergio.peers.files.artifactFile = async () => null;
  round = 0;
  sergio.reply = () => (++round === 1 ? call("create_deliverable", { title: "otro.py", kind: "code", format: "py", content: "x = 1\n" }, "d3") : answer("Hecho otro."));
  await ask(marta, room, sergio, "@Vera otro script");
  await botAnswer(marta, room, "Hecho otro.");
  await settle(sergio.runtime);
  const note = await until(() => sergio.store.list("peerMessages").find((m) => m.local && /No he podido compartir «otro\.py» en la sala/.test(m.text)), "Sergio lo lee en la sala");
  assert.equal(note.shareId, room.id);
  await pause(300);
  assert.equal(sergio.store.list("peerMessages").filter((m) => m.local && /otro\.py/.test(m.text)).length, 1, "once");
  assert.equal(logged.filter((m) => /no pudo compartirse/.test(m)).length, 1, "tried once, not once per write of the step");
  assert.ok(!marta.store.list("peerMessages").some((m) => /No he podido/.test(m.text)), "the line never travels");
});

test("a request turn's prompt keeps the bot's name, role and personality, never the owner's free text: instructions, edited SOUL, role, space name", async (t) => {
  const [sergio, marta] = await world(t);
  await friends(sergio, marta);
  const room = await sharedRoom(sergio, marta);
  rule(sergio, marta, "siempre");
  const vera = sergio.store.get("bots", "vera");
  sergio.store.patch("bots", "vera", { instructions: "INSTRUCCIONES-1212: Sergio está negociando su salida de la empresa.", personality: { tono: 90, detalle: 10, riesgo: 50 } });
  sergio.store.patch("settings", "main", { userRole: "ROL-3434 en busca de empleo", spaceName: "ESPACIO-5656 privado" });
  writeSoul("vera", "Eres Vera. SOUL-7878: aprendido de Sergio, que tiene deudas con su socio.", { source: "tú" });
  // His own turn reads all of it.
  sergio.reply = () => answer("Para Sergio.");
  await sergio.rooms.send(room.id, { text: "@Vera hola" });
  await botAnswer(marta, room, "Para Sergio.");
  await settle(sergio.runtime);
  const own = sergio.calls.at(-1).instructions;
  for (const marker of ["INSTRUCCIONES-1212", "ROL-3434", "ESPACIO-5656", "SOUL-7878"]) assert.ok(own.includes(marker), "his own turn has " + marker);
  // Marta's request reads none of it, and keeps who the bot is.
  sergio.reply = () => answer("Para Marta.");
  await ask(marta, room, sergio, "@Vera ¿quién eres?");
  await botAnswer(marta, room, "Para Marta.");
  await settle(sergio.runtime);
  const theirs = sergio.calls.at(-1).instructions;
  for (const marker of ["INSTRUCCIONES-1212", "ROL-3434", "ESPACIO-5656", "SOUL-7878", "# Tus instrucciones"]) assert.ok(!theirs.includes(marker), "a request turn never reads " + marker);
  assert.match(theirs, new RegExp("Eres " + vera.name + ", " + vera.role));
  assert.match(theirs, /Trabajas para Sergio Rico\./);
  assert.match(theirs, /# Personalidad\n- Tono cercano/);
  // The tool-less answer to another person's mention (server/peers/bots.mjs) leaves them out too.
  const share = sergio.store.get("peerShares", room.id);
  const toHer = sharedInstructions(sergio.store, sergio.store.get("bots", "vera"), share, sergio.peers, { forOther: true });
  for (const marker of ["INSTRUCCIONES-1212", "SOUL-7878", "# Tus instrucciones"]) assert.ok(!toHer.includes(marker), "the tool-less answer to her never reads " + marker);
  assert.match(sharedInstructions(sergio.store, sergio.store.get("bots", "vera"), share, sergio.peers), /INSTRUCCIONES-1212/, "to him it does");
});

test("«carpetas» for other people's requests is on or off (no per-folder choice) and off unless the owner turns it on", async (t) => {
  const [sergio, marta] = await world(t, ["Sergio Rico", "Marta Ruiz"], { app: ["Sergio Rico"] });
  await friends(sergio, marta);
  const room = await sharedRoom(sergio, marta);
  rule(sergio, marta, "siempre");
  // Vera has a folder of Sergio's connected; nobody has touched Ajustes › Personas › Encargos.
  sergio.store.put("folders", { id: "f-privada", path: sergio.runtime.root("x"), label: "Privada", botIds: ["vera"], access: "lee" });
  assert.equal(sergio.store.get("settings", "main").peerErrandTools, undefined);
  assert.equal(sergio.rooms.work.capabilities().carpetas, false, "off by default for requests in rooms");
  assert.equal(sergio.peers.errands.settings().carpetas, false, "and for errands");
  assert.deepEqual(sergio.peers.errands.settings(), { web: true, carpetas: false, apps: false, ordenador: false });
  const offered = async (text) => {
    sergio.reply = () => answer(text);
    await ask(marta, room, sergio, "@Vera " + text);
    await botAnswer(marta, room, text);
    await settle(sergio.runtime);
    return sergio.calls.at(-1).tools.map((x) => x.name);
  };
  for (const name of ["list_folder", "read_folder_file"]) assert.ok(!(await offered("Por defecto " + name + ".")).includes(name), name + " is not offered by default");
  // Only a real «on» counts; the setting is a yes or no and nothing else (there is no list of folders to choose).
  sergio.store.patch("settings", "main", { peerErrandTools: { carpetas: "true" } });
  assert.ok(!(await offered("Con texto.")).includes("list_folder"));
  sergio.store.patch("settings", "main", { peerErrandTools: {} });
  assert.equal(sergio.peers.errands.setTools({ carpetas: ["f-privada"] }).carpetas, false, "a list of folders is not a setting");
  assert.equal("folders" in sergio.peers.errands.setTools({ folders: ["f-privada"] }), false);
  assert.equal(sergio.peers.errands.setTools({ carpetas: true }).carpetas, true);
  assert.ok((await offered("Encendido.")).includes("list_folder"), "on: the folders that bot has");
});

test("«ordenador» for another person's request: the browser runs in a session of that turn's own, wiped at its end; never the owner's screen or apps", async (t) => {
  const [sergio, marta] = await world(t);
  await friends(sergio, marta);
  const room = await sharedRoom(sergio, marta);
  rule(sergio, marta, "siempre");
  sergio.store.patch("settings", "main", { peerErrandTools: { ...NONE, ordenador: true } });
  sergio.store.patch("bots", "vera", { capabilities: { ...(sergio.store.get("bots", "vera").capabilities || {}), ordenador: true } });
  // The desktop's browser bridge, as Electron answers it.
  const ops = [];
  const computer = { available: true, call: async (op, args) => { ops.push({ op, args }); return { url: "https://correo.example/", title: "Bandeja", text: "Página", elements: [], jpegBase64: "AAAA" }; } };
  sergio.runtime.extraTools = computerExtraTools(sergio.runtime, { computer });
  const reads = () => ops.filter((o) => o.op === "snapshot");
  let round = 0;
  sergio.reply = () => (++round === 1 ? call("browser_read", { mode: "texto", query: "" }, "b1") : answer("Leída."));
  await ask(marta, room, sergio, "@Vera abre mi correo y léelo");
  await botAnswer(marta, room, "Leída.");
  await settle(sergio.runtime);
  const step = sergio.store.where("steps", "missionId", room.missionId).at(-1);
  const offered = sergio.calls.at(-1).tools.map((x) => x.name);
  for (const name of ["desktop_look", "desktop_do", "desktop_windows", "open_app", "open_file", "run_command"]) assert.ok(!offered.includes(name), name + " is not offered");
  assert.ok(offered.includes("browser_read"));
  const theirs = reads()[0];
  assert.equal(theirs.args.session, "req-" + step.id, "her request browses in a session of its own");
  // When the turn ends, that session is closed (Electron wipes it).
  const closed = await until(() => ops.find((o) => o.op === "close" && o.args.session === theirs.args.session), "la sesión se cierra");
  assert.deepEqual([closed.args.missionId, closed.args.botId], [room.missionId, "vera"]);
  // The owner's own turn uses the bots' usual browser.
  round = 0;
  sergio.reply = () => (++round === 1 ? call("browser_read", { mode: "texto", query: "" }, "b2") : answer("Para Sergio."));
  await sergio.rooms.send(room.id, { text: "@Vera lee la página" });
  await until(() => reads().length === 2, "su lectura");
  await settle(sergio.runtime);
  assert.equal(reads()[1].args.session, undefined);
  assert.ok(!ops.some((o) => o.op === "close" && !o.args.session), "and it is never closed by a turn");
  // Electron keys and partitions: a separate session never shares the persistent one.
  const { tabKey, partitionFor, PARTITION } = require("../desktop/browser.cjs");
  assert.equal(partitionFor({ missionId: "m", botId: "vera" }), PARTITION);
  assert.ok(PARTITION.startsWith("persist:"));
  const apart = partitionFor({ missionId: "m", botId: "vera", session: "req-m:followup-1" });
  assert.ok(!apart.startsWith("persist:") && apart !== PARTITION, "in memory only");
  assert.notEqual(tabKey({ missionId: "m", botId: "vera", session: "req-m:followup-1" }), tabKey({ missionId: "m", botId: "vera" }));
  assert.equal(partitionFor({ missionId: "m", botId: "vera", session: "a/b" }), PARTITION, "a malformed session name is ignored");
});
