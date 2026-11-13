// What leaves a shared room by itself and what is taken from it (server/room.mjs,
// server/room-work.mjs, docs/PEOPLE.md › Salas): real Colmenas over a local mailbox
// (tests/fixtures/people-world.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { answer, settle } from "./fixtures/runtime-fixture.mjs";
import { ROOM_STATES, ROOM_WORK, cleanStatus, statusText } from "../server/room-work.mjs";
import { countOf } from "../server/peers/service.mjs";
import { addr, ask, botAnswer, card, friends, lines, pause, peerRows, rule, sharedRoom, until, world } from "./fixtures/people-world.mjs";

const botSaid = (p, roomId) => peerRows(p, roomId).filter((m) => m.bot).map((m) => m.text);
const sentMsgs = (p, from = 0) => p.out.slice(from).filter((o) => o.body.type === "msg").map((o) => o.body.text);

test("only turns of the shared conversation are relayed: nothing from before the room had people, nothing written to the sala alone, never a «stuck» line", async (t) => {
  const [sergio, marta] = await world(t, ["Sergio Rico", "Marta Ruiz"], { app: ["Sergio Rico"] });
  await friends(sergio, marta);
  // A private room with a turn that ended, and one still running when Marta comes in.
  const room = sergio.rooms.create({ title: "Informe Q3", botIds: ["vera"] });
  sergio.reply = () => answer("PRIVADO-ANTES: el presupuesto real.");
  await sergio.rooms.send(room.id, { text: "@Vera ¿cuál es el presupuesto?", to: ["vera"] });
  await until(() => sergio.store.where("messages", "missionId", room.missionId).some((m) => /PRIVADO-ANTES/.test(m.text)), "el turno privado termina");
  await settle(sergio.runtime);
  let release = null;
  sergio.reply = () => new Promise((r) => { release = () => r(answer("PRIVADO-EN-MARCHA: sigo con lo tuyo.")); setTimeout(release, 15000).unref(); });
  await sergio.rooms.send(room.id, { text: "@Vera y ahora mira lo otro", to: ["vera"] });
  await until(() => release, "el segundo turno está en marcha");
  await sergio.rooms.invite(room.id, { address: addr(marta) });
  await until(() => marta.rooms.resolveRoom(room.id), "Marta ve la sala");
  const mark = sergio.out.length;
  release();
  await until(() => sergio.store.where("messages", "missionId", room.missionId).some((m) => /PRIVADO-EN-MARCHA/.test(m.text)), "el segundo turno termina");
  await settle(sergio.runtime);
  // An old step written again later (a receipt, a task of Código that reports back).
  for (const step of sergio.store.where("steps", "missionId", room.missionId)) sergio.store.patch("steps", step.id, { touchedAt: new Date().toISOString() });
  await pause(300);
  assert.deepEqual(sentMsgs(sergio, mark), [], "nothing of the sala went to the room");
  assert.deepEqual(botSaid(marta, room.id), []);
  // The sala of a room with people takes no message of its own: it goes through the room.
  const direct = await sergio.call("POST", "/missions/" + room.missionId + "/messages", { text: "@Vera dime el presupuesto" });
  assert.deepEqual([direct.status, direct.json.error], [409, "Esta sala tiene personas: escribe desde la sala para que lo lean todos."]);
  assert.equal((await sergio.call("POST", "/missions/" + room.missionId + "/queue", { text: "luego" })).status, 409);
  // And a turn for something that reached the sala another way is not relayed either.
  sergio.reply = () => answer("SOLO-PARA-SERGIO.");
  sergio.runtime.addMessage(room.missionId, "Una pregunta que no pasó por la sala", [], { to: ["vera"] });
  await until(() => sergio.store.where("messages", "missionId", room.missionId).some((m) => m.text === "SOLO-PARA-SERGIO."), "ese turno termina");
  await settle(sergio.runtime);
  await pause(300);
  assert.deepEqual([sentMsgs(sergio, mark), botSaid(marta, room.id)], [[], []]);
  // Written in the room: question and answer are for everybody.
  sergio.reply = () => answer("Para todos.");
  const sent = await sergio.call("POST", "/rooms/" + room.id + "/messages", { text: "@Vera saluda", to: ["vera"] });
  assert.equal(sent.status, 200);
  await botAnswer(marta, room, "Para todos.");
  await settle(sergio.runtime);
  assert.deepEqual(peerRows(marta, room.id).map((m) => m.text), ["@Vera saluda", "Para todos."]);
  // A turn that left its answer and then a line saying it got stuck: the answer is what goes.
  const share = sergio.store.get("peerShares", room.id), vera = sergio.store.get("bots", "vera");
  const at = new Date().toISOString();
  sergio.store.put("messages", { id: "u-stall", missionId: room.missionId, role: "user", kind: "message", text: "@Vera otra cosa", peerId: "peer-u-stall", to: ["vera"], at });
  sergio.store.put("messages", { id: "a-real", missionId: room.missionId, role: "assistant", kind: "message", botId: "vera", stepId: "step-stall", text: "La respuesta de verdad.", at });
  sergio.store.put("messages", { id: "a-stall", missionId: room.missionId, role: "assistant", kind: "message", botId: "vera", stepId: "step-stall", text: "Me he atascado: llevo 5 intentos con C:\\Users\\sergio.", stall: "loop", at });
  const step = { id: "step-stall", missionId: room.missionId, botId: "vera", kind: "followup", status: "completed", ackOn: "u-stall", startedAt: at, text: "La respuesta de verdad." };
  assert.ok(sergio.rooms.relay(sergio.rooms.must(room.id), share, step, vera));
  await botAnswer(marta, room, "La respuesta de verdad.");
  assert.ok(!botSaid(marta, room.id).some((x) => /atascado/.test(x)));
  // With nothing but that line, nothing goes.
  sergio.store.put("messages", { id: "a-only", missionId: room.missionId, role: "assistant", kind: "message", botId: "vera", stepId: "step-only", text: "Me he atascado otra vez.", stall: "loop", at });
  assert.equal(sergio.rooms.relay(sergio.rooms.must(room.id), share, { ...step, id: "step-only" }, vera), null);
  for (const secret of ["PRIVADO-ANTES", "PRIVADO-EN-MARCHA", "SOLO-PARA-SERGIO", "atascado"]) assert.ok(!JSON.stringify(sergio.out.slice(mark).map((o) => o.body)).includes(secret), secret);
});

