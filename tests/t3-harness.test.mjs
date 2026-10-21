import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, settle } from "./fixtures/runtime-fixture.mjs";
import { composeInstructions, nowNote } from "../server/soul.mjs";
import { threadCut, THREAD_WINDOW, THREAD_STEP } from "../server/runtime.mjs";
import { buildState } from "../server/state.mjs";

test("the system prompt is the same all day: the time goes with each turn", async (t) => {
  const { store, directory } = await fixture(t, async () => answer("x"));
  const bot = store.get("bots", "nora");
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-22T08:01:00Z") });
  const first = composeInstructions(store, bot, { directory });
  const early = nowNote();
  t.mock.timers.setTime(Date.parse("2026-10-22T08:47:00Z"));
  assert.equal(composeInstructions(store, bot, { directory }), first, "same prefix for the prompt cache");
  assert.notEqual(nowNote(), early);
  assert.match(nowNote(), /^\[Ahora: \d\d:\d\d del /);
  // What changes (memory, context) is at the very end.
  assert.ok(first.indexOf("# Contexto") > first.indexOf("# Mientras trabajas"));
  assert.ok(first.indexOf("# Lo que sabes de la persona") > first.indexOf("# Lo más reciente manda"));
});

test("a chat's history window moves in steps, so its start stays cached", () => {
  assert.equal(threadCut(THREAD_WINDOW), 0);
  assert.equal(threadCut(THREAD_WINDOW + THREAD_STEP - 1), 0);
  assert.equal(threadCut(THREAD_WINDOW + THREAD_STEP), THREAD_STEP);
  assert.equal(threadCut(THREAD_WINDOW + 2 * THREAD_STEP - 1), THREAD_STEP);
  assert.equal(threadCut(THREAD_WINDOW + 2 * THREAD_STEP), 2 * THREAD_STEP);
});

test("a long chat sends one summary of what is before the cut, written once, then the turns after it", async (t) => {
  const summaries = [];
  const { store, runtime } = await fixture(t, async (request) => {
    if (/^Condensa una conversación/.test(request.instructions)) { summaries.push(JSON.parse(request.input[0].content)); return answer("- Quiere el informe de Klast el lunes."); }
    return answer("ok");
  });
  const m = runtime.create({ prompt: "Hola", mode: "solo", botIds: ["nora"], conversation: true });
  for (let i = 0; i < 45; i++) store.put("messages", { id: "x" + String(i).padStart(3, "0"), missionId: m.id, role: i % 2 ? "assistant" : "user", text: "mensaje " + i, at: new Date(Date.now() + i).toISOString() });
  const before = runtime.conversationTurns(m.id);
  await settle(runtime);
  assert.equal(summaries.length, 1, "one summary for this cut");
  const turns = runtime.conversationTurns(m.id);
  const total = store.where("messages", "missionId", m.id).filter((x) => x.text).length;
  const cut = threadCut(total);
  assert.equal(turns[0].content.startsWith("[Resumen de lo que hablamos antes"), true);
  assert.equal(turns.length, 1 + total - cut);
  assert.ok(before.length <= THREAD_WINDOW, "before the summary exists: the last turns, as before");
  // The next turns inside the same cut reuse it: no new summary, same first two messages.
  store.put("messages", { id: "y1", missionId: m.id, role: "user", text: "otra", at: new Date(Date.now() + 99).toISOString() });
  const next = runtime.conversationTurns(m.id);
  await settle(runtime);
  assert.equal(summaries.length, 1);
  assert.deepEqual(next.slice(0, 2), turns.slice(0, 2));
});

test("old big tool bodies keep a preview; recent ones and small ones stay whole", async (t) => {
  const { store } = await fixture(t, async () => answer("x"));
  const old = new Date(Date.now() - 10 * 86400000).toISOString();
  store.put("receipts", { id: "r-old", tool: "web_fetch", at: old, result: { text: "a".repeat(60000) } });
  store.put("receipts", { id: "r-new", tool: "web_fetch", at: new Date().toISOString(), result: { text: "b".repeat(60000) } });
  store.put("receipts", { id: "r-small", tool: "web_fetch", at: old, result: { text: "c" } });
  assert.equal(store.pruneReceipts(), 1);
  assert.equal(store.get("receipts", "r-old").result.recortado, true);
  assert.ok(store.get("receipts", "r-old").result.vista.length <= 4000);
  assert.equal(store.get("receipts", "r-new").result.text.length, 60000);
  assert.equal(store.get("receipts", "r-small").result.text, "c");
  assert.equal(Number(store.db.prepare("PRAGMA synchronous").get().synchronous), 1, "synchronous=NORMAL");
});

test("the state lists what a screen shows: automatic approvals only for a day", async (t) => {
  const { store, runtime } = await fixture(t, async () => answer("x"));
  const m = runtime.create({ prompt: "Hola", mode: "solo", botIds: ["nora"], conversation: true });
  const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
  const base = { missionId: m.id, botId: "nora", tool: "apps_execute", kind: "permission", status: "executed", title: "x" };
  store.put("approvals", { ...base, id: "auto-old", decidedBy: "automático", createdAt: ago(3), decidedAt: ago(3) });
  store.put("approvals", { ...base, id: "auto-new", decidedBy: "automático", createdAt: ago(0.1), decidedAt: ago(0.1) });
  store.put("approvals", { ...base, id: "mine-old", decidedBy: "tú", createdAt: ago(3), decidedAt: ago(3) });
  const ids = buildState(store, runtime, {}).approvals.map((a) => a.id);
  assert.ok(!ids.includes("auto-old"));
  assert.ok(ids.includes("auto-new") && ids.includes("mine-old"));
});

test("a failed accounts refresh keeps the accounts you had and retries sooner", async () => {
  const { ConnectorCache } = await import("../server/state.mjs");
  let fail = false;
  const cache = new ConnectorCache({ call: async () => { if (fail) throw Error("red"); return { items: [{ id: "ca_1", toolkit: "gmail", status: "ACTIVE" }] }; } }, () => {}, 60000);
  await cache.refresh();
  fail = true;
  const kept = await cache.refresh();
  assert.deepEqual(kept.map((a) => a.id), ["ca_1"]);
  assert.ok(Date.now() - cache.at > 60000 - 5000 - 50, "next try in ~5 s, not in a minute");
});

test("a long pause of the server is written down", async () => {
  const { watchStalls } = await import("../server/stalls.mjs");
  const lines = [];
  const w = watchStalls({ every: 60, threshold: 120, log: (l) => lines.push(l) });
  await new Promise((r) => setTimeout(r, 100)); // the monitor is sampling, as it is from start-up
  const until = Date.now() + 300;
  while (Date.now() < until) {} // the loop stands still
  // The sample of the pause lands on the next tick of the monitor: wait for it (up to 2 s).
  for (let i = 0; i < 40 && !w.state.count; i++) await new Promise((r) => setTimeout(r, 50));
  w.stop();
  assert.equal(w.state.count >= 1, true);
  assert.match(lines[0], /parado \d+ ms/);
});
