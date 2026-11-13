// The rules of a turn that answers another person (server/request-turn.mjs, server/room-work.mjs,
// docs/PEOPLE.md › «Bots trabajando en salas compartidas»): real Colmenas over a local mailbox,
// each with a scripted model (tests/fixtures/people-world.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { answer, call, settle } from "./fixtures/runtime-fixture.mjs";
import { addr, ask, asks, botAnswer, friends, pause, peerRows, rule, sharedRoom, until, world } from "./fixtures/people-world.mjs";
import { REQUEST_ALWAYS, REQUEST_BY_CAPABILITY, requestCapability, requestToolAllowed } from "../server/request-turn.mjs";
import { canCreateImages } from "../server/images.mjs";
import { createPage } from "../server/wiki.mjs";

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
];

test("the allow-list itself: closed by default, each capability lets in exactly its own tools", () => {
  assert.deepEqual(sorted(REQUEST_ALWAYS), ["ask_room", "ask_user", "create_deliverable", "create_document", "create_image", "create_presentation", "create_spreadsheet", "read_deliverable", "read_file"]);
  assert.deepEqual(Object.keys(REQUEST_BY_CAPABILITY), ["web", "carpetas", "apps", "ordenador"]);
  assert.deepEqual(REQUEST_BY_CAPABILITY.web, ["web_fetch"]);
  assert.deepEqual(REQUEST_BY_CAPABILITY.carpetas, ["list_folder", "read_folder_file"]);
  for (const [name] of FORBIDDEN) {
    assert.equal(requestCapability(name), null, name + " is on no list");
    assert.equal(requestToolAllowed(name, { web: true, carpetas: true, apps: true, ordenador: true }), false, name + " is refused with every capability on");
  }
  for (const name of ["", null, undefined, "__proto__", "constructor", "toString"]) assert.equal(requestToolAllowed(name, { web: true, carpetas: true, apps: true, ordenador: true }), false);
  assert.equal(requestToolAllowed("web_fetch", NONE), false);
  assert.equal(requestToolAllowed("gmail_send_email", { ...NONE, apps: true }), true, "a direct tool of a connected app follows «apps»");
  assert.equal(requestToolAllowed("gmail_send_email", { ...NONE, web: true, carpetas: true, ordenador: true }), false);
  assert.equal(requestToolAllowed("browser_open", { ...NONE, apps: "yes" }), false, "only a real true counts");
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
    ordenador: sorted([...always, "browser_open", "browser_read", "desktop_do", "desktop_look", "open_app"]),
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
  family(sergio, ran, Array.from({ length: 40 }, (_, i) => ["gmail_extra_" + i, "apps"]));
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
