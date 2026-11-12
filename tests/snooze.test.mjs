import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { pendingCount, waitingApprovals } from "../server/notifications.mjs";
import { createSnoozeWaker, isSnoozed as storedSnoozed, snoozeDeadline as storedDeadline, snoozeProblem } from "../server/snooze.mjs";
import { isSnoozed, snoozeChoices, snoozeChoicesFor, snoozeDeadline, snoozeWhen, snoozedLabel, splitSnoozed } from "../src/lib/snooze.js";
import { needsCount, needsOf } from "../src/components/v2/needs.js";

// «Recordar después» in «Te necesitan»: the three times (src/lib/snooze.js), what counts as
// waiting while something is put off (needs.js, notifications.mjs pendingCount) and the
// endpoint that keeps the time on the approval (server/routes/approvals.mjs, snooze.mjs).

// Local times throughout: the helpers work in the person's own clock.
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);
const parts = (d) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];
const pick = (now, id) => snoozeChoices(now).find((c) => c.id === id)?.at;

test("the three choices: in one hour, tomorrow at 9:00, Monday of next week at 9:00", () => {
  const now = local(2026, 11, 12, 16, 40); // a Thursday
  const choices = snoozeChoices(now);
  assert.deepEqual(choices.map((c) => c.id), ["hour", "tomorrow", "week"]);
  assert.deepEqual(choices.map((c) => c.label), ["Dentro de 1 hora", "Mañana a las 9:00", "La semana que viene (lunes a las 9:00)"]);
  assert.deepEqual(parts(choices[0].at), [2026, 11, 12, 17, 40]);
  assert.deepEqual(parts(choices[1].at), [2026, 11, 13, 9, 0]);
  assert.deepEqual(parts(choices[2].at), [2026, 11, 16, 9, 0]);
  assert.equal(choices[2].at.getDay(), 1);
});

test("«mañana a las 9:00» crosses the end of a month and of a year", () => {
  assert.deepEqual(parts(pick(local(2026, 1, 31, 23, 59), "tomorrow")), [2026, 2, 1, 9, 0]);
  assert.deepEqual(parts(pick(local(2028, 2, 28, 8, 0), "tomorrow")), [2028, 2, 29, 9, 0], "a leap year");
  assert.deepEqual(parts(pick(local(2026, 12, 31, 18, 0), "tomorrow")), [2027, 1, 1, 9, 0]);
  // Before 9:00 it is still tomorrow, never «today at 9:00».
  assert.deepEqual(parts(pick(local(2026, 11, 12, 0, 5), "tomorrow")), [2026, 11, 13, 9, 0]);
  // One hour from 23:30 is already the next day.
  assert.deepEqual(parts(pick(local(2026, 12, 31, 23, 30), "hour")), [2027, 1, 1, 0, 30]);
});

test("«lunes a las 9:00» is the Monday of next week, across month and year ends", () => {
  // Every day of one week lands on the following Monday.
  for (let d = 9; d <= 14; d++) assert.deepEqual(parts(pick(local(2026, 11, d, 12), "week")), [2026, 11, 16, 9, 0], `from the ${d}`);
  // On a Monday: the next one, never the same day.
  assert.deepEqual(parts(pick(local(2026, 11, 9, 7, 0), "week")), [2026, 11, 16, 9, 0]);
  assert.deepEqual(parts(pick(local(2026, 11, 26, 10), "week")), [2026, 11, 30, 9, 0]);
  assert.deepEqual(parts(pick(local(2026, 11, 30, 10), "week")), [2026, 12, 7, 9, 0], "a Monday at the end of a month");
  assert.deepEqual(parts(pick(local(2026, 12, 29, 10), "week")), [2027, 1, 4, 9, 0], "across the year");
  assert.deepEqual(parts(pick(local(2026, 12, 31, 23, 59), "week")), [2027, 1, 4, 9, 0]);
  for (const now of [local(2026, 11, 12), local(2026, 12, 30), local(2027, 2, 27)]) assert.equal(pick(now, "week").getDay(), 1);
});

test("on a Sunday next Monday is tomorrow: the choice is not offered twice", () => {
  const sunday = local(2026, 11, 15, 20, 0);
  assert.deepEqual(snoozeChoices(sunday).map((c) => c.id), ["hour", "tomorrow"]);
  assert.deepEqual(parts(pick(sunday, "tomorrow")), [2026, 11, 16, 9, 0]);
});

