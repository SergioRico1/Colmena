// What leaves a shared room by itself and what is taken from it (server/room.mjs,
// server/room-work.mjs, docs/PEOPLE.md › Salas): real Colmenas over a local mailbox
// (tests/fixtures/people-world.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { answer, settle } from "./fixtures/runtime-fixture.mjs";
import { ROOM_WORK } from "../server/room-work.mjs";
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