test("an old status sent again after a restart is ignored: the newest one heard of each bot is kept", async (t) => {
  const people = await world(t);
  const [sergio] = people;
  let marta = people[1];
  await friends(sergio, marta);
  const room = await sharedRoom(sergio, marta);
  const activity = (p) => p.rooms.detail(room.id).activity.map((a) => a.state);
  // «Pregúntame»: Marta reads that Vera waits for Sergio; he answers, the turn runs and ends.
  await ask(marta, room, sergio, "@Vera mira esto");
  const waiting = await until(() => sergio.out.find((o) => o.body.type === "room.status" && o.body.state === "waiting"), "el estado de espera");
  await until(() => activity(marta).includes("waiting"), "Marta lo lee");
  sergio.reply = () => answer("Mirado.");
  sergio.runtime.answer(card(sergio).id, { optionId: "go" });
  await botAnswer(marta, room, "Mirado.");
  await settle(sergio.runtime);
  await until(() => !activity(marta).includes("waiting"), "ya no espera");
  const heard = marta.store.get("roomHeard", room.id + ":" + addr(sergio) + ":vera");
  assert.ok(heard.at > waiting.body.at, "the newest one is kept");
  // Time passes: the status itself is gone from her Colmena. Then she restarts.
  marta.skew = 10 * 60000;
  marta.rooms.work.tick();
  assert.deepEqual(marta.store.list("roomStatus"), []);
  marta = await people.reopen(marta);
  // The old «waiting» arrives again (the same words, sealed again).
  marta.rooms.work.onStatus({ id: addr(sergio) }, { ...waiting.body });
  sergio.peers.enqueue(addr(marta), { ...waiting.body });
  await sergio.peers.flushOutbox();
  await pause(400);
  assert.deepEqual([activity(marta), marta.store.list("roomStatus").length], [[], 0], "it does not come back");
  assert.ok(!lines(marta, room).some((x) => /espera/.test(x)));
  // A newer one is heard as always.
  marta.rooms.work.onStatus({ id: addr(sergio) }, { share: room.id, bot: "vera", state: "waiting", at: marta.peers.clock() });
  assert.deepEqual(activity(marta), ["waiting"]);
  rule(sergio, marta, "pregunta");
});

