import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { createLiveSnapshot } from "../server/live-snapshot.mjs";
import { applyDeltas, applyLiveSnapshot, queueDelta } from "../src/lib/liveText.js";

const delta = (stepId, text, extra = {}) => ({ type: "delta", mission: "m", stepId, botId: "nora", text, ...extra });

test("the live snapshot keeps each in-flight step's text and forgets the ones that end", () => {
  const live = createLiveSnapshot({ maxSteps: 3 });
  live.apply(delta("s1", "Hola"));
  live.apply(delta("s1", ", qué tal"));
  live.apply(delta("s2", "Otro", { botId: "iris" }));
  assert.deepEqual(live.snapshot(), [
    { stepId: "s1", botId: "nora", mission: "m", text: "Hola, qué tal" },
    { stepId: "s2", botId: "iris", mission: "m", text: "Otro" },
  ]);
  live.apply(delta("s1", "Desde aquí", { reset: true }));
  assert.equal(live.snapshot().find((s) => s.stepId === "s1").text, "Desde aquí", "a reset starts the text again");
  live.apply({ type: "step_done", mission: "m", stepId: "s1", botId: "nora" });
  assert.deepEqual(live.snapshot().map((s) => s.stepId), ["s2"]);
  live.apply({ type: "activity", mission: "m", botId: "iris", verb: null });
  assert.deepEqual(live.snapshot(), [], "a stopped bot's half-written text goes");
  live.apply(delta("a", "1", { mission: "x" }));
  live.apply(delta("b", "2", { mission: "x" }));
  live.apply(delta("c", "3", { mission: "y" }));
  live.apply(delta("d", "4", { mission: "y" }));
  assert.deepEqual(live.snapshot().map((s) => s.stepId), ["b", "c", "d"], "bounded: the oldest goes first");
  live.apply({ type: "completed", mission: "y", seq: 9 });
  assert.deepEqual(live.snapshot().map((s) => s.stepId), ["b"]);
  live.apply({ type: "activity", mission: "x", botId: "nora", verb: "escribiendo" });
  assert.equal(live.snapshot().length, 1, "an activity with a verb keeps the text");
});

test("client: queued deltas merge per frame and a snapshot replaces the copy", () => {
  let q = queueDelta(undefined, delta("s1", "Ho"));
  q = queueDelta(q, delta("s1", "la"));
  assert.deepEqual(q, { botId: "nora", mission: "m", reset: false, text: "Hola" });
  let live = applyDeltas({}, [["s1", q]]);
  live = applyDeltas(live, [["s1", queueDelta(undefined, delta("s1", " mundo"))]]);
  assert.equal(live.s1.text, "Hola mundo");
  const reset = queueDelta(queueDelta(undefined, delta("s1", "x")), delta("s1", "Otra", { reset: true }));
  assert.equal(applyDeltas(live, [["s1", reset]]).s1.text, "Otra");

  // The stream dropped after «Hola mundo»; the server kept on: «Hola mundo, ¿cómo» arrives
  // as the first frame. A step that ended meanwhile (s9) goes.
  const before = { ...live, s9: { botId: "iris", mission: "m", text: "viejo" } };
  const after = applyLiveSnapshot(before, [{ stepId: "s1", botId: "nora", mission: "m", text: "Hola mundo, ¿cómo" }]);
  assert.deepEqual(after, { s1: { botId: "nora", mission: "m", text: "Hola mundo, ¿cómo" } });
  // Later chunks append to the snapshot's text.
  assert.equal(applyDeltas(after, [["s1", queueDelta(undefined, delta("s1", " estás?"))]]).s1.text, "Hola mundo, ¿cómo estás?");
  assert.equal(applyLiveSnapshot(after, [{ stepId: "s1", botId: "nora", mission: "m", text: "Hola mundo, ¿cómo" }]), after, "same text → same object");
  assert.deepEqual(applyLiveSnapshot(after, []), {}, "nothing in flight → nothing live");
  assert.deepEqual(applyLiveSnapshot({}, null), {});
});

test("/api/events opens with the snapshot of every in-flight step; later pieces append", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-live-"));
  const store = new Store(dir);
  const runtime = new Runtime(store, { respond: async () => { throw Error("No provider calls"); } });
  const server = http.createServer(createApp({ store, runtime, session: { status: () => null, models: [] }, getOrigin: () => origin }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const controllers = [];
  t.after(async () => {
    for (const c of controllers) c.abort();
    await runtime.shutdown();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const emit = (event) => { for (const fn of store.listeners) fn(event); };
  const open = async () => {
    const controller = new AbortController();
    controllers.push(controller);
    const response = await fetch(origin + "/api/events", { signal: controller.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const next = async (predicate = (e) => !!e.type) => {
      for (;;) {
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop();
        for (let i = 0; i < chunks.length; i++) {
          const line = chunks[i].split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6));
          if (predicate(event)) {
            buffer = chunks.slice(i + 1).concat(buffer).join("\n\n");
            return event;
          }
        }
        const { value, done } = await reader.read();
        if (done) throw Error("stream closed");
        buffer += decoder.decode(value);
      }
    };
    return { next, close: () => controller.abort() };
  };

  const first = await open();
  assert.deepEqual(await first.next(), { type: "live_snapshot", steps: [] }, "the first frame, even with nothing in flight");
  emit(delta("s1", "Primera parte"));
  assert.equal((await first.next((e) => e.type === "delta")).text, "Primera parte");
  first.close();
  // While no browser listens, the bot goes on writing.
  emit(delta("s1", " y segunda"));
  emit(delta("s2", "Otra sala", { mission: "m2", botId: "iris" }));
  emit(delta("s3", "Ya terminado"));
  emit({ type: "step_done", mission: "m", stepId: "s3", botId: "nora" });

  const again = await open();
  const snap = await again.next();
  assert.equal(snap.type, "live_snapshot");
  assert.deepEqual(snap.steps, [
    { stepId: "s1", botId: "nora", mission: "m", text: "Primera parte y segunda" },
    { stepId: "s2", botId: "iris", mission: "m2", text: "Otra sala" },
  ]);
  emit(delta("s1", ", tercera"));
  const later = await again.next((e) => e.type === "delta");
  assert.equal(later.text, ", tercera");
  // The browser's merge: the snapshot replaces its copy, the next piece appends.
  let live = applyLiveSnapshot({ s1: { botId: "nora", mission: "m", text: "Primera parte" } }, snap.steps);
  live = applyDeltas(live, [[later.stepId, queueDelta(undefined, later)]]);
  assert.equal(live.s1.text, "Primera parte y segunda, tercera");
});
