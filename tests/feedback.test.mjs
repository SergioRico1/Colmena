// «No me sirve» with a reason (server/feedback.mjs): chips and a note on the person's 👎, editable
// later and gone with the 👎; measured by verdicts.mjs and read by the learning review as what
// she said, while a bare 👎 stays a measure only.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { Store } from "../server/store.mjs";
import { Runtime } from "../server/runtime.mjs";
import { createApp } from "../server/app.mjs";
import { DOWN_REASONS, downFeedback, feedbackCorrections, reactionView, setDownFeedback } from "../server/feedback.mjs";
import { togglePersonReaction } from "../server/reactions.mjs";
import { missionSignals, observeMission, computeVerdict } from "../server/verdicts.mjs";
import { assertNoApprovalSignals, personCorrections, recentCorrections } from "../server/learning.mjs";
import { importSkill, activateSkill } from "../server/skills.mjs";
import { useDataDirectory } from "../server/soul.mjs";

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-feedback-"));
  const store = new Store(dir);
  useDataDirectory(dir, store);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  return { store };
}
let n = 0;
function answer(store, { text = "Las ventas de marzo fueron 1.200 €.", at = new Date(Date.now() - 100000 + ++n * 1000).toISOString(), skillId = null } = {}) {
  const id = "m" + ++n;
  store.put("missions", { id, title: "Ventas " + n, prompt: "Resume las ventas de marzo", mode: "solo", botIds: ["nora"], status: "completed", createdAt: at, completedAt: at });
  store.put("messages", { id: id + ":u", missionId: id, role: "user", text: "Resume las ventas de marzo", at });
  store.put("messages", { id: id + ":a", missionId: id, role: "assistant", botId: "nora", text, at });
  const history = skillId ? [{ type: "function_call", name: "read_skill", arguments: JSON.stringify({ id: skillId }), call_id: "c1" }] : [];
  store.put("steps", { id: id + ":s", missionId: id, botId: "nora", status: "completed", history });
  if (skillId) store.put("receipts", { id: id + ":s:c1", tool: "read_skill", result: { id: skillId }, ms: 30, at });
  return id;
}

test("the reasons are the agreed Spanish chips", () => {
  assert.deepEqual(DOWN_REASONS.map(([, label]) => label), ["No hizo lo que pedí", "Datos incorrectos", "Demasiado largo", "Se saltó un paso", "Tono", "Lento", "Otro"]);
});

test("reasons and a note live on the 👎, can be changed and go with it", async (t) => {
  const { store } = await fixture(t);
  const m = answer(store);
  // Saving a reason adds the 👎 when it was not there.
  setDownFeedback(store, m + ":a", { reasons: ["datos", "datos", "inventado"], note: "  La cifra   es de febrero " });
  let r = downFeedback(store.get("messages", m + ":a"));
  assert.deepEqual(r.reasons, ["datos"]);
  assert.equal(r.note, "La cifra es de febrero");
  assert.ok(r.editedAt);
  assert.equal(store.where("reactionNotices", "missionId", m).length, 1, "the bots see the 👎 on their next turn, as a click");
  assert.deepEqual(reactionView(r), { emoji: "👎", by: "user", reasons: ["datos"], note: "La cifra es de febrero" });
  // Changed later: one 👎, the new reasons.
  setDownFeedback(store, m + ":a", { reasons: ["largo", "tono"], note: "" });
  const list = store.get("messages", m + ":a").reactions.filter((x) => x.emoji === "👎");
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].reasons, ["largo", "tono"]);
  // Nothing chosen: a plain 👎 again.
  setDownFeedback(store, m + ":a", {});
  r = downFeedback(store.get("messages", m + ":a"));
  assert.equal(r.reasons, undefined);
  assert.deepEqual(reactionView(r), { emoji: "👎", by: "user" });
  // Removing the 👎 removes its reasons.
  setDownFeedback(store, m + ":a", { reasons: ["paso"] });
  togglePersonReaction(store, m + ":a", "👎");
  assert.equal(downFeedback(store.get("messages", m + ":a")), null);
  // Only a bot's answer takes a reason.
  assert.throws(() => setDownFeedback(store, m + ":u", { reasons: ["datos"] }), /respuesta de un bot/);
  assert.throws(() => setDownFeedback(store, "nope", { reasons: ["datos"] }), /ya no existe/);
});