test("what has a deadline is never put off past it: those choices are hidden", () => {
  const now = local(2026, 11, 12, 16, 0);
  const iso = (d) => d.toISOString();
  const pending = { id: "a", status: "pending" };
  assert.equal(snoozeChoicesFor(pending, now).length, 3, "no deadline: every choice");
  // A send expires 30 minutes after it was prepared: nothing can be put off.
  assert.deepEqual(snoozeChoicesFor({ ...pending, kind: "send", expiresAt: iso(local(2026, 11, 12, 16, 30)) }, now), []);
  // A send that leaves on its own in seconds.
  assert.deepEqual(snoozeChoicesFor({ ...pending, autoSendAt: iso(local(2026, 11, 12, 16, 0, 10)) }, now), []);
  // A question the bot waits for until tomorrow noon: an hour and tomorrow 9:00 fit, Monday does not.
  assert.deepEqual(snoozeChoicesFor({ ...pending, kind: "question", waitUntil: iso(local(2026, 11, 13, 12)) }, now).map((c) => c.id), ["hour", "tomorrow"]);
  // Once that wait ended the bot went on: the question stays open with no deadline.
  assert.equal(snoozeChoicesFor({ ...pending, kind: "question", waitUntil: iso(local(2026, 11, 12, 15)), stillOpen: true }, now).length, 3);
  // A deadline exactly at the choice's time counts as passing first.
  assert.deepEqual(snoozeChoicesFor({ ...pending, expiresAt: iso(local(2026, 11, 13, 9)) }, now).map((c) => c.id), ["hour"]);
  // A folded card takes what all of its requests can take.
  assert.deepEqual(snoozeChoicesFor([pending, { ...pending, id: "b", expiresAt: iso(local(2026, 11, 12, 18)) }], now).map((c) => c.id), ["hour"]);
  // Nothing to put off once decided.
  assert.deepEqual(snoozeChoicesFor({ id: "a", status: "approved" }, now), []);
  assert.deepEqual(snoozeChoicesFor([], now), []);
  assert.equal(snoozeDeadline(pending), null);
});

test("what is put off leaves the list and the counts until its time, then counts again", () => {
  const now = Date.parse("2026-11-12T10:00:00Z");
  const approvals = [
    { id: "a1", missionId: "m1", status: "pending", createdAt: "2026-11-12T08:00:00Z" },
    { id: "a2", missionId: "m2", status: "pending", snoozedUntil: "2026-11-13T09:00:00Z" },
    { id: "a3", missionId: "m3", status: "pending", snoozedUntil: "2026-11-12T10:30:00Z" },
    { id: "a4", missionId: "m4", status: "pending", snoozedUntil: "2026-11-12T09:00:00Z" }, // its time has come
    { id: "a5", missionId: "m5", status: "approved", snoozedUntil: "2026-11-13T09:00:00Z" }, // decided meanwhile
  ];
  const missions = [
    { id: "m2", status: "awaiting_plan" }, // its plan is put off: the room must not count instead
    { id: "m9", status: "awaiting_choice" },
  ];
  const store = { approvals, missions, watchNotes: [{ id: "n1" }] };
  const needs = needsOf(store, now);
  assert.deepEqual(needs.asks.map((a) => a.id), ["a1", "a4"]);
  assert.deepEqual(needs.snoozed.map((a) => a.id), ["a3", "a2"], "the soonest back first");
  assert.deepEqual(needs.choices.map((m) => m.id), ["m9"]);
  assert.equal(needsCount(store, now), 4);
  assert.equal(needsCount({ ...store, approvals: approvals.map(({ snoozedUntil, ...a }) => a) }, now), 6, "nothing put off: all four pending count");
  // At its time it is back.
  const later = Date.parse("2026-11-12T10:30:00Z");
  assert.deepEqual(needsOf(store, later).asks.map((a) => a.id), ["a1", "a3", "a4"]);
  assert.equal(needsCount(store, later), 5);
  assert.equal(isSnoozed(approvals[1], now), true);
  assert.equal(isSnoozed(approvals[3], now), false);
  assert.equal(isSnoozed(approvals[4], now), false);
  assert.equal(isSnoozed({ status: "pending", snoozedUntil: "no es una fecha" }, now), false);
  assert.deepEqual(splitSnoozed([], now), { waiting: [], snoozed: [] });
  assert.equal(snoozedLabel(1), "1 pospuesto");
  assert.equal(snoozedLabel(2), "2 pospuestos");
});

