import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Store } from "../server/store.mjs";
import { importSkill, activateSkill, curateSkills } from "../server/skills.mjs";
import { isForgotten } from "../server/learning.mjs";
import { observeMission, missionSignals, computeVerdict, decideRevert, listVerdicts } from "../server/verdicts.mjs";
import { useDataDirectory } from "../server/soul.mjs";

const SKILL = (extra = "") => `---\nname: informe-ventas\ndescription: Úsala cuando haya que preparar el informe de ventas\n---\n## Pasos\n1. Lee los datos.\n2. Redacta.${extra}\n`;

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-verdicts-"));
  const store = new Store(dir);
  store.patch("settings", "main", { model: "fixture", learning: true });
  useDataDirectory(dir, store);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  return { store };
}

let n = 0;
/** A finished mission of Nora; `skillId` loaded with read_skill; `say` = later messages of the person; `react` = her emoji on the answer. */
function mission(store, { prompt = "Prepara el informe de ventas de la semana", skillId = null, say = [], react = null, status = "completed", at = null, limited = null } = {}) {
  const id = "m" + ++n;
  const createdAt = at || new Date(Date.now() - 1000 * (100 - n)).toISOString();
  store.put("missions", { id, title: "Informe " + n, prompt, mode: "solo", botIds: ["nora"], status, createdAt, completedAt: createdAt, limited, error: limited ? "Límite" : null });
  store.put("messages", { id: id + ":u0", missionId: id, role: "user", text: prompt, at: createdAt });
  say.forEach((text, i) => store.put("messages", { id: id + ":u" + (i + 1), missionId: id, role: "user", text, at: createdAt }));
  store.put("messages", { id: id + ":a", missionId: id, role: "assistant", botId: "nora", text: "Hecho", reactions: react ? [{ emoji: react, by: "user" }] : [], at: createdAt });
  const history = skillId ? [{ type: "function_call", name: "read_skill", arguments: JSON.stringify({ id: skillId }), call_id: "c1" }] : [];
  store.put("steps", { id: id + ":s", missionId: id, botId: "nora", status: "completed", history });
  if (skillId) store.put("receipts", { id: id + ":s:c1", tool: "read_skill", result: { id: skillId }, ms: 30, at: createdAt });
  return id;
}

test("signals come from what Colmena keeps: corrections, reactions, denials, failed and limited endings", async (t) => {
  const { store } = await fixture(t);
  const bad = mission(store, { say: ["No, así no: demasiado largo"] });
  assert.equal(missionSignals(store, bad).outcome, "mal");
  assert.equal(missionSignals(store, bad).corrections, 1);
  const good = mission(store, { react: "👍" });
  assert.equal(missionSignals(store, good).outcome, "bien");
  assert.equal(missionSignals(store, mission(store)).outcome, "regular");
  assert.equal(missionSignals(store, mission(store, { status: "cancelled" })).outcome, "mal");
  const limited = mission(store, { status: "paused", limited: { engine: "chatgpt" } });
  assert.equal(missionSignals(store, limited).outcome, null, "a limit says nothing about the bot");
  const denied = mission(store);
  store.put("approvals", { id: "ap1", missionId: denied, botId: "nora", kind: "write", status: "denied", decidedBy: "tú", denyReason: "Ese no es el cliente" });
  assert.equal(missionSignals(store, denied).outcome, "mal");
  assert.equal(missionSignals(store, denied).reasons, 1);
});