test("what a request shares by itself is capped per request and per person and day; beyond it the owner is asked", async (t) => {
  const [sergio, marta] = await world(t);
  await friends(sergio, marta);
  const room = await sharedRoom(sergio, marta);
  rule(sergio, marta, "siempre");
  assert.deepEqual([ROOM_WORK.files, ROOM_WORK.fileBytes, ROOM_WORK.filesDay, ROOM_WORK.fileBytesDay], [3, 25 * 1024 * 1024, 10, 100 * 1024 * 1024]);
  const files = (p) => p.store.list("peerFiles").filter((f) => f.status === "ready").map((f) => f.name).sort();
  const make = (n) => ({ text: "", output: Array.from({ length: n }, (_, i) => ({ type: "function_call", name: "create_deliverable", arguments: JSON.stringify({ title: "Parte " + (i + 1), kind: "document", format: "md", content: "# Parte " + (i + 1) }), call_id: "d" + i })) });
  // Five deliverables in one request: three go with the answer, two stay and Sergio is asked.
  sergio.reply = ({ input }) => (input.some((x) => x.type === "function_call_output") ? answer("Aquí van.") : make(5));
  await ask(marta, room, sergio, "@Vera hazme el informe por partes");
  await botAnswer(marta, room, "Aquí van.");
  await settle(sergio.runtime);
  await until(() => files(marta).length === 3, "Marta recibe tres");
  const a = await until(() => sergio.store.list("approvals").find((x) => x.roomShare && x.status === "pending"), "la tarjeta de Sergio");
  assert.deepEqual([a.kind, a.tool, a.roomShare.artifactIds.length, a.options.map((o) => o.label)], ["question", "room_share", 2, ["Compartir", "No compartir"]]);
  assert.match(a.summary, /¿Los comparto en la sala\?/);
  assert.ok(sergio.notices.some((n) => n.kind === "needs" && /más archivos para Marta/.test(n.title)));
  await pause(300);
  assert.deepEqual(files(marta), ["Parte 1.md", "Parte 2.md", "Parte 3.md"]);
  const request = sergio.store.list("roomAsks")[0];
  assert.deepEqual([request.shared.length, request.kept.length, request.sharedBytes > 0], [3, 2, true]);
  // He says yes: the rest goes. No message of his is left in the room for it.
  sergio.runtime.answer(a.id, { optionId: "share" });
  await until(() => files(marta).length === 5, "Marta recibe el resto");
  assert.deepEqual(sergio.store.where("messages", "missionId", room.missionId).filter((m) => m.role === "user" && !m.author), []);
  // «No compartir» keeps them here.
  sergio.reply = ({ input }) => (input.some((x) => x.type === "function_call_output") ? answer("Otra tanda.") : make(4));
  await ask(marta, room, sergio, "@Vera otra vez");
  await botAnswer(marta, room, "Otra tanda.");
  await settle(sergio.runtime);
  const b = await until(() => sergio.store.list("approvals").find((x) => x.roomShare && x.status === "pending"), "otra tarjeta");
  sergio.runtime.answer(b.id, { optionId: "no" });
  await until(() => files(marta).length === 8, "tres más");
  await pause(300);
  assert.equal(files(marta).length, 8);
  // Ten files a day for one person: with eight sent by themselves… the next request shares two and asks for the third.
  assert.equal(sergio.store.list("roomAsks").reduce((n, x) => n + (x.shared || []).length, 0), 8);
  sergio.reply = ({ input }) => (input.some((x) => x.type === "function_call_output") ? answer("Y otra.") : make(3));
  await ask(marta, room, sergio, "@Vera una más");
  await botAnswer(marta, room, "Y otra.");
  await settle(sergio.runtime);
  const c = await until(() => sergio.store.list("approvals").find((x) => x.roomShare && x.status === "pending"), "la del límite diario");
  assert.equal(c.roomShare.artifactIds.length, 1);
  await until(() => files(marta).length === 10, "dos más");
  // Size counts too: per request and per day.
  const work = sergio.rooms.work, fresh = { from: addr(sergio), shared: [], sharedBytes: 0 };
  assert.deepEqual([work.shareOver(fresh, 1024), work.shareOver(fresh, ROOM_WORK.fileBytes + 1), work.shareOver({ ...fresh, sharedBytes: ROOM_WORK.fileBytes - 10 }, 11), work.shareOver({ ...fresh, shared: ["a", "b", "c"] }, 1)], [false, true, true, true]);
  sergio.store.put("roomAsks", { id: "big", roomId: room.id, shareId: room.id, from: addr(sergio), botId: "vera", peerId: "p-big", text: "x", state: "done", at: new Date().toISOString(), t: sergio.peers.clock(), shared: ["x"], sharedBytes: ROOM_WORK.fileBytesDay - 100 });
  assert.deepEqual([work.shareOver(fresh, 50), work.shareOver(fresh, 200)], [false, true]);
});

