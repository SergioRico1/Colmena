// A step's provider conversation is a record of its own (server/histories.mjs): the step
// record stays small, older records that carry it inline still read and are moved in batches,
// and it goes away with its mission.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { context, toolCalls } from "../server/state.mjs";
import { encryptDatabase } from "../server/db-crypto.mjs";
import { HISTORIES, hasHistory, historySize, migrateHistories, setStepHistory, startHistoryMigration, stepHistory } from "../server/histories.mjs";
import { answer, call, fixture } from "./fixtures/runtime-fixture.mjs";

const PAGE = "x".repeat(20_000);
const conversation = (n = 3, mark = "") => [
  { role: "user", content: "Encargo " + mark },
  ...Array.from({ length: n }, (_, i) => [
    { type: "function_call", name: "web_fetch", call_id: "c" + i, arguments: JSON.stringify({ url: "https://example.com/" + i }) },
    { type: "function_call_output", call_id: "c" + i, output: JSON.stringify({ url: "https://example.com/" + i, title: "Página " + i, text: PAGE }) },
  ]).flat(),
];
const inlineStep = (store, id, missionId = "m1", extra = {}) =>
  store.put("steps", { id, key: id, missionId, botId: "nora", kind: "solo", status: "completed", text: "Hecho", pending: [], history: conversation(3, id), ...extra });
const stepBytes = (store) => store.db.prepare("SELECT coalesce(sum(length(data)),0) AS n FROM records WHERE kind='steps'").get().n;
async function tempStore(t, options) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-hist-"));
  let store = new Store(directory, options);
  t.after(async () => {
    try { store.close(); } catch {}
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, store, reopen: (o) => { try { store.close(); } catch {} store = new Store(directory, o); return store; } };
}

test("after a run the step record has no conversation: it is a record of its own, with a count and the tool cards", async (t) => {
  let round = 0;
  const { store, runtime } = await fixture(t, async () => (round++ === 0 ? call("list_files", {}, "f1") : answer("Listo.")));
  const m = runtime.create({ prompt: "Mira los archivos", mode: "solo", botIds: ["nora"] });
  await runtime.launch(m.id);
  const step = runtime.steps(m.id)[0];
  assert.equal(step.status, "completed");
  assert.ok(!("history" in step), "no inline conversation");
  assert.ok(!JSON.stringify(step).includes("function_call_output"), "nor any tool output");
  const items = runtime.history(step.id);
  assert.ok(Array.isArray(items) && items.some((x) => x.type === "function_call_output" && x.call_id === "f1"));
  assert.equal(step.historyItems, items.length);
  assert.equal(hasHistory(step), true);
  assert.deepEqual(store.get(HISTORIES, step.id).missionId, m.id);
  // The cards a room shows come from the step record alone, and match the conversation's.
  const bots = new Map(store.list("bots").map((b) => [b.id, b]));
  const receipt = (id) => store.get("receipts", step.id + ":" + id);
  const cards = toolCalls(step, { bots, receipt });
  assert.deepEqual(cards.map((c) => [c.id, c.name, c.status]), [["f1", "list_files", "done"]]);
  assert.deepEqual(cards, toolCalls({ ...step, history: items }, { bots, receipt }));
  assert.deepEqual(runtime.liveStep(step.id).history, items);
});

test("a step that has not started has no conversation and no record of it", async (t) => {
  const { store, runtime } = await fixture(t, async () => answer("x"));
  const step = runtime.makeStep("m1", "a", "nora", "solo");
  assert.equal(runtime.history(step.id), null);
  assert.equal(hasHistory(step), false);
  assert.equal(historySize(step), 0);
  assert.equal(store.get(HISTORIES, step.id), null);
  assert.equal(runtime.history("nope"), null);
});

test("an older record with the conversation inline still reads, and its first write moves it", async (t) => {
  const { store } = await tempStore(t);
  const old = inlineStep(store, "s1");
  assert.deepEqual(stepHistory(store, "s1"), old.history, "by id");
  assert.deepEqual(stepHistory(store, old), old.history, "by record");
  assert.equal(hasHistory(old), true);
  assert.equal(historySize(old), 7);
  assert.equal(toolCalls(old).length, 3, "its cards come from the inline conversation");
  const next = [...old.history, { role: "user", content: "Sigue" }];
  const step = setStepHistory(store, "s1", next, { status: "pending" });
  assert.equal(step.status, "pending");
  const stored = store.get("steps", "s1");
  assert.ok(!("history" in stored), "the inline copy is gone");
  assert.equal(stored.historyItems, 8);
  assert.deepEqual(stepHistory(store, "s1"), next);
  assert.equal(toolCalls(stored).length, 3);
  // The record of its own wins over a stale inline copy.
  store.put("steps", { ...stored, history: [{ role: "user", content: "viejo" }] });
  assert.deepEqual(stepHistory(store, "s1"), next);
});

