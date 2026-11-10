import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { lockInstance } from "../server/instance.mjs";

const answer = (text) => ({ text, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }] });
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

async function fixture(t, respond) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-alive-"));
  const store = new Store(directory);
  store.patch("settings", "main", { model: "fixture", learning: false });
  const runtime = new Runtime(store, { respond });
  t.after(async () => {
    await runtime.shutdown();
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { store, runtime };
}

/** A provider whose first call hangs until it is aborted; later calls answer. */
function hanging() {
  let started, calls = 0;
  const ready = new Promise((r) => (started = r));
  const respond = async ({ signal }) => {
    if (++calls > 1) return answer("Continuado");
    started();
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  };
  return { ready, respond, calls: () => calls };
}

test("«Pausar» right after «Reintentar» stays paused", async (t) => {
  const h = hanging();
  const { store, runtime } = await fixture(t, h.respond);
  const m = runtime.create({ prompt: "Largo" });
  const run = runtime.launch(m.id);
  await h.ready;
  runtime.retry(m.id);
  runtime.stop(m.id);
  await run;
  await tick();
  await Promise.all([...runtime.jobs]);
  assert.equal(store.get("missions", m.id).status, "paused");
  assert.equal(h.calls(), 1, "nothing ran again");
  await runtime.resume(m.id);
  assert.equal(store.get("missions", m.id).status, "completed");
});

test("a paused mission is not resumed by a wait that ends, only by you", async (t) => {
  const h = hanging();
  const { store, runtime } = await fixture(t, h.respond);
  const m = runtime.create({ prompt: "Largo" });
  const run = runtime.launch(m.id);
  await h.ready;
  runtime.stop(m.id);
  await run;
  // A question whose wait ended while it was paused.
  store.put("approvals", { id: "q1", missionId: m.id, kind: "question", status: "pending", waitUntil: new Date(Date.now() - 1000).toISOString() });
  assert.equal(runtime.sweepQuestions(), 1);
  runtime.wake(m.id);
  await tick();
  await Promise.all([...runtime.jobs]);
  assert.equal(store.get("missions", m.id).status, "paused");
  assert.equal(h.calls(), 1);
});

test("deleting a conversation while it is reviewed does not fail in the background", async (t) => {
  const { store, runtime } = await fixture(t, async () => answer("ok"));
  const m = runtime.create({ prompt: "test" });
  await runtime.launch(m.id);
  store.remove("missions", m.id);
  await runtime.learn(m.id, "fixture", AbortSignal.timeout(1000));
});

test("the instance lock: only a Colmena that answers as that process holds it", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-lock-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "instance.json");
  const mine = async () => JSON.parse(await readFile(file, "utf8")).pid === process.pid;
  const other = process.ppid; // a live process that is not this one

  // A record cut short by a crash is nobody's.
  await writeFile(file, "{\"pi");
  (await lockInstance(directory)).release();

  // The PID is alive but nothing answers there as Colmena: recycled, the lock is taken.
  await writeFile(file, JSON.stringify({ pid: other, origin: "http://127.0.0.1:9" }));
  let lock = await lockInstance(directory, { probe: async () => { throw Error("ECONNREFUSED"); } });
  assert.ok(await mine());
  lock.release();
  await writeFile(file, JSON.stringify({ pid: other, origin: "http://127.0.0.1:9" }));
  lock = await lockInstance(directory, { probe: async () => ({ application: "Colmena", pid: other + 1 }) });
  lock.release();

  // It answers as that very process: Colmena is open.
  await writeFile(file, JSON.stringify({ pid: other, origin: "http://127.0.0.1:9" }));
  await assert.rejects(lockInstance(directory, { probe: async () => ({ application: "Colmena", pid: other }) }), /ya está abierta en http:\/\/127\.0\.0\.1:9/);

  // Still starting (no address yet): open for a while, then stale.
  await writeFile(file, JSON.stringify({ pid: other }));
  await assert.rejects(lockInstance(directory), /ya está abierta/);
  const old = new Date(Date.now() - 11 * 60 * 1000);
  await utimes(file, old, old);
  (await lockInstance(directory)).release();
});
