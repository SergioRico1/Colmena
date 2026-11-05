import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer } from "./fixtures/runtime-fixture.mjs";
import { RETRY, retryDelay, retryAfterMs } from "../server/provider.mjs";

test("retries back off exponentially with jitter and honour the provider's Retry-After", () => {
  const mid = () => 0.5, low = () => 0, high = () => 1;
  assert.deepEqual([0, 1, 2].map((a) => retryDelay(a, { random: mid })), [2000, 6000, 18000]);
  assert.equal(retryDelay(0, { random: low }), 1600);
  assert.equal(retryDelay(0, { random: high }), 2400);
  assert.equal(retryDelay(5, { random: high }), RETRY.maxMs, "capped");
  assert.equal(retryDelay(0, { error: { headers: { "retry-after": "7" } }, random: mid }), 7000);
  assert.equal(retryDelay(2, { error: { headers: { "retry-after-ms": "1500" } }, random: mid }), 1500);
  assert.equal(retryDelay(0, { error: { headers: { "retry-after": "3600" } }, random: mid }), 2000, "a long wait is a usage limit, not a retry");
  assert.equal(retryDelay(1, { base: 6000, random: mid }), 6000, "fixed waits (tests)");
  const at = Date.parse("2026-11-05T10:00:00Z");
  assert.equal(retryAfterMs({ "retry-after": "Thu, 05 Nov 2026 10:00:30 GMT" }, at), 30_000);
  assert.equal(retryAfterMs({}), null);
});

test("the runtime waits what the provider's Retry-After says", async (t) => {
  let n = 0;
  const waits = [];
  const { store, runtime } = await fixture(t, async () => {
    n++;
    if (n === 1) throw Object.assign(Error("OpenAI rechazo la peticion (429)."), { status: 429, headers: { "retry-after": "4" } });
    return answer("Listo");
  }, { sleep: async (ms) => { waits.push(ms); } });
  const m = runtime.create({ prompt: "Hazlo" });
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).status, "completed");
  assert.deepEqual(waits, [4000]);
});
