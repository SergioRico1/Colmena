import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { CHAT_PAGE, historyPage, stepsForPage } from "../server/history.mjs";
import { createLiveCoalescer } from "../server/live-coalescer.mjs";

const at = (i) => new Date(Date.UTC(2026, 9, 1) + i * 60000).toISOString();
const chat = (turns) => {
  const messages = [];
  const steps = [];
  for (let i = 0; i < turns; i++) {
    messages.push({ id: "u" + i, role: "user", text: "pregunta " + i, at: at(i * 3) });
    if (i % 2 === 0) messages.push({ id: "p" + i, role: "assistant", kind: "progress", stepId: "s" + i, text: "mirando", at: at(i * 3 + 1) });
    messages.push({ id: "a" + i, role: "assistant", text: "respuesta " + i, stepId: "s" + i, at: at(i * 3 + 2) });
    steps.push({ id: "s" + i, status: "completed", startedAt: at(i * 3), completedAt: at(i * 3 + 2) });
  }
  return { messages, steps };
};

test("history pages hold whole messages with their progress lines and walk back to the start", () => {
  const { messages } = chat(100); // 200 top-level messages
  const first = historyPage(messages, { limit: 75 });
  assert.equal(first.messages.filter((m) => m.kind !== "progress").length, 75);
  assert.equal(first.olderCount, 125);
  assert.equal(first.cursor, first.messages[0].id);
  assert.equal(first.until, null);
  // The progress line of a shown answer comes along; none of the hidden ones do.
  const shownSteps = new Set(first.messages.filter((m) => m.stepId && m.kind !== "progress").map((m) => m.stepId));
  for (const p of first.messages.filter((m) => m.kind === "progress")) assert.ok(shownSteps.has(p.stepId));

  const seen = new Set(first.messages.map((m) => m.id));
  let cursor = first.cursor;
  let pages = 1;
  while (cursor) {
    const page = historyPage(messages, { before: cursor, limit: 75 });
    for (const m of page.messages) {
      assert.ok(!seen.has(m.id), "pages never overlap: " + m.id);
      seen.add(m.id);
    }
    cursor = page.cursor;
    pages++;
  }
  assert.equal(pages, 3);
  assert.equal(seen.size, messages.length, "every message is reachable exactly once");
  assert.equal(historyPage(messages, { before: "nope" }), null);
});

test("a page brings only the steps its messages need; the latest one keeps unfinished work", () => {
  const { messages, steps } = chat(100);
  steps.push({ id: "live", status: "running", startedAt: at(1) });
  const latest = historyPage(messages, { limit: 20 });
  const ids = stepsForPage(steps, latest).map((s) => s.id);
  assert.ok(ids.includes("live"), "a running step always comes with the latest page");
  assert.ok(ids.includes("s99") && !ids.includes("s10"));
  const older = historyPage(messages, { before: latest.cursor, limit: 20 });
  const olderIds = stepsForPage(steps, older).map((s) => s.id);
  assert.ok(!olderIds.includes("live") && olderIds.includes("s85") && !olderIds.includes("s99"));
});

test("live text and activity travel in 50 ms windows without changing their order", () => {
  const out = [];
  let fire = null;
  const live = createLiveCoalescer((e) => out.push(e), { setTimer: (fn) => { fire = fn; return 1; }, clearTimer: () => { fire = null; } });
  for (const t of ["Ho", "la", ", ", "qué"]) live.push({ type: "delta", stepId: "s1", botId: "nora", mission: "m", text: t });
  live.push({ type: "activity", mission: "m", botId: "nora", verb: "leyendo" });
  live.push({ type: "activity", mission: "m", botId: "nora", verb: "buscando" });
  live.push({ type: "delta", stepId: "s2", botId: "vera", mission: "m", text: "Sí" });
  assert.equal(out.length, 0, "nothing goes out before the window ends");
  fire();
  assert.deepEqual(out.map((e) => e.type + ":" + (e.text ?? e.verb)), ["delta:Hola, qué", "activity:buscando", "delta:Sí"]);

  out.length = 0;
  live.push({ type: "delta", stepId: "s1", botId: "nora", mission: "m", text: " tal" });
  live.push({ type: "step_done", stepId: "s1", botId: "nora", mission: "m" });
  assert.deepEqual(out.map((e) => e.type), ["delta", "step_done"], "a finished step first sends what was waiting");
  out.length = 0;
  live.push({ type: "delta", stepId: "s3", botId: "nora", mission: "m", text: "x" });
  live.push({ type: "delta", stepId: "s3", botId: "nora", mission: "m", text: "", reset: true });
  assert.deepEqual(out.map((e) => !!e.reset), [false, true], "a reset goes at once, after what waited");
});

test("a long chat opens with its latest 75 messages and pages back through GET /history", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-history-"));
  const store = new Store(dir);
  const runtime = new Runtime(store, { respond: async () => { throw Error("No provider calls"); } });
  const server = http.createServer(createApp({ store, runtime, session: { status: () => null, models: [] }, getOrigin: () => origin }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    await runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const get = async (route) => { const r = await fetch(origin + "/api" + route); return { status: r.status, body: await r.json() }; };
  store.put("missions", { id: "c", title: "Larga", status: "completed", mode: "solo", botIds: ["nora"], conversation: true, createdAt: at(0) });
  const { messages, steps } = chat(150);
  for (const m of messages) store.put("messages", { missionId: "c", kind: "message", ...m });
  for (const s of steps) store.put("steps", { missionId: "c", key: s.id, botId: "nora", kind: "followup", history: [], ...s });

  const open = (await get("/missions/c")).body;
  assert.equal(open.messages.filter((m) => m.kind !== "progress").length, CHAT_PAGE);
  assert.equal(open.olderCount, 300 - CHAT_PAGE);
  assert.ok(open.steps.length <= 40, "only the steps of the shown messages: " + open.steps.length);
  const all = [...open.messages];
  let cursor = open.cursor;
  while (cursor) {
    const { status, body } = await get(`/missions/c/history?antes=${cursor}`);
    assert.equal(status, 200);
    // The steps of its answers, plus at most the one started by its last message of yours.
    const answered = body.steps.filter((s) => body.messages.some((m) => m.stepId === s.id));
    assert.ok(body.steps.length - answered.length <= 1, `${body.steps.length} steps, ${answered.length} answered`);
    all.unshift(...body.messages);
    cursor = body.cursor;
  }
  assert.deepEqual(all.map((m) => m.id), messages.map((m) => m.id), "the pages join up in order");
  assert.equal((await get("/missions/c/history?antes=nope")).status, 404);
  assert.equal((await get("/missions/c?mensajes=todos")).body.steps.length, 150);
});
