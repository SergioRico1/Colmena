import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Runtime, AUTO_RESUMES } from "../server/runtime.mjs";
import { answer, call, settle } from "./fixtures/runtime-fixture.mjs";

async function world(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-resume-"));
  const runtimes = [];
  const open = (respond, options = {}) => {
    const store = new Store(directory);
    store.patch("settings", "main", { model: "fixture", learning: false });
    const runtime = new Runtime(store, { respond }, null, options);
    runtimes.push({ store, runtime });
    return { store, runtime };
  };
  t.after(async () => {
    for (const { store, runtime } of runtimes) { try { await runtime.shutdown(); } catch {} try { store.close(); } catch {} }
    await rm(directory, { recursive: true, force: true });
  });
  return open;
}

test("work cut by a close goes on by itself after the restart, told to check what was half done", async (t) => {
  const open = await world(t);
  // First run: the bot is in the middle of a tool round when Colmena closes.
  const first = open(async () => call("list_files", {}, "c1"));
  const m = first.runtime.create({ prompt: "Ordena mis archivos", mode: "solo", botIds: ["nora"] });
  first.store.patch("missions", m.id, { status: "running" });
  const stepId = first.runtime.steps(m.id)[0].id;
  first.store.patch("steps", stepId, { status: "running", history: [{ role: "user", content: "Ordena mis archivos" }] });
  first.store.close();

  const seen = [];
  const second = open(async ({ input }) => { seen.push(JSON.stringify(input)); return answer("Archivos ordenados."); });
  assert.equal(second.store.get("missions", m.id).status, "paused");
  assert.ok(second.store.get("missions", m.id).interrupted, "marked as cut by the close");
  assert.deepEqual(second.runtime.resumeInterrupted(), [m.id]);
  await settle(second.runtime);
  const after = second.store.get("missions", m.id);
  assert.equal(after.status, "completed");
  assert.equal(after.interrupted, null);
  assert.match(seen[0], /Colmena se reinició mientras trabajabas/);
  assert.ok(second.store.events(m.id).some((e) => e.type === "resumed"));
});

test("a mission the person paused is not resumed; nor one that keeps crashing", async (t) => {
  const open = await world(t);
  const { store, runtime } = open(async () => answer("ok"));
  const mine = runtime.create({ prompt: "Pausada a mano", mode: "solo", botIds: ["nora"] });
  store.patch("missions", mine.id, { status: "paused" });
  const loop = runtime.create({ prompt: "Se cae siempre", mode: "solo", botIds: ["nora"] });
  const recent = Array.from({ length: AUTO_RESUMES }, () => new Date().toISOString());
  store.patch("missions", loop.id, { status: "paused", interrupted: { at: new Date().toISOString() }, autoResumes: recent });
  assert.deepEqual(runtime.resumeInterrupted(), []);
  assert.equal(store.get("missions", mine.id).status, "paused");
  assert.match(store.get("missions", loop.id).error, /varias veces/);
  store.patch("settings", "main", { paused: true });
  store.patch("missions", loop.id, { interrupted: { at: new Date().toISOString() }, autoResumes: [] });
  assert.deepEqual(runtime.resumeInterrupted(), [], "never while the whole team is paused");
});

test("no total time cap: a mission stops only when nothing moves", async (t) => {
  const open = await world(t);
  let round = 0;
  // Busy for longer than the idle limit, but moving every round: it finishes.
  const busy = open(async () => {
    await new Promise((r) => setTimeout(r, 60));
    return ++round < 6 ? call("list_files", {}, "c" + round) : answer("Hecho tras muchas rondas.");
  }, { idleAbortMs: 250 });
  const m = busy.runtime.create({ prompt: "Trabajo largo", mode: "solo", botIds: ["nora"] });
  await busy.runtime.launch(m.id);
  assert.equal(busy.store.get("missions", m.id).status, "completed");
  // Silent for longer than the limit: stopped with a clear message, resumable.
  const stuck = open(async ({ signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))), { idleAbortMs: 250 });
  const s = stuck.runtime.create({ prompt: "Se queda colgado", mode: "solo", botIds: ["nora"] });
  await stuck.runtime.launch(s.id);
  const after = stuck.store.get("missions", s.id);
  assert.equal(after.status, "paused");
  assert.match(after.error, /10 minutos sin avanzar/);
});