test("one observation is «dudoso»; a version that keeps getting corrected «empeoró» and a revert is proposed", async (t) => {
  const { store } = await fixture(t);
  const v1 = activateSkill(store, importSkill(store, { content: SKILL(), botId: "nora", origin: "learned" }).id, "active");
  for (let i = 0; i < 3; i++) observeMission(store, mission(store, { skillId: v1.id, react: "👍" }));
  const v2 = importSkill(store, { content: SKILL("\n3. Añade un anexo enorme."), botId: "nora", origin: "learned", previous: v1.id });
  activateSkill(store, v2.id, "active");
  observeMission(store, mission(store, { skillId: v2.id, say: ["No, demasiado largo"] }));
  let verdict = store.get("verdicts", "skill:" + v2.id);
  assert.equal(verdict.value, "dudoso");
  assert.equal(verdict.confidence, "baja");
  assert.equal(store.get("approvals", "revert:skill:" + v2.id), null);
  for (let i = 0; i < 2; i++) observeMission(store, mission(store, { skillId: v2.id, say: ["Te has equivocado otra vez"] }));
  verdict = store.get("verdicts", "skill:" + v2.id);
  assert.equal(verdict.value, "empeoro");
  assert.equal(verdict.confidence, "media");
  assert.match(verdict.hint, /^Cuando haya que preparar el informe de ventas · medido en «Informe/);
  assert.match(verdict.summary, /3 tareas medidas: 0 bien, 0 sin quejas, 3 con problemas · antes, 100 % de acierto en 3/);
  assert.equal(store.get("skills", v2.id).verdict.value, "empeoro");
  const revert = store.get("approvals", "revert:skill:" + v2.id);
  assert.equal(revert.kind, "revert");
  assert.equal(revert.title, "Volver a la versión 1 de «informe-ventas»");
  decideRevert(store, revert, "approved");
  assert.equal(store.get("skills", v1.id).status, "active");
  assert.equal(store.get("skills", v2.id).status, "disabled");
  assert.ok(isForgotten(store, "skill-patch", v2.content, "nora"), "the worse version is never proposed again");
  assert.equal(store.get("approvals", revert.id).status, "executed");
  // Asked once: a new verdict never asks again.
  computeVerdict(store, "skill", v2.id);
  assert.equal(store.list("approvals").filter((a) => a.kind === "revert").length, 1);
});

test("a version that does better than the one before «ayudó», is consolidated and the curator keeps it", async (t) => {
  const { store } = await fixture(t);
  const v1 = activateSkill(store, importSkill(store, { content: SKILL(), botId: "nora", origin: "learned" }).id, "active");
  for (let i = 0; i < 3; i++) observeMission(store, mission(store, { skillId: v1.id, say: ["Mejor más breve"] }));
  const v2 = activateSkill(store, importSkill(store, { content: SKILL("\n3. Una sola página."), botId: "nora", origin: "learned", previous: v1.id }).id, "active");
  for (let i = 0; i < 3; i++) observeMission(store, mission(store, { skillId: v2.id, react: "🙌" }));
  const skill = store.get("skills", v2.id);
  assert.equal(skill.verdict.value, "ayudo");
  assert.equal(skill.verdict.confidence, "media");
  assert.equal(skill.consolidated, true);
  store.patch("skills", v2.id, { lastUsedAt: "2025-01-01T00:00:00Z", createdAt: "2025-01-01T00:00:00Z", activatedAt: null });
  assert.deepEqual(curateSkills(store, Date.now()).archived, [], "a consolidated skill is never aged out");
  const [first] = listVerdicts(store, { botId: "nora" });
  assert.equal(first.label, "Ayudó");
  assert.equal(first.confidenceLabel, "confianza media");
  assert.equal(first.title, "«informe-ventas» v2");
});

test("learned memories in play are measured with weak attribution: they stay «dudoso» or low confidence", async (t) => {
  const { store } = await fixture(t);
  store.put("memories", { id: "mem", text: "Prefiere el informe de ventas en una página", botId: "nora", target: "user", source: "dedujo", active: true, createdAt: "2026-01-01T00:00:00Z" });
  for (let i = 0; i < 3; i++) observeMission(store, mission(store, { say: ["No, otra vez demasiado largo"] }));
  const verdict = store.get("verdicts", "memory:mem");
  assert.equal(verdict.kind, "memory");
  assert.equal(verdict.confidence, "baja");
  assert.equal(store.get("approvals", "revert:memory:mem"), null, "low confidence never proposes a revert");
  assert.equal(store.get("memories", "mem").consolidated, false);
  // Limited missions are not observed.
  const before = store.list("learningObservations").length;
  observeMission(store, mission(store, { status: "paused", limited: { engine: "chatgpt" } }));
  assert.equal(store.list("learningObservations").length, before);
});
