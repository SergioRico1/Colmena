import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fixture, answer, settle } from "./fixtures/runtime-fixture.mjs";
import { Store } from "../server/store.mjs";
import { Scheduler } from "../server/scheduler.mjs";
import { Notifier } from "../server/notifications.mjs";
import { normalizeTrigger } from "../server/triggers.mjs";
import { quietRun, missingFor, QUIET_MARK } from "../server/quiet.mjs";

test("quietRun strips the mark and tells a quiet run apart", () => {
  assert.deepEqual(quietRun("[SIN NOVEDADES] Revisé el correo: nada nuevo."), { quiet: true, text: "Revisé el correo: nada nuevo." });
  assert.deepEqual(quietRun("  [sin novedades]"), { quiet: true, text: "Sin novedades." });
  assert.deepEqual(quietRun("Hay 2 facturas nuevas."), { quiet: false, text: "Hay 2 facturas nuevas." });
});

test("a run with nothing new is not notified and the next run sees what the last one said", async (t) => {
  const seen = [];
  let round = 0;
  const { store, runtime } = await fixture(t, async ({ input }) => {
    seen.push(JSON.stringify(input));
    round += 1;
    return answer(round === 1 ? "Hay 2 facturas nuevas de Iberdrola." : QUIET_MARK + " Revisé el correo: nada nuevo.");
  });
  const notifier = new Notifier(store);
  notifier.start();
  t.after(() => notifier.stop());
  store.put("automations", { id: "r", name: "Facturas", botId: "nora", prompt: "Revisa facturas", enabled: true, notify: "resultado", trigger: normalizeTrigger({ type: "dia", config: { hora: "08:00", dias: [1] } }) });
  const first = runtime.create({ prompt: "Revisa facturas", title: "Facturas", mode: "solo", botIds: ["nora"], automationId: "r" });
  await runtime.launch(first.id);
  await settle(runtime);
  assert.match(seen[0], /empieza tu respuesta final con \[SIN NOVEDADES\]/);
  assert.equal(store.get("automations", "r").lastSummary, "Hay 2 facturas nuevas de Iberdrola.");
  const second = runtime.create({ prompt: "Revisa facturas", title: "Facturas", mode: "solo", botIds: ["nora"], automationId: "r" });
  await runtime.launch(second.id);
  await settle(runtime);
  assert.match(seen[1], /Lo que contaste en la ejecución anterior[^«]*«Hay 2 facturas nuevas de Iberdrola\.»/);
  const quiet = store.get("missions", second.id);
  assert.equal(quiet.nothingNew, true);
  assert.equal(quiet.result, "Revisé el correo: nada nuevo.");
  const reply = store.list("messages").filter((m) => m.missionId === second.id && m.role === "assistant").at(-1);
  assert.equal(reply.text, "Revisé el correo: nada nuevo.", "the mark never shows in the room");
  const notices = store.list("notifications").filter((n) => n.kind === "done");
  assert.deepEqual(notices.map((n) => n.missionId), [first.id], "only the run with news is notified");
});

test("missingFor names what a rule lacks: its bot, a permission or a connected app", () => {
  const bots = [{ id: "nora", name: "Nora", enabled: true, tools: { correo: "none", hojas: "lee" } }, { id: "vera", name: "Vera", enabled: false, tools: {} }];
  assert.match(missingFor({ botId: "zoe" }, { bots }), /Le falta su bot/);
  assert.match(missingFor({ botId: "vera" }, { bots }), /Vera está desactivado/);
  assert.match(missingFor({ botId: "nora", needs: [{ tool: "correo", access: "lee" }] }, { bots }), /Nora no tiene acceso al correo\. Dáselo en Equipo › Nora › Permisos/);
  const needsSheets = { botId: "nora", needs: [{ tool: "hojas", access: "lee" }] };
  assert.equal(missingFor(needsSheets, { bots, accounts: null }), null, "unknown accounts are not a reason to block");
  assert.match(missingFor(needsSheets, { bots, accounts: [] }), /Le falta conectar Hojas de cálculo/);
  assert.equal(missingFor(needsSheets, { bots, accounts: [{ toolkit: "googlesheets", status: "ACTIVE" }] }), null);
});

test("a rule that lacks something waits blocked, is told once and runs when the gap is filled", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colmena-quiet-"));
  const store = new Store(directory);
  const created = [];
  const runtime = {
    create(input) { created.push(input); return store.put("missions", { id: "m" + created.length, title: input.title, automationId: input.automationId, status: "queued", botIds: input.botIds, createdAt: new Date().toISOString() }); },
    launch() {},
  };
  const scheduler = new Scheduler(store, runtime, () => true);
  t.after(async () => { scheduler.stop(); store.close(); await rm(directory, { recursive: true, force: true }); });
  store.patch("bots", "nora", { tools: { ...store.get("bots", "nora").tools, correo: "none" } });
  store.put("automations", { id: "r", name: "Correo", botId: "nora", prompt: "Resume", enabled: true, needs: [{ tool: "correo", access: "lee" }], trigger: normalizeTrigger({ type: "dia", config: { hora: "08:00", dias: [1] } }), nextRun: new Date(0).toISOString() });
  scheduler.tick();
  scheduler.tick();
  const rule = store.get("automations", "r");
  assert.equal(rule.state, "blocked");
  assert.match(rule.error, /Nora no tiene acceso/);
  assert.equal(created.length, 0);
  assert.equal(store.list("notifications").filter((n) => /no puede ejecutarse/.test(n.title)).length, 1, "told once");
  store.patch("bots", "nora", { tools: { ...store.get("bots", "nora").tools, correo: "lee" } });
  scheduler.tick();
  assert.equal(created.length, 1);
  assert.equal(store.get("automations", "r").blockedBy, null);
});
