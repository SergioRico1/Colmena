// What leaves a shared room by itself and what is taken from it (server/room.mjs,
// server/room-work.mjs, docs/PEOPLE.md › Salas): real Colmenas over a local mailbox
// (tests/fixtures/people-world.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { answer, settle } from "./fixtures/runtime-fixture.mjs";
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
