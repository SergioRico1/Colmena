import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Store } from "../server/store.mjs";
import { importSkill } from "../server/skills.mjs";
import {
  learnFromMission, learnedInMission, forgetMission, isForgotten, suggestAutomation, retireSuggestions, ideasFromConnections,
  suggestAlwaysApprove,
} from "../server/learning.mjs";
import { Notifier, weekKey, weeklyStats, weeklyText } from "../server/notifications.mjs";
import { useDataDirectory } from "../server/soul.mjs";

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colmena-int-learn-")),
    store = new Store(dir);
  store.patch("settings", "main", { model: "fixture", learning: true });
  useDataDirectory(dir, store);
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { store };
}
const SKILL = (name) => `---\nname: "${name}"\ndescription: "Úsala cuando prepares informes"\n---\n# ${name}\n\n## Pasos\n1. Reúne los datos.\n2. Escribe el informe.\n`;
const reflection = (memText, skillName) => JSON.stringify({
  memory: memText ? [{ action: "add", target: "persona", text: memText, old: "" }] : [],
  skill: skillName ? { action: "create", skillId: null, edits: [], name: skillName, description: "Úsala cuando prepares informes", content: SKILL(skillName) } : { action: "none", skillId: null, edits: [], name: "", description: "", content: "" },
  soul: null,
});

test("«Olvidar lo aprendido aquí»: preview, removal, and never extracted again", async (t) => {
  const { store } = await fixture(t);
  const at = new Date().toISOString();
  store.put("missions", { id: "m1", title: "Informe Q3", prompt: "Prepara el informe trimestral", mode: "solo", botIds: ["nora"], status: "completed", createdAt: at });
  store.put("missions", { id: "m2", title: "Informe Q4", prompt: "Prepara el informe del cuarto trimestre", mode: "solo", botIds: ["nora"], status: "completed", createdAt: at });
  store.put("memories", { id: "mem1", text: "Prefiere informes de una página", botId: "nora", scope: "equipo", target: "user", source: "dedujo", review: true, missionId: "m1", active: true, createdAt: at });
  store.put("memories", { id: "mem2", text: "Trabaja en euros", botId: "nora", scope: "equipo", target: "user", source: "dijiste", missionId: "m1", active: true, createdAt: at });
  const skill = importSkill(store, { content: SKILL("Informe trimestral"), missionId: "m1", botId: "nora", origin: "learned" });
  store.put("approvals", { id: "skill:" + skill.id, missionId: "m1", botId: "nora", kind: "skill", skillId: skill.id, status: "pending", createdAt: at });

  const preview = learnedInMission(store, "m1");
  assert.deepEqual(preview.memories.map((m) => m.id), ["mem1"], "what the person said by hand is never offered");
  assert.deepEqual(preview.skills.map((s) => s.id), [skill.id]);

  assert.deepEqual(forgetMission(store, "m1"), { memories: 1, skills: 1 });
  assert.equal(store.get("memories", "mem1").active, false);
  assert.equal(store.get("memories", "mem1").removed, true);
  assert.equal(store.get("memories", "mem2").active, true);
  assert.equal(store.get("skills", skill.id).status, "disabled");
  assert.equal(store.get("skills", skill.id).removed, true);
  assert.equal(store.get("approvals", "skill:" + skill.id).status, "denied");
  assert.ok(isForgotten(store, "memory", "prefiere INFORMES de una página"));
  assert.ok(isForgotten(store, "skill", "Informe trimestral", "nora"));
  assert.equal(isForgotten(store, "skill", "Informe trimestral", "vera"), false, "skills are forgotten per owner");
  assert.deepEqual(learnedInMission(store, "m1"), { memories: [], skills: [] });

  let calls = 0;
  const infer = async () => {
    calls++;
    return { text: reflection("Prefiere informes de una página", "Informe trimestral") };
  };
  const again = await learnFromMission({ store, missionId: "m1", model: "fixture", infer, force: true });
  assert.equal(again.status, "skipped");
  assert.equal(calls, 0, "a forgotten mission is not reviewed again");

  const other = await learnFromMission({ store, missionId: "m2", model: "fixture", infer, force: true });
  assert.equal(calls, 2, "one call per reviewer (work and subject)");
  assert.equal(other.skill, null, "the forgotten skill is not created again");
  assert.equal(other.memories.length, 0, "the forgotten memory is not saved again");
  assert.ok(other.notes.some((n) => /olvidaste/.test(n)));
  assert.equal(store.list("memories").filter((m) => m.active !== false && m.text === "Prefiere informes de una página").length, 0);
});

