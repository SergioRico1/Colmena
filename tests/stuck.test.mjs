import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer } from "./fixtures/runtime-fixture.mjs";

test("a quiet mission is flagged «sin avanzar», «Reintentar» drops the call and starts again", async (t) => {
  let calls = 0;
  const { store, runtime } = await fixture(t, async ({ signal }) => {
    calls += 1;
    if (calls === 1) return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))); // hangs
    return answer("Ya está.");
  }, { quietMs: 60, idleAbortMs: 60000 });
  const m = runtime.create({ prompt: "Busca algo", mode: "solo", botIds: ["nora"] });
  const job = runtime.launch(m.id);
  await new Promise((r) => setTimeout(r, 200));
  const quiet = store.get("missions", m.id).quiet;
  assert.ok(quiet?.since, "flagged after going quiet");
  assert.equal(quiet.botId, "nora");
  runtime.retry(m.id);
  await job;
  for (let i = 0; i < 50 && store.get("missions", m.id).status !== "completed"; i++) await new Promise((r) => setTimeout(r, 20));
  const after = store.get("missions", m.id);
  assert.equal(after.status, "completed", after.error || "");
  assert.equal(after.quiet, null, "the flag clears");
  assert.equal(calls, 2);
});