test("a group that arrives with the id of a private room of yours gets a room of its own: your room and its sala are not taken over", async (t) => {
  const [sergio, marta] = await world(t);
  await friends(sergio, marta);
  // A private room of Sergio, with something said in it.
  const mine = sergio.rooms.create({ title: "Cosas mías", botIds: ["vera"] });
  sergio.reply = () => answer("PRIVADO-SOLO-MIO.");
  await sergio.rooms.send(mine.id, { text: "@Vera apunta esto", to: ["vera"] });
  await until(() => sergio.store.where("messages", "missionId", mine.missionId).some((m) => m.text === "PRIVADO-SOLO-MIO."), "el turno termina");
  await settle(sergio.runtime);
  // Marta makes a group with that very id and puts Sergio in it.
  marta.peers.createGroup("Grupo de Marta", [addr(sergio)], { id: mine.id });
  await until(() => sergio.store.get("peerShares", mine.id), "el grupo llega");
  await pause(200);
  const own = sergio.store.get("rooms", mine.id);
  assert.deepEqual([own.shareId, own.missionId, own.createdBy, own.title], [null, mine.missionId, addr(sergio), mine.title], "his room is as it was");
  const theirs = sergio.rooms.ofShare(mine.id);
  assert.ok(theirs && theirs.id !== mine.id);
  assert.deepEqual([theirs.shareId, theirs.missionId, theirs.createdBy, theirs.title], [mine.id, null, addr(marta), "Grupo de Marta"]);
  assert.equal(sergio.rooms.shared.has(mine.missionId), false, "his sala is not the sala of that group");
  // Nothing of his sala goes to that group, whatever is written to its steps; his own next turn stays private.
  const mark = sergio.out.length;
  for (const step of sergio.store.where("steps", "missionId", mine.missionId)) sergio.store.patch("steps", step.id, { touchedAt: new Date().toISOString() });
  sergio.reply = () => answer("OTRO-PRIVADO.");
  await sergio.rooms.send(own.id, { text: "@Vera y esto", to: ["vera"] });
  await until(() => sergio.store.where("messages", "missionId", mine.missionId).some((m) => m.text === "OTRO-PRIVADO."), "su turno termina");
  await settle(sergio.runtime);
  await pause(300);
  assert.deepEqual(sergio.out.slice(mark).filter((o) => o.body.type === "msg"), []);
  assert.deepEqual(peerRows(marta, mine.id), []);
  // His own first invitation still turns his room into the room of its conversation.
  const other = sergio.rooms.create({ title: "Para compartir", botIds: ["vera"] });
  await sergio.rooms.invite(other.id, { address: addr(marta) });
  assert.deepEqual([sergio.store.get("rooms", other.id).shareId, sergio.store.list("rooms").filter((r) => r.shareId === other.id).length], [other.id, 1]);
});