test("«vuelve mañana a las 9:00»", () => {
  const now = local(2026, 11, 12, 16, 40);
  assert.equal(snoozeWhen(local(2026, 11, 12, 17, 40), now), "hoy a las 17:40");
  assert.equal(snoozeWhen(local(2026, 11, 13, 9, 0), now), "mañana a las 9:00");
  assert.equal(snoozeWhen(local(2026, 11, 16, 9, 0), now), "el lunes 16 a las 9:00");
  assert.equal(snoozeWhen("nada", now), "");
});

// ---------------------------------------------------------------- server

async function setup(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-snooze-"));
  const store = new Store(dir);
  const runtime = new Runtime(store, { respond: async () => { throw Error("No provider calls in API tests"); } });
  let origin;
  const server = http.createServer(createApp({ store, runtime, session: { status: () => null, models: [] }, getOrigin: () => origin }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  const csrf = (await (await fetch(origin + "/api/bootstrap")).json()).csrf;
  t.after(async () => {
    await runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const post = (route, body = {}) => fetch(origin + "/api" + route, { method: "POST", headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: JSON.stringify(body) });
  const get = async (route) => (await fetch(origin + "/api" + route)).json();
  return { store, runtime, post, get };
}

const inHours = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const seed = (store) => {
  store.put("missions", { id: "m1", title: "Informe", prompt: "x", mode: "solo", botIds: ["vera"], status: "waiting", createdAt: new Date().toISOString() });
  store.put("approvals", { id: "q1", missionId: "m1", botId: "vera", kind: "question", status: "pending", title: "¿Qué formato?", options: [{ id: "o1", label: "PDF" }, { id: "o2", label: "Word" }], createdAt: new Date().toISOString() });
  store.put("approvals", { id: "w1", missionId: "m1", botId: "vera", kind: "write", tool: "write_file", status: "pending", title: "Crear «notas.md»", args: { path: "notas.md" }, createdAt: new Date().toISOString() });
};

test("POST /approvals/:id/snooze keeps the time on the approval and takes it out of the counts", async (t) => {
  const { store, post, get } = await setup(t);
  seed(store);
  assert.equal(pendingCount(store), 2);
  const until = inHours(1);
  const res = await post("/approvals/q1/snooze", { until });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).snoozedUntil, until);
  // On the record, not in the browser: another window, the tray and a restart all see it.
  assert.equal(store.get("approvals", "q1").snoozedUntil, until);
  assert.equal(store.get("approvals", "q1").status, "pending", "nothing was decided: the bot keeps waiting");
  const state = await get("/state");
  assert.equal(state.approvals.find((a) => a.id === "q1").snoozedUntil, until);
  assert.equal(state.approvals.find((a) => a.id === "w1").snoozedUntil, null);
  assert.equal(needsCount(state), 1);
  assert.deepEqual(needsOf(state).snoozed.map((a) => a.id), ["q1"]);
  assert.equal(pendingCount(store), 1, "the tray and taskbar counter");
  assert.deepEqual(waitingApprovals(store).map((a) => a.id), ["w1"]);
  // When its time has come it counts again without anyone touching it.
  assert.equal(pendingCount(store, Date.parse(until) + 1), 2);
  assert.equal((await get("/state?_=" + Date.now())).approvals.find((a) => a.id === "q1").status, "pending");
  // Both put off: the room is not counted in their place.
  assert.equal((await post("/approvals/w1/snooze", { until })).status, 200);
  assert.equal(pendingCount(store), 0);
  // «Traer de vuelta».
  const back = await post("/approvals/q1/snooze", { until: null });
  assert.equal(back.status, 200);
  assert.equal(store.get("approvals", "q1").snoozedUntil, null);
  assert.equal(pendingCount(store), 1);
  assert.equal(needsCount(await get("/state")), 1);
});

test("the endpoint refuses a past or absurd time, a settled request and anything whose deadline comes first", async (t) => {
  const { store, post } = await setup(t);
  seed(store);
  assert.equal((await post("/approvals/q1/snooze", { until: new Date(Date.now() - 1000).toISOString() })).status, 409);
  assert.equal((await post("/approvals/q1/snooze", { until: inHours(24 * 60) })).status, 409);
  assert.equal((await post("/approvals/q1/snooze", { until: "mañana" })).status, 400);
  assert.equal((await post("/approvals/q1/snooze", {})).status, 400);
  assert.equal((await post("/approvals/nada/snooze", { until: inHours(1) })).status, 404);
  // A send expires 30 minutes after it was prepared.
  store.put("approvals", { id: "e1", missionId: "m1", botId: "vera", kind: "send", status: "pending", createdAt: new Date().toISOString(), email: { to: ["a@b.es"], cc: [], cco: [], subject: "Hola", body: "Texto", attachments: [] } });
  const expiring = await post("/approvals/e1/snooze", { until: inHours(1) });
  assert.equal(expiring.status, 409);
  assert.match((await expiring.json()).error, /caduca antes/);
  assert.equal(store.get("approvals", "e1").snoozedUntil ?? null, null);
  // A send you asked for that leaves on its own in a few seconds.
  store.put("approvals", { id: "e2", missionId: "m1", botId: "vera", kind: "permission", status: "pending", autoSendAt: new Date(Date.now() + 10e3).toISOString(), createdAt: new Date().toISOString() });
  assert.equal((await post("/approvals/e2/snooze", { until: inHours(1) })).status, 409);
  // A timed question: the bot goes on in 20 minutes.
  store.put("approvals", { id: "q2", missionId: "m1", botId: "vera", kind: "question", status: "pending", title: "¿Sigo?", waitUntil: new Date(Date.now() + 20 * 60e3).toISOString(), createdAt: new Date().toISOString() });
  assert.equal((await post("/approvals/q2/snooze", { until: inHours(1) })).status, 409);
  assert.equal((await post("/approvals/q2/snooze", { until: new Date(Date.now() + 10 * 60e3).toISOString() })).status, 200, "before its deadline it can wait");
  // Already decided.
  store.patch("approvals", "w1", { status: "approved" });
  assert.equal((await post("/approvals/w1/snooze", { until: inHours(1) })).status, 409);
});

test("stored approvals: deadlines and the waker that brings them back", () => {
  const time = Date.parse("2026-11-12T10:00:00Z");
  const base = { id: "a", status: "pending", createdAt: "2026-11-12T09:50:00Z" };
  assert.equal(storedDeadline({ ...base, kind: "write" }), null);
  assert.equal(storedDeadline({ ...base, kind: "send" }), Date.parse("2026-11-12T10:20:00Z"));
  assert.equal(storedDeadline({ ...base, kind: "send", deferred: true }), null, "left for later by a routine: it waits as long as it takes");
  assert.equal(storedDeadline({ ...base, kind: "question", waitUntil: "2026-11-12T11:00:00Z" }), Date.parse("2026-11-12T11:00:00Z"));
  assert.equal(storedDeadline({ ...base, kind: "question", waitUntil: "2026-11-12T09:55:00Z", timedOut: true }), null);
  assert.equal(storedDeadline({ ...base, kind: "secret", expiresAt: "2026-11-12T10:05:00Z" }), Date.parse("2026-11-12T10:05:00Z"));
  assert.equal(snoozeProblem({ ...base, kind: "write" }, "2026-11-12T11:00:00Z", time), null);
  assert.match(snoozeProblem({ ...base, kind: "send" }, "2026-11-12T11:00:00Z", time), /caduca antes/);
  assert.match(snoozeProblem({ ...base, status: "denied" }, "2026-11-12T11:00:00Z", time), /resuelto/);
  assert.equal(storedSnoozed({ ...base, snoozedUntil: "2026-11-12T11:00:00Z" }, time), true);
  assert.equal(storedSnoozed({ ...base, snoozedUntil: "2026-11-12T09:59:00Z" }, time), false);

  // The waker clears the mark when the time comes, which repaints every window and the tray.
  const records = new Map([
    ["due", { ...base, id: "due", snoozedUntil: "2026-11-12T09:59:00Z" }],
    ["later", { ...base, id: "later", snoozedUntil: "2026-11-12T12:00:00Z" }],
    ["done", { ...base, id: "done", status: "approved", snoozedUntil: "2026-11-12T12:00:00Z" }],
  ]);
  const patched = [];
  const fake = { list: () => [...records.values()], patch: (kind, id, data) => { patched.push(id); records.set(id, { ...records.get(id), ...data }); } };
  const waker = createSnoozeWaker(fake, { clock: () => time });
  waker.schedule();
  waker.stop();
  assert.deepEqual(patched.sort(), ["done", "due"]);
  assert.equal(records.get("due").snoozedUntil, null);
  assert.equal(records.get("later").snoozedUntil, "2026-11-12T12:00:00Z");
});