test("a resumed older step runs from its inline conversation and leaves it in its own record", async (t) => {
  const seen = [];
  const { store, runtime } = await fixture(t, async (request) => { seen.push(request.input); return answer("Terminado."); });
  const m = runtime.create({ prompt: "Encargo viejo", mode: "solo", botIds: ["nora"] });
  const step = runtime.steps(m.id)[0];
  store.put("steps", { ...step, status: "pending", instructions: "Eres Nora.", model: "fixture", history: [{ role: "user", content: "Encargo viejo, ya empezado" }] });
  await runtime.launch(m.id);
  assert.match(JSON.stringify(seen[0]), /ya empezado/);
  const done = store.get("steps", step.id);
  assert.equal(done.status, "completed");
  assert.ok(!("history" in done));
  assert.match(JSON.stringify(runtime.history(step.id)), /ya empezado/);
});

test("the move is batched, tells nobody, loses nothing and can run again", async (t) => {
  const { store } = await tempStore(t);
  const before = new Map();
  for (let i = 0; i < 12; i++) before.set("s" + i, inlineStep(store, "s" + i, "m" + (i % 3)).history);
  store.put("steps", { id: "new", key: "new", missionId: "m1", botId: "nora", kind: "solo", status: "pending", pending: [] });
  const order = store.list("steps").map((s) => s.id);
  const heavy = stepBytes(store);
  const heard = [];
  store.listeners.add((e) => heard.push(e));
  // Five steps at a time.
  let after = "", batches = 0, moved = 0;
  for (;;) {
    const r = migrateHistories(store, { after, max: 5, ms: 60_000 });
    batches++;
    moved += r.moved;
    after = r.after;
    if (r.done) break;
    assert.ok(store.list("steps").some((s) => Array.isArray(s.history)), "still some to go");
  }
  assert.equal(moved, 12);
  assert.ok(batches >= 3);
  assert.deepEqual(heard, [], "no listener heard of it");
  assert.deepEqual(store.list("steps").map((s) => s.id), order, "the steps keep their order");
  for (const s of store.list("steps")) {
    assert.ok(!("history" in s), s.id);
    if (s.id === "new") { assert.equal(stepHistory(store, s), null); continue; }
    assert.deepEqual(stepHistory(store, s.id), before.get(s.id));
    assert.equal(s.historyItems, 7);
    assert.equal(toolCalls(s).length, 3);
    assert.equal(toolCalls(s)[0].card.title, "Página 0");
    assert.equal(store.get(HISTORIES, s.id).missionId, s.missionId);
  }
  assert.ok(stepBytes(store) < heavy / 20, "the step records are small now");
  assert.equal(store.where(HISTORIES, "missionId", "m1").length, 4);
  // Again: nothing to do, nothing changes.
  const snapshot = JSON.stringify([store.list("steps"), store.list(HISTORIES)]);
  assert.deepEqual(migrateHistories(store, { ms: 60_000, max: 1000 }), { moved: 0, after: "s9", done: true });
  assert.equal(JSON.stringify([store.list("steps"), store.list(HISTORIES)]), snapshot);
});

test("a move cut half-way loses nothing: the batch did not happen, and the next start finishes it", async (t) => {
  const { store, reopen } = await tempStore(t);
  const before = new Map();
  for (let i = 0; i < 6; i++) before.set("s" + i, inlineStep(store, "s" + i).history);
  assert.equal(migrateHistories(store, { max: 2, ms: 60_000 }).moved, 2);
  // The third step of the next batch fails to write: the whole batch is rolled back.
  const put = store.put.bind(store);
  let writes = 0;
  store.put = (...args) => { if (++writes === 4) throw Error("disco lleno"); return put(...args); };
  assert.throws(() => migrateHistories(store, { after: "s1", max: 10, ms: 60_000 }), /disco lleno/);
  store.put = put;
  assert.equal(store.list(HISTORIES).length, 2, "only the first batch is there");
  assert.equal(store.list("steps").filter((s) => Array.isArray(s.history)).length, 4);
  for (const [id, history] of before) assert.deepEqual(stepHistory(store, id), history, id);
  // Closed and opened again: the background move starts over and finishes.
  const again = reopen();
  assert.equal(await startHistoryMigration(again, { pause: 1, max: 2 }), 4);
  assert.equal(again.list("steps").filter((s) => "history" in s).length, 0);
  for (const [id, history] of before) assert.deepEqual(stepHistory(again, id), history, id);
  assert.equal(await startHistoryMigration(again, { pause: 1 }), 0, "idempotent");
});

