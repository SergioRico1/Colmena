import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, settle } from "./fixtures/runtime-fixture.mjs";
import { roomSlug } from "../server/runtime.mjs";
import { forkRoom, snoozeUntil, wakeDue, watchRooms } from "../server/rooms.mjs";

const tick = () => new Promise((r) => setImmediate(r));

test("snooze presets: this afternoon, tomorrow morning, next Monday", () => {
  const thursday = new Date(2026, 9, 15, 11, 0);
  assert.equal(snoozeUntil("tarde", thursday), new Date(2026, 9, 15, 17, 0).toISOString());
  assert.equal(snoozeUntil("tarde", new Date(2026, 9, 15, 18, 0)), new Date(2026, 9, 16, 9, 0).toISOString(), "too late: tomorrow");
  assert.equal(snoozeUntil("manana", thursday), new Date(2026, 9, 16, 9, 0).toISOString());
  assert.equal(snoozeUntil("lunes", thursday), new Date(2026, 9, 19, 9, 0).toISOString());
  assert.equal(snoozeUntil("lunes", new Date(2026, 9, 19, 8, 0)), new Date(2026, 9, 26, 9, 0).toISOString(), "on a Monday: the next one");
});

test("a snoozed or archived room comes back when something happens or its time comes", async (t) => {
  const { store } = await fixture(t, async () => answer("ok"));
  const stop = watchRooms(store);
  t.after(stop);
  const later = new Date(Date.now() + 3600e3).toISOString();
  store.put("missions", { id: "a", title: "Ventas", room: "ventas", status: "waiting", botIds: ["nora"], snoozedUntil: later });
  store.patch("missions", "a", { title: "Ventas Q3" });
  await tick();
  assert.equal(store.get("missions", "a").snoozedUntil, later, "snoozed while it waits: stays snoozed");
  store.put("messages", { id: "m1", missionId: "a", role: "assistant", botId: "nora", text: "Ya está", at: new Date().toISOString() });
  await tick();
  assert.equal(store.get("missions", "a").snoozedUntil, null, "a bot answered: back");
  store.put("missions", { id: "b", title: "Viaje", room: "viaje", status: "completed", botIds: ["nora"], archived: true });
  store.patch("missions", "b", { status: "waiting" });
  await tick();
  assert.equal(store.get("missions", "b").archived, false, "it needs you: back");
  store.put("missions", { id: "c", title: "Gastos", room: "gastos", status: "completed", botIds: ["tomas"], snoozedUntil: new Date(Date.now() - 1000).toISOString() });
  const notices = [];
  assert.deepEqual(wakeDue(store, (n) => notices.push(n)).map((m) => m.id), ["c"]);
  assert.equal(store.get("missions", "c").snoozedUntil, null);
  assert.match(notices[0].title, /Vuelve #gastos/);
});

test("«Duplicar desde aquí» copies the conversation up to a message and the bot remembers it", async (t) => {
  const inputs = [];
  let n = 0;
  const { store, runtime } = await fixture(t, async ({ input }) => {
    inputs.push(JSON.stringify(input));
    n += 1;
    return answer(n === 1 ? "Opción A: Lisboa." : n === 2 ? "Opción B: Oporto." : "Entonces probamos con Sevilla.");
  });
  const m = runtime.create({ prompt: "Ideas para un viaje", mode: "solo", botIds: ["nora"], conversation: true });
  await runtime.launch(m.id);
  runtime.addMessage(m.id, "Dame otra");
  await settle(runtime);
  const firstAnswer = store.list("messages").find((x) => x.missionId === m.id && x.text === "Opción A: Lisboa.");
  const copy = forkRoom(store, m.id, firstAnswer.id, { slug: roomSlug });
  assert.equal(copy.title, m.title + " (copia)");
  assert.equal(copy.status, "completed");
  const copied = store.list("messages").filter((x) => x.missionId === copy.id);
  assert.deepEqual(copied.filter((x) => x.copied).map((x) => x.text), ["Ideas para un viaje", "Opción A: Lisboa."]);
  assert.ok(copied.some((x) => x.kind === "fork"), "one line says it is a copy");
  runtime.addMessage(copy.id, "¿Y algo en España?");
  await settle(runtime);
  assert.match(inputs.at(-1), /Opción A: Lisboa/);
  assert.doesNotMatch(inputs.at(-1), /Oporto/, "what came after the cut is not in the copy");
  assert.equal(store.list("messages").filter((x) => x.missionId === m.id).length, 4, "the original is untouched");
});
