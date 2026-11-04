import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Store } from "../server/store.mjs";
import { Runtime, SUGGEST_INSTRUCTIONS } from "../server/runtime.mjs";
import { openBranch } from "../server/branches.mjs";

async function setup(t, reply) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-follow-"));
  const store = new Store(dir);
  store.patch("settings", "main", { model: "gpt-5" });
  const asked = [];
  const runtime = new Runtime(store, { respond: async (p) => { asked.push(p); return { text: JSON.stringify({ sugerencias: reply }), output: [] }; } }, null, { suggest: true });
  runtime.availableModels = () => [{ slug: "gpt-5-mini" }];
  t.after(async () => { await runtime.shutdown(); store.close(); await rm(dir, { recursive: true, force: true }); });
  const at = (s) => new Date(Date.UTC(2026, 10, 1, 10, 0, s)).toISOString();
  store.put("missions", { id: "c", title: "Chat", status: "completed", mode: "solo", botIds: ["nora"], conversation: true });
  store.put("messages", { id: "u1", missionId: "c", role: "user", kind: "message", text: "Compara las dos ofertas", at: at(1) });
  store.put("messages", { id: "a1", missionId: "c", role: "assistant", botId: "nora", kind: "message", text: "La B sale más barata pero ata 3 años.", at: at(2) });
  return { store, runtime, asked, at };
}

test("suggestions come in 2 or 3 and only when they add something", async (t) => {
  assert.match(SUGGEST_INSTRUCTIONS, /lista vacía/);
  const { store, runtime } = await setup(t, ["Prepárame la respuesta a la B", "¿Y si negocio 1 año?", "Prepárame la respuesta a la B"]);
  assert.deepEqual(await runtime.suggestNext("c"), ["Prepárame la respuesta a la B", "¿Y si negocio 1 año?"], "no repeats");
  assert.equal(store.get("missions", "c").suggestions.forMessageId, "a1");
});

test("one lone suggestion, or none, leaves the chat without any", async (t) => {
  for (const reply of [[], ["Vale"]]) {
    const { store, runtime } = await setup(t, reply);
    assert.equal(await runtime.suggestNext("c"), null);
    assert.equal(store.get("missions", "c").suggestions, undefined);
  }
});

test("never in incognito (they would be kept), and always for the version you see", async (t) => {
  const { store, runtime, asked, at } = await setup(t, ["Una", "Otra"]);
  store.patch("missions", "c", { incognito: true });
  assert.equal(await runtime.suggestNext("c"), null);
  assert.equal(asked.length, 0, "not even asked");
  store.patch("missions", "c", { incognito: false });
  // Another version of the answer: suggestions are for it.
  store.patch("missions", "c", openBranch(store.get("missions", "c"), store.where("messages", "missionId", "c"), "a1", at(3)).changes);
  store.put("messages", { id: "a1b", missionId: "c", role: "assistant", botId: "nora", kind: "message", text: "Mejor la A.", at: at(4) });
  await runtime.suggestNext("c");
  assert.equal(store.get("missions", "c").suggestions.forMessageId, "a1b");
  assert.ok(!JSON.stringify(asked.at(-1).input).includes("ata 3 años"), "it did not see the other version");
});
