// The desktop's «para después» (server/room-plus.mjs): saved messages, reminders that pop as a
// notice, scheduled messages sent as you and bots' follow-ups that resume them.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { Store } from "../server/store.mjs";
import { RoomPlus, urlOf } from "../server/room-plus.mjs";

async function plusOf(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-plus-"));
  const store = new Store(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  const out = { sent: [], resumed: [], notices: [] };
  let now = Date.UTC(2026, 10, 17, 9, 0);
  const plus = new RoomPlus({ store, clock: () => now, tz: () => "Europe/Madrid", send: async (x) => { out.sent.push(x); }, resume: (x) => { out.resumed.push(x); }, notify: (n) => out.notices.push(n) });
  return { plus, out, store, at: (ms) => { now = ms; }, now: () => now };
}

test("saved messages: once per message, newest first, and taken off", async (t) => {
  const { plus, at, now } = await plusOf(t);
  const a = plus.save({ where: { room: "r1" }, messageId: "m1", text: "Presupuesto", author: "Marta" });
  assert.equal(plus.save({ where: { room: "r1" }, messageId: "m1" }).id, a.id);
  at(now() + 60000);
  plus.save({ where: { share: "s1" }, messageId: "m2", text: "Hola" });
  assert.deepEqual(plus.saved().map((s) => s.url), ["/con/s1?m=m2", "/sala/r1?m=m1"]);
  plus.unsave("m1");
  assert.equal(plus.saved().length, 1);
  assert.throws(() => plus.save({ where: {}, messageId: "x" }), /Falta la conversación/);
});

test("a reminder pops once at its time and opens the message", async (t) => {
  const { plus, out, at, now } = await plusOf(t);
  const r = plus.remind({ where: { mission: "c1" }, messageId: "m9", text: "Llamar a Ana", when: "en 2 horas" });
  assert.match(r.label, /11:00|hoy/);
  await plus.due(now() + 3600000);
  assert.equal(out.notices.length, 0);
  at(now() + 2 * 3600000 + 1000);
  await plus.due();
  await plus.due();
  assert.deepEqual(out.notices.map((n) => [n.kind, n.text, n.url]), [["reminder", "Llamar a Ana", "/sala/c1?m=m9"]]);
  assert.equal(plus.reminders().length, 0);
  assert.throws(() => plus.remind({ where: { room: "r" }, when: "cuando sea" }), /No entiendo cuándo/);
  // «/recordar mañana a las 9 llamar a Ana»: the time comes out of the words.
  const both = plus.remind({ where: { room: "r" }, text: "mañana a las 9 llamar a Ana", when: "mañana a las 9 llamar a Ana" });
  assert.equal(both.text, "llamar a Ana");
  assert.equal(new Date(both.at).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }), "09:00");
});

test("a scheduled message is sent as you at its time, or now; a bot's follow-up resumes it", async (t) => {
  const { plus, out, at, now } = await plusOf(t);
  const s = plus.schedule({ where: { room: "r1" }, text: "Buenos días", when: "mañana a las 9" });
  plus.schedule({ where: { share: "s1" }, text: "Te llamo luego", when: "en 1 hora" });
  assert.equal(plus.scheduled().length, 2);
  await plus.sendNow(plus.scheduled()[0].id);
  assert.deepEqual(out.sent, [{ where: { share: "s1" }, text: "Te llamo luego" }]);
  plus.followup({ missionId: "c1", botId: "vera", when: "en 30 minutos", note: "mirar si respondió" });
  at(s.at + 1);
  await plus.due();
  assert.deepEqual(out.sent.at(-1), { where: { room: "r1" }, text: "Buenos días" });
  assert.deepEqual(out.resumed, [{ missionId: "c1", botId: "vera", note: "mirar si respondió" }]);
  assert.equal(plus.scheduled().length, 0);
  assert.throws(() => plus.schedule({ where: { room: "r1" }, text: "x", at: now() - 1000 }), /ya ha pasado/);
  assert.equal(urlOf({}), "/chats");
});