test("counts are said in the right number: «con 1 persona», «con 2 personas»", async (t) => {
  assert.deepEqual([countOf(1, "persona", "personas"), countOf(2, "persona", "personas"), countOf(0, "persona", "personas")], ["1 persona", "2 personas", "0 personas"]);
  const [sergio, marta, luis] = await world(t, ["Sergio Rico", "Marta Ruiz", "Luis Vega"]);
  await friends(sergio, marta);
  await friends(sergio, luis);
  const added = (p) => p.notices.filter((n) => /te ha añadido a/.test(n.title)).map((n) => n.text);
  // A room with one other person, then one with two.
  const one = sergio.rooms.create({ title: "A dos", people: [addr(marta)] });
  await until(() => marta.rooms.resolveRoom(one.id), "Marta ve la sala");
  assert.deepEqual(added(marta), ["Una conversación con 1 persona."]);
  const two = sergio.rooms.create({ title: "A tres", people: [addr(marta), addr(luis)] });
  await until(() => luis.rooms.resolveRoom(two.id), "Luis ve la sala");
  assert.deepEqual(added(luis), ["Una conversación con 2 personas."]);
});

test("stopping a bot is said once to the room", async (t) => {
  const [sergio, marta] = await world(t);
  await friends(sergio, marta);
  const room = await sharedRoom(sergio, marta);
  const stops = () => sergio.out.filter((o) => o.body.type === "room.status" && o.body.state === "stopped");
  // A turn of his own, stopped while it thinks.
  let hold = null;
  sergio.reply = () => new Promise((r) => { hold = r; setTimeout(() => r(answer("tarde")), 15000).unref(); });
  await sergio.rooms.send(room.id, { text: "@Vera una larga" });
  await until(() => hold && marta.rooms.detail(room.id).activity.some((a) => a.state === "thinking"), "Marta la ve pensando");
  sergio.runtime.stop(room.missionId);
  hold(answer("tarde"));
  await until(() => lines(marta, room).includes("Sergio ha parado a Vera"), "Marta lee que la paró");
  await settle(sergio.runtime);
  await pause(400);
  assert.deepEqual(stops().map((o) => o.to), [addr(marta)], "one status, once");
  assert.deepEqual([lines(marta, room).filter((x) => /ha parado/.test(x)), lines(sergio, room).filter((x) => /Has parado/.test(x))], [["Sergio ha parado a Vera"], ["Has parado a Vera"]]);
  // A turn for her request, stopped while it uses a tool.
  rule(sergio, marta, "siempre");
  const other = await sharedRoom(sergio, marta, "Otra sala");
  let round = 0, hold2 = null;
  sergio.reply = () => (++round === 1 ? { text: "", output: [{ type: "function_call", name: "web_fetch", arguments: JSON.stringify({ url: "https://ejemplo.example/a" }), call_id: "w1" }] } : new Promise((r) => { hold2 = r; setTimeout(() => r(answer("tarde")), 15000).unref(); }));
  await ask(marta, other, sergio, "@Vera mira esa página");
  await until(() => hold2 && marta.rooms.detail(other.id).activity.some((a) => a.state === "working"), "Marta la ve trabajando");
  sergio.runtime.stop(sergio.rooms.must(other.id).missionId);
  hold2(answer("tarde"));
  await until(() => stops().length >= 2, "se dice que la paró");
  await settle(sergio.runtime);
  await pause(400);
  assert.equal(stops().length, 2, "once more, once");
  assert.equal(sergio.store.list("roomAsks").at(-1).state, "stopped");
});

