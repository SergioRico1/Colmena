import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { fixture, answer } from "./fixtures/runtime-fixture.mjs";
import { readSoul, writeSoul } from "../server/soul.mjs";
import { proposeSoulChange, saveUserProfile, userProfile, restoreSoulVersion } from "../server/learning.mjs";
import { listVersions, versionsView } from "../server/doc-history.mjs";
import { registerLearningRoutes } from "../server/learning-routes.mjs";

async function server(t, store, runtime) {
  const app = express();
  app.use(express.json());
  registerLearningRoutes(app, { store, runtime });
  app.use((err, _req, res, _next) => res.status(err.status || 422).json({ error: err.message }));
  const s = app.listen(0, "127.0.0.1");
  await new Promise((r) => s.once("listening", r));
  t.after(() => s.close());
  const base = "http://127.0.0.1:" + s.address().port + "/api";
  return (method, url, body) => fetch(base + url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
}

test("every SOUL change keeps a version: the first text, yours, approved proposals; restoring is one more", async (t) => {
  const { store, runtime } = await fixture(t, async () => answer("ok"));
  const bot = store.get("bots", "nora");
  const original = readSoul("nora", { bot });
  writeSoul("nora", original.trim() + "\n\nHablo claro y breve.\n");
  const proposal = proposeSoulChange(store, { bot, missionId: null, proposal: "Uso tablas para las cifras.", reason: "Lo pediste" });
  runtime.approve(proposal.id, "approved");
  const versions = versionsView(store, "soul", "nora");
  assert.deepEqual(versions.map((v) => v.source), ["propuesta", "tú", "inicial"]);
  assert.equal(versions[0].current, true);
  assert.equal(versions[0].reason, "Lo pediste");
  assert.equal(versions[2].content, original, "the template it started with");
  restoreSoulVersion(store, "nora", versions[2].id);
  assert.equal(readSoul("nora"), original);
  const after = versionsView(store, "soul", "nora");
  assert.equal(after[0].source, "restaurado");
  assert.match(after[0].reason, /^Vuelve a la versión del /);
  assert.equal(after.length, 4, "nothing is lost");
  writeSoul("nora", original);
  assert.equal(listVersions(store, "soul", "nora").length, 4, "the same text again records nothing");
});

test("USER.md keeps its versions; the routes list and restore them for the bot profile, the Archivo and Ajustes", async (t) => {
  const { store, runtime } = await fixture(t, async () => answer("ok"));
  const send = await server(t, store, runtime);
  saveUserProfile(store, "# USER.md\n\n## Directivas\n- [2026-10-01 · activa] Prefiere el tuteo\n");
  saveUserProfile(store, "# USER.md\n\n## Directivas\n- [2026-10-02 · activa] Prefiere el usted\n");
  const list = await (await send("GET", "/user-profile/versions")).json();
  assert.equal(list.length, 2);
  assert.equal(list[0].sourceLabel, "Lo editaste tú");
  const restored = await (await send("POST", "/user-profile/versions/" + list[1].id + "/restore", {})).json();
  assert.equal(restored[0].source, "restaurado");
  assert.match(userProfile(store).content, /Prefiere el tuteo/);
  assert.equal((await send("POST", "/user-profile/versions/nope/restore", {})).status, 404);

  writeSoul("vera", "# SOUL\nSoy Vera y lo reviso todo dos veces.\n");
  const soul = await (await send("GET", "/bots/vera/soul/versions")).json();
  assert.deepEqual(soul.map((v) => v.source), ["tú", "inicial"]);
  const back = await (await send("POST", "/bots/vera/soul/versions/" + soul[1].id + "/restore", {})).json();
  assert.equal(back[0].source, "restaurado");
  assert.doesNotMatch(readSoul("vera"), /dos veces/);
  assert.equal((await send("POST", "/bots/nora/soul/versions/" + soul[1].id + "/restore", {})).status, 404, "a version belongs to its bot");
});