test("verdicts measure with the reasons; a reasoned 👎 weighs as a correction", async (t) => {
  const { store } = await fixture(t);
  const plain = answer(store);
  togglePersonReaction(store, plain + ":a", "👎");
  store.put("messages", { id: plain + ":a2", missionId: plain, role: "assistant", botId: "nora", text: "Y el gráfico", reactions: [{ emoji: "👍", by: "user" }] });
  assert.equal(missionSignals(store, plain).outcome, "bien", "a bare 👎 next to a 👍 stays ambiguous");
  const why = answer(store);
  setDownFeedback(store, why + ":a", { reasons: ["datos"] });
  store.put("messages", { id: why + ":a2", missionId: why, role: "assistant", botId: "nora", text: "Y el gráfico", reactions: [{ emoji: "👍", by: "user" }] });
  const s = missionSignals(store, why);
  assert.equal(s.outcome, "mal");
  assert.deepEqual(s.downReasons, ["datos"]);
  assert.equal(s.downReasoned, 1);
  // The verdict says which reason repeats.
  const skill = activateSkill(store, importSkill(store, { content: "---\nname: ventas\ndescription: Úsala cuando haya que resumir ventas\n---\n1. Lee.\n", botId: "nora", origin: "learned" }).id, "active");
  for (let i = 0; i < 3; i++) {
    const id = answer(store, { skillId: skill.id });
    setDownFeedback(store, id + ":a", { reasons: i === 2 ? ["largo"] : ["datos"], note: "" });
    observeMission(store, id);
  }
  const verdict = computeVerdict(store, "skill", skill.id);
  assert.match(verdict.summary, /lo que más se repite al decir que no sirve: Datos incorrectos \(2\)/);
});

test("the learning review reads them as what the person said, past the approval wall", async (t) => {
  const { store } = await fixture(t);
  const m = answer(store);
  setDownFeedback(store, m + ":a", { reasons: ["datos", "paso"], note: "Falta comparar con febrero" });
  const mission = store.get("missions", m);
  const corrections = personCorrections(store, mission);
  assert.equal(corrections.length, 1);
  assert.match(corrections[0], /^Sobre la respuesta «Las ventas de marzo fueron 1\.200 €\.»: Datos incorrectos, Se saltó un paso\. Falta comparar con febrero$/);
  assert.doesNotThrow(() => assertNoApprovalSignals({ correccionesDeLaPersona: corrections }));
  const later = answer(store);
  const earlier = recentCorrections(store, "nora", later);
  assert.ok(earlier.some((c) => /Datos incorrectos/.test(c.texto)));
  // A bare 👎 is a measure only: it never becomes a correction.
  const bare = answer(store);
  togglePersonReaction(store, bare + ":a", "👎");
  assert.deepEqual(feedbackCorrections(store, bare), []);
  assert.deepEqual(personCorrections(store, store.get("missions", bare)), []);
});

test("API: PUT /messages/:id/feedback saves and returns the reasons with the reactions", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-feedback-api-"));
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
  const put = (route, body) => fetch(origin + "/api" + route, { method: "PUT", headers: { "Content-Type": "application/json", "X-Colmena-Token": csrf }, body: JSON.stringify(body) });
  const m = answer(store);
  const saved = await put("/messages/" + m + ":a/feedback", { reasons: ["no-pedido"], note: "Pedí solo el total" });
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).reactions, [{ emoji: "👎", by: "user", reasons: ["no-pedido"], note: "Pedí solo el total" }]);
  assert.equal((await put("/messages/" + m + ":a/feedback", { reasons: ["inventado"] })).status, 400);
  assert.equal((await put("/messages/" + m + ":a/feedback", { reasons: [], note: "x".repeat(501) })).status, 400);
  assert.equal((await put("/messages/" + m + ":u/feedback", { reasons: ["datos"] })).status, 422);
  assert.equal((await put("/messages/nope/feedback", { reasons: ["datos"] })).status, 404);
});