test("the move keeps a conversation that already has its own record, and stops quietly if the store closes", async (t) => {
  const { store } = await tempStore(t);
  inlineStep(store, "s1");
  const newer = [{ role: "user", content: "el bueno" }];
  store.put(HISTORIES, { id: "s1", missionId: "m1", items: newer });
  assert.equal(migrateHistories(store).moved, 1);
  assert.deepEqual(stepHistory(store, "s1"), newer);
  assert.equal(store.get("steps", "s1").historyItems, 1);
  inlineStep(store, "s2");
  const running = startHistoryMigration(store, { pause: 5 });
  store.close();
  assert.equal(await running, 0);
});

test("an encrypted database moves its conversations too, and nothing of them stays readable in the step", async (t) => {
  const { directory, store: plain, reopen } = await tempStore(t);
  const history = inlineStep(plain, "s1").history;
  plain.close();
  const key = randomBytes(32);
  encryptDatabase(path.join(directory, "colmena.sqlite"), key);
  const store = reopen({ key });
  assert.equal(store.encrypted, true);
  assert.deepEqual(stepHistory(store, "s1"), history, "inline, before the move");
  assert.deepEqual(migrateHistories(store), { moved: 1, after: "s1", done: true });
  assert.ok(!("history" in store.get("steps", "s1")));
  assert.deepEqual(stepHistory(store, "s1"), history);
  assert.equal(store.where(HISTORIES, "missionId", "m1").length, 1, "found by its mission");
  const raw = store.db.prepare("SELECT data FROM records WHERE kind='histories' AND id='s1'").get().data;
  assert.ok(!String(raw).includes("example.com"), "stored encrypted");
});

test("deleting a room deletes the conversations of its steps; another room keeps its own", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-hist-api-"));
  const store = new Store(dir);
  const runtime = new Runtime(store, { respond: async () => answer("Hecho.") });
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
  store.patch("settings", "main", { model: "fixture", learning: false });
  const gone = runtime.create({ prompt: "Uno", mode: "solo", botIds: ["nora"] });
  const kept = runtime.create({ prompt: "Dos", mode: "solo", botIds: ["nora"] });
  await runtime.launch(gone.id);
  await runtime.launch(kept.id);
  // An older step of the same room, still inline, goes away as before.
  inlineStep(store, gone.id + ":viejo", gone.id);
  assert.equal(store.where(HISTORIES, "missionId", gone.id).length, 1);
  const detail = await (await fetch(origin + "/api/missions/" + gone.id)).json();
  assert.equal(detail.steps.length, 2);
  assert.ok(detail.steps.every((s) => !("history" in s) && !("cards" in s) && Array.isArray(s.tools)));
  assert.equal(detail.steps.find((s) => s.id.endsWith(":viejo")).tools.length, 3);
  const res = await fetch(origin + "/api/missions/" + gone.id, { method: "DELETE", headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: "{}" });
  assert.equal(res.status, 200);
  assert.equal(store.where("steps", "missionId", gone.id).length, 0);
  assert.equal(store.where(HISTORIES, "missionId", gone.id).length, 0);
  assert.equal(store.list(HISTORIES).length, 1);
  assert.ok(Array.isArray(runtime.history(runtime.steps(kept.id)[0].id)));
});