test("suggestions carry evidence and retire when the work is already done", async (t) => {
  const { store } = await fixture(t);
  const thursdays = ["2026-10-01T09:10:00", "2026-10-08T09:30:00", "2026-10-15T09:20:00"];
  thursdays.forEach((d, i) => store.put("missions", { id: "w" + i, title: "Resumen semanal", prompt: "Resume los correos de clientes de esta semana", mode: "solo", botIds: ["vera"], status: "completed", createdAt: new Date(d).toISOString() }));
  const s = suggestAutomation(store, store.get("missions", "w2"));
  assert.ok(s, "pattern detected");
  assert.equal(s.evidence.length, 3);
  assert.match(s.evidence[0].source, /^Se lo pediste el 1 de octubre$/);
  assert.equal(s.evidence[0].url, "/misiones/w0");
  assert.match(s.evidence[0].quote, /Resume los correos/);

  for (let i = 0; i < 4; i++)
    store.put("approvals", { id: "ap" + i, botId: "vera", tool: "write_file", canAlways: true, decidedBy: "tú", status: "approved", title: "Crear el archivo " + i, missionId: "w0", createdAt: new Date().toISOString(), decidedAt: new Date().toISOString() });
  const [always] = suggestAlwaysApprove(store);
  assert.equal(always.evidence.length, 4);
  assert.match(always.evidence[0].source, /^Lo aprobaste el/);

  assert.deepEqual(retireSuggestions(store), [], "nothing done yet");
  store.put("automations", { id: "r1", botId: "vera", prompt: "Resume los correos de clientes de esta semana", trigger: { type: "semana", config: {} } });
  store.put("grants", { id: "g1", botId: "vera", tool: "write_file", scope: null, active: true });
  const retired = retireSuggestions(store);
  assert.deepEqual(retired.sort(), [s.id, always.id].sort());
  assert.equal(store.get("suggestions", s.id).status, "retired");
  assert.match(store.get("suggestions", s.id).retiredReason, /Ya existe/);
});

function fakeConnections({ inbox = [], sent = [], grantActive = true } = {}) {
  const log = [];
  let n = 0;
  const pending = new Map();
  return {
    log,
    async call(op, args = {}) {
      log.push(op);
      if (op === "accounts") return { items: [{ id: "acc1", toolkit: "gmail", status: "ACTIVE" }] };
      if (op === "prepare") {
        const proposal = "p" + n++;
        pending.set(proposal, JSON.parse(args.arguments_json || "{}"));
        return { proposal, read_scope: true, read_grant: grantActive ? "grant-gmail" : "grant-missing" };
      }
      if (op === "commit") {
        const a = pending.get(args.proposal);
        return { ok: true, data: { messages: /in:sent/.test(a.query) ? sent : inbox } };
      }
      if (op === "discard") return { ok: true };
      throw Error("op " + op);
    },
  };
}