test("an approval that expires undecided ends the wait for the others, and closes the request it belonged to; a request left at work by a close is settled on start", async (t) => {
  const people = await world(t);
  let [sergio] = people;
  const marta = people[1];
  await friends(sergio, marta);
  const room = await sharedRoom(sergio, marta);
  rule(sergio, marta, "siempre");
  sergio.store.patch("settings", "main", { peerErrandTools: { web: true, carpetas: false, apps: true, ordenador: false } });
  assert.ok(ROOM_STATES.includes("expired"));
  assert.deepEqual([statusText("expired", { bot: "Vera", owner: "Sergio Rico" }), statusText("expired", { bot: "Vera", owner: "Sergio Rico", you: true })], ["Vera no llegó a tener el OK de Sergio", "No llegaste a dar el OK a Vera"]);
  assert.deepEqual(Object.keys(cleanStatus({ bot: "vera", state: "expired", at: Date.now(), tools: 3, text: "enviar a ana@x.es" })).sort(), ["at", "bot", "state"]);
  const send = (id) => ({ text: "", output: [{ type: "function_call", name: "apps_execute", arguments: JSON.stringify({ tool: "GMAIL_SEND_EMAIL", account: "acc", arguments_json: JSON.stringify({ recipient_email: "ana@lumbre.es", subject: "Informe", body: "Te lo paso." }) }), call_id: id }] });
  const states = (p) => p.rooms.detail(room.id).activity.map((a) => a.state);
  const old = () => new Date(Date.now() - 31 * 60000).toISOString();
  // Marta's request needs a send: it waits for Sergio, and she reads so.
  sergio.reply = ({ input }) => (input.some((x) => x.type === "function_call_output") ? answer("No se envió.") : send("s1"));
  await ask(marta, room, sergio, "@Vera envía el informe a Ana");
  const step = await until(() => sergio.store.where("steps", "missionId", sergio.rooms.must(room.id).missionId).find((s) => s.status === "waiting"), "el turno espera");
  await until(() => states(marta).includes("waiting"), "Marta lee que espera");
  // Half an hour passes and nobody decided.
  const approvalId = step.id + ":s1";
  sergio.store.patch("approvals", approvalId, { createdAt: old(), preparedAt: old() });
  sergio.rooms.work.tick();
  await until(() => lines(marta, room).includes("Vera no llegó a tener el OK de Sergio"), "Marta lee que no se aprobó");
  await settle(sergio.runtime);
  assert.deepEqual(states(marta).filter((x) => x === "waiting"), []);
  assert.deepEqual(lines(sergio, room).filter((x) => /No llegaste/.test(x)), ["No llegaste a dar el OK a Vera"]);
  const request = sergio.store.list("roomAsks")[0];
  assert.deepEqual([request.state, sergio.store.get("approvals", approvalId).status, sergio.store.get("steps", step.id).status, sergio.effects], ["expired", "denied", "completed", []]);
  assert.deepEqual(sergio.rooms.detail(room.id).asks, undefined, "nothing of it is left open");
  await until(() => !["waiting", "running", "queued"].includes(sergio.store.get("missions", step.missionId).status), "la sala no se queda esperando");
  const expired = sergio.out.filter((o) => o.body.type === "room.status" && o.body.state === "expired");
  assert.deepEqual(expired.map((o) => Object.keys(o.body).sort()), [["at", "bot", "share", "state", "type"]]);
  sergio.rooms.work.tick();
  sergio.rooms.work.tick();
  assert.equal(sergio.out.filter((o) => o.body.type === "room.status" && o.body.state === "expired").length, 1, "said once");
  // A turn of his own that waits and expires: the others stop reading that it waits; the card stays his.
  sergio.reply = ({ input }) => (input.some((x) => x.type === "function_call_output") ? answer("Hecho.") : send("s2"));
  await sergio.rooms.send(room.id, { text: "@Vera prepara y manda el informe a quien toque" });
  const own = await until(() => sergio.store.where("steps", "missionId", step.missionId).find((s) => s.status === "waiting"), "su turno espera");
  await until(() => states(marta).includes("waiting"), "Marta lee que espera");
  sergio.store.patch("approvals", own.id + ":s2", { createdAt: old(), preparedAt: old() });
  sergio.rooms.work.tick();
  await until(() => lines(marta, room).filter((x) => /no llegó a tener el OK/.test(x)).length === 2, "Marta lo lee otra vez");
  assert.equal(sergio.store.get("approvals", own.id + ":s2").status, "pending");
  // A request that was at work when Colmena closed and does not go on: settled on start.
  const other = await sharedRoom(sergio, marta, "Otra sala");
  sergio.reply = () => answer("Terminado.");
  await ask(marta, other, sergio, "@Vera una cosa");
  await botAnswer(marta, other, "Terminado.");
  await settle(sergio.runtime);
  const left = sergio.store.list("roomAsks").find((a) => a.shareId === other.id);
  const missionId = sergio.rooms.must(other.id).missionId;
  const last = sergio.store.where("steps", "missionId", missionId).at(-1);
  sergio.store.patch("roomAsks", left.id, { state: "working", endedAt: null });
  sergio.store.patch("steps", last.id, { status: "pending" }, { silent: true });
  sergio.store.patch("missions", missionId, { status: "paused" });
  sergio = await people.reopen(sergio);
  sergio.rooms.work.tick();
  assert.equal(sergio.store.get("roomAsks", left.id).state, "working", "it gets a moment to go on with its sala");
  sergio.rooms.work.startedAt = Date.now() - ROOM_WORK.settleMs - 1000;
  sergio.rooms.work.tick();
  assert.equal(sergio.store.get("roomAsks", left.id).state, "failed");
  await until(() => lines(marta, other).includes("Vera no ha podido terminarlo"), "Marta lee que no pudo");
});