test("an expired incognito chat takes its conversations with it", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-hist-inc-"));
  const store = new Store(dir);
  const runtime = new Runtime(store, { respond: async () => answer("Hecho.") });
  store.patch("settings", "main", { model: "fixture", learning: false });
  const m = runtime.create({ prompt: "Privado", mode: "solo", botIds: ["nora"], conversation: true });
  await runtime.launch(m.id);
  assert.equal(store.where(HISTORIES, "missionId", m.id).length, 1);
  store.patch("missions", m.id, { incognito: true, expiresAt: new Date(Date.now() - 1000).toISOString() });
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const app = createApp({ store, runtime, session: { status: () => null, models: [] }, getOrigin: () => "http://127.0.0.1" });
  t.after(async () => {
    t.mock.timers.reset();
    await runtime.shutdown();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  assert.ok(app);
  t.mock.timers.tick(3000); // the first sweep
  t.mock.timers.reset();
  for (let i = 0; i < 200 && store.get("missions", m.id); i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(store.get("missions", m.id), null);
  assert.equal(store.where("steps", "missionId", m.id).length, 0);
  assert.equal(store.where(HISTORIES, "missionId", m.id).length, 0);
});

test("old tool outputs of a finished step are slimmed in its conversation record; a step at work keeps them", async (t) => {
  const { store } = await tempStore(t);
  const big = JSON.stringify({ text: "y".repeat(50_000) });
  const items = [{ role: "user", content: "Encargo" }, { type: "function_call", name: "web_fetch", call_id: "a", arguments: "{}" }, { type: "function_call_output", call_id: "a", output: big }];
  for (const [id, status] of [["done", "completed"], ["busy", "running"]]) {
    store.put("steps", { id, key: id, missionId: "m1", botId: "nora", kind: "solo", status, pending: [] });
    setStepHistory(store, id, items);
  }
  const cards = toolCalls(store.get("steps", "done"));
  assert.equal(store.pruneReceipts(7, Date.now() + 8 * 86400000), 1);
  const slim = stepHistory(store, "done");
  assert.ok(slim[2].output.length < 6000 && /recortado/.test(slim[2].output));
  assert.equal(slim[2].call_id, "a");
  assert.equal(stepHistory(store, "busy")[2].output, big);
  assert.deepEqual(toolCalls(store.get("steps", "done")), cards, "the cards stay as they were");
});

test("the tool cards of a step follow its calls: open ones by its receipts and state, big arguments from step.pending", async (t) => {
  const { store } = await tempStore(t);
  const content = "z".repeat(20_000);
  const write = { type: "function_call", name: "write_file", call_id: "w", arguments: JSON.stringify({ path: "informe.md", content }) };
  const fetched = { type: "function_call", name: "web_fetch", call_id: "f", arguments: JSON.stringify({ url: "https://example.com/a" }) };
  const search = { type: "web_search_call", id: "ws1", status: "completed", action: { type: "search", query: "tarifas luz" } };
  store.put("steps", { id: "s", key: "s", missionId: "m1", botId: "nora", kind: "solo", status: "running", pending: [fetched, write] });
  const items = [{ role: "user", content: "Encargo" }, search, fetched, write];
  setStepHistory(store, "s", items);
  const step = store.get("steps", "s");
  assert.ok(JSON.stringify(step.cards).length < 2000, "the digest does not copy big arguments");
  const receipt = (id) => (id === "f" ? { result: { url: "https://example.com/a", title: "Tarifas", text: "…" } } : null);
  const expected = toolCalls({ ...step, cards: undefined, history: items }, { receipt });
  assert.deepEqual(toolCalls(step, { receipt }), expected);
  assert.deepEqual(expected.map((c) => [c.name, c.status]), [["web_search", "done"], ["web_fetch", "done"], ["write_file", "running"]]);
  assert.equal(expected[2].card.title, "informe.md");
  // Stopped with the calls unanswered: «se interrumpió», as before.
  const stopped = { ...step, status: "failed" };
  assert.deepEqual(toolCalls(stopped), toolCalls({ ...stopped, cards: undefined, history: items }));
  assert.equal(toolCalls(stopped)[2].status, "error");
});

test("listing a mission's steps and the state index never read the conversations", async (t) => {
  const { store, runtime } = await fixture(t, async () => answer("x"));
  const m = runtime.create({ prompt: "Largo", mode: "solo", botIds: ["nora"] });
  for (let i = 0; i < 30; i++) {
    const s = runtime.makeStep(m.id, "k" + i, "nora", "followup");
    runtime.setHistory(s.id, conversation(10, "k" + i), { status: "completed" });
  }
  const reads = [];
  const get = store.get.bind(store);
  store.get = (kind, id) => { reads.push(kind); return get(kind, id); };
  const steps = runtime.steps(m.id);
  const ctx = context(store, runtime);
  for (const s of steps) toolCalls(s, { bots: ctx.bots, receipt: (id) => store.get("receipts", s.id + ":" + id) });
  store.get = get;
  assert.equal(steps.length, 31);
  assert.ok(!reads.includes(HISTORIES), "no conversation was read");
  assert.ok(!reads.includes("receipts"), "nor a receipt: every call has its card");
  assert.ok(stepBytes(store) < 31 * 12_000, "step records stay small: " + stepBytes(store));
  assert.ok(JSON.stringify(steps).length < 31 * 12_000);
});