test("ideas from mail: only with a remembered read permission, with evidence, retired once answered", async (t) => {
  const { store } = await fixture(t);
  // With «Atento a tu correo» on, the watcher tells you about mail instead (tests/watch.test.mjs).
  store.patch("settings", "main", { watch: { enabled: false } });
  const none = await ideasFromConnections(store, fakeConnections());
  assert.equal(none.skipped, "sin permiso de lectura recordado", "without a remembered read permission nothing is read");

  store.put("connectionGrants", { id: "grant-gmail", active: true });
  const inbox = [
    { messageId: "e1", subject: "Presupuesto de imprenta", sender: "Ana Ruiz", preview: { body: "¿Puedes enviarme el presupuesto antes del viernes?" } },
    { messageId: "e2", subject: "Boletín de ofertas", sender: "Tienda", preview: { body: "Las mejores ofertas de la semana." } },
  ];
  const first = await ideasFromConnections(store, fakeConnections({ inbox }));
  assert.equal(first.created.length, 1);
  const idea = first.created[0];
  assert.equal(idea.kind, "idea");
  assert.equal(idea.evidence[0].source, "Correo de Ana Ruiz");
  assert.match(idea.evidence[0].quote, /Presupuesto de imprenta — ¿Puedes enviarme/);
  assert.match(idea.payload.prompt, /No lo envíes/);
  assert.equal((await ideasFromConnections(store, fakeConnections({ inbox }))).created.length, 0, "no duplicates");

  const unremembered = fakeConnections({ inbox, grantActive: false });
  const blocked = await ideasFromConnections(store, unremembered);
  assert.equal(blocked.created.length, 0);
  assert.ok(unremembered.log.includes("discard") && !unremembered.log.includes("commit"), "a read without remembered permission is discarded, never committed");

  const answered = await ideasFromConnections(store, fakeConnections({ inbox, sent: [{ subject: "Re: Presupuesto de imprenta" }] }));
  assert.deepEqual(answered.retired, [idea.id]);
  assert.equal(store.get("suggestions", idea.id).status, "retired");
});

test("weekly summary: Friday from 17:00, once per week, without a model; closing line only with one", async (t) => {
  const { store } = await fixture(t);
  const friday = new Date(2026, 9, 16, 17, 5).getTime();
  const iso = (offset) => new Date(friday - offset).toISOString();
  store.put("missions", { id: "m1", title: "Informe Q3", mode: "equipo", botIds: ["nora", "tomas"], status: "completed", completedAt: iso(86400000), createdAt: iso(2 * 86400000) });
  store.put("missions", { id: "old", title: "Viejo", mode: "solo", botIds: ["vera"], status: "completed", completedAt: iso(10 * 86400000), createdAt: iso(11 * 86400000) });
  store.put("artifacts", { id: "a1", missionId: "m1", title: "informe.md", createdAt: iso(86400000) });
  store.put("approvals", { id: "ap1", missionId: "m1", decidedBy: "tú", status: "approved", decidedAt: iso(3600000) });
  importSkill(store, { content: SKILL("Informe trimestral"), missionId: "m1", botId: "nora", origin: "learned" });
  // Learned yesterday, whatever the real clock says when the tests run.
  for (const sk of store.list("skills")) store.patch("skills", sk.id, { createdAt: iso(86400000) });
  const stats = weeklyStats(store, friday - 7 * 86400000, friday);
  assert.deepEqual([stats.missions, stats.artifacts, stats.approvals, stats.skills], [1, 1, 1, 1]);
  assert.equal(weeklyText(stats), "1 misión terminada · 1 entregable nuevo · 1 aprobación tuya · 1 habilidad aprendida.");

  let clock = new Date(2026, 9, 15, 17, 30).getTime(); // Thursday
  const notifier = new Notifier(store, { emit: () => {}, clock: () => clock });
  let closerCalls = 0;
  notifier.closer = async (digest) => {
    closerCalls++;
    return "Buena semana: el informe ya está en la Biblioteca.\nOtra línea";
  };
  assert.equal(notifier.maybeWeekly(clock), null, "only the scheduler's (started) notifier");
  notifier.start();
  t.after(() => notifier.stop());
  assert.equal(notifier.maybeWeekly(clock), null, "not on Thursday");
  clock = new Date(2026, 9, 16, 16, 59).getTime();
  assert.equal(notifier.maybeWeekly(clock), null, "not before 17:00");
  clock = friday;
  notifier.maybeRound(clock);
  const key = weekKey(new Date(friday));
  const digest = store.get("weeklyDigests", key);
  assert.ok(digest);
  assert.equal(digest.stats.missions, 1);
  const n = store.list("notifications").filter((x) => x.kind === "digest");
  assert.equal(n.length, 1);
  assert.equal(n[0].weekly, key);
  assert.match(n[0].title, /resumen de la semana/);
  notifier.lastRound = 0;
  notifier.maybeRound(friday + 3600000);
  assert.equal(store.list("notifications").filter((x) => x.kind === "digest" && x.weekly).length, 1, "once per week");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(closerCalls, 1);
  assert.equal(store.get("weeklyDigests", key).closing, "Buena semana: el informe ya está en la Biblioteca.");
});