test("a bot's answer that ends while the mailbox is unreachable still reaches the room, with what it made, also after a restart", async (t) => {
  const people = await world(t);
  let [sergio] = people;
  const marta = people[1];
  await friends(sergio, marta);
  const room = await sharedRoom(sergio, marta);
  rule(sergio, marta, "siempre");
  const files = (p) => p.store.list("peerFiles").filter((f) => f.status === "ready").map((f) => f.name).sort();
  // Marta asks; while Vera works the mailbox goes down, and the turn ends with it down.
  let round = 0, release = null;
  sergio.reply = () => {
    round += 1;
    if (round === 1) return new Promise((r) => { release = () => r({ text: "", output: [{ type: "function_call", name: "create_deliverable", arguments: JSON.stringify({ title: "Informe", kind: "document", format: "md", content: "# Informe. Todo bien." }), call_id: "d1" }] }); setTimeout(release, 20000).unref(); });
    return answer("Aquí tienes el informe.");
  };
  await ask(marta, room, sergio, "@Vera hazme el informe");
  await until(() => release, "el turno está en marcha");
  await people.relay.stop();
  await until(() => sergio.peers.relayStatus.status !== "online", "Sergio se queda sin buzón");
  release();
  await until(() => sergio.store.where("messages", "missionId", sergio.rooms.must(room.id).missionId).some((m) => m.text === "Aquí tienes el informe."), "el turno termina");
  await settle(sergio.runtime);
  await pause(500);
  assert.equal(peerRows(marta, room.id).some((m) => m.bot), false, "nothing could travel yet");
  // Colmena is closed and opened again before the mailbox is back.
  sergio = await people.reopenOffline(sergio);
  await people.relay.start();
  await botAnswer(marta, room, "Aquí tienes el informe.");
  await until(() => files(marta).length === 1, "y el archivo");
  assert.deepEqual(files(marta), ["Informe.md"]);
  assert.equal(peerRows(marta, room.id).filter((m) => m.bot && m.text === "Aquí tienes el informe.").length, 1, "once");
  await pause(1500);
  assert.equal(files(marta).length, 1);
  // An answer that could not even be posted when its turn ended (no mailbox to post to) is kept and goes later.
  const post = sergio.peers.post.bind(sergio.peers);
  let down = true;
  sergio.peers.post = (shareId, text, options = {}) => { if (down && options.bot) throw Object.assign(Error("Falta conectar Colmena al buzón (Ajustes › Personas)."), { status: 409 }); return post(shareId, text, options); };
  sergio.reply = () => answer("Esta salió más tarde.");
  await ask(marta, room, sergio, "@Vera otra cosa");
  await until(() => sergio.store.where("messages", "missionId", sergio.rooms.must(room.id).missionId).some((m) => m.text === "Esta salió más tarde."), "el turno termina");
  await settle(sergio.runtime);
  assert.deepEqual(sergio.store.list("roomUnsent").map((x) => x.kind), ["answer"]);
  sergio.rooms.work.tick();
  assert.equal(sergio.store.list("roomUnsent").length, 1, "still kept while it cannot go");
  sergio = await people.reopen(sergio);
  down = false;
  sergio.rooms.work.tick();
  await botAnswer(marta, room, "Esta salió más tarde.");
  await pause(300);
  assert.deepEqual([sergio.store.list("roomUnsent").length, peerRows(marta, room.id).filter((m) => m.text === "Esta salió más tarde.").length], [0, 1]);
});
