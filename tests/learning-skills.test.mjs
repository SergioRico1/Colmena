import test from "node:test";
import assert from "node:assert/strict";
import { fixture, answer, call, outputs } from "./fixtures/runtime-fixture.mjs";
import {
  importSkill, activateSkill, applySkillEdits, patchSkill, curateSkills, setSkillPinned, skillDetail,
} from "../server/skills.mjs";
import { skillIndex } from "../server/soul.mjs";

const SKILL = "---\nname: informe-ventas\ndescription: Úsala cuando haya que preparar el informe de ventas\n---\n# Informe\n## Pasos\n1. Lee los datos.\n2. Calcula totales.\n3. Redacta.\n## Comprobacion\nCifras cuadran.\n## Limites\nSin datos inventados.\n";
const DAY = 86400000;

test("minimal patches: exact unique matches only; any miss discards the whole patch", () => {
  const next = applySkillEdits(SKILL, [{ old: "2. Calcula totales.", new: "2. Calcula totales y revisa las unidades." }, { old: "Cifras cuadran.", new: "Cifras y unidades cuadran." }]);
  assert.match(next, /revisa las unidades/);
  assert.match(next, /Cifras y unidades cuadran/);
  assert.throws(() => applySkillEdits(SKILL, [{ old: "2. Calcula totales.", new: "x" }, { old: "no existe", new: "y" }]), /no está en la versión actual/);
  assert.throws(() => applySkillEdits(SKILL + "\nRedacta.", [{ old: "Redacta.", new: "Escribe." }]), /aparece 2 veces/);
  assert.equal(applySkillEdits(SKILL, [{ old: "  3. Redacta.  ", new: "3. Redacta en una página." }]).includes("3. Redacta en una página."), true, "outer spaces are tolerated");
});

test("patchSkill creates a pending version with previous (clean diff) and keeps the name and pin", async (t) => {
  const { store } = await fixture(t, async () => answer("x"));
  const v1 = activateSkill(store, importSkill(store, { content: SKILL, botId: "nora" }).id, "active");
  setSkillPinned(store, v1.id, true);
  const v2 = patchSkill(store, { skillId: v1.id, edits: [{ old: "3. Redacta.", new: "3. Redacta en una página." }], missionId: "m" });
  assert.equal(v2.status, "pending");
  assert.equal(v2.version, 2);
  assert.equal(v2.previous, v1.id);
  assert.equal(v2.pinned, true);
  assert.equal(store.get("skills", v1.id).status, "active");
  assert.equal(skillDetail(store, v2.id).previous.content, SKILL);
  assert.throws(() => patchSkill(store, { skillId: v1.id, edits: [{ old: "name: informe-ventas", new: "name: otra" }] }), /nombre/);
  assert.throws(() => patchSkill(store, { skillId: v1.id, edits: [{ old: "nada de esto", new: "x" }] }), /no está/);
  assert.equal(store.list("skills").length, 2, "failed patches write nothing");
});

test("curator: 30 days → stale (hidden from the index), 90 → archived; pinned, automations and grace respected", async (t) => {
  const { store } = await fixture(t, async () => answer("x"));
  const at = Date.parse("2026-10-15T10:00:00Z");
  const make = (name, extra) => {
    const s = importSkill(store, { content: SKILL.replace("informe-ventas", name), botId: "nora" });
    activateSkill(store, s.id, "active");
    return store.patch("skills", s.id, { createdAt: new Date(at - 200 * DAY).toISOString(), activatedAt: new Date(at - 200 * DAY).toISOString(), ...extra });
  };
  const idle40 = make("idle40", { lastUsedAt: new Date(at - 40 * DAY).toISOString() });
  const idle100 = make("idle100", { lastUsedAt: new Date(at - 100 * DAY).toISOString() });
  const fresh = make("fresh", { lastUsedAt: new Date(at - 2 * DAY).toISOString() });
  const pinned = make("pinned", { lastUsedAt: new Date(at - 100 * DAY).toISOString(), pinned: true });
  const automated = make("automated", { lastUsedAt: new Date(at - 100 * DAY).toISOString() });
  const newborn = make("newborn", { createdAt: new Date(at - 5 * DAY).toISOString(), activatedAt: new Date(at - 5 * DAY).toISOString(), lastUsedAt: null });
  store.put("automations", { id: "a1", name: "Resumen", botId: "nora", prompt: "Usa la habilidad automated para el resumen", enabled: true });
  const r = curateSkills(store, at);
  assert.deepEqual(r.stale, [idle40.id]);
  assert.deepEqual(r.archived, [idle100.id]);
  for (const s of [fresh, pinned, automated, newborn]) assert.equal(store.get("skills", s.id).status, "active", s.name);
  assert.equal(store.list("skills").length, 6, "never deletes");
  const index = skillIndex(store, store.get("bots", "nora")).join("\n");
  assert.doesNotMatch(index, /idle40|idle100/);
  assert.match(index, /fresh \(v1\) — Úsala cuando/);
  // Used again → active again on the next pass; «Reactivar» restarts the clock.
  store.patch("skills", idle40.id, { lastUsedAt: new Date(at + DAY).toISOString() });
  assert.deepEqual(curateSkills(store, at + 2 * DAY).reactivated, [idle40.id]);
  activateSkill(store, idle100.id, "active");
  assert.equal(curateSkills(store, Date.now()).archived.includes(idle100.id), false);
});

test("read_skill (and the skill_view alias) loads a stale skill, records lastUsedAt and reactivates it", async (t) => {
  let id;
  const { store, runtime } = await fixture(t, async ({ input }) => {
    const out = outputs(input);
    if (!out.length) return call("skill_view", { id });
    return answer("v" + out[0].version + " " + out[0].name);
  });
  const s = importSkill(store, { content: SKILL, botId: "nora" });
  activateSkill(store, s.id, "active");
  store.patch("skills", s.id, { status: "stale" });
  id = s.id;
  const m = runtime.create({ prompt: "Informe" });
  await runtime.launch(m.id);
  assert.equal(store.get("missions", m.id).result, "v1 informe-ventas");
  const after = store.get("skills", s.id);
  assert.equal(after.status, "active");
  assert.equal(after.uses, 1);
  assert.ok(after.lastUsedAt);
});
